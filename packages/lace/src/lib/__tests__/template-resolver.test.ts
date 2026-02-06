// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractFeatureShortId,
  buildFeatureIdMap,
  autoInjectPortTemplates,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
  buildFeaturePortMetadata,
  warnPrebuildPortTemplates,
} from "../template-resolver";
import { PortAllocator } from "../port-allocator";
import type { PortAllocation } from "../port-allocator";
import type { FeatureMetadata } from "../feature-metadata";

// ── Helpers ──

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-test-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

// Standard test metadata
const weztermMetadata: FeatureMetadata = {
  id: "wezterm-server",
  version: "1.0.0",
  options: {
    sshPort: { type: "string", default: "2222" },
  },
  customizations: {
    lace: {
      ports: {
        sshPort: { label: "wezterm ssh" },
      },
    },
  },
};

const debugProxyMetadata: FeatureMetadata = {
  id: "debug-proxy",
  version: "1.0.0",
  options: {
    debugPort: { type: "string", default: "9229" },
  },
  customizations: {
    lace: {
      ports: {
        debugPort: { label: "debug" },
      },
    },
  },
};

const gitMetadata: FeatureMetadata = {
  id: "git",
  version: "1.0.0",
  options: { version: { type: "string", default: "latest" } },
};

// ── extractFeatureShortId ──

describe("extractFeatureShortId", () => {
  it("extracts short ID from registry reference with version", () => {
    expect(
      extractFeatureShortId(
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
      ),
    ).toBe("wezterm-server");
  });

  it("extracts short ID from registry reference with exact semver", () => {
    expect(
      extractFeatureShortId(
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1.2.3",
      ),
    ).toBe("wezterm-server");
  });

  it("extracts short ID from registry reference without version", () => {
    expect(
      extractFeatureShortId(
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server",
      ),
    ).toBe("wezterm-server");
  });

  it("extracts short ID from local path reference", () => {
    expect(extractFeatureShortId("./features/my-feature")).toBe("my-feature");
  });

  it("extracts short ID from relative parent path", () => {
    expect(extractFeatureShortId("../features/my-feature")).toBe("my-feature");
  });
});

// ── buildFeatureIdMap ──

describe("buildFeatureIdMap", () => {
  it("builds map from full refs to short IDs", () => {
    const features = {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      "ghcr.io/devcontainers/features/git:1": {},
    };
    const map = buildFeatureIdMap(features);

    expect(map.size).toBe(2);
    expect(map.get("wezterm-server")).toBe(
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
    );
    expect(map.get("git")).toBe("ghcr.io/devcontainers/features/git:1");
  });

  // Scenario 8: FeatureId collision
  it("throws on feature ID collision", () => {
    const features = {
      "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      "ghcr.io/other-org/devcontainer-features/wezterm-server:2": {},
    };

    expect(() => buildFeatureIdMap(features)).toThrow(
      /Feature ID collision: "wezterm-server"/,
    );
    expect(() => buildFeatureIdMap(features)).toThrow(
      /Rename one using a local feature wrapper/,
    );
  });
});

// ── autoInjectPortTemplates ──

describe("autoInjectPortTemplates", () => {
  it("injects port templates for features with lace port metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    expect(injected).toEqual(["wezterm-server/sshPort"]);
    const features = config.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort,
    ).toBe("${lace.port(wezterm-server/sshPort)}");
  });

  // Scenario 1a: User-provided static value prevents auto-injection
  it("skips injection when user provides explicit value", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "3333",
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    expect(injected).toEqual([]);
    const features = config.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort,
    ).toBe("3333");
  });

  // Scenario 1b: Explicit template also prevents injection
  it("skips injection when user provides explicit template", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    expect(injected).toEqual([]);
  });

  it("skips features with null metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        null,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);
    expect(injected).toEqual([]);
  });

  it("skips features without lace port metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);
    expect(injected).toEqual([]);
  });

  // Scenario 4: Multiple features, multiple ports
  it("injects for multiple features with port metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
      [
        "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1",
        debugProxyMetadata,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    expect(injected).toHaveLength(2);
    expect(injected).toContain("wezterm-server/sshPort");
    expect(injected).toContain("debug-proxy/debugPort");
  });

  it("returns empty when no features in config", () => {
    const config: Record<string, unknown> = {};
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const injected = autoInjectPortTemplates(config, metadataMap);
    expect(injected).toEqual([]);
  });

  // Scenario 10: Non-port options unaffected
  it("only injects for declared port options, not other options", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          enableTls: true,
          maxConnections: 10,
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    expect(injected).toEqual(["wezterm-server/sshPort"]);
    const features = config.features as Record<
      string,
      Record<string, unknown>
    >;
    const opts =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ];
    expect(opts.enableTls).toBe(true);
    expect(opts.maxConnections).toBe(10);
    expect(opts.sshPort).toBe("${lace.port(wezterm-server/sshPort)}");
  });
});

// ── resolveTemplates ──

describe("resolveTemplates", () => {
  // Scenario 1: Basic resolution (auto-injected template)
  it("resolves auto-injected port template to integer", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    const sshPort =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort;

    // Type coercion: entire string is a single template -> integer
    expect(typeof sshPort).toBe("number");
    expect(sshPort).toBeGreaterThanOrEqual(22425);
    expect(sshPort).toBeLessThanOrEqual(22499);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].label).toBe("wezterm-server/sshPort");
  });

  // Scenario 2: Embedded template (asymmetric mapping)
  it("resolves embedded port template to string", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "2222",
        },
      },
      appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const appPort = result.resolvedConfig.appPort as string[];
    expect(appPort[0]).toMatch(/^224\d{2}:2222$/);
    expect(typeof appPort[0]).toBe("string");
    expect(result.allocations).toHaveLength(1);

    // sshPort stays literal
    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort,
    ).toBe("2222");
  });

  // Scenario 3: Same label in two locations resolves to same port
  it("resolves same label to same port in multiple locations", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
      },
      appPort: ["${lace.port(wezterm-server/sshPort)}:2222"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    const resolvedSshPort =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort as number;
    const appPort = result.resolvedConfig.appPort as string[];
    const resolvedAppPort = parseInt(appPort[0].split(":")[0], 10);

    expect(resolvedSshPort).toBe(resolvedAppPort);
    // Only one allocation even though label appears twice
    expect(result.allocations).toHaveLength(1);
  });

  // Scenario 4: Multiple features, multiple ports
  it("allocates distinct ports for different features", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
        "ghcr.io/weftwiseink/devcontainer-features/debug-proxy:1": {
          debugPort: "${lace.port(debug-proxy/debugPort)}",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    expect(result.allocations).toHaveLength(2);
    const ports = result.allocations.map((a) => a.port);
    expect(new Set(ports).size).toBe(2); // distinct ports
  });

  // Scenario 5: Spec-native variables pass through
  it("passes through spec-native ${localEnv:} variables", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
      },
      remoteEnv: {
        HOST_HOME: "${localEnv:HOME}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const remoteEnv = result.resolvedConfig.remoteEnv as Record<
      string,
      string
    >;
    expect(remoteEnv.HOST_HOME).toBe("${localEnv:HOME}");
  });

  // Scenario 6: Unknown lace template variable hard-fails
  it("throws on unknown ${lace.*} template variable", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
          hostClaudeDir: "${lace.home}/.claude",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Unknown template variable: \$\{lace\.home\}/,
    );
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /The only supported template/,
    );
  });

  // Scenario 7: FeatureId not in config
  it("throws when featureId is not in config features", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
      appPort: ["${lace.port(nonexistent-feature/port)}:8080"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Feature "nonexistent-feature" not found in config/,
    );
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Available features: wezterm-server/,
    );
  });

  // Scenario 8: FeatureId collision (via buildFeatureIdMap)
  it("throws on feature ID collision", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
        "ghcr.io/other-org/devcontainer-features/wezterm-server:2": {},
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Feature ID collision: "wezterm-server"/,
    );
  });

  // Scenario 9: No templates -- config passes through unchanged
  it("returns config unchanged when no templates present", async () => {
    const config: Record<string, unknown> = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    expect(result.resolvedConfig).toEqual(config);
    expect(result.allocations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // Scenario 10: Non-string values pass through
  it("passes through boolean and number values unchanged", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
          enableTls: true,
          maxConnections: 10,
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    const opts =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ];
    expect(opts.enableTls).toBe(true);
    expect(opts.maxConnections).toBe(10);
    expect(typeof opts.sshPort).toBe("number");
  });

  // Scenario 11: Nested objects and arrays are walked
  it("resolves templates in nested objects and arrays", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(wezterm-server/sshPort)}",
        },
      },
      customizations: {
        vscode: {
          settings: {
            "myExtension.port": "${lace.port(wezterm-server/sshPort)}",
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    const sshPort =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].sshPort as number;

    const customizations = result.resolvedConfig.customizations as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const extPort = customizations.vscode.settings[
      "myExtension.port"
    ] as number;

    expect(sshPort).toBe(extPort);
    // Only one allocation despite two locations
    expect(result.allocations).toHaveLength(1);
  });

  // Scenario: Invalid port label format
  it("throws on invalid port label format (missing slash)", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          sshPort: "${lace.port(sshPort)}",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Invalid port label "sshPort"\. Expected format: featureId\/optionName/,
    );
  });

  // Scenario: Config with no features key works
  it("handles config with no features key", async () => {
    const config: Record<string, unknown> = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    expect(result.resolvedConfig).toEqual(config);
    expect(result.allocations).toHaveLength(0);
  });

  // Scenario: ${containerEnv:} passes through
  it("passes through ${containerEnv:} variables", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      remoteEnv: {
        PATH: "${containerEnv:PATH}:/extra",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const remoteEnv = result.resolvedConfig.remoteEnv as Record<
      string,
      string
    >;
    expect(remoteEnv.PATH).toBe("${containerEnv:PATH}:/extra");
  });
});

// ── generatePortEntries ──

describe("generatePortEntries", () => {
  // Scenario 1: Full auto-generation (no user entries)
  it("generates all entries when user has none", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const resolvedConfig: Record<string, unknown> = {};

    const result = generatePortEntries(resolvedConfig, allocations, null);

    expect(result.appPort).toEqual(["22430:22430"]);
    expect(result.forwardPorts).toEqual([22430]);
    expect(result.portsAttributes).toEqual({
      "22430": {
        label: "wezterm-server/sshPort (lace)",
        requireLocalPort: true,
      },
    });
  });

  // Scenario 2: User appPort suppresses auto-generation
  it("suppresses appPort when user already has one for that port", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const resolvedConfig: Record<string, unknown> = {
      appPort: ["22430:2222"],
    };

    const result = generatePortEntries(resolvedConfig, allocations, null);

    expect(result.appPort).toEqual([]); // suppressed
    expect(result.forwardPorts).toEqual([22430]); // still generated
    expect(result.portsAttributes["22430"]).toBeDefined(); // still generated
  });

  // Scenario 3: User portsAttributes takes precedence
  it("suppresses portsAttributes when user provides them", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const resolvedConfig: Record<string, unknown> = {
      portsAttributes: { "22430": { label: "My SSH" } },
    };

    const result = generatePortEntries(resolvedConfig, allocations, null);

    expect(result.portsAttributes).toEqual({}); // suppressed
    expect(result.appPort).toEqual(["22430:22430"]); // still generated
    expect(result.forwardPorts).toEqual([22430]); // still generated
  });

  // Scenario 4: Feature metadata enriches label
  it("uses feature metadata label in portsAttributes", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const featurePortMetadata = new Map([
      ["wezterm-server/sshPort", { label: "wezterm ssh" }],
    ]);

    const result = generatePortEntries(
      {},
      allocations,
      featurePortMetadata,
    );

    expect(result.portsAttributes["22430"]).toEqual({
      label: "wezterm ssh (lace)",
      requireLocalPort: true,
    });
  });

  // Scenario: User forwardPorts suppresses
  it("suppresses forwardPorts when user provides them", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const resolvedConfig: Record<string, unknown> = {
      forwardPorts: [22430],
    };

    const result = generatePortEntries(resolvedConfig, allocations, null);
    expect(result.forwardPorts).toEqual([]); // suppressed
  });

  // Scenario: Multiple allocations
  it("generates entries for multiple allocations", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
      {
        label: "debug-proxy/debugPort",
        port: 22431,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];

    const result = generatePortEntries({}, allocations, null);

    expect(result.appPort).toEqual(["22430:22430", "22431:22431"]);
    expect(result.forwardPorts).toEqual([22430, 22431]);
    expect(Object.keys(result.portsAttributes)).toHaveLength(2);
  });

  // Scenario: No allocations -> empty entries
  it("returns empty entries when no allocations", () => {
    const result = generatePortEntries({}, [], null);

    expect(result.appPort).toEqual([]);
    expect(result.forwardPorts).toEqual([]);
    expect(result.portsAttributes).toEqual({});
  });

  // Scenario: requireLocalPort from metadata
  it("uses requireLocalPort from feature metadata", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/sshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const featurePortMetadata = new Map([
      [
        "wezterm-server/sshPort",
        { label: "wezterm ssh", requireLocalPort: false },
      ],
    ]);

    const result = generatePortEntries(
      {},
      allocations,
      featurePortMetadata,
    );

    expect(result.portsAttributes["22430"].requireLocalPort).toBe(false);
  });
});

// ── mergePortEntries ──

describe("mergePortEntries", () => {
  it("merges generated entries into resolved config", () => {
    const config: Record<string, unknown> = {
      image: "test",
    };
    const generated = {
      appPort: ["22430:22430"],
      forwardPorts: [22430],
      portsAttributes: {
        "22430": { label: "wezterm ssh (lace)", requireLocalPort: true },
      },
    };

    const merged = mergePortEntries(config, generated);

    expect(merged.image).toBe("test");
    expect(merged.appPort).toEqual(["22430:22430"]);
    expect(merged.forwardPorts).toEqual([22430]);
    expect(merged.portsAttributes).toEqual({
      "22430": { label: "wezterm ssh (lace)", requireLocalPort: true },
    });
  });

  it("appends to existing port entries", () => {
    const config: Record<string, unknown> = {
      appPort: ["3000:3000"],
      forwardPorts: [3000],
      portsAttributes: {
        "3000": { label: "web" },
      },
    };
    const generated = {
      appPort: ["22430:22430"],
      forwardPorts: [22430],
      portsAttributes: {
        "22430": { label: "wezterm ssh (lace)", requireLocalPort: true },
      },
    };

    const merged = mergePortEntries(config, generated);

    expect(merged.appPort).toEqual(["3000:3000", "22430:22430"]);
    expect(merged.forwardPorts).toEqual([3000, 22430]);
    expect(Object.keys(merged.portsAttributes as object)).toHaveLength(2);
  });

  it("does not add empty entries", () => {
    const config: Record<string, unknown> = { image: "test" };
    const generated = {
      appPort: [],
      forwardPorts: [],
      portsAttributes: {},
    };

    const merged = mergePortEntries(config, generated);

    expect(merged.appPort).toBeUndefined();
    expect(merged.forwardPorts).toBeUndefined();
    expect(merged.portsAttributes).toBeUndefined();
  });
});

// ── buildFeaturePortMetadata ──

describe("buildFeaturePortMetadata", () => {
  it("builds metadata map from feature metadata", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const result = buildFeaturePortMetadata(metadataMap);

    expect(result.size).toBe(1);
    expect(result.get("wezterm-server/sshPort")).toEqual({
      label: "wezterm ssh",
      requireLocalPort: undefined,
    });
  });

  it("skips features without port metadata", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
    ]);

    const result = buildFeaturePortMetadata(metadataMap);
    expect(result.size).toBe(0);
  });

  it("skips null metadata entries", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        null,
      ],
    ]);

    const result = buildFeaturePortMetadata(metadataMap);
    expect(result.size).toBe(0);
  });
});

// ── warnPrebuildPortTemplates ──

describe("warnPrebuildPortTemplates", () => {
  it("warns about ${lace.port()} in prebuildFeatures", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/org/feat:1": {
              port: "${lace.port(feat/port)}",
            },
          },
        },
      },
    };

    const warnings = warnPrebuildPortTemplates(config);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("prebuildFeatures");
    expect(warnings[0]).toContain("will not be resolved");
  });

  it("returns empty when no prebuildFeatures", () => {
    const config: Record<string, unknown> = {};
    const warnings = warnPrebuildPortTemplates(config);
    expect(warnings).toEqual([]);
  });

  it("returns empty when prebuildFeatures have no templates", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/org/feat:1": {
              port: "3000",
            },
          },
        },
      },
    };

    const warnings = warnPrebuildPortTemplates(config);
    expect(warnings).toEqual([]);
  });
});
