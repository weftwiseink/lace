// IMPLEMENTATION_VALIDATION
//
// Sub-check: scans resolved feature metadata for ports declaring
// `portlessAlias: true`, emits the URL hint, and probes whether the
// shared host portless port (:1355) is free or held by an unrelated
// process.
//
// The check is diagnostic. It does not mutate state. Spawn / alias-shellout
// is the responsibility of `lace up` itself (see host-portless.ts and the
// up.ts integration); validate only reports.
//
// Dedupe: a project may declare multiple `portlessAlias` ports (e.g., one
// for a future second proxy). The info lines should print once per
// validate run, not once per declaration.
import {
  type FeatureMetadata,
  extractLaceCustomizations,
} from "./feature-metadata";
import {
  type PortAllocation,
  isPortAvailable,
} from "./port-allocator";
import { HOST_PORTLESS_PORT } from "./host-portless";
import { extractFeatureShortId } from "./template-resolver";

export interface PortlessAliasFinding {
  /** Allocation label (e.g., `portless/proxyPort`). */
  label: string;
  /** Lace-allocated host port for the container portless. */
  port: number;
  /** Whether the shared host port :1355 is free (or held by lace itself). */
  hostPortFree: boolean;
  /** Project name used for the alias URL hint. */
  projectName: string;
}

export interface PortlessAliasCheckResult {
  findings: PortlessAliasFinding[];
  /** Human-readable lines, in emission order. */
  messages: string[];
}

/**
 * Run the portlessAlias sub-check.
 *
 * For each feature port declaring `portlessAlias: true`:
 *   1. Locate the corresponding live allocation by label
 *      (`${featureShortId}/${optionName}`).
 *   2. Probe whether the host portless port (`:1355`) is available
 *      (or held by lace itself per the runtime file).
 *   3. Emit info lines describing the URL pattern at `:1355`, once per
 *      validate run.
 *
 * Returns the findings and a list of messages (info + warn) intended
 * for stdout. Callers decide how to surface them.
 */
export async function checkPortlessAliases(opts: {
  metadataMap: Map<string, FeatureMetadata | null>;
  allocations: PortAllocation[];
  /** Ports held by lace's own running containers (treated as "free" from the user's POV). */
  ownedPorts: Set<number>;
  projectName: string;
  /** Override the shared host port for testing. Defaults to HOST_PORTLESS_PORT (1355). */
  hostPortlessPort?: number;
  /** Override the port-availability probe for testing. */
  isPortAvailable?: (port: number) => Promise<boolean>;
  /**
   * Optional list of PIDs lace believes are owned by it (e.g., the host
   * portless runtime file's pid). Used purely to suppress "unrelated
   * process" warns when the port is bound by a lace daemon.
   */
  laceOwnedPids?: Set<number>;
}): Promise<PortlessAliasCheckResult> {
  const {
    metadataMap,
    allocations,
    projectName,
    hostPortlessPort = HOST_PORTLESS_PORT,
    isPortAvailable: probe = isPortAvailable,
  } = opts;
  const findings: PortlessAliasFinding[] = [];
  const messages: string[] = [];

  const allocationsByLabel = new Map<string, PortAllocation>();
  for (const a of allocations) {
    allocationsByLabel.set(a.label, a);
  }

  let infoEmitted = false;

  for (const [fullRef, metadata] of metadataMap) {
    if (!metadata) continue;
    const shortId = extractFeatureShortId(fullRef);
    const laceCustom = extractLaceCustomizations(metadata);
    if (!laceCustom?.ports) continue;

    for (const [optionName, decl] of Object.entries(laceCustom.ports)) {
      if (decl.portlessAlias !== true) continue;
      const label = `${shortId}/${optionName}`;
      const allocation = allocationsByLabel.get(label);
      if (!allocation) {
        // The flag was declared but no allocation exists. This can
        // happen if the feature is declared but `${lace.port()}`
        // injection did not fire. Surface a soft warning rather than
        // a hard error.
        messages.push(
          `warn: portlessAlias declared on ${label} but no host-port allocation was made; skipping availability check.`,
        );
        continue;
      }

      // The container portless's host-allocated port is owned by the
      // project's container. The user-collision risk lives on the
      // shared host port (:1355), not the per-project allocation.
      const hostPortFree = await probe(hostPortlessPort);
      findings.push({
        label,
        port: allocation.port,
        hostPortFree,
        projectName,
      });

      if (!infoEmitted) {
        messages.push(
          `info: portless feature detected (alias=${projectName}); URLs at http://{branch}.${projectName}.localhost:${hostPortlessPort}/.`,
        );
        messages.push(
          `info: port-80 binding is tracked in cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md.`,
        );
        if (hostPortFree) {
          messages.push(
            `info: host port ${hostPortlessPort} is free; lace will spawn the host portless on lace up.`,
          );
        } else {
          messages.push(
            `warn: host port ${hostPortlessPort} is held by another process; lace up will skip alias registration. ` +
              `Free the port (e.g., 'lace doctor --reset' if you suspect a stale lace daemon, or 'lsof -iTCP:${hostPortlessPort}') and retry.`,
          );
        }
        infoEmitted = true;
      }
    }
  }

  return { findings, messages };
}
