import type { DaemonPrefs } from "./daemon-types";

export const DEFAULT_DAEMON_PREFS: Readonly<DaemonPrefs> = Object.freeze({
  autoStart: true,
  autoStop: false,
  launchAtLogin: true,
  workspacesRoot: "",
});

export function normalizeDaemonPrefs(value: unknown): DaemonPrefs {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    autoStart:
      typeof source.autoStart === "boolean"
        ? source.autoStart
        : DEFAULT_DAEMON_PREFS.autoStart,
    autoStop:
      typeof source.autoStop === "boolean"
        ? source.autoStop
        : DEFAULT_DAEMON_PREFS.autoStop,
    launchAtLogin:
      typeof source.launchAtLogin === "boolean"
        ? source.launchAtLogin
        : DEFAULT_DAEMON_PREFS.launchAtLogin,
    workspacesRoot:
      typeof source.workspacesRoot === "string"
        ? source.workspacesRoot.trim()
        : DEFAULT_DAEMON_PREFS.workspacesRoot,
  };
}

export function daemonWorkspacesRootArgs(
  prefs: Pick<DaemonPrefs, "workspacesRoot">,
): string[] {
  const root = prefs.workspacesRoot.trim();
  return root ? ["--workspaces-root", root] : [];
}
