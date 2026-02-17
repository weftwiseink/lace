// IMPLEMENTATION_VALIDATION
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { MountPathResolver } from "../mount-resolver";
import type { MountAssignmentsFile } from "../mount-resolver";
import type { LaceSettings } from "../settings";
import type { LaceMountDeclaration } from "../feature-metadata";
import { deriveProjectId } from "../repo-clones";
import { clearClassificationCache } from "../workspace-detector";

let testDir: string;
let workspaceFolder: string;
/** Auto-created default mount dirs to clean up after tests */
let createdMountDirs: string[];

beforeEach(() => {
  clearClassificationCache();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `lace-test-mount-resolver-${suffix}`);
  workspaceFolder = join(testDir, "workspace");
  mkdirSync(workspaceFolder, { recursive: true });
  createdMountDirs = [];
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
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

// ── Default path derivation (resolveSource) ──

describe("MountPathResolver — resolveSource default path derivation", () => {
  it("returns ~/.config/lace/<projectId>/mounts/namespace/label for default resolution", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    const result = resolver.resolveSource("myns/data");

    const projectId = deriveProjectId(workspaceFolder);
    const expected = join(
      homedir(),
      ".config",
      "lace",
      projectId,
      "mounts",
      "myns",
      "data",
    );
    expect(result).toBe(expected);
  });

  it("uses workspace folder basename for projectId derivation", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    const result = resolver.resolveSource("ns/label");

    const projectId = deriveProjectId(workspaceFolder);
    expect(projectId).toBe(basename(workspaceFolder).toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-"));
    expect(result).toContain(projectId);
  });
});

// ── Settings override (resolveSource) ──

describe("MountPathResolver — resolveSource settings override", () => {
  it("returns expanded custom path when override exists in settings", () => {
    const overrideDir = join(testDir, "custom-mount");
    mkdirSync(overrideDir, { recursive: true });

    const settings: LaceSettings = {
      mounts: {
        "myns/data": { source: overrideDir },
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, settings);

    const result = resolver.resolveSource("myns/data");
    expect(result).toBe(overrideDir);
  });

  it("records override assignment as isOverride: true", () => {
    const overrideDir = join(testDir, "custom-mount");
    mkdirSync(overrideDir, { recursive: true });

    const settings: LaceSettings = {
      mounts: {
        "myns/data": { source: overrideDir },
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, settings);
    resolver.resolveSource("myns/data");

    const assignments = resolver.getAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].isOverride).toBe(true);
  });
});

// ── Auto-create default directory ──

describe("MountPathResolver — auto-create default directory", () => {
  it("creates the default directory on disk when resolving", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    const result = resolver.resolveSource("myns/data");
    expect(existsSync(result)).toBe(true);
  });
});

// ── No auto-create for overrides ──

describe("MountPathResolver — no auto-create for overrides", () => {
  it("does not create directories for override paths", () => {
    const overrideDir = join(testDir, "existing-mount");
    mkdirSync(overrideDir, { recursive: true });

    // Create a sibling path that doesn't exist
    const nonExistentSibling = join(testDir, "nonexistent-sibling");

    const settings: LaceSettings = {
      mounts: {
        "myns/data": { source: overrideDir },
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, settings);
    resolver.resolveSource("myns/data");

    // The override path exists (it was pre-created)
    expect(existsSync(overrideDir)).toBe(true);
    // But we didn't create anything new in the test dir other than what was explicitly created
    expect(existsSync(nonExistentSibling)).toBe(false);
  });
});

// ── Override path missing ──

describe("MountPathResolver — override path missing", () => {
  it("throws hard error when override source path does not exist", () => {
    const settings: LaceSettings = {
      mounts: {
        "myns/data": { source: join(testDir, "nonexistent") },
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("myns/data")).toThrow(
      /Mount override source does not exist/,
    );
    expect(() => resolver.resolveSource("myns/data")).toThrow(
      /"myns\/data"/,
    );
  });
});

// ── Persistence ──

describe("MountPathResolver — persistence", () => {
  it("saves to .lace/mount-assignments.json and loads on new instance", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};

    // Create first resolver, resolve a label, and save
    const resolver1 = new MountPathResolver(workspaceFolder, settings);
    const path1 = resolver1.resolveSource("myns/data");
    resolver1.save();

    // Verify the file was written
    const persistPath = join(workspaceFolder, ".lace", "mount-assignments.json");
    expect(existsSync(persistPath)).toBe(true);

    // Parse and verify the file contents
    const raw = JSON.parse(
      readFileSync(persistPath, "utf-8"),
    ) as MountAssignmentsFile;
    expect(raw.assignments["myns/data"]).toBeDefined();
    expect(raw.assignments["myns/data"].resolvedSource).toBe(path1);

    // Create second resolver -- it should load the persisted state
    const resolver2 = new MountPathResolver(workspaceFolder, settings);
    const path2 = resolver2.resolveSource("myns/data");
    expect(path2).toBe(path1);

    // Assignments should match
    const assignments = resolver2.getAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0].label).toBe("myns/data");
  });
});

// ── Label validation ──

describe("MountPathResolver — label validation", () => {
  it("throws on label with spaces", () => {
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("my ns/data")).toThrow(
      /Invalid mount label/,
    );
  });

  it("throws on label with uppercase characters", () => {
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("MyNs/Data")).toThrow(
      /Invalid mount label/,
    );
  });

  it("throws on label missing namespace (no slash)", () => {
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("data")).toThrow(/Invalid mount label/);
    expect(() => resolver.resolveSource("data")).toThrow(
      /exactly one "\/"/,
    );
  });

  it("throws on empty label", () => {
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("")).toThrow(/Invalid mount label/);
  });

  it("throws on label with too many slashes", () => {
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    expect(() => resolver.resolveSource("a/b/c")).toThrow(/Invalid mount label/);
  });

  it("accepts valid labels with hyphens and underscores", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    // Should not throw
    const result = resolver.resolveSource("my-ns_1/data-file_2");
    expect(result).toBeDefined();
  });
});

// ── Multiple resolves same label ──

describe("MountPathResolver — idempotent resolution", () => {
  it("returns the same path when resolving the same label twice", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    const path1 = resolver.resolveSource("myns/data");
    const path2 = resolver.resolveSource("myns/data");
    expect(path1).toBe(path2);
  });

  it("only creates one assignment for multiple resolves of the same label", () => {
    trackProjectMountsDir(workspaceFolder);
    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(workspaceFolder, settings);

    resolver.resolveSource("myns/data");
    resolver.resolveSource("myns/data");
    resolver.resolveSource("myns/data");

    const assignments = resolver.getAssignments();
    expect(assignments).toHaveLength(1);
  });
});

// ── ProjectId derivation ──

describe("MountPathResolver — projectId derivation", () => {
  it("derives projectId from workspace folder basename", () => {
    // Create a workspace with a distinctive name
    const customWorkspace = join(testDir, "My-Cool_Project");
    mkdirSync(customWorkspace, { recursive: true });
    trackProjectMountsDir(customWorkspace);

    const settings: LaceSettings = {};
    const resolver = new MountPathResolver(customWorkspace, settings);
    const result = resolver.resolveSource("ns/label");

    // deriveProjectId lowercases and replaces non-alphanumeric with hyphens
    const expectedProjectId = "my-cool-project";
    expect(result).toContain(expectedProjectId);
    expect(result).toContain(join("mounts", "ns", "label"));
  });
});

// ── resolveTarget ──

describe("MountPathResolver — resolveTarget", () => {
  it("returns the declaration target path", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    expect(resolver.resolveTarget("project/foo")).toBe("/bar");
  });

  it("throws when label not in declarations", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    expect(() => resolver.resolveTarget("project/unknown")).toThrow(
      /Mount label "project\/unknown" not found in declarations/,
    );
    expect(() => resolver.resolveTarget("project/unknown")).toThrow(
      /Available: project\/foo/,
    );
  });

  it("throws on invalid label format", () => {
    const declarations: Record<string, LaceMountDeclaration> = {};
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    expect(() => resolver.resolveTarget("noslash")).toThrow(/Invalid mount label/);
  });
});

// ── resolveFullSpec ──

describe("MountPathResolver — resolveFullSpec", () => {
  it("produces source=<path>,target=/bar,type=bind for basic declaration", () => {
    trackProjectMountsDir(workspaceFolder);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toMatch(/^source=\/.*,target=\/bar,type=bind$/);
  });

  it("includes ,readonly when declaration has readonly: true", () => {
    trackProjectMountsDir(workspaceFolder);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar", readonly: true },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toContain(",readonly");
    expect(spec).toMatch(/,type=bind,readonly$/);
  });

  it("uses custom type when declared", () => {
    trackProjectMountsDir(workspaceFolder);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar", type: "volume" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toContain("type=volume");
  });

  it("includes consistency when declared", () => {
    trackProjectMountsDir(workspaceFolder);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar", consistency: "delegated" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toContain("consistency=delegated");
  });

  it("assembles all options correctly", () => {
    trackProjectMountsDir(workspaceFolder);
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": {
        target: "/bar",
        type: "bind",
        readonly: true,
        consistency: "cached",
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toMatch(/^source=\/.*,target=\/bar,type=bind,readonly,consistency=cached$/);
  });

  it("uses settings override for source when present", () => {
    const overrideDir = join(testDir, "custom-mount");
    mkdirSync(overrideDir, { recursive: true });

    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const settings: LaceSettings = {
      mounts: {
        "project/foo": { source: overrideDir },
      },
    };
    const resolver = new MountPathResolver(workspaceFolder, settings, declarations);

    const spec = resolver.resolveFullSpec("project/foo");
    expect(spec).toBe(`source=${overrideDir},target=/bar,type=bind`);
  });

  it("throws when label not in declarations", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    expect(() => resolver.resolveFullSpec("project/unknown")).toThrow(
      /Mount label "project\/unknown" not found in declarations/,
    );
  });
});

// ── Declaration validation in resolveSource ──

describe("MountPathResolver — declaration validation in resolveSource", () => {
  it("throws when label not in non-empty declarations map", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);

    expect(() => resolver.resolveSource("project/unknown")).toThrow(
      /Mount label "project\/unknown" not found in declarations/,
    );
    expect(() => resolver.resolveSource("project/unknown")).toThrow(
      /Available: project\/foo/,
    );
  });

  it("allows any label when declarations map is empty (backwards compat)", () => {
    trackProjectMountsDir(workspaceFolder);
    const resolver = new MountPathResolver(workspaceFolder, {});

    // Should not throw -- empty declarations = no declaration validation
    const result = resolver.resolveSource("any/label");
    expect(result).toBeDefined();
  });
});

// ── hasDeclarations ──

describe("MountPathResolver — hasDeclarations", () => {
  it("returns false when no declarations", () => {
    const resolver = new MountPathResolver(workspaceFolder, {});
    expect(resolver.hasDeclarations()).toBe(false);
  });

  it("returns true when declarations are provided", () => {
    const declarations: Record<string, LaceMountDeclaration> = {
      "project/foo": { target: "/bar" },
    };
    const resolver = new MountPathResolver(workspaceFolder, {}, declarations);
    expect(resolver.hasDeclarations()).toBe(true);
  });
});

// ── Staleness detection ──

describe("MountPathResolver — staleness detection", () => {
  it("discards stale default-path assignments from old project ID", () => {
    const currentProjectId = deriveProjectId(workspaceFolder);
    const oldProjectId = "old-wrong-name";

    // Write a persistence file with an assignment using the old project ID
    const persistDir = join(workspaceFolder, ".lace");
    mkdirSync(persistDir, { recursive: true });
    const staleAssignments: MountAssignmentsFile = {
      assignments: {
        "project/bash-history": {
          label: "project/bash-history",
          resolvedSource: join(
            homedir(),
            ".config",
            "lace",
            oldProjectId,
            "mounts",
            "project",
            "bash-history",
          ),
          isOverride: false,
          assignedAt: new Date().toISOString(),
        },
      },
    };
    writeFileSync(
      join(persistDir, "mount-assignments.json"),
      JSON.stringify(staleAssignments, null, 2),
      "utf-8",
    );

    // Capture console.warn
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Create resolver — should detect and discard the stale entry
    const resolver = new MountPathResolver(workspaceFolder, {});

    // Stale entry should have been discarded
    expect(resolver.getAssignments()).toHaveLength(0);

    // Warning should have been emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("stale path"),
    );

    warnSpy.mockRestore();

    // Re-resolve should use current project ID
    trackProjectMountsDir(workspaceFolder);
    const freshPath = resolver.resolveSource("project/bash-history");
    expect(freshPath).toContain(`/${currentProjectId}/mounts/`);
    expect(freshPath).not.toContain(`/${oldProjectId}/`);
  });

  it("preserves override assignments even when default paths would be stale", () => {
    const overrideDir = join(testDir, "my-claude-config");
    mkdirSync(overrideDir, { recursive: true });

    // Write a persistence file with an override assignment (path doesn't contain project ID)
    const persistDir = join(workspaceFolder, ".lace");
    mkdirSync(persistDir, { recursive: true });
    const assignments: MountAssignmentsFile = {
      assignments: {
        "project/claude-config": {
          label: "project/claude-config",
          resolvedSource: overrideDir,
          isOverride: true,
          assignedAt: new Date().toISOString(),
        },
      },
    };
    writeFileSync(
      join(persistDir, "mount-assignments.json"),
      JSON.stringify(assignments, null, 2),
      "utf-8",
    );

    // Create resolver — override should be preserved
    const resolver = new MountPathResolver(workspaceFolder, {});
    expect(resolver.getAssignments()).toHaveLength(1);
    expect(resolver.getAssignments()[0].resolvedSource).toBe(overrideDir);
  });

  it("preserves non-stale default-path assignments", () => {
    const currentProjectId = deriveProjectId(workspaceFolder);
    const correctPath = join(
      homedir(),
      ".config",
      "lace",
      currentProjectId,
      "mounts",
      "project",
      "data",
    );
    mkdirSync(correctPath, { recursive: true });
    createdMountDirs.push(join(homedir(), ".config", "lace", currentProjectId, "mounts"));

    // Write a persistence file with a correct project ID
    const persistDir = join(workspaceFolder, ".lace");
    mkdirSync(persistDir, { recursive: true });
    const assignments: MountAssignmentsFile = {
      assignments: {
        "project/data": {
          label: "project/data",
          resolvedSource: correctPath,
          isOverride: false,
          assignedAt: new Date().toISOString(),
        },
      },
    };
    writeFileSync(
      join(persistDir, "mount-assignments.json"),
      JSON.stringify(assignments, null, 2),
      "utf-8",
    );

    // Create resolver — correct assignment should be preserved
    const resolver = new MountPathResolver(workspaceFolder, {});
    expect(resolver.getAssignments()).toHaveLength(1);
    expect(resolver.getAssignments()[0].resolvedSource).toBe(correctPath);
  });
});
