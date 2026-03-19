// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { getContainerHostPorts } from "@/lib/up";
import type { RunSubprocess } from "@/lib/subprocess";

describe("getContainerHostPorts", () => {
  it("parses host ports from docker port output", () => {
    const mock: RunSubprocess = (command, args) => {
      if (args[0] === "ps") {
        return { exitCode: 0, stdout: "abc123def\n", stderr: "" };
      }
      if (args[0] === "port") {
        return {
          exitCode: 0,
          stdout: [
            "2222/tcp -> 0.0.0.0:22425",
            "8080/tcp -> 0.0.0.0:22426",
            "9090/tcp -> :::22427",
            "3000/tcp -> 127.0.0.1:22428",
          ].join("\n"),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    };

    const ports = getContainerHostPorts("/workspace/test", mock);
    expect(ports).toEqual(new Set([22425, 22426, 22427, 22428]));
  });

  it("returns empty set when no container is running", () => {
    const mock: RunSubprocess = () => ({
      exitCode: 0,
      stdout: "\n",
      stderr: "",
    });

    const ports = getContainerHostPorts("/workspace/test", mock);
    expect(ports.size).toBe(0);
  });

  it("returns empty set when docker ps fails", () => {
    const mock: RunSubprocess = () => ({
      exitCode: 1,
      stdout: "",
      stderr: "docker not found",
    });

    const ports = getContainerHostPorts("/workspace/test", mock);
    expect(ports.size).toBe(0);
  });

  it("returns empty set when docker port fails", () => {
    const mock: RunSubprocess = (command, args) => {
      if (args[0] === "ps") {
        return { exitCode: 0, stdout: "abc123\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "no such container" };
    };

    const ports = getContainerHostPorts("/workspace/test", mock);
    expect(ports.size).toBe(0);
  });

  it("passes correct workspace folder as docker filter", () => {
    const calls: string[][] = [];
    const mock: RunSubprocess = (command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    getContainerHostPorts("/my/workspace", mock);
    expect(calls[0]).toContain(
      "label=devcontainer.local_folder=/my/workspace",
    );
  });
});
