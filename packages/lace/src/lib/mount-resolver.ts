// IMPLEMENTATION_VALIDATION
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { deriveProjectId } from "./repo-clones";
import type { LaceSettings } from "./settings";
import type { LaceMountDeclaration } from "./feature-metadata";

// ── Types ──

/** A single mount path assignment tracked by lace. */
export interface MountAssignment {
  /** The label that identifies this assignment (e.g., "myns/data"). */
  label: string;
  /** The resolved host source path for the mount. */
  resolvedSource: string;
  /** Whether this assignment came from a settings override. */
  isOverride: boolean;
  /** ISO 8601 timestamp of when this assignment was first created. */
  assignedAt: string;
}

/** Persisted state in .lace/mount-assignments.json. */
export interface MountAssignmentsFile {
  /** Map from label to assignment details. */
  assignments: Record<string, MountAssignment>;
}

// ── Label validation ──

const LABEL_PATTERN = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;

/**
 * Validate a mount label format.
 * Must be `namespace/label` where both parts are lowercase alphanumeric with hyphens/underscores.
 *
 * @throws Error if the label is invalid
 */
function validateLabel(label: string): void {
  if (!LABEL_PATTERN.test(label)) {
    const parts = label.split("/");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid mount label "${label}". Expected format: namespace/label (e.g., "myns/data"). ` +
          `Label must contain exactly one "/" separating namespace and label parts.`,
      );
    }
    // Has correct structure but invalid characters
    const [namespace, labelPart] = parts;
    const badChars = (s: string) =>
      s.replace(/[a-z0-9_-]/g, "").split("").filter((c, i, a) => a.indexOf(c) === i).join(", ");
    const nsIssues = badChars(namespace);
    const labelIssues = badChars(labelPart);
    const issues: string[] = [];
    if (nsIssues) issues.push(`namespace "${namespace}" contains invalid characters: ${nsIssues}`);
    if (labelIssues) issues.push(`label "${labelPart}" contains invalid characters: ${labelIssues}`);
    throw new Error(
      `Invalid mount label "${label}". ${issues.join("; ")}. ` +
        `Only lowercase alphanumeric characters, hyphens, and underscores are allowed.`,
    );
  }
}

// ── MountPathResolver ──

export class MountPathResolver {
  private assignments: Map<string, MountAssignment> = new Map();
  private persistPath: string;
  private projectId: string;

  constructor(
    private workspaceFolder: string,
    private settings: LaceSettings,
    private declarations: Record<string, LaceMountDeclaration> = {},
  ) {
    this.persistPath = join(
      workspaceFolder,
      ".lace",
      "mount-assignments.json",
    );
    this.projectId = deriveProjectId(workspaceFolder);
    this.load();
  }

  /** Whether this resolver has declarations loaded. */
  hasDeclarations(): boolean {
    return Object.keys(this.declarations).length > 0;
  }

  /** Load persisted assignments from disk. */
  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(
        readFileSync(this.persistPath, "utf-8"),
      ) as MountAssignmentsFile;
      for (const [label, assignment] of Object.entries(
        raw.assignments ?? {},
      )) {
        this.assignments.set(label, assignment);
      }
    } catch {
      // Corrupt file -- start fresh, will be overwritten on save
    }
  }

  /** Persist current assignments to disk. */
  save(): void {
    const dir = join(this.workspaceFolder, ".lace");
    mkdirSync(dir, { recursive: true });
    const file: MountAssignmentsFile = {
      assignments: Object.fromEntries(this.assignments),
    };
    writeFileSync(
      this.persistPath,
      JSON.stringify(file, null, 2) + "\n",
      "utf-8",
    );
  }

  /**
   * Validate that a label exists in the declarations map.
   * @throws Error if the label is not declared
   */
  private validateDeclaration(label: string): void {
    if (Object.keys(this.declarations).length > 0 && !(label in this.declarations)) {
      const available = Object.keys(this.declarations).join(", ");
      throw new Error(
        `Mount label "${label}" not found in declarations. ` +
          `Available: ${available || "(none)"}`,
      );
    }
  }

  /**
   * Resolve a mount label to a host source path.
   *
   * Resolution order:
   * 1. Validate label format and existence in declarations
   * 2. If already resolved, return the existing assignment
   * 3. Check settings override: settings.mounts[label].source
   * 4. Derive default: ~/.config/lace/<projectId>/mounts/<namespace>/<label-part>
   *
   * @param label Mount label in namespace/label format (e.g., "myns/data")
   * @returns Resolved absolute host path
   * @throws Error if label is invalid, not declared, or override path doesn't exist
   */
  resolveSource(label: string): string {
    validateLabel(label);
    this.validateDeclaration(label);

    // Return existing assignment if already resolved
    const existing = this.assignments.get(label);
    if (existing) {
      return existing.resolvedSource;
    }

    const [namespace, labelPart] = label.split("/");

    // Check settings override
    const overrideSettings = this.settings.mounts?.[label];
    if (overrideSettings?.source) {
      const overridePath = overrideSettings.source;

      // Override path must exist on disk (hard error, consistent with repoMounts)
      if (!existsSync(overridePath)) {
        throw new Error(
          `Mount override source does not exist for "${label}": ${overridePath}. ` +
            `Create the directory or remove the override from settings.json.`,
        );
      }

      const assignment: MountAssignment = {
        label,
        resolvedSource: overridePath,
        isOverride: true,
        assignedAt: new Date().toISOString(),
      };
      this.assignments.set(label, assignment);
      return overridePath;
    }

    // Derive default path
    const defaultPath = join(
      homedir(),
      ".config",
      "lace",
      this.projectId,
      "mounts",
      namespace,
      labelPart,
    );

    // Auto-create default directory
    mkdirSync(defaultPath, { recursive: true });

    const assignment: MountAssignment = {
      label,
      resolvedSource: defaultPath,
      isOverride: false,
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(label, assignment);
    return defaultPath;
  }

  /**
   * Return container target path from declaration.
   * @throws Error if label is not in declarations
   */
  resolveTarget(label: string): string {
    validateLabel(label);
    const decl = this.declarations[label];
    if (!decl) {
      const available = Object.keys(this.declarations).join(", ");
      throw new Error(
        `Mount label "${label}" not found in declarations. ` +
          `Available: ${available || "(none)"}`,
      );
    }
    return decl.target;
  }

  /**
   * Produce complete mount spec string from declaration + resolved source.
   * Format: source=<path>,target=<path>,type=<type>[,readonly][,consistency=<val>]
   */
  resolveFullSpec(label: string): string {
    const source = this.resolveSource(label);
    // resolveSource() already validates the label exists in declarations via
    // validateDeclaration(), but that check is a no-op when declarations is empty
    // (backwards compat for tests without declarations). The explicit check here
    // ensures resolveFullSpec() always fails on missing declarations regardless.
    const decl = this.declarations[label];
    if (!decl) {
      const available = Object.keys(this.declarations).join(", ");
      throw new Error(
        `Mount label "${label}" not found in declarations. ` +
          `Available: ${available || "(none)"}`,
      );
    }

    const parts = [
      `source=${source}`,
      `target=${decl.target}`,
      `type=${decl.type ?? "bind"}`,
    ];

    if (decl.readonly) {
      parts.push("readonly");
    }

    if (decl.consistency) {
      parts.push(`consistency=${decl.consistency}`);
    }

    return parts.join(",");
  }

  /** Get all current assignments. */
  getAssignments(): MountAssignment[] {
    return Array.from(this.assignments.values());
  }

  /** Get declarations map. */
  getDeclarations(): Record<string, LaceMountDeclaration> {
    return this.declarations;
  }
}
