import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mergeUserMounts,
  mergeUserFeatures,
  mergeUserContainerEnv,
  mergeUserGitIdentity,
  applyUserConfig,
} from "@/lib/user-config-merge";

// ── mergeUserMounts ──

describe("mergeUserMounts", () => {
  it("prefixes mount labels with user/ namespace", () => {
    const userMounts = {
      screenshots: {
        source: "~/Pictures/Screenshots",
        target: "/mnt/user/screenshots",
        description: "Host screenshots",
      },
    };

    const result = mergeUserMounts(userMounts);
    expect(result["user/screenshots"]).toBeDefined();
    expect(result["user/screenshots"].target).toBe("/mnt/user/screenshots");
  });

  it("forces readonly: true on all user mounts", () => {
    const userMounts = {
      notes: {
        source: "~/Documents/notes",
        target: "/mnt/user/notes",
      },
    };

    const result = mergeUserMounts(userMounts);
    expect(result["user/notes"].readonly).toBe(true);
  });

  it("expands and resolves source paths into recommendedSource", () => {
    const userMounts = {
      data: {
        source: "~/shared/data",
        target: "/mnt/user/data",
      },
    };

    const result = mergeUserMounts(userMounts);
    expect(result["user/data"].recommendedSource).toBe(
      join(homedir(), "shared/data"),
    );
  });

  it("handles multiple mounts", () => {
    const userMounts = {
      screenshots: {
        source: "~/Pictures/Screenshots",
        target: "/mnt/user/screenshots",
      },
      notes: {
        source: "~/Documents/notes",
        target: "/mnt/user/notes",
      },
    };

    const result = mergeUserMounts(userMounts);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["user/screenshots"]).toBeDefined();
    expect(result["user/notes"]).toBeDefined();
  });
});

// ── mergeUserFeatures ──

describe("mergeUserFeatures", () => {
  it("unions features with no conflicts", () => {
    const userFeatures = {
      "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    };
    const projectFeatures = {
      "ghcr.io/devcontainers/features/rust:1": { version: "latest" },
    };

    const result = mergeUserFeatures(userFeatures, projectFeatures);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("project options override user options on same feature", () => {
    const userFeatures = {
      "ghcr.io/devcontainers/features/rust:1": { version: "1.70", profile: "minimal" },
    };
    const projectFeatures = {
      "ghcr.io/devcontainers/features/rust:1": { version: "latest" },
    };

    const result = mergeUserFeatures(userFeatures, projectFeatures);
    expect(result["ghcr.io/devcontainers/features/rust:1"].version).toBe("latest");
    // User-only option preserved when project doesn't set it
    expect(result["ghcr.io/devcontainers/features/rust:1"].profile).toBe("minimal");
  });

  it("handles empty user features", () => {
    const projectFeatures = {
      "ghcr.io/devcontainers/features/rust:1": {},
    };

    const result = mergeUserFeatures({}, projectFeatures);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("handles empty project features", () => {
    const userFeatures = {
      "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    };

    const result = mergeUserFeatures(userFeatures, {});
    expect(Object.keys(result)).toHaveLength(1);
  });
});

// ── mergeUserContainerEnv ──

describe("mergeUserContainerEnv", () => {
  it("user provides defaults, project overrides per-key", () => {
    const userEnv = { EDITOR: "nvim", PAGER: "less" };
    const projectEnv = { EDITOR: "code" };

    const result = mergeUserContainerEnv(userEnv, projectEnv);
    expect(result.merged.EDITOR).toBe("code"); // project wins
    expect(result.merged.PAGER).toBe("less"); // user default preserved
  });

  it("warns when user sets GIT_AUTHOR_NAME in containerEnv", () => {
    const userEnv = { GIT_AUTHOR_NAME: "Wrong" };
    const projectEnv = {};

    const result = mergeUserContainerEnv(userEnv, projectEnv);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("GIT_AUTHOR_NAME");
    expect(result.warnings[0]).toContain("two-layer");
  });

  it("warns for each git identity env var in user containerEnv", () => {
    const userEnv = {
      GIT_AUTHOR_NAME: "a",
      GIT_AUTHOR_EMAIL: "b",
      GIT_COMMITTER_NAME: "c",
      GIT_COMMITTER_EMAIL: "d",
    };

    const result = mergeUserContainerEnv(userEnv, {});
    expect(result.warnings).toHaveLength(4);
  });

  it("no warnings for normal env vars", () => {
    const userEnv = { EDITOR: "nvim", TERM: "xterm-256color" };
    const result = mergeUserContainerEnv(userEnv, {});
    expect(result.warnings).toHaveLength(0);
  });
});

// ── mergeUserGitIdentity ──

describe("mergeUserGitIdentity", () => {
  it("sets LACE_GIT_NAME and LACE_GIT_EMAIL", () => {
    const git = { name: "Jane Developer", email: "jane@example.com" };
    const result = mergeUserGitIdentity(git, {});

    expect(result.LACE_GIT_NAME).toBe("Jane Developer");
    expect(result.LACE_GIT_EMAIL).toBe("jane@example.com");
  });

  it("does NOT set GIT_AUTHOR_NAME or GIT_AUTHOR_EMAIL", () => {
    const git = { name: "Jane", email: "jane@example.com" };
    const result = mergeUserGitIdentity(git, {});

    expect(result.GIT_AUTHOR_NAME).toBeUndefined();
    expect(result.GIT_AUTHOR_EMAIL).toBeUndefined();
    expect(result.GIT_COMMITTER_NAME).toBeUndefined();
    expect(result.GIT_COMMITTER_EMAIL).toBeUndefined();
  });

  it("does not overwrite existing LACE_GIT_NAME (project override)", () => {
    const git = { name: "User Default", email: "user@example.com" };
    const existing = { LACE_GIT_NAME: "Project Override" };

    const result = mergeUserGitIdentity(git, existing);
    expect(result.LACE_GIT_NAME).toBe("Project Override");
    expect(result.LACE_GIT_EMAIL).toBe("user@example.com");
  });

  it("preserves other env vars", () => {
    const git = { name: "Jane", email: "jane@example.com" };
    const existing = { EDITOR: "nvim" };

    const result = mergeUserGitIdentity(git, existing);
    expect(result.EDITOR).toBe("nvim");
    expect(result.LACE_GIT_NAME).toBe("Jane");
  });
});

// ── applyUserConfig ──

describe("applyUserConfig", () => {
  it("merges full user config with project config", () => {
    const userConfig = {
      mounts: {
        screenshots: {
          source: "~/Pictures/Screenshots",
          target: "/mnt/user/screenshots",
        },
      },
      features: {
        "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
      },
      git: { name: "Jane", email: "jane@example.com" },
      defaultShell: "/usr/bin/nu",
      containerEnv: { EDITOR: "nvim" },
    };

    const result = applyUserConfig(
      userConfig,
      { "ghcr.io/devcontainers/features/rust:1": {} },
      {},
      { TERM: "xterm" },
    );

    // User mounts with user/ prefix
    expect(result.userMountDeclarations["user/screenshots"]).toBeDefined();
    expect(result.userMountDeclarations["user/screenshots"].readonly).toBe(true);

    // Features merged into regular features (no prebuild)
    expect(Object.keys(result.mergedFeatures)).toHaveLength(2);

    // containerEnv: user defaults + project overrides + git identity
    expect(result.mergedContainerEnv.EDITOR).toBe("nvim");
    expect(result.mergedContainerEnv.TERM).toBe("xterm");
    expect(result.mergedContainerEnv.LACE_GIT_NAME).toBe("Jane");
    expect(result.mergedContainerEnv.LACE_GIT_EMAIL).toBe("jane@example.com");

    // Default shell
    expect(result.defaultShell).toBe("/usr/bin/nu");

    // No warnings
    expect(result.warnings).toHaveLength(0);
  });

  it("user features go into prebuildFeatures when project has them", () => {
    const userConfig = {
      features: {
        "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
      },
    };

    const result = applyUserConfig(
      userConfig,
      {},
      { "ghcr.io/devcontainers/features/sshd:1": {} },
      {},
    );

    // User features merged into prebuild (project has prebuild features)
    expect(result.mergedPrebuildFeatures["ghcr.io/eitsupi/devcontainer-features/nushell:0"]).toBeDefined();
    expect(result.mergedPrebuildFeatures["ghcr.io/devcontainers/features/sshd:1"]).toBeDefined();
    // Regular features unchanged
    expect(Object.keys(result.mergedFeatures)).toHaveLength(0);
  });

  it("returns empty state for empty user config", () => {
    const result = applyUserConfig(
      {},
      { "ghcr.io/devcontainers/features/rust:1": {} },
      {},
      { TERM: "xterm" },
    );

    expect(Object.keys(result.userMountDeclarations)).toHaveLength(0);
    expect(Object.keys(result.mergedFeatures)).toHaveLength(1);
    expect(result.mergedContainerEnv.TERM).toBe("xterm");
    expect(result.defaultShell).toBeUndefined();
  });

  it("user/screenshots and project/data mounts coexist", () => {
    const userConfig = {
      mounts: {
        screenshots: {
          source: "~/Pictures/Screenshots",
          target: "/mnt/user/screenshots",
        },
      },
    };

    const result = applyUserConfig(userConfig, {}, {}, {});
    // User mount is in declarations
    expect(result.userMountDeclarations["user/screenshots"]).toBeDefined();
    // Target conflict detection happens in the pipeline, not here
  });
});
