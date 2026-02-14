// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  extractFeatureShortId,
  buildFeatureIdMap,
  extractPrebuildFeaturesRaw,
  autoInjectPortTemplates,
  autoInjectMountTemplates,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
  buildFeaturePortMetadata,
  buildMountTargetMap,
  warnPrebuildPortTemplates,
  warnPrebuildPortFeaturesStaticPort,
} from "../template-resolver";
import { PortAllocator } from "../port-allocator";
import type { PortAllocation } from "../port-allocator";
import type { FeatureMetadata } from "../feature-metadata";
import { MountPathResolver } from "../mount-resolver";
import { deriveProjectId } from "../repo-clones";

// ── Helpers ──

let workspaceRoot: string;
/** Auto-created default mount dirs to clean up after tests */
let createdMountDirs: string[];

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `lace-test-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  createdMountDirs = [];
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  // Clean up any auto-created default mount directories under ~/.config/lace
  for (const dir of createdMountDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Track a default mount path for cleanup.
 * Returns the path for the project's mounts directory under ~/.config/lace.
 */
function trackProjectMountsDir(wf: string): string {
  const projectId = deriveProjectId(wf);
  const mountsDir = join(homedir(), ".config", "lace", projectId, "mounts");
  createdMountDirs.push(mountsDir);
  return mountsDir;
}

// Standard test metadata
const weztermMetadata: FeatureMetadata = {
  id: "wezterm-server",
  version: "1.0.0",
  options: {
    hostSshPort: { type: "string", default: "2222" },
  },
  customizations: {
    lace: {
      ports: {
        hostSshPort: { label: "wezterm ssh" },
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

// ── extractPrebuildFeaturesRaw ──

describe("extractPrebuildFeaturesRaw", () => {
  it("returns prebuild features when present", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
              version: "20240203-110809-5046fc22",
            },
          },
        },
      },
    };

    const result = extractPrebuildFeaturesRaw(config);
    expect(Object.keys(result)).toHaveLength(1);
    expect(
      result["ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"],
    ).toEqual({ version: "20240203-110809-5046fc22" });
  });

  it("returns empty object when no customizations", () => {
    const config: Record<string, unknown> = {};
    expect(extractPrebuildFeaturesRaw(config)).toEqual({});
  });

  it("returns empty object when no lace customizations", () => {
    const config: Record<string, unknown> = {
      customizations: { vscode: {} },
    };
    expect(extractPrebuildFeaturesRaw(config)).toEqual({});
  });

  it("returns empty object when prebuildFeatures absent", () => {
    const config: Record<string, unknown> = {
      customizations: { lace: {} },
    };
    expect(extractPrebuildFeaturesRaw(config)).toEqual({});
  });

  it("returns empty object when prebuildFeatures is null", () => {
    const config: Record<string, unknown> = {
      customizations: { lace: { prebuildFeatures: null } },
    };
    expect(extractPrebuildFeaturesRaw(config)).toEqual({});
  });

  it("returns empty object when prebuildFeatures is empty", () => {
    const config: Record<string, unknown> = {
      customizations: { lace: { prebuildFeatures: {} } },
    };
    expect(extractPrebuildFeaturesRaw(config)).toEqual({});
  });

  it("returns a direct reference (not a copy)", () => {
    const prebuildFeatures = {
      "ghcr.io/devcontainers/features/git:1": {},
    };
    const config: Record<string, unknown> = {
      customizations: { lace: { prebuildFeatures } },
    };

    const result = extractPrebuildFeaturesRaw(config);
    expect(result).toBe(prebuildFeatures); // same reference
  });
});

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

    expect(injected).toEqual(["wezterm-server/hostSshPort"]);
    const features = config.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe("${lace.port(wezterm-server/hostSshPort)}");
  });

  // Scenario 1a: User-provided static value prevents auto-injection
  it("skips injection when user provides explicit value", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "3333",
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
      ].hostSshPort,
    ).toBe("3333");
  });

  // Scenario 1b: Explicit template also prevents injection
  it("skips injection when user provides explicit template", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
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
    expect(injected).toContain("wezterm-server/hostSshPort");
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

    expect(injected).toEqual(["wezterm-server/hostSshPort"]);
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
    expect(opts.hostSshPort).toBe("${lace.port(wezterm-server/hostSshPort)}");
  });

  // T1: autoInjectPortTemplates with prebuild feature (asymmetric)
  it("injects asymmetric appPort entry for prebuild features", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
          },
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

    // Feature option should NOT be modified
    const prebuildFeatures = (
      config.customizations as Record<string, Record<string, unknown>>
    ).lace.prebuildFeatures as Record<string, Record<string, unknown>>;
    expect(
      prebuildFeatures[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ],
    ).toEqual({}); // no hostSshPort injected into feature options

    // Asymmetric appPort entry should be injected
    const appPort = config.appPort as string[];
    expect(appPort).toHaveLength(1);
    expect(appPort[0]).toBe("${lace.port(wezterm-server/hostSshPort)}:2222");

    // Return value includes the label
    expect(injected).toEqual(["wezterm-server/hostSshPort"]);
  });

  // T2: autoInjectPortTemplates with prebuild feature, user-provided value
  it("skips injection for prebuild feature when user provides explicit value", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
              hostSshPort: "3333",
            },
          },
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
    expect(config.appPort).toBeUndefined();
  });

  // T3: autoInjectPortTemplates with features in both blocks
  it("injects for top-level features only when prebuild features have no port metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/devcontainers/features/git:1": {},
            "ghcr.io/devcontainers/features/sshd:1": {},
          },
        },
      },
    };

    const sshdMetadata: FeatureMetadata = {
      id: "sshd",
      version: "1.0.0",
      options: { version: { type: "string", default: "latest" } },
    };

    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
      ["ghcr.io/devcontainers/features/sshd:1", sshdMetadata],
    ]);

    const injected = autoInjectPortTemplates(config, metadataMap);

    // Only wezterm-server (in features block) gets symmetric injection
    expect(injected).toEqual(["wezterm-server/hostSshPort"]);
    const features = config.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe("${lace.port(wezterm-server/hostSshPort)}");

    // No appPort injection (prebuild features have no port metadata)
    expect(config.appPort).toBeUndefined();
  });
});

// ── autoInjectMountTemplates ──

describe("autoInjectMountTemplates", () => {
  // Metadata with a single mount declaration
  const featureWithMountMetadata: FeatureMetadata = {
    id: "wezterm-server",
    version: "1.0.0",
    options: {
      hostSshPort: { type: "string", default: "2222" },
    },
    customizations: {
      lace: {
        mounts: {
          config: {
            target: "/home/user/.config/wezterm",
            description: "WezTerm config",
          },
        },
      },
    },
  };

  // Metadata with multiple mount declarations
  const featureWithMultipleMountsMetadata: FeatureMetadata = {
    id: "data-feature",
    version: "1.0.0",
    options: {},
    customizations: {
      lace: {
        mounts: {
          data: {
            target: "/mnt/data",
            description: "Persistent data store",
          },
          cache: {
            target: "/mnt/cache",
            description: "Cache directory",
          },
        },
      },
    },
  };

  // Metadata with readonly mount
  const featureWithReadonlyMountMetadata: FeatureMetadata = {
    id: "config-feature",
    version: "1.0.0",
    options: {},
    customizations: {
      lace: {
        mounts: {
          settings: {
            target: "/etc/app/settings",
            readonly: true,
          },
        },
      },
    },
  };

  it("injects mount entry for feature with mount declaration", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        featureWithMountMetadata,
      ],
    ]);

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toEqual(["wezterm-server/config"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe(
      "source=${lace.mount.source(wezterm-server/config)},target=/home/user/.config/wezterm,type=bind",
    );
  });

  it("injects multiple mounts for feature with multiple declarations", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/data-feature:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/org/data-feature:1",
        featureWithMultipleMountsMetadata,
      ],
    ]);

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toHaveLength(2);
    expect(injected).toContain("data-feature/data");
    expect(injected).toContain("data-feature/cache");
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(2);
    expect(mounts.some((m: string) => m.includes("target=/mnt/data"))).toBe(true);
    expect(mounts.some((m: string) => m.includes("target=/mnt/cache"))).toBe(true);
  });

  it("injects readonly mount when declared", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/config-feature:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/org/config-feature:1",
        featureWithReadonlyMountMetadata,
      ],
    ]);

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toEqual(["config-feature/settings"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe(
      "source=${lace.mount.source(config-feature/settings)},target=/etc/app/settings,type=bind,readonly",
    );
  });

  it("skips features without mount metadata", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
    ]);

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toEqual([]);
    expect(config.mounts).toBeUndefined();
  });

  it("returns empty when no features in config", () => {
    const config: Record<string, unknown> = {};
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const injected = autoInjectMountTemplates(config, metadataMap);

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

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toEqual([]);
  });

  it("appends to existing mounts array", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
      mounts: ["source=/existing,target=/existing,type=bind"],
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        featureWithMountMetadata,
      ],
    ]);

    const injected = autoInjectMountTemplates(config, metadataMap);

    expect(injected).toEqual(["wezterm-server/config"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toBe("source=/existing,target=/existing,type=bind");
    expect(mounts[1]).toContain("wezterm-server/config");
  });
});

// ── resolveTemplates ──

describe("resolveTemplates", () => {
  // Scenario 1: Basic resolution (auto-injected template)
  it("resolves auto-injected port template to integer", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    const hostSshPort =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort;

    // Type coercion: entire string is a single template -> integer
    expect(typeof hostSshPort).toBe("number");
    expect(hostSshPort).toBeGreaterThanOrEqual(22425);
    expect(hostSshPort).toBeLessThanOrEqual(22499);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].label).toBe("wezterm-server/hostSshPort");
  });

  // Scenario 2: Embedded template (asymmetric mapping)
  it("resolves embedded port template to string", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "2222",
        },
      },
      appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const appPort = result.resolvedConfig.appPort as string[];
    expect(appPort[0]).toMatch(/^224\d{2}:2222$/);
    expect(typeof appPort[0]).toBe("string");
    expect(result.allocations).toHaveLength(1);

    // hostSshPort stays literal
    const features = result.resolvedConfig.features as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort,
    ).toBe("2222");
  });

  // Scenario 3: Same label in two locations resolves to same port
  it("resolves same label to same port in multiple locations", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
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
      ].hostSshPort as number;
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
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
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
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
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
      /Supported templates:/,
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
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
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
    expect(typeof opts.hostSshPort).toBe("number");
  });

  // Scenario 11: Nested objects and arrays are walked
  it("resolves templates in nested objects and arrays", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      customizations: {
        vscode: {
          settings: {
            "myExtension.port": "${lace.port(wezterm-server/hostSshPort)}",
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
    const hostSshPort =
      features[
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
      ].hostSshPort as number;

    const customizations = result.resolvedConfig.customizations as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const extPort = customizations.vscode.settings[
      "myExtension.port"
    ] as number;

    expect(hostSshPort).toBe(extPort);
    // Only one allocation despite two locations
    expect(result.allocations).toHaveLength(1);
  });

  // Scenario: Invalid port label format
  it("throws on invalid port label format (missing slash)", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(hostSshPort)}",
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Invalid port label "hostSshPort"\. Expected format: featureId\/optionName/,
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

  // T4: resolveTemplates with prebuild feature in featureIdMap
  it("resolves appPort template referencing a prebuild-only feature", async () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
              hostSshPort: "2222",
            },
          },
        },
      },
      appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    // Template resolved successfully
    const appPort = result.resolvedConfig.appPort as string[];
    expect(appPort[0]).toMatch(/^224\d{2}:2222$/);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].label).toBe("wezterm-server/hostSshPort");
    expect(result.allocations[0].port).toBeGreaterThanOrEqual(22425);
    expect(result.allocations[0].port).toBeLessThanOrEqual(22499);
  });

  // T5: resolveTemplates with prebuild feature auto-injected appPort (two-step)
  it("resolves auto-injected asymmetric appPort for prebuild feature", async () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
          },
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    // Step 1: auto-inject
    const injected = autoInjectPortTemplates(config, metadataMap);
    expect(injected).toEqual(["wezterm-server/hostSshPort"]);

    // Verify injection produced asymmetric appPort template
    const appPortAfterInjection = config.appPort as string[];
    expect(appPortAfterInjection).toHaveLength(1);
    expect(appPortAfterInjection[0]).toBe(
      "${lace.port(wezterm-server/hostSshPort)}:2222",
    );

    // Step 2: resolve
    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    // Resolved appPort has concrete port
    const resolvedAppPort = result.resolvedConfig.appPort as string[];
    expect(resolvedAppPort[0]).toMatch(/^224\d{2}:2222$/);

    // Allocation produced
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].label).toBe("wezterm-server/hostSshPort");
  });

  // T6: buildFeatureIdMap collision across blocks
  it("throws on feature ID collision across features and prebuildFeatures", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org-a/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/org-b/devcontainer-features/wezterm-server:2": {},
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(resolveTemplates(config, allocator)).rejects.toThrow(
      /Feature ID collision: "wezterm-server"/,
    );
  });
});

// ── generatePortEntries ──

describe("generatePortEntries", () => {
  // Scenario 1: Full auto-generation (no user entries)
  it("generates all entries when user has none", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/hostSshPort",
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
        label: "wezterm-server/hostSshPort (lace)",
        requireLocalPort: true,
      },
    });
  });

  // Scenario 2: User appPort suppresses auto-generation
  it("suppresses appPort when user already has one for that port", () => {
    const allocations: PortAllocation[] = [
      {
        label: "wezterm-server/hostSshPort",
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
        label: "wezterm-server/hostSshPort",
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
        label: "wezterm-server/hostSshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const featurePortMetadata = new Map([
      ["wezterm-server/hostSshPort", { label: "wezterm ssh" }],
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
        label: "wezterm-server/hostSshPort",
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
        label: "wezterm-server/hostSshPort",
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
        label: "wezterm-server/hostSshPort",
        port: 22430,
        assignedAt: "2026-02-06T00:00:00.000Z",
      },
    ];
    const featurePortMetadata = new Map([
      [
        "wezterm-server/hostSshPort",
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
    expect(result.get("wezterm-server/hostSshPort")).toEqual({
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

// ── warnPrebuildPortFeaturesStaticPort ──

describe("warnPrebuildPortFeaturesStaticPort", () => {
  it("warns when prebuild feature has static port and no appPort", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
              hostSshPort: "2222",
            },
          },
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const warnings = warnPrebuildPortFeaturesStaticPort(
      config,
      metadataMap,
      [], // nothing was auto-injected
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("wezterm-server");
    expect(warnings[0]).toContain("hostSshPort");
    expect(warnings[0]).toContain("no appPort entry");
    expect(warnings[0]).toContain("static value");
  });

  it("does not warn when auto-injection is active", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
          },
        },
      },
      appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const warnings = warnPrebuildPortFeaturesStaticPort(
      config,
      metadataMap,
      ["wezterm-server/hostSshPort"], // auto-injection happened
    );

    expect(warnings).toEqual([]);
  });

  it("does not warn when user provides static value and explicit appPort", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
              hostSshPort: "2222",
            },
          },
        },
      },
      appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"],
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        weztermMetadata,
      ],
    ]);

    const warnings = warnPrebuildPortFeaturesStaticPort(
      config,
      metadataMap,
      [], // nothing injected because user provided explicit value
    );

    expect(warnings).toEqual([]);
  });

  it("returns empty when no prebuild features", () => {
    const config: Record<string, unknown> = {};
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const warnings = warnPrebuildPortFeaturesStaticPort(
      config,
      metadataMap,
      [],
    );

    expect(warnings).toEqual([]);
  });

  it("returns empty when prebuild features have no port metadata", () => {
    const config: Record<string, unknown> = {
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/devcontainers/features/git:1": {},
          },
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
    ]);

    const warnings = warnPrebuildPortFeaturesStaticPort(
      config,
      metadataMap,
      [],
    );

    expect(warnings).toEqual([]);
  });
});

// ── mount template resolution ──

describe("mount template resolution", () => {
  // Test 1: LACE_UNKNOWN_PATTERN relaxation
  it("does not reject ${lace.mount.source()} as unknown, but still rejects ${lace.nonsense()}", async () => {
    // mount.source should pass the guard (no error thrown)
    const configWithMountSource: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["source=${lace.mount.source(project/history)},target=/history,type=bind"],
    };
    trackProjectMountsDir(workspaceRoot);
    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});

    // Should not throw — mount.source passes the guard
    await expect(
      resolveTemplates(configWithMountSource, allocator, mountResolver),
    ).resolves.toBeDefined();

    // Nonsense lace template should still throw
    const configWithNonsense: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        FOO: "${lace.nonsense(foo)}",
      },
    };
    await expect(
      resolveTemplates(configWithNonsense, allocator),
    ).rejects.toThrow(/Unknown template variable/);
  });

  // Test 2: Mount source resolution in string
  it("resolves ${lace.mount.source()} embedded in a mount string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["source=${lace.mount.source(project/history)},target=/history,type=bind"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount.source(");
    // Should contain a concrete path
    expect(mounts[0]).toMatch(/source=\/.*,target=\/history,type=bind/);

    const projectId = deriveProjectId(workspaceRoot);
    const expectedPath = join(
      homedir(),
      ".config",
      "lace",
      projectId,
      "mounts",
      "project",
      "history",
    );
    expect(mounts[0]).toBe(`source=${expectedPath},target=/history,type=bind`);
  });

  // Test 3: Mount source standalone
  it("resolves standalone ${lace.mount.source()} to a path string (not integer)", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        HISTORY_DIR: "${lace.mount.source(project/history)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(typeof containerEnv.HISTORY_DIR).toBe("string");
    expect(containerEnv.HISTORY_DIR).not.toContain("${lace.mount.source(");
    // Should be a path, not a number
    expect(containerEnv.HISTORY_DIR).toMatch(/^\//);
  });

  // Test 4: Mixed port and mount
  it("resolves both ${lace.port()} and ${lace.mount.source()} in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      mounts: ["source=${lace.mount.source(project/data)},target=/data,type=bind"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    // Port resolved to integer
    const features = result.resolvedConfig.features as Record<string, Record<string, unknown>>;
    const hostSshPort = features["ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"].hostSshPort;
    expect(typeof hostSshPort).toBe("number");
    expect(hostSshPort).toBeGreaterThanOrEqual(22425);

    // Mount resolved to path
    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount.source(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/data,type=bind/);

    // Both allocations and mount assignments present
    expect(result.allocations).toHaveLength(1);
    expect(result.mountAssignments).toHaveLength(1);
  });

  // Test 5: Mount source in nested config
  it("resolves mount source template in nested config objects", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      customizations: {
        vscode: {
          settings: {
            "myExtension.historyPath": "${lace.mount.source(project/history)}",
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    const customizations = result.resolvedConfig.customizations as Record<string, Record<string, Record<string, unknown>>>;
    const historyPath = customizations.vscode.settings["myExtension.historyPath"];
    expect(typeof historyPath).toBe("string");
    expect(historyPath).not.toContain("${lace.mount.source(");
    expect(historyPath).toMatch(/^\//);
  });

  // Test 6: Mount source in mounts array
  it("resolves mount source template inside a mounts array string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: [
        "source=${lace.mount.source(project/cache)},target=/cache,type=bind",
        "source=/fixed/path,target=/fixed,type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    // First entry resolved
    expect(mounts[0]).not.toContain("${lace.mount.source(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/cache,type=bind/);
    // Second entry unchanged
    expect(mounts[1]).toBe("source=/fixed/path,target=/fixed,type=bind");
  });

  // Test 7: No mount templates
  it("passes config unchanged when no mount templates present", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["source=/fixed/path,target=/fixed,type=bind"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toBe("source=/fixed/path,target=/fixed,type=bind");
    expect(result.mountAssignments).toHaveLength(0);
  });

  // Test 8: Invalid mount label format
  it("throws on invalid mount label format (missing slash)", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        BAD: "${lace.mount.source(noslash)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    await expect(
      resolveTemplates(config, allocator, mountResolver),
    ).rejects.toThrow(/Invalid mount label "noslash"/);
  });

  // Test 9: Unresolved target expression
  it("passes ${lace.mount.target()} through as literal string when no target resolver exists", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        TARGET: "${lace.mount.target(foo/bar)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    // No mount resolver, or a mount resolver that doesn't handle targets
    const result = await resolveTemplates(config, allocator);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    // Should pass through as literal string — not rejected by guard, not resolved
    expect(containerEnv.TARGET).toBe("${lace.mount.target(foo/bar)}");
  });

  // Test 10: mountAssignments in result
  it("populates mountAssignments in TemplateResolutionResult", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: [
        "source=${lace.mount.source(project/data)},target=/data,type=bind",
        "source=${lace.mount.source(project/cache)},target=/cache,type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver);

    expect(result.mountAssignments).toHaveLength(2);
    const labels = result.mountAssignments.map((a) => a.label);
    expect(labels).toContain("project/data");
    expect(labels).toContain("project/cache");
    // Each assignment has a resolved source path
    for (const assignment of result.mountAssignments) {
      expect(assignment.resolvedSource).toMatch(/^\//);
      expect(assignment.isOverride).toBe(false);
    }
  });

  // Test 11: No resolver supplied
  it("leaves ${lace.mount.source()} as literal string when no resolver is supplied", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        MOUNT_SRC: "${lace.mount.source(foo/bar)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    // No mountResolver passed — expressions should remain as-is
    const result = await resolveTemplates(config, allocator);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.MOUNT_SRC).toBe("${lace.mount.source(foo/bar)}");
    expect(result.mountAssignments).toHaveLength(0);
  });
});

// ── buildMountTargetMap ──

describe("buildMountTargetMap", () => {
  it("builds target map from feature metadata with mount declarations", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/org/claude-code:1",
        {
          id: "claude-code",
          version: "1.0.0",
          options: {},
          customizations: {
            lace: {
              mounts: {
                config: {
                  target: "/home/node/.claude",
                  description: "Claude config",
                },
              },
            },
          },
        },
      ],
    ]);

    const result = buildMountTargetMap(metadataMap);

    expect(result.size).toBe(1);
    expect(result.get("claude-code/config")).toBe("/home/node/.claude");
  });

  it("builds map for multiple features with multiple mounts", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/org/claude-code:1",
        {
          id: "claude-code",
          version: "1.0.0",
          options: {},
          customizations: {
            lace: {
              mounts: {
                config: {
                  target: "/home/node/.claude",
                  description: "Claude config",
                },
                data: {
                  target: "/home/node/.claude-data",
                  description: "Claude data",
                },
              },
            },
          },
        },
      ],
      [
        "ghcr.io/org/wezterm-server:1",
        {
          id: "wezterm-server",
          version: "1.0.0",
          options: {},
          customizations: {
            lace: {
              mounts: {
                config: {
                  target: "/home/user/.config/wezterm",
                  description: "WezTerm config",
                },
              },
            },
          },
        },
      ],
    ]);

    const result = buildMountTargetMap(metadataMap);

    expect(result.size).toBe(3);
    expect(result.get("claude-code/config")).toBe("/home/node/.claude");
    expect(result.get("claude-code/data")).toBe("/home/node/.claude-data");
    expect(result.get("wezterm-server/config")).toBe("/home/user/.config/wezterm");
  });

  it("returns empty map for features with no mount declarations", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/devcontainers/features/git:1", gitMetadata],
    ]);

    const result = buildMountTargetMap(metadataMap);

    expect(result.size).toBe(0);
  });

  it("skips null metadata entries", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", null],
    ]);

    const result = buildMountTargetMap(metadataMap);

    expect(result.size).toBe(0);
  });

  it("returns empty map for empty metadata map", () => {
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = buildMountTargetMap(metadataMap);

    expect(result.size).toBe(0);
  });
});

// ── mount target template resolution ──

describe("mount target template resolution", () => {
  const claudeCodeMetadata: FeatureMetadata = {
    id: "claude-code",
    version: "1.0.0",
    options: {},
    customizations: {
      lace: {
        mounts: {
          config: {
            target: "/home/node/.claude",
            description: "Claude config directory",
          },
        },
      },
    },
  };

  const weztermWithMountMetadata: FeatureMetadata = {
    id: "wezterm-server",
    version: "1.0.0",
    options: {
      hostSshPort: { type: "string", default: "2222" },
    },
    customizations: {
      lace: {
        ports: {
          hostSshPort: { label: "wezterm ssh" },
        },
        mounts: {
          config: {
            target: "/home/user/.config/wezterm",
            description: "WezTerm config",
          },
        },
      },
    },
  };

  // Test 1: Basic mount target resolution
  it("resolves ${lace.mount.target(claude-code/config)} to declared target path", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      containerEnv: {
        CLAUDE_CONFIG: "${lace.mount.target(claude-code/config)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.CLAUDE_CONFIG).toBe("/home/node/.claude");
  });

  // Test 2: Non-existent mount label throws descriptive error
  it("throws descriptive error when mount target label not found", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      containerEnv: {
        MISSING: "${lace.mount.target(nonexistent/mount)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(
      resolveTemplates(config, allocator, undefined, mountTargetMap),
    ).rejects.toThrow(/Mount target label "nonexistent\/mount" not found in feature metadata/);
    await expect(
      resolveTemplates(config, allocator, undefined, mountTargetMap),
    ).rejects.toThrow(/Available mount labels: claude-code\/config/);
  });

  // Test 3: Target template in containerEnv resolves
  it("resolves mount target in containerEnv", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      containerEnv: {
        CONFIG_DIR: "${lace.mount.target(claude-code/config)}",
        SETTINGS_FILE: "${lace.mount.target(claude-code/config)}/settings.json",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.CONFIG_DIR).toBe("/home/node/.claude");
    expect(containerEnv.SETTINGS_FILE).toBe("/home/node/.claude/settings.json");
  });

  // Test 4: Target template in lifecycle commands
  it("resolves mount target in lifecycle commands", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      postCreateCommand: "mkdir -p ${lace.mount.target(claude-code/config)}/extensions",
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    expect(result.resolvedConfig.postCreateCommand).toBe(
      "mkdir -p /home/node/.claude/extensions",
    );
  });

  // Test 5: Mixed mount.source and mount.target in the same string
  it("resolves both mount.source and mount.target in the same string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      postCreateCommand:
        "cp ${lace.mount.source(claude-code/config)}/defaults.json ${lace.mount.target(claude-code/config)}/defaults.json",
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    const result = await resolveTemplates(config, allocator, mountResolver, mountTargetMap);

    const cmd = result.resolvedConfig.postCreateCommand as string;
    // mount.source should be resolved to a host path
    expect(cmd).not.toContain("${lace.mount.source(");
    // mount.target should be resolved to the container path
    expect(cmd).not.toContain("${lace.mount.target(");
    expect(cmd).toContain("/home/node/.claude/defaults.json");
    // The source portion should be a concrete host path
    expect(cmd).toMatch(/^cp \/.*\/defaults\.json \/home\/node\/\.claude\/defaults\.json$/);
  });

  // Test 6: Target template in nested config objects
  it("resolves mount target in nested config objects", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      customizations: {
        vscode: {
          settings: {
            "claude.configPath": "${lace.mount.target(claude-code/config)}",
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    const customizations = result.resolvedConfig.customizations as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(customizations.vscode.settings["claude.configPath"]).toBe(
      "/home/node/.claude",
    );
  });

  // Test 7: Target template in arrays
  it("resolves mount target in array elements", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/claude-code:1", claudeCodeMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      mounts: [
        "source=/host/path,target=${lace.mount.target(claude-code/config)},type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toBe(
      "source=/host/path,target=/home/node/.claude,type=bind",
    );
  });

  // Test 8: Error message shows empty available labels when map is empty
  it("shows (none) when no mount labels are available", async () => {
    const mountTargetMap = new Map<string, string>();

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/claude-code:1": {},
      },
      containerEnv: {
        MISSING: "${lace.mount.target(nonexistent/mount)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    await expect(
      resolveTemplates(config, allocator, undefined, mountTargetMap),
    ).rejects.toThrow(/Available mount labels: \(none\)/);
  });

  // Test 9: Mount target with port in same config resolves both
  it("resolves both port templates and mount target templates in the same config", async () => {
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/wezterm-server:1", weztermWithMountMetadata],
    ]);
    const mountTargetMap = buildMountTargetMap(metadataMap);

    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      containerEnv: {
        WEZTERM_CONFIG: "${lace.mount.target(wezterm-server/config)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator, undefined, mountTargetMap);

    // Port resolved to integer
    const features = result.resolvedConfig.features as Record<string, Record<string, unknown>>;
    const hostSshPort = features["ghcr.io/org/wezterm-server:1"].hostSshPort;
    expect(typeof hostSshPort).toBe("number");
    expect(hostSshPort).toBeGreaterThanOrEqual(22425);

    // Mount target resolved to path
    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.WEZTERM_CONFIG).toBe("/home/user/.config/wezterm");
  });
});
