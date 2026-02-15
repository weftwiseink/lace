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
  validateMountNamespaces,
  validateMountTargetConflicts,
  resolveTemplates,
  generatePortEntries,
  mergePortEntries,
  buildFeaturePortMetadata,
  warnPrebuildPortTemplates,
  warnPrebuildPortFeaturesStaticPort,
} from "../template-resolver";
import type { LaceMountDeclaration } from "../feature-metadata";
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

  const noProjectDecls: Record<string, LaceMountDeclaration> = {};

  it("injects bare mount template for feature with mount declaration", () => {
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual(["wezterm-server/config"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe("${lace.mount(wezterm-server/config)}");
    // Declarations map includes feature declaration
    expect(result.declarations["wezterm-server/config"]).toBeDefined();
    expect(result.declarations["wezterm-server/config"].target).toBe("/home/user/.config/wezterm");
  });

  it("injects multiple bare mount templates for feature with multiple declarations", () => {
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toHaveLength(2);
    expect(result.injected).toContain("data-feature/data");
    expect(result.injected).toContain("data-feature/cache");
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(2);
    expect(mounts.some((m: string) => m === "${lace.mount(data-feature/data)}")).toBe(true);
    expect(mounts.some((m: string) => m === "${lace.mount(data-feature/cache)}")).toBe(true);
  });

  it("injects bare mount template for readonly declaration (readonly resolved at spec time)", () => {
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual(["config-feature/settings"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe("${lace.mount(config-feature/settings)}");
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual([]);
    expect(config.mounts).toBeUndefined();
  });

  it("returns empty when no declarations at all", () => {
    const config: Record<string, unknown> = {};
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual([]);
    expect(Object.keys(result.declarations)).toHaveLength(0);
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual([]);
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

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual(["wezterm-server/config"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(2);
    expect(mounts[0]).toBe("source=/existing,target=/existing,type=bind");
    expect(mounts[1]).toBe("${lace.mount(wezterm-server/config)}");
  });

  // ── Project declarations ──

  it("injects project-level declaration as ${lace.mount(project/key)}", () => {
    const config: Record<string, unknown> = {};
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/bash-history": { target: "/commandhistory" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(result.injected).toEqual(["project/bash-history"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe("${lace.mount(project/bash-history)}");
    expect(result.declarations["project/bash-history"]).toBeDefined();
  });

  it("injects both project and feature declarations", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
    };
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        featureWithMountMetadata,
      ],
    ]);

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(result.injected).toHaveLength(2);
    expect(result.injected).toContain("project/data");
    expect(result.injected).toContain("wezterm-server/config");
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(2);
  });

  // ── Suppression tests ──

  it("suppresses injection when bare ${lace.mount(label)} already in mounts", () => {
    const config: Record<string, unknown> = {
      mounts: ["${lace.mount(project/data)}"],
    };
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(result.injected).toEqual([]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1); // No duplicate
  });

  it("suppresses injection when ${lace.mount(label).source} already in mounts", () => {
    const config: Record<string, unknown> = {
      mounts: ["source=${lace.mount(project/data).source},target=/data,type=bind"],
    };
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(result.injected).toEqual([]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
  });

  it("suppresses injection when ${lace.mount(label).target} already in mounts", () => {
    const config: Record<string, unknown> = {
      mounts: ["target=${lace.mount(project/data).target}"],
    };
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>();

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(result.injected).toEqual([]);
  });

  // ── Prebuild feature declarations ──

  it("injects prebuild feature mount declarations identically to regular features", () => {
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
        featureWithMountMetadata,
      ],
    ]);

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toEqual(["wezterm-server/config"]);
    const mounts = config.mounts as string[];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toBe("${lace.mount(wezterm-server/config)}");
  });

  it("injects both regular and prebuild feature mount declarations", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/org/data-feature:1": {},
      },
      customizations: {
        lace: {
          prebuildFeatures: {
            "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
          },
        },
      },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      ["ghcr.io/org/data-feature:1", featureWithMultipleMountsMetadata],
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        featureWithMountMetadata,
      ],
    ]);

    const result = autoInjectMountTemplates(config, noProjectDecls, metadataMap);

    expect(result.injected).toHaveLength(3);
    expect(result.injected).toContain("data-feature/data");
    expect(result.injected).toContain("data-feature/cache");
    expect(result.injected).toContain("wezterm-server/config");
  });

  // ── Unified declarations map ──

  it("returns unified declarations map combining project + feature", () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
      },
    };
    const projectDecls: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const metadataMap = new Map<string, FeatureMetadata | null>([
      [
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1",
        featureWithMountMetadata,
      ],
    ]);

    const result = autoInjectMountTemplates(config, projectDecls, metadataMap);

    expect(Object.keys(result.declarations)).toHaveLength(2);
    expect(result.declarations["project/data"]).toBeDefined();
    expect(result.declarations["project/data"].target).toBe("/data");
    expect(result.declarations["wezterm-server/config"]).toBeDefined();
    expect(result.declarations["wezterm-server/config"].target).toBe("/home/user/.config/wezterm");
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

// ── mount template resolution (v2 accessor syntax) ──

describe("mount template resolution", () => {
  // Declarations for tests that need declaration-aware resolution
  const projectDeclarations: Record<string, LaceMountDeclaration> = {
    "project/history": { target: "/history" },
    "project/data": { target: "/data" },
    "project/cache": { target: "/cache" },
  };

  // Test 1: LACE_UNKNOWN_PATTERN rejects non-mount/port patterns
  it("does not reject ${lace.mount()} as unknown, but still rejects ${lace.nonsense()}", async () => {
    trackProjectMountsDir(workspaceRoot);
    const configWithMount: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["${lace.mount(project/history)}"],
    };
    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);

    // Should not throw — mount() passes the guard
    await expect(
      resolveTemplates(configWithMount, allocator, mountResolver),
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

  // Test 2: Mount .source resolution in string
  it("resolves ${lace.mount(label).source} embedded in a mount string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["source=${lace.mount(project/history).source},target=/history,type=bind"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount(");
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

  // Test 3: Mount .source standalone
  it("resolves standalone ${lace.mount(label).source} to a path string (not integer)", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        HISTORY_DIR: "${lace.mount(project/history).source}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(typeof containerEnv.HISTORY_DIR).toBe("string");
    expect(containerEnv.HISTORY_DIR).not.toContain("${lace.mount(");
    expect(containerEnv.HISTORY_DIR).toMatch(/^\//);
  });

  // Test 4: Mixed port and mount
  it("resolves both ${lace.port()} and ${lace.mount(label).source} in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      mounts: ["source=${lace.mount(project/data).source},target=/data,type=bind"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    // Port resolved to integer
    const features = result.resolvedConfig.features as Record<string, Record<string, unknown>>;
    const hostSshPort = features["ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"].hostSshPort;
    expect(typeof hostSshPort).toBe("number");
    expect(hostSshPort).toBeGreaterThanOrEqual(22425);

    // Mount resolved to path
    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/data,type=bind/);

    // Both allocations and mount assignments present
    expect(result.allocations).toHaveLength(1);
    expect(result.mountAssignments).toHaveLength(1);
  });

  // Test 5: Mount .source in nested config
  it("resolves mount source template in nested config objects", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      customizations: {
        vscode: {
          settings: {
            "myExtension.historyPath": "${lace.mount(project/history).source}",
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const customizations = result.resolvedConfig.customizations as Record<string, Record<string, Record<string, unknown>>>;
    const historyPath = customizations.vscode.settings["myExtension.historyPath"];
    expect(typeof historyPath).toBe("string");
    expect(historyPath).not.toContain("${lace.mount(");
    expect(historyPath).toMatch(/^\//);
  });

  // Test 6: Mount .source in mounts array with mixed entries
  it("resolves mount source template inside a mounts array string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: [
        "source=${lace.mount(project/cache).source},target=/cache,type=bind",
        "source=/fixed/path,target=/fixed,type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).not.toContain("${lace.mount(");
    expect(mounts[0]).toMatch(/source=\/.*,target=\/cache,type=bind/);
    expect(mounts[1]).toBe("source=/fixed/path,target=/fixed,type=bind");
  });

  // Test 7: No mount templates passes through
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
        BAD: "${lace.mount(noslash).source}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {});
    await expect(
      resolveTemplates(config, allocator, mountResolver),
    ).rejects.toThrow(/Invalid mount label "noslash"/);
  });

  // Test 9: Mount .target resolution
  it("resolves ${lace.mount(label).target} to declaration target path", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        CLAUDE_CONFIG: "${lace.mount(project/config).target}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.CLAUDE_CONFIG).toBe("/home/node/.claude");
  });

  // Test 10: Mount .target with path suffix
  it("resolves ${lace.mount(label).target}/subpath correctly", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        SETTINGS_FILE: "${lace.mount(project/config).target}/settings.json",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.SETTINGS_FILE).toBe("/home/node/.claude/settings.json");
  });

  // Test 11: Mount .target in lifecycle commands
  it("resolves mount target in lifecycle commands", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      postCreateCommand: "mkdir -p ${lace.mount(project/config).target}/extensions",
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    expect(result.resolvedConfig.postCreateCommand).toBe(
      "mkdir -p /home/node/.claude/extensions",
    );
  });

  // Test 12: Mixed .source and .target in the same string
  it("resolves both .source and .target in the same string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      postCreateCommand:
        "cp ${lace.mount(project/config).source}/defaults.json ${lace.mount(project/config).target}/defaults.json",
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const cmd = result.resolvedConfig.postCreateCommand as string;
    expect(cmd).not.toContain("${lace.mount(");
    expect(cmd).toContain("/home/node/.claude/defaults.json");
    expect(cmd).toMatch(/^cp \/.*\/defaults\.json \/home\/node\/\.claude\/defaults\.json$/);
  });

  // Test 13: Bare ${lace.mount(label)} resolves to full mount spec
  it("resolves bare ${lace.mount(label)} to full mount spec string", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["${lace.mount(project/data)}"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toMatch(/^source=\/.*,target=\/data,type=bind$/);
    expect(mounts[0]).not.toContain("${lace.mount(");
  });

  // Test 14: Bare ${lace.mount(label)} with readonly declaration
  it("resolves bare ${lace.mount(label)} with readonly flag", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/secrets": { target: "/secrets", readonly: true },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["${lace.mount(project/secrets)}"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toMatch(/,type=bind,readonly$/);
  });

  // Test 15: Bare ${lace.mount(label)} with custom type and consistency
  it("resolves bare ${lace.mount(label)} with custom type and consistency", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/vol": { target: "/vol", type: "volume", consistency: "delegated" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: ["${lace.mount(project/vol)}"],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toContain("type=volume");
    expect(mounts[0]).toContain("consistency=delegated");
  });

  // Test 16: mountAssignments in result
  it("populates mountAssignments in TemplateResolutionResult", async () => {
    trackProjectMountsDir(workspaceRoot);
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: [
        "source=${lace.mount(project/data).source},target=/data,type=bind",
        "source=${lace.mount(project/cache).source},target=/cache,type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, projectDeclarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    expect(result.mountAssignments).toHaveLength(2);
    const labels = result.mountAssignments.map((a) => a.label);
    expect(labels).toContain("project/data");
    expect(labels).toContain("project/cache");
    for (const assignment of result.mountAssignments) {
      expect(assignment.resolvedSource).toMatch(/^\//);
      expect(assignment.isOverride).toBe(false);
    }
  });

  // Test 17: No resolver supplied — mount expressions pass through
  it("leaves mount expressions as literal strings when no resolver is supplied", async () => {
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        MOUNT_SRC: "${lace.mount(foo/bar).source}",
        MOUNT_TGT: "${lace.mount(foo/bar).target}",
        MOUNT_FULL: "${lace.mount(foo/bar)}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const result = await resolveTemplates(config, allocator);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.MOUNT_SRC).toBe("${lace.mount(foo/bar).source}");
    expect(containerEnv.MOUNT_TGT).toBe("${lace.mount(foo/bar).target}");
    expect(containerEnv.MOUNT_FULL).toBe("${lace.mount(foo/bar)}");
    expect(result.mountAssignments).toHaveLength(0);
  });

  // Test 18: Mount target in nested objects
  it("resolves mount target in nested config objects", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      customizations: {
        vscode: {
          settings: {
            "claude.configPath": "${lace.mount(project/config).target}",
          },
        },
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const customizations = result.resolvedConfig.customizations as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(customizations.vscode.settings["claude.configPath"]).toBe(
      "/home/node/.claude",
    );
  });

  // Test 19: Mount target in array elements
  it("resolves mount target in array elements", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      mounts: [
        "source=/host/path,target=${lace.mount(project/config).target},type=bind",
      ],
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const mounts = result.resolvedConfig.mounts as string[];
    expect(mounts[0]).toBe(
      "source=/host/path,target=/home/node/.claude,type=bind",
    );
  });

  // Test 20: Unknown mount label throws with declaration-aware error
  it("throws when mount label not in declarations", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/node/.claude" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
      containerEnv: {
        MISSING: "${lace.mount(project/unknown).target}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    await expect(
      resolveTemplates(config, allocator, mountResolver),
    ).rejects.toThrow(/Mount label "project\/unknown" not found in declarations/);
    await expect(
      resolveTemplates(config, allocator, mountResolver),
    ).rejects.toThrow(/Available: project\/config/);
  });

  // Test 21: Port + mount target in same config
  it("resolves both port templates and mount target templates in the same config", async () => {
    trackProjectMountsDir(workspaceRoot);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/config": { target: "/home/user/.config/wezterm" },
    };
    const config: Record<string, unknown> = {
      features: {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          hostSshPort: "${lace.port(wezterm-server/hostSshPort)}",
        },
      },
      containerEnv: {
        WEZTERM_CONFIG: "${lace.mount(project/config).target}",
      },
    };

    const allocator = new PortAllocator(workspaceRoot);
    const mountResolver = new MountPathResolver(workspaceRoot, {}, declarations);
    const result = await resolveTemplates(config, allocator, mountResolver);

    const features = result.resolvedConfig.features as Record<string, Record<string, unknown>>;
    const hostSshPort = features["ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"].hostSshPort;
    expect(typeof hostSshPort).toBe("number");
    expect(hostSshPort).toBeGreaterThanOrEqual(22425);

    const containerEnv = result.resolvedConfig.containerEnv as Record<string, unknown>;
    expect(containerEnv.WEZTERM_CONFIG).toBe("/home/user/.config/wezterm");
  });
});

// ── validateMountNamespaces ──

describe("validateMountNamespaces", () => {
  it("passes when all namespaces are valid (project + known feature)", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
      "wezterm-server/config": { target: "/config" },
    };
    const featureShortIds = new Set(["wezterm-server"]);

    // Should not throw
    expect(() => validateMountNamespaces(declarations, featureShortIds)).not.toThrow();
  });

  it("passes with only project declarations and no features", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
      "project/cache": { target: "/cache" },
    };
    const featureShortIds = new Set<string>();

    expect(() => validateMountNamespaces(declarations, featureShortIds)).not.toThrow();
  });

  it("throws when namespace is unknown", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
      "unknown-feature/config": { target: "/config" },
    };
    const featureShortIds = new Set(["wezterm-server"]);

    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /Unknown mount namespace/,
    );
    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /"unknown-feature\/config"/,
    );
  });

  it("includes valid namespaces in error message", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "bad-ns/data": { target: "/data" },
    };
    const featureShortIds = new Set(["wezterm-server", "claude-code"]);

    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /Valid namespaces:.*project/,
    );
    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /Valid namespaces:.*wezterm-server/,
    );
  });

  it("reports all unknown labels in a single error", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "bad1/data": { target: "/data" },
      "bad2/config": { target: "/config" },
    };
    const featureShortIds = new Set<string>();

    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /"bad1\/data"/,
    );
    expect(() => validateMountNamespaces(declarations, featureShortIds)).toThrow(
      /"bad2\/config"/,
    );
  });

  it("passes with empty declarations", () => {
    const declarations: Record<string, LaceMountDeclaration> = {};
    const featureShortIds = new Set<string>();

    expect(() => validateMountNamespaces(declarations, featureShortIds)).not.toThrow();
  });

  it("passes with multiple valid feature namespaces", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
      "wezterm-server/config": { target: "/config" },
      "claude-code/session": { target: "/session" },
    };
    const featureShortIds = new Set(["wezterm-server", "claude-code"]);

    expect(() => validateMountNamespaces(declarations, featureShortIds)).not.toThrow();
  });
});

// ── validateMountTargetConflicts ──

describe("validateMountTargetConflicts", () => {
  it("passes when all targets are unique", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
      "project/cache": { target: "/cache" },
      "wezterm-server/config": { target: "/config" },
    };

    expect(() => validateMountTargetConflicts(declarations)).not.toThrow();
  });

  it("throws when two declarations share the same target", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/shared-path" },
      "wezterm-server/config": { target: "/shared-path" },
    };

    expect(() => validateMountTargetConflicts(declarations)).toThrow(
      /Mount target conflict/,
    );
    expect(() => validateMountTargetConflicts(declarations)).toThrow(
      /\/shared-path/,
    );
    expect(() => validateMountTargetConflicts(declarations)).toThrow(
      /project\/data/,
    );
    expect(() => validateMountTargetConflicts(declarations)).toThrow(
      /wezterm-server\/config/,
    );
  });

  it("passes with empty declarations", () => {
    const declarations: Record<string, LaceMountDeclaration> = {};

    expect(() => validateMountTargetConflicts(declarations)).not.toThrow();
  });

  it("passes with a single declaration", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/data": { target: "/data" },
    };

    expect(() => validateMountTargetConflicts(declarations)).not.toThrow();
  });

  it("detects conflict between project and feature declarations", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/my-data": { target: "/mnt/data" },
      "feature/other-data": { target: "/mnt/data" },
    };

    expect(() => validateMountTargetConflicts(declarations)).toThrow(
      /Mount target conflict.*\/mnt\/data/,
    );
  });
});
