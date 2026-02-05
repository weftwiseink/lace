// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as net from "node:net";
import {
  LACE_PORT_MIN,
  LACE_PORT_MAX,
  CONTAINER_SSH_PORT,
  isPortAvailable,
  findAvailablePort,
  parseAppPort,
  readPortAssignment,
  writePortAssignment,
  assignPort,
} from "../port-manager";

describe("port-manager constants", () => {
  it("defines the correct port range", () => {
    expect(LACE_PORT_MIN).toBe(22425);
    expect(LACE_PORT_MAX).toBe(22499);
    expect(CONTAINER_SSH_PORT).toBe(2222);
  });

  it("has 75 ports in the range", () => {
    expect(LACE_PORT_MAX - LACE_PORT_MIN + 1).toBe(75);
  });
});

describe("parseAppPort", () => {
  it("parses valid port mapping string", () => {
    expect(parseAppPort("22425:2222")).toBe(22425);
    expect(parseAppPort("22499:2222")).toBe(22499);
  });

  it("parses array format", () => {
    expect(parseAppPort(["22427:2222"])).toBe(22427);
    expect(parseAppPort(["22427:2222", "3000:3000"])).toBe(22427);
  });

  it("returns null for out-of-range ports", () => {
    expect(parseAppPort("22424:2222")).toBeNull(); // Below min
    expect(parseAppPort("22500:2222")).toBeNull(); // Above max
    expect(parseAppPort("2222:2222")).toBeNull();  // Old format
  });

  it("returns null for wrong container port", () => {
    expect(parseAppPort("22425:3000")).toBeNull();
    expect(parseAppPort("22425:22")).toBeNull();
  });

  it("returns null for invalid formats", () => {
    expect(parseAppPort(null)).toBeNull();
    expect(parseAppPort(undefined)).toBeNull();
    expect(parseAppPort("")).toBeNull();
    expect(parseAppPort("22425")).toBeNull();
    expect(parseAppPort(":2222")).toBeNull();
    expect(parseAppPort([])).toBeNull();
  });
});

describe("isPortAvailable", () => {
  let server: net.Server | null = null;
  const testPort = 22450; // Use a port in the middle of the range

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("returns true for available port", async () => {
    const available = await isPortAvailable(testPort);
    expect(available).toBe(true);
  });

  it("returns false for port in use", async () => {
    // Start a server on the test port
    server = net.createServer();
    await new Promise<void>((resolve) => {
      server!.listen(testPort, "localhost", () => resolve());
    });

    const available = await isPortAvailable(testPort);
    expect(available).toBe(false);
  });
});

describe("port assignment file operations", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `lace-test-port-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  describe("readPortAssignment", () => {
    it("returns null when .lace/devcontainer.json does not exist", () => {
      expect(readPortAssignment(workspaceRoot)).toBeNull();
    });

    it("reads port from existing config", () => {
      const laceDir = join(workspaceRoot, ".lace");
      mkdirSync(laceDir, { recursive: true });
      writeFileSync(
        join(laceDir, "devcontainer.json"),
        JSON.stringify({ appPort: ["22430:2222"] }),
        "utf-8"
      );

      expect(readPortAssignment(workspaceRoot)).toBe(22430);
    });

    it("returns null for invalid config", () => {
      const laceDir = join(workspaceRoot, ".lace");
      mkdirSync(laceDir, { recursive: true });
      writeFileSync(
        join(laceDir, "devcontainer.json"),
        "{ invalid json",
        "utf-8"
      );

      expect(readPortAssignment(workspaceRoot)).toBeNull();
    });
  });

  describe("writePortAssignment", () => {
    it("creates .lace directory and config file", () => {
      writePortAssignment(workspaceRoot, 22435);

      const configPath = join(workspaceRoot, ".lace", "devcontainer.json");
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.appPort).toEqual(["22435:2222"]);
    });

    it("preserves existing config values", () => {
      const laceDir = join(workspaceRoot, ".lace");
      mkdirSync(laceDir, { recursive: true });
      writeFileSync(
        join(laceDir, "devcontainer.json"),
        JSON.stringify({ customSetting: true, appPort: ["old:old"] }),
        "utf-8"
      );

      writePortAssignment(workspaceRoot, 22436);

      const config = JSON.parse(
        readFileSync(join(laceDir, "devcontainer.json"), "utf-8")
      );
      expect(config.customSetting).toBe(true);
      expect(config.appPort).toEqual(["22436:2222"]);
    });
  });
});

describe("assignPort", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `lace-test-assign-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("assigns first available port for new project", async () => {
    const result = await assignPort(workspaceRoot);

    expect(result.assignment.hostPort).toBeGreaterThanOrEqual(LACE_PORT_MIN);
    expect(result.assignment.hostPort).toBeLessThanOrEqual(LACE_PORT_MAX);
    expect(result.assignment.containerPort).toBe(CONTAINER_SSH_PORT);
    expect(result.wasReassigned).toBe(false);

    // Verify it was persisted
    const persisted = readPortAssignment(workspaceRoot);
    expect(persisted).toBe(result.assignment.hostPort);
  });

  it("reuses existing port if available", async () => {
    // Pre-assign a port
    writePortAssignment(workspaceRoot, 22450);

    const result = await assignPort(workspaceRoot);

    expect(result.assignment.hostPort).toBe(22450);
    expect(result.wasReassigned).toBe(false);
  });

  it("reassigns if existing port is in use", async () => {
    // Pre-assign a port and block it
    const blockedPort = 22451;
    writePortAssignment(workspaceRoot, blockedPort);

    // Start a server on the blocked port
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(blockedPort, "localhost", () => resolve());
    });

    try {
      const result = await assignPort(workspaceRoot);

      expect(result.assignment.hostPort).not.toBe(blockedPort);
      expect(result.assignment.hostPort).toBeGreaterThanOrEqual(LACE_PORT_MIN);
      expect(result.assignment.hostPort).toBeLessThanOrEqual(LACE_PORT_MAX);
      expect(result.wasReassigned).toBe(true);
      expect(result.previousPort).toBe(blockedPort);
    } finally {
      server.close();
    }
  });
});
