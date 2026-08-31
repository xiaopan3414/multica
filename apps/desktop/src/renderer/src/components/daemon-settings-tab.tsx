import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AlertCircle, FolderOpen, Info, LogIn, RotateCcw } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Switch } from "@multica/ui/components/ui/switch";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsTab,
} from "@multica/views/settings";
import { reauthenticateDaemon } from "../platform/daemon-reauth";
import type { DaemonPrefs, DaemonStatus } from "../../../shared/daemon-types";
import { DEFAULT_DAEMON_PREFS } from "../../../shared/daemon-preferences";
import {
  DAEMON_STATE_COLORS,
  DAEMON_STATE_LABELS,
  formatUptime,
} from "../../../shared/daemon-types";

// One row inside the diagnostics block. Values that are likely to be
// long IDs / URLs render as monospaced + truncated with a tooltip.
function DiagnosticsRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-body",
          mono && "font-mono text-caption",
        )}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function DaemonSettingsTab() {
  const [prefs, setPrefs] = useState<DaemonPrefs>(() => ({
    ...DEFAULT_DAEMON_PREFS,
  }));
  const [prefsReady, setPrefsReady] = useState(false);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [status, setStatus] = useState<DaemonStatus>({ state: "stopped" });
  const [reauthLoading, setReauthLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.daemonAPI
      .getPrefs()
      .then((value) => {
        if (mounted) setPrefs(value);
      })
      .finally(() => {
        if (mounted) setPrefsReady(true);
      });
    void window.daemonAPI
      .isCliInstalled()
      .then((value) => mounted && setCliInstalled(value));
    void window.daemonAPI
      .getStatus()
      .then((value) => mounted && setStatus(value));
    const unsubscribe = window.daemonAPI.onStatusChange((value) => {
      if (mounted) setStatus(value);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleReauth = useCallback(async () => {
    setReauthLoading(true);
    await reauthenticateDaemon();
    setReauthLoading(false);
  }, []);

  const persistPrefs = useCallback(
    async (update: Partial<DaemonPrefs>, successMessage = "Daemon settings saved") => {
      setSaving(true);
      try {
        const updated = await window.daemonAPI.setPrefs(update);
        setPrefs(updated);
        toast.success(successMessage, { id: "settings-auto-save" });
        return true;
      } catch (error) {
        void window.daemonAPI.getPrefs().then(setPrefs);
        toast.error(
          error instanceof Error ? error.message : "Failed to save daemon settings",
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const updateBooleanPref = useCallback(
    (
      key: "autoStart" | "autoStop" | "launchAtLogin",
      value: boolean,
    ) => persistPrefs({ [key]: value }),
    [persistPrefs],
  );

  const pickWorkingFolder = useCallback(async () => {
    setPickingFolder(true);
    try {
      const picked = await window.desktopAPI.pickDirectory(
        prefs.workspacesRoot || undefined,
      );
      if (!picked.ok || !picked.path) {
        if (picked.reason === "error") {
          toast.error(picked.error ?? "Could not open the folder picker");
        }
        return;
      }
      const validation = await window.desktopAPI.validateLocalDirectory(
        picked.path,
      );
      if (!validation.ok) {
        toast.error(
          validation.error ??
            "The selected folder must be readable and writable.",
        );
        return;
      }
      await persistPrefs(
        { workspacesRoot: picked.path },
        "Task working folder updated",
      );
    } finally {
      setPickingFolder(false);
    }
  }, [persistPrefs, prefs.workspacesRoot]);

  // The daemon runs somewhere the app can't drive (e.g. inside WSL2 behind a
  // Windows desktop): /health is reachable but the lifecycle CLI can't reach
  // its process. Auto-start/auto-stop can't work, so disable them and say why
  // rather than letting the toggles silently no-op. See #3916.
  const externallyManaged = status.externallyManaged === true;
  const daemonTransitioning =
    status.state === "starting" || status.state === "stopping";

  return (
    <SettingsTab
      title="Daemon"
      description="Configure how the local agent daemon behaves with the desktop app."
    >

      {status.state === "auth_expired" && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-destructive">
              Sign-in expired
            </p>
            <p className="mt-0.5 text-body text-muted-foreground">
              The local daemon couldn&apos;t authenticate, so this device
              can&apos;t take tasks. Sign in again to restore it.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={handleReauth}
            disabled={reauthLoading}
          >
            <LogIn className="size-3.5 mr-1.5" />
            Sign in again
          </Button>
        </div>
      )}

      {externallyManaged && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 text-body text-muted-foreground">
            This device&apos;s daemon runs outside the app — for example inside
            WSL2 — so the app can&apos;t start or stop it. Start or stop it from
            that environment with{" "}
            <code className="font-mono text-caption">multica daemon start</code> /{" "}
            <code className="font-mono text-caption">multica daemon stop</code>.
          </p>
        </div>
      )}

      <SettingsCard>
        {window.desktopAPI.appInfo.os === "windows" && (
          <SettingsRow
            label="Start Multica with Windows"
            description="Open the Desktop app automatically after you sign in to Windows."
          >
            <Switch
              checked={prefs.launchAtLogin}
              onCheckedChange={(checked) =>
                updateBooleanPref("launchAtLogin", checked)
              }
              disabled={!prefsReady || saving}
              aria-label="Start Multica with Windows"
            />
          </SettingsRow>
        )}

        <SettingsRow
          label="Auto-start on launch"
          description="Automatically start the daemon when the app opens and you are logged in."
        >
          <Switch
            checked={prefs.autoStart}
            onCheckedChange={(checked) =>
              updateBooleanPref("autoStart", checked)
            }
            disabled={!prefsReady || saving || externallyManaged}
            aria-label="Auto-start daemon on launch"
          />
        </SettingsRow>

        <SettingsRow
          label="Auto-stop on quit"
          description="Stop the daemon when the desktop app is closed. Disable this to keep the daemon running in the background."
        >
          <Switch
            checked={prefs.autoStop}
            onCheckedChange={(checked) =>
              updateBooleanPref("autoStop", checked)
            }
            disabled={!prefsReady || saving || externallyManaged}
            aria-label="Auto-stop daemon on quit"
          />
        </SettingsRow>

        <SettingsRow
          label="Task working folder"
          align="start"
          description={
            <div className="min-w-0 space-y-1.5">
              <p>
                Stores task workspaces and repository caches. Changing it
                restarts an idle daemon; existing files are not moved.
              </p>
              <code
                className="block max-w-[360px] truncate font-mono text-caption text-foreground"
                title={prefs.workspacesRoot || "Multica default"}
              >
                {prefs.workspacesRoot || "Multica default"}
              </code>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {prefs.workspacesRoot && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void persistPrefs(
                    { workspacesRoot: "" },
                    "Default task working folder restored",
                  )
                }
                disabled={
                  !prefsReady ||
                  saving ||
                  externallyManaged ||
                  daemonTransitioning
                }
              >
                <RotateCcw className="size-3.5" />
                Use default
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void pickWorkingFolder()}
              disabled={
                !prefsReady ||
                saving ||
                pickingFolder ||
                externallyManaged ||
                daemonTransitioning
              }
            >
              <FolderOpen className="size-3.5" />
              {pickingFolder ? "Choosing..." : "Choose folder"}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="CLI Status"
          description={
            cliInstalled === null
              ? "Checking…"
              : cliInstalled
                ? "multica CLI is installed and available in PATH."
                : "multica CLI not found. Install it to enable daemon management."
          }
        >
          {cliInstalled === false && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.desktopAPI.openExternal(
                  "https://github.com/multica-ai/multica#cli-installation",
                )
              }
            >
              Installation Guide
            </Button>
          )}
          {cliInstalled !== false && <span />}
        </SettingsRow>
      </SettingsCard>

      {/* Diagnostics — moved out of the logs panel so the panel can focus
          on logs. These fields matter for support tickets and bug reports,
          not for everyday use. */}
      <SettingsSection
        title="Diagnostics"
        description="Identification and connection details. Useful when filing a bug report or investigating why a runtime isn't showing up."
      >
        <SettingsCard>
          <div className="px-4 py-2">
          <DiagnosticsRow
            label="State"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    DAEMON_STATE_COLORS[status.state],
                  )}
                />
                {DAEMON_STATE_LABELS[status.state]}
              </span>
            }
          />
          <DiagnosticsRow
            label="Uptime"
            value={status.uptime ? formatUptime(status.uptime) : "—"}
          />
          <DiagnosticsRow
            label="PID"
            value={status.pid ?? "—"}
            mono={!!status.pid}
          />
          <DiagnosticsRow
            label="Daemon ID"
            value={status.daemonId ?? "—"}
            mono={!!status.daemonId}
          />
          <DiagnosticsRow
            label="Profile"
            value={status.profile || "default"}
          />
          <DiagnosticsRow
            label="Server URL"
            value={status.serverUrl ?? "—"}
            mono={!!status.serverUrl}
          />
          <DiagnosticsRow
            label="Device name"
            value={status.deviceName ?? "—"}
          />
          <DiagnosticsRow
            label="Workspaces"
            value={
              typeof status.workspaceCount === "number"
                ? status.workspaceCount
                : "—"
            }
          />
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
