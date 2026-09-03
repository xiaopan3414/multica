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
import { useT } from "@multica/views/i18n";
import { reauthenticateDaemon } from "../platform/daemon-reauth";
import type { DaemonPrefs, DaemonStatus } from "../../../shared/daemon-types";
import { DEFAULT_DAEMON_PREFS } from "../../../shared/daemon-preferences";
import {
  DAEMON_STATE_COLORS,
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
  const { t } = useT("settings");
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
    async (
      update: Partial<DaemonPrefs>,
      successMessage = t(($) => $.desktop.daemon.toast_saved),
    ) => {
      setSaving(true);
      try {
        const updated = await window.daemonAPI.setPrefs(update);
        setPrefs(updated);
        toast.success(successMessage, { id: "settings-auto-save" });
        return true;
      } catch (error) {
        void window.daemonAPI.getPrefs().then(setPrefs);
        toast.error(
          error instanceof Error
            ? error.message
            : t(($) => $.desktop.daemon.toast_save_failed),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [t],
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
          toast.error(
            picked.error ?? t(($) => $.desktop.daemon.folder_picker_failed),
          );
        }
        return;
      }
      const validation =
        await window.desktopAPI.validateWorkspacesRootDirectory(picked.path);
      if (!validation.ok) {
        toast.error(
          validation.reason === "contains_unmanaged_content"
            ? t(($) => $.desktop.daemon.working_folder_must_be_dedicated)
            : (validation.error ??
                t(($) => $.desktop.daemon.folder_validation_failed)),
        );
        return;
      }
      await persistPrefs(
        { workspacesRoot: picked.path },
        t(($) => $.desktop.daemon.working_folder_updated),
      );
    } finally {
      setPickingFolder(false);
    }
  }, [persistPrefs, prefs.workspacesRoot, t]);

  // The daemon runs somewhere the app can't drive (e.g. inside WSL2 behind a
  // Windows desktop): /health is reachable but the lifecycle CLI can't reach
  // its process. Auto-start/auto-stop can't work, so disable them and say why
  // rather than letting the toggles silently no-op. See #3916.
  const externallyManaged = status.externallyManaged === true;
  const daemonTransitioning =
    status.state === "starting" || status.state === "stopping";
  const stateLabels: Record<DaemonStatus["state"], string> = {
    running: t(($) => $.desktop.daemon.states.running),
    stopped: t(($) => $.desktop.daemon.states.stopped),
    starting: t(($) => $.desktop.daemon.states.starting),
    stopping: t(($) => $.desktop.daemon.states.stopping),
    installing_cli: t(($) => $.desktop.daemon.states.installing_cli),
    cli_not_found: t(($) => $.desktop.daemon.states.cli_not_found),
    auth_expired: t(($) => $.desktop.daemon.states.auth_expired),
  };

  return (
    <SettingsTab
      title={t(($) => $.desktop.daemon.title)}
      description={t(($) => $.desktop.daemon.description)}
    >

      {status.state === "auth_expired" && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-destructive">
              {t(($) => $.desktop.daemon.auth_expired_title)}
            </p>
            <p className="mt-0.5 text-body text-muted-foreground">
              {t(($) => $.desktop.daemon.auth_expired_description)}
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={handleReauth}
            disabled={reauthLoading}
          >
            <LogIn className="size-3.5 mr-1.5" />
            {t(($) => $.desktop.daemon.sign_in_again)}
          </Button>
        </div>
      )}

      {externallyManaged && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 text-body text-muted-foreground">
            {t(($) => $.desktop.daemon.externally_managed_prefix)}{" "}
            <code className="font-mono text-caption">multica daemon start</code> /{" "}
            <code className="font-mono text-caption">multica daemon stop</code>
            {t(($) => $.desktop.daemon.externally_managed_suffix)}
          </p>
        </div>
      )}

      <SettingsCard>
        {window.desktopAPI.appInfo.os === "windows" ? (
          <SettingsRow
            label={t(($) => $.desktop.daemon.windows_start_title)}
            description={t(($) => $.desktop.daemon.windows_start_description)}
          >
            <Switch
              checked={prefs.launchAtLogin}
              onCheckedChange={(checked) =>
                updateBooleanPref("launchAtLogin", checked)
              }
              disabled={!prefsReady || saving}
              aria-label={t(($) => $.desktop.daemon.windows_start_title)}
            />
          </SettingsRow>
        ) : (
          <SettingsRow
            label={t(($) => $.desktop.daemon.auto_start_title)}
            description={t(($) => $.desktop.daemon.auto_start_description)}
          >
            <Switch
              checked={prefs.autoStart}
              onCheckedChange={(checked) =>
                updateBooleanPref("autoStart", checked)
              }
              disabled={!prefsReady || saving || externallyManaged}
              aria-label={t(($) => $.desktop.daemon.auto_start_title)}
            />
          </SettingsRow>
        )}

        <SettingsRow
          label={t(($) => $.desktop.daemon.auto_stop_title)}
          description={t(($) => $.desktop.daemon.auto_stop_description)}
        >
          <Switch
            checked={prefs.autoStop}
            onCheckedChange={(checked) =>
              updateBooleanPref("autoStop", checked)
            }
            disabled={!prefsReady || saving || externallyManaged}
            aria-label={t(($) => $.desktop.daemon.auto_stop_title)}
          />
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.desktop.daemon.working_folder_title)}
          align="start"
          description={
            <div className="min-w-0 space-y-1.5">
              <p>
                {t(($) => $.desktop.daemon.working_folder_description)}
              </p>
              <code
                className="block max-w-[360px] truncate font-mono text-caption text-foreground"
                title={
                  prefs.workspacesRoot ||
                  t(($) => $.desktop.daemon.multica_default)
                }
              >
                {prefs.workspacesRoot ||
                  t(($) => $.desktop.daemon.multica_default)}
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
                    t(($) => $.desktop.daemon.working_folder_restored),
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
                {t(($) => $.desktop.daemon.use_default)}
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
              {pickingFolder
                ? t(($) => $.desktop.daemon.choosing_folder)
                : t(($) => $.desktop.daemon.choose_folder)}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label={t(($) => $.desktop.daemon.cli_status_title)}
          description={
            cliInstalled === null
              ? t(($) => $.desktop.daemon.cli_checking)
              : cliInstalled
                ? t(($) => $.desktop.daemon.cli_installed)
                : t(($) => $.desktop.daemon.cli_missing)
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
              {t(($) => $.desktop.daemon.installation_guide)}
            </Button>
          )}
          {cliInstalled !== false && <span />}
        </SettingsRow>
      </SettingsCard>

      {/* Diagnostics — moved out of the logs panel so the panel can focus
          on logs. These fields matter for support tickets and bug reports,
          not for everyday use. */}
      <SettingsSection
        title={t(($) => $.desktop.daemon.diagnostics_title)}
        description={t(($) => $.desktop.daemon.diagnostics_description)}
      >
        <SettingsCard>
          <div className="px-4 py-2">
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.state)}
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    DAEMON_STATE_COLORS[status.state],
                  )}
                />
                {stateLabels[status.state]}
              </span>
            }
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.uptime)}
            value={status.uptime ? formatUptime(status.uptime) : "—"}
          />
          <DiagnosticsRow
            label="PID"
            value={status.pid ?? "—"}
            mono={!!status.pid}
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.daemon_id)}
            value={status.daemonId ?? "—"}
            mono={!!status.daemonId}
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.profile)}
            value={
              status.profile || t(($) => $.desktop.daemon.default_profile)
            }
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.server_url)}
            value={status.serverUrl ?? "—"}
            mono={!!status.serverUrl}
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.device_name)}
            value={status.deviceName ?? "—"}
          />
          <DiagnosticsRow
            label={t(($) => $.desktop.daemon.diagnostics.workspaces)}
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
