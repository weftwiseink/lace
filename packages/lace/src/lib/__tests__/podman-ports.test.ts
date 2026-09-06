// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { getAllPublishedHostPorts } from "@/lib/podman-ports";
import type { RunSubprocess, SubprocessResult } from "@/lib/subprocess";

/** Build a canned `podman ps -a --format json` payload. */
function psJson(entries: unknown[]): SubprocessResult {
  return { exitCode: 0, stdout: JSON.stringify(entries), stderr: "" };
}

describe("getAllPublishedHostPorts", () => {
  it("parses running, stopped, and non-lace containers with correct ports and localFolder", () => {
    const mock: RunSubprocess = (_command, args) => {
      if (args[0] === "ps") {
        return psJson([
          {
            Id: "running-lace",
            State: "running",
            Labels: { "devcontainer.local_folder": "/work/whelm" },
            Ports: [
              { host_ip: "0.0.0.0", host_port: 22425, container_port: 2222, protocol: "tcp" },
            ],
          },
          {
            Id: "stopped-lace",
            State: "exited",
            Labels: { "devcontainer.local_folder": "/work/jif" },
            Ports: [
              { host_ip: "0.0.0.0", host_port: 22428, container_port: 2222, protocol: "tcp" },
            ],
          },
          {
            Id: "non-lace",
            State: "running",
            Labels: { "some.other.label": "x" },
            Ports: [
              { host_ip: "0.0.0.0", host_port: 33000, container_port: 80, protocol: "tcp" },
            ],
          },
        ]);
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    };

    const published = getAllPublishedHostPorts(mock);
    expect(published).toEqual([
      { port: 22425, containerId: "running-lace", localFolder: "/work/whelm" },
      { port: 22428, containerId: "stopped-lace", localFolder: "/work/jif" },
      { port: 33000, containerId: "non-lace", localFolder: null },
    ]);
  });

  it("contributes nothing for a container with an empty or absent Ports array", () => {
    const mock: RunSubprocess = (_command, args) => {
      if (args[0] === "ps") {
        return psJson([
          { Id: "no-ports-a", State: "running", Labels: {}, Ports: [] },
          { Id: "no-ports-b", State: "created", Labels: {} },
        ]);
      }
      // No inspect fallback should find anything either.
      return { exitCode: 0, stdout: "null", stderr: "" };
    };

    expect(getAllPublishedHostPorts(mock)).toEqual([]);
  });

  it("falls back to `podman inspect .HostConfig.PortBindings` when ps -a omits stopped host ports", () => {
    const mock: RunSubprocess = (_command, args) => {
      if (args[0] === "ps") {
        // Stopped container reported by ps -a but WITHOUT host ports (older podman).
        return psJson([
          {
            Id: "stopped-omitted",
            State: "exited",
            Labels: { "devcontainer.local_folder": "/work/jif" },
            Ports: [],
          },
        ]);
      }
      if (args[0] === "inspect") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            "2222/tcp": [{ HostIp: "0.0.0.0", HostPort: "22488" }],
          }),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    };

    expect(getAllPublishedHostPorts(mock)).toEqual([
      { port: 22488, containerId: "stopped-omitted", localFolder: "/work/jif" },
    ]);
  });

  it("does not call inspect when ps -a already reports host ports", () => {
    const calls: string[][] = [];
    const mock: RunSubprocess = (_command, args) => {
      calls.push(args);
      if (args[0] === "ps") {
        return psJson([
          {
            Id: "c1",
            Labels: { "devcontainer.local_folder": "/work/a" },
            Ports: [{ host_port: 22440, container_port: 2222, protocol: "tcp" }],
          },
        ]);
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    };

    getAllPublishedHostPorts(mock);
    expect(calls.some((a) => a[0] === "inspect")).toBe(false);
  });

  it("tolerates an empty container list", () => {
    const mock: RunSubprocess = () => psJson([]);
    expect(getAllPublishedHostPorts(mock)).toEqual([]);
  });

  it("returns [] on a non-zero ps -a exit (degrade to ledger arm)", () => {
    const mock: RunSubprocess = () => ({
      exitCode: 125,
      stdout: "",
      stderr: "podman: command not found",
    });
    expect(getAllPublishedHostPorts(mock)).toEqual([]);
  });

  it("returns [] on unparseable ps -a output", () => {
    const mock: RunSubprocess = () => ({
      exitCode: 0,
      stdout: "not json",
      stderr: "",
    });
    expect(getAllPublishedHostPorts(mock)).toEqual([]);
  });

  it("ignores zero / non-integer host_port values", () => {
    const mock: RunSubprocess = (_command, args) => {
      if (args[0] === "ps") {
        return psJson([
          {
            Id: "c1",
            Labels: { "devcontainer.local_folder": "/work/a" },
            Ports: [
              { host_port: 0, container_port: 2222, protocol: "tcp" },
              { host_port: 22450, container_port: 8080, protocol: "tcp" },
            ],
          },
        ]);
      }
      return { exitCode: 0, stdout: "null", stderr: "" };
    };

    expect(getAllPublishedHostPorts(mock)).toEqual([
      { port: 22450, containerId: "c1", localFolder: "/work/a" },
    ]);
  });
});
