// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as net from "node:net";
import { PortAllocator, LACE_PORT_MIN, LACE_PORT_MAX } from "../port-allocator";

describe("PortAllocator", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `lace-test-allocator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  // Scenario 1: Fresh allocation
  it("allocates the first available port for a new label", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    const alloc = await allocator.allocate("wezterm-server/sshPort");

    expect(alloc.label).toBe("wezterm-server/sshPort");
    expect(alloc.port).toBeGreaterThanOrEqual(LACE_PORT_MIN);
    expect(alloc.port).toBeLessThanOrEqual(LACE_PORT_MAX);
    expect(alloc.assignedAt).toBeTruthy();
  });

  // Scenario 2: Stable reuse
  it("reuses existing assignment if port is still available", async () => {
    const laceDir = join(workspaceRoot, ".lace");
    mkdirSync(laceDir, { recursive: true });
    writeFileSync(
      join(laceDir, "port-assignments.json"),
      JSON.stringify({
        assignments: {
          "wezterm-server/sshPort": {
            label: "wezterm-server/sshPort",
            port: 22430,
            assignedAt: "2026-02-06T00:00:00.000Z",
          },
        },
      }),
      "utf-8",
    );

    const allocator = new PortAllocator(workspaceRoot);
    const alloc = await allocator.allocate("wezterm-server/sshPort");

    expect(alloc.port).toBe(22430);
    expect(alloc.assignedAt).toBe("2026-02-06T00:00:00.000Z");
  });

  // Scenario 3: Reassignment when port is in use
  it("reassigns when existing port is in use", async () => {
    const blockedPort = 22430;

    const laceDir = join(workspaceRoot, ".lace");
    mkdirSync(laceDir, { recursive: true });
    writeFileSync(
      join(laceDir, "port-assignments.json"),
      JSON.stringify({
        assignments: {
          "wezterm-server/sshPort": {
            label: "wezterm-server/sshPort",
            port: blockedPort,
            assignedAt: "2026-02-06T00:00:00.000Z",
          },
        },
      }),
      "utf-8",
    );

    // Block the port with a server
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(blockedPort, "localhost", () => resolve());
    });

    try {
      const allocator = new PortAllocator(workspaceRoot);
      const alloc = await allocator.allocate("wezterm-server/sshPort");

      expect(alloc.port).not.toBe(blockedPort);
      expect(alloc.port).toBeGreaterThanOrEqual(LACE_PORT_MIN);
      expect(alloc.port).toBeLessThanOrEqual(LACE_PORT_MAX);
    } finally {
      server.close();
    }
  });

  // Scenario 4: Multiple labels get distinct ports
  it("allocates distinct ports for different labels", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    const alloc1 = await allocator.allocate("wezterm-server/sshPort");
    const alloc2 = await allocator.allocate("debug-proxy/debugPort");

    expect(alloc1.port).not.toBe(alloc2.port);
    expect(alloc1.label).toBe("wezterm-server/sshPort");
    expect(alloc2.label).toBe("debug-proxy/debugPort");
  });

  // Scenario 5: Same label always returns same port
  it("returns the same port for the same label on repeated calls", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    const alloc1 = await allocator.allocate("wezterm-server/sshPort");
    const alloc2 = await allocator.allocate("wezterm-server/sshPort");

    expect(alloc1.port).toBe(alloc2.port);
  });

  // Scenario 6: Save and reload
  it("persists assignments and reloads them", async () => {
    const allocator1 = new PortAllocator(workspaceRoot);
    const alloc = await allocator1.allocate("wezterm-server/sshPort");
    allocator1.save();

    // Verify file exists
    const filePath = join(workspaceRoot, ".lace", "port-assignments.json");
    expect(existsSync(filePath)).toBe(true);

    // Create a new allocator and verify it loads the saved assignment
    const allocator2 = new PortAllocator(workspaceRoot);
    const alloc2 = await allocator2.allocate("wezterm-server/sshPort");

    expect(alloc2.port).toBe(alloc.port);
    expect(alloc2.assignedAt).toBe(alloc.assignedAt);
  });

  // Scenario: Save creates .lace directory if needed
  it("creates .lace directory on save if it does not exist", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    await allocator.allocate("test/port");
    allocator.save();

    expect(existsSync(join(workspaceRoot, ".lace"))).toBe(true);
    expect(
      existsSync(join(workspaceRoot, ".lace", "port-assignments.json")),
    ).toBe(true);
  });

  // Scenario: Corrupt file is handled gracefully
  it("handles corrupt port-assignments.json gracefully", async () => {
    const laceDir = join(workspaceRoot, ".lace");
    mkdirSync(laceDir, { recursive: true });
    writeFileSync(
      join(laceDir, "port-assignments.json"),
      "{ corrupt json",
      "utf-8",
    );

    const allocator = new PortAllocator(workspaceRoot);
    const alloc = await allocator.allocate("wezterm-server/sshPort");

    expect(alloc.port).toBeGreaterThanOrEqual(LACE_PORT_MIN);
    expect(alloc.port).toBeLessThanOrEqual(LACE_PORT_MAX);
  });

  // Scenario: getAllocations returns all tracked allocations
  it("getAllocations returns all allocations", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    await allocator.allocate("wezterm-server/sshPort");
    await allocator.allocate("debug-proxy/debugPort");

    const all = allocator.getAllocations();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.label)).toContain("wezterm-server/sshPort");
    expect(all.map((a) => a.label)).toContain("debug-proxy/debugPort");
  });

  // Scenario: Saved file has expected structure
  it("saves assignments in the expected JSON structure", async () => {
    const allocator = new PortAllocator(workspaceRoot);
    const alloc = await allocator.allocate("wezterm-server/sshPort");
    allocator.save();

    const filePath = join(workspaceRoot, ".lace", "port-assignments.json");
    const saved = JSON.parse(readFileSync(filePath, "utf-8"));

    expect(saved).toHaveProperty("assignments");
    expect(saved.assignments["wezterm-server/sshPort"]).toEqual({
      label: "wezterm-server/sshPort",
      port: alloc.port,
      assignedAt: alloc.assignedAt,
    });
  });
});
