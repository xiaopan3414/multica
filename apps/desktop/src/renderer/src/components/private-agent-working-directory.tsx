import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@multica/views/settings";
import { useT } from "@multica/views/i18n";

export function PrivateAgentWorkingDirectory({
  agentId,
}: {
  agentId: string;
}) {
  const { t } = useT("agents");
  const labels = {
    title: t(($) => $.inspector.private_working_directory.title),
    section_hint: t(
      ($) => $.inspector.private_working_directory.section_hint,
    ),
    folder_label: t(
      ($) => $.inspector.private_working_directory.folder_label,
    ),
    folder_hint: t(
      ($) => $.inspector.private_working_directory.folder_hint,
    ),
    default_path: t(
      ($) => $.inspector.private_working_directory.default_path,
    ),
    loading: t(($) => $.inspector.private_working_directory.loading),
    choose: t(($) => $.inspector.private_working_directory.choose),
    choosing: t(($) => $.inspector.private_working_directory.choosing),
    saving: t(($) => $.inspector.private_working_directory.saving),
    use_default: t(
      ($) => $.inspector.private_working_directory.use_default,
    ),
    saved: t(($) => $.inspector.private_working_directory.saved),
    reset: t(($) => $.inspector.private_working_directory.reset),
    load_failed: t(
      ($) => $.inspector.private_working_directory.load_failed,
    ),
    save_failed: t(
      ($) => $.inspector.private_working_directory.save_failed,
    ),
    picker_failed: t(
      ($) => $.inspector.private_working_directory.picker_failed,
    ),
    invalid_folder: t(
      ($) => $.inspector.private_working_directory.invalid_folder,
    ),
  };
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void window.daemonAPI
      .getAgentWorkingDirectory(agentId)
      .then((value) => {
        if (current) setPath(value);
      })
      .catch((error: unknown) => {
        if (current) {
          toast.error(
            error instanceof Error ? error.message : labels.load_failed,
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [agentId, labels.load_failed]);

  const persist = useCallback(
    async (nextPath: string) => {
      setSaving(true);
      try {
        const result = await window.daemonAPI.setAgentWorkingDirectory(
          agentId,
          nextPath,
        );
        setPath(result.path);
        toast.success(result.path ? labels.saved : labels.reset);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : labels.save_failed,
        );
      } finally {
        setSaving(false);
      }
    },
    [agentId, labels.reset, labels.save_failed, labels.saved],
  );

  const chooseFolder = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await window.desktopAPI.pickDirectory(path || undefined);
      if (!picked.ok || !picked.path) {
        if (picked.reason === "error") {
          toast.error(picked.error ?? labels.picker_failed);
        }
        return;
      }
      const validation = await window.desktopAPI.validateLocalDirectory(
        picked.path,
      );
      if (!validation.ok) {
        toast.error(validation.error ?? labels.invalid_folder);
        return;
      }
      await persist(picked.path);
    } finally {
      setPicking(false);
    }
  }, [labels.invalid_folder, labels.picker_failed, path, persist]);

  const disabled = loading || saving || picking;

  return (
    <SettingsSection title={labels.title} description={labels.section_hint}>
      <SettingsCard>
        <SettingsRow
          label={labels.folder_label}
          align="start"
          description={
            <div className="min-w-0 space-y-1.5">
              <p>{labels.folder_hint}</p>
              <code
                className="block max-w-[360px] truncate font-mono text-caption text-foreground"
                title={path || labels.default_path}
              >
                {loading ? labels.loading : path || labels.default_path}
              </code>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {path ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void persist("")}
                disabled={disabled}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {labels.use_default}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void chooseFolder()}
              disabled={disabled}
            >
              {picking || saving ? (
                <Loader2
                  className="size-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <FolderOpen className="size-3.5" aria-hidden="true" />
              )}
              {picking ? labels.choosing : saving ? labels.saving : labels.choose}
            </Button>
          </div>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
