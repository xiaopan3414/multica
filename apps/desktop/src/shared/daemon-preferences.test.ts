// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAEMON_PREFS,
  daemonWorkspacesRootArgs,
  normalizeDaemonPrefs,
} from "./daemon-preferences";

describe("daemon preferences", () => {
  it("adds new preferences without breaking older saved files", () => {
    expect(normalizeDaemonPrefs({ autoStart: false, autoStop: true })).toEqual({
      autoStart: false,
      autoStop: true,
      launchAtLogin: false,
      workspacesRoot: "",
    });
  });

  it("rejects malformed persisted values by falling back per field", () => {
    expect(
      normalizeDaemonPrefs({
        autoStart: "yes",
        autoStop: null,
        launchAtLogin: true,
        workspacesRoot: "  D:\\Multica Workspaces  ",
      }),
    ).toEqual({
      ...DEFAULT_DAEMON_PREFS,
      launchAtLogin: true,
      workspacesRoot: "D:\\Multica Workspaces",
    });
  });

  it("passes a custom workspace root as one CLI argument", () => {
    expect(
      daemonWorkspacesRootArgs({ workspacesRoot: "D:\\Multica Workspaces" }),
    ).toEqual(["--workspaces-root", "D:\\Multica Workspaces"]);
    expect(daemonWorkspacesRootArgs({ workspacesRoot: "" })).toEqual([]);
  });
});
