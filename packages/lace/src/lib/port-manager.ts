// IMPLEMENTATION_VALIDATION
import * as net from "node:net";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as jsonc from "jsonc-parser";

// Port range for lace devcontainer SSH servers
// w=22, e=4, z=25 spells "wez" in alphabet positions
export const LACE_PORT_MIN = 22425;
export const LACE_PORT_MAX = 22499;
export const CONTAINER_SSH_PORT = 2222;

export interface PortAssignment {
  hostPort: number;
  containerPort: number;
}

export interface PortAssignmentResult {
  assignment: PortAssignment;
  wasReassigned: boolean;
  previousPort?: number;
}

/**
 * Check if a port is available (not in use) on localhost.
 * Uses TCP connect with a short timeout.
 *
 * @param port Port number to check
 * @param timeout Connection timeout in milliseconds (default 100ms)
 * @returns Promise that resolves to true if port is available, false if in use
 */
export function isPortAvailable(port: number, timeout = 100): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // Port is in use
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(true); // Port is available (connection timed out)
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(true); // Port is available (connection refused or other error)
    });

    socket.connect(port, "localhost");
  });
}

/**
 * Find the first available port in the lace port range.
 *
 * @returns Promise that resolves to an available port, or null if all ports are in use
 */
export async function findAvailablePort(): Promise<number | null> {
  for (let port = LACE_PORT_MIN; port <= LACE_PORT_MAX; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Parse the appPort from a devcontainer.json to extract the host port.
 *
 * Expected format: "22425:2222" or ["22425:2222"]
 *
 * @param appPort The appPort value from devcontainer.json
 * @returns The host port number, or null if not found/invalid
 */
export function parseAppPort(appPort: unknown): number | null {
  if (!appPort) {
    return null;
  }

  // Handle array format
  let portSpec: string;
  if (Array.isArray(appPort)) {
    if (appPort.length === 0) {
      return null;
    }
    portSpec = String(appPort[0]);
  } else {
    portSpec = String(appPort);
  }

  // Parse "hostPort:containerPort" format
  const match = portSpec.match(/^(\d+):(\d+)$/);
  if (!match) {
    return null;
  }

  const hostPort = parseInt(match[1], 10);
  const containerPort = parseInt(match[2], 10);

  // Validate host port is in lace range
  if (hostPort < LACE_PORT_MIN || hostPort > LACE_PORT_MAX) {
    return null;
  }

  // Validate container port is the expected SSH port
  if (containerPort !== CONTAINER_SSH_PORT) {
    return null;
  }

  return hostPort;
}

/**
 * Read the current port assignment from .lace/devcontainer.json.
 *
 * @param workspaceFolder Path to the workspace folder
 * @returns The assigned host port, or null if not configured
 */
export function readPortAssignment(workspaceFolder: string): number | null {
  const configPath = join(workspaceFolder, ".lace", "devcontainer.json");

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const errors: jsonc.ParseError[] = [];
    const config = jsonc.parse(content, errors) as Record<string, unknown>;

    if (errors.length > 0) {
      return null;
    }

    return parseAppPort(config.appPort);
  } catch {
    return null;
  }
}

/**
 * Write or update the port assignment in .lace/devcontainer.json.
 * Preserves other config values if the file already exists.
 *
 * @param workspaceFolder Path to the workspace folder
 * @param hostPort The host port to assign
 */
export function writePortAssignment(
  workspaceFolder: string,
  hostPort: number
): void {
  const laceDir = join(workspaceFolder, ".lace");
  const configPath = join(laceDir, "devcontainer.json");

  // Ensure .lace directory exists
  mkdirSync(laceDir, { recursive: true });

  // Read existing config if present
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const errors: jsonc.ParseError[] = [];
      const parsed = jsonc.parse(content, errors) as Record<string, unknown>;
      if (errors.length === 0) {
        config = parsed;
      }
    } catch {
      // If we can't read the existing file, start fresh
    }
  }

  // Set the appPort
  config.appPort = [`${hostPort}:${CONTAINER_SSH_PORT}`];

  // Write back
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Assign a port for a lace devcontainer.
 *
 * Port assignment algorithm:
 * 1. Read existing port from .lace/devcontainer.json if present
 * 2. If port is in valid range and available, use it (stable port)
 * 3. If port is not available or not configured, find first available port
 * 4. Update .lace/devcontainer.json with the port
 *
 * @param workspaceFolder Path to the workspace folder
 * @returns Port assignment result with the port and whether it was reassigned
 * @throws Error if all ports in range are in use
 */
export async function assignPort(
  workspaceFolder: string
): Promise<PortAssignmentResult> {
  const existingPort = readPortAssignment(workspaceFolder);

  // If we have an existing port, check if it's still available
  if (existingPort !== null) {
    if (await isPortAvailable(existingPort)) {
      // Existing port is still available, use it
      return {
        assignment: {
          hostPort: existingPort,
          containerPort: CONTAINER_SSH_PORT,
        },
        wasReassigned: false,
      };
    }

    // Existing port is in use by something else, need to reassign
    const newPort = await findAvailablePort();
    if (newPort === null) {
      throw new Error(
        `All ports in range ${LACE_PORT_MIN}-${LACE_PORT_MAX} are in use. ` +
          `Cannot start devcontainer.`
      );
    }

    // Write the new assignment
    writePortAssignment(workspaceFolder, newPort);

    return {
      assignment: {
        hostPort: newPort,
        containerPort: CONTAINER_SSH_PORT,
      },
      wasReassigned: true,
      previousPort: existingPort,
    };
  }

  // No existing port, find first available
  const newPort = await findAvailablePort();
  if (newPort === null) {
    throw new Error(
      `All ports in range ${LACE_PORT_MIN}-${LACE_PORT_MAX} are in use. ` +
        `Cannot start devcontainer.`
    );
  }

  // Write the assignment
  writePortAssignment(workspaceFolder, newPort);

  return {
    assignment: {
      hostPort: newPort,
      containerPort: CONTAINER_SSH_PORT,
    },
    wasReassigned: false,
  };
}
