// IMPLEMENTATION_VALIDATION
import type { RunSubprocess } from "./subprocess";
import { getPodmanCommand } from "./container-runtime";

/**
 * A single published host port observed across ALL podman containers,
 * regardless of run-state (running, exited, created).
 */
export interface PublishedPort {
  /** The host port a container publishes (the `-p <host>:<container>` left side). */
  port: number;
  /** The podman container id publishing it. */
  containerId: string;
  /** The `devcontainer.local_folder` label, joining this port to a lace project, or null for a non-lace container. */
  localFolder: string | null;
}

/**
 * Shape of a single element of `podman ps -a --format json`.
 * Only the fields we consume are typed; podman emits many more.
 *
 * `Ports[].host_port` is an integer, present and non-zero only when a
 * container actually publishes a host port. A container with no published
 * ports has an empty or absent `Ports` array.
 */
interface PodmanPsEntry {
  Id?: string;
  State?: string;
  Labels?: Record<string, string> | null;
  Ports?: Array<{
    host_ip?: string;
    host_port?: number;
    container_port?: number;
    protocol?: string;
  }> | null;
}

/** Shape of `podman inspect --format '{{json .HostConfig.PortBindings}}'`. */
type HostConfigPortBindings = Record<
  string,
  Array<{ HostIp?: string; HostPort?: string }> | null
> | null;

/**
 * Enumerate every published host port across ALL podman containers on the
 * machine, running or not, joined to their `devcontainer.local_folder` label.
 *
 * Unlike {@link getContainerHostPorts}, this is NOT scoped to one project and
 * DOES include non-running containers, which is what lets the exclusion path
 * see a stopped sibling's reserved port.
 *
 * Primary source: `podman ps -a --format json`, reading `Ports[].host_port`.
 * On podman 5.8.2 a stopped (`State: "exited"`) container still reports its
 * `host_port` here; see the proposal NOTE on version-dependence.
 *
 * Fallback: for any container that `ps -a` lists but reports NO host ports for
 * (a podman version/runtime that omits stopped host ports from `ps -a`), fall
 * back to `podman inspect <id> --format '{{json .HostConfig.PortBindings}}'`,
 * a config-sourced view that persists across stop.
 *
 * Fails safe: a non-zero `ps -a` exit or unparseable output yields `[]` so the
 * allocator degrades to the ledger arm rather than throwing.
 */
export function getAllPublishedHostPorts(
  subprocess: RunSubprocess,
): PublishedPort[] {
  const psResult = subprocess(getPodmanCommand(), [
    "ps",
    "-a",
    "--format",
    "json",
  ]);
  if (psResult.exitCode !== 0) return [];

  let entries: PodmanPsEntry[];
  try {
    const parsed = JSON.parse(psResult.stdout || "[]");
    entries = Array.isArray(parsed) ? (parsed as PodmanPsEntry[]) : [];
  } catch {
    // Unparseable podman output: degrade to the ledger arm rather than throw.
    return [];
  }

  const published: PublishedPort[] = [];
  for (const entry of entries) {
    const containerId = entry.Id ?? "";
    const localFolder = entry.Labels?.["devcontainer.local_folder"] ?? null;

    const ports = collectHostPorts(entry.Ports);
    if (ports.size === 0 && containerId) {
      // ps -a reported no host ports for this container. It may genuinely have
      // none, or this podman version omits stopped-container host ports from
      // `ps -a`; consult the config-sourced inspect view to be sure.
      for (const port of inspectHostPorts(subprocess, containerId)) {
        ports.add(port);
      }
    }

    for (const port of ports) {
      published.push({ port, containerId, localFolder });
    }
  }
  return published;
}

/** Read valid, non-zero `host_port` integers from a `ps -a` entry's `Ports`. */
function collectHostPorts(
  portsField: PodmanPsEntry["Ports"],
): Set<number> {
  const ports = new Set<number>();
  if (!Array.isArray(portsField)) return ports;
  for (const p of portsField) {
    const hp = p?.host_port;
    if (typeof hp === "number" && Number.isInteger(hp) && hp > 0) {
      ports.add(hp);
    }
  }
  return ports;
}

/**
 * Config-sourced fallback: `podman inspect <id> --format '{{json .HostConfig.PortBindings}}'`
 * returns e.g. `{"2222/tcp":[{"HostIp":"0.0.0.0","HostPort":"22488"}]}` and
 * persists across container stop. Returns an empty set on any error.
 */
function inspectHostPorts(
  subprocess: RunSubprocess,
  containerId: string,
): Set<number> {
  const ports = new Set<number>();
  const result = subprocess(getPodmanCommand(), [
    "inspect",
    containerId,
    "--format",
    "{{json .HostConfig.PortBindings}}",
  ]);
  if (result.exitCode !== 0) return ports;

  let bindings: HostConfigPortBindings;
  try {
    bindings = JSON.parse((result.stdout || "null").trim());
  } catch {
    return ports;
  }
  if (!bindings || typeof bindings !== "object") return ports;

  for (const list of Object.values(bindings)) {
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      const hp = Number(b?.HostPort);
      if (Number.isInteger(hp) && hp > 0) ports.add(hp);
    }
  }
  return ports;
}
