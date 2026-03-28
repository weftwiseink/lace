// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { formatDebugFooter } from "../debug-footer";

describe("formatDebugFooter", () => {
  it("includes all required fields in the footer", () => {
    const footer = formatDebugFooter({
      logPath: "/home/user/project/.lace/logs/2026-03-28T10-15-30-a3f2b1.log",
      failedPhase: "mountValidation",
      projectName: "whelm",
      workspaceFolder: "/home/user/code/apps/whelm",
    });

    expect(footer).toContain("lace debugging context");
    expect(footer).toContain("/home/user/project/.lace/logs/2026-03-28T10-15-30-a3f2b1.log");
    expect(footer).toContain("devcontainer.json");
    expect(footer).toContain("mount-assignments.json");
    expect(footer).toContain("port-assignments.json");
    expect(footer).toContain("failed phase: mountValidation");
    expect(footer).toContain("project: whelm");
    expect(footer).toContain("workspace: /home/user/code/apps/whelm");
    expect(footer).toContain("lace validate --workspace-folder /home/user/code/apps/whelm");
  });

  it("omits log path when not provided", () => {
    const footer = formatDebugFooter({
      failedPhase: "devcontainerUp",
      workspaceFolder: "/tmp/test",
    });

    expect(footer).not.toContain("log:");
    expect(footer).toContain("failed phase: devcontainerUp");
  });

  it("omits project name when not provided", () => {
    const footer = formatDebugFooter({
      failedPhase: "templateResolution",
      workspaceFolder: "/tmp/test",
    });

    expect(footer).not.toContain("project:");
    expect(footer).toContain("workspace: /tmp/test");
  });

  it("uses absolute paths for all config files", () => {
    const footer = formatDebugFooter({
      failedPhase: "hostValidation",
      workspaceFolder: "/home/user/project",
    });

    expect(footer).toContain("/home/user/project/.lace/devcontainer.json");
    expect(footer).toContain("/home/user/project/.lace/mount-assignments.json");
    expect(footer).toContain("/home/user/project/.lace/port-assignments.json");
  });
});
