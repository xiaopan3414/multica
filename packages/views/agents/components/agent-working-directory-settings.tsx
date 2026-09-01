import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import {
  agentWorkingDirectoryKeys,
  agentWorkingDirectoryOptions,
} from "@multica/core/agents/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "../../settings/components/settings-layout";
import { useT } from "../../i18n";

export interface AgentWorkingDirectoryPlatformAdapter {
  pickDirectory?: (currentPath?: string) => Promise<{
    ok: boolean;
    path?: string;
    reason?: "cancelled" | "no_window" | "error";
    error?: string;
  }>;
  validateDirectory?: (path: string) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  getLegacyDirectory?: (agentId: string) => Promise<string>;
  clearLegacyDirectory?: (agentId: string) => Promise<void>;
}

export function AgentWorkingDirectorySettings({
  agentId,
  platform,
}: {
  agentId: string;
  platform?: AgentWorkingDirectoryPlatformAdapter;
}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const query = useQuery(agentWorkingDirectoryOptions(wsId, agentId));
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const migratedAgentRef = useRef("");
  const labels = useMemo(() => ({
    title: t(($) => $.inspector.private_working_directory.title),
    section_hint: t(($) => $.inspector.private_working_directory.section_hint),
    folder_label: t(($) => $.inspector.private_working_directory.folder_label),
    folder_hint: t(($) => $.inspector.private_working_directory.folder_hint),
    default_path: t(($) => $.inspector.private_working_directory.default_path),
    choose: t(($) => $.inspector.private_working_directory.choose),
    choosing: t(($) => $.inspector.private_working_directory.choosing),
    saving: t(($) => $.inspector.private_working_directory.saving),
    use_default: t(($) => $.inspector.private_working_directory.use_default),
    saved: t(($) => $.inspector.private_working_directory.saved),
    reset: t(($) => $.inspector.private_working_directory.reset),
    load_failed: t(($) => $.inspector.private_working_directory.load_failed),
    save_failed: t(($) => $.inspector.private_working_directory.save_failed),
    picker_failed: t(($) => $.inspector.private_working_directory.picker_failed),
    invalid_folder: t(($) => $.inspector.private_working_directory.invalid_folder),
    sync_failed: t(($) => $.inspector.private_working_directory.sync_failed),
    unavailable: t(($) => $.inspector.private_working_directory.unavailable),
  }), [t]);

  const mutation = useMutation({
    mutationFn: (localPath: string) =>
      localPath
        ? api.updateAgentWorkingDirectory(agentId, localPath)
        : api.deleteAgentWorkingDirectory(agentId),
    onSuccess: (data) => {
      queryClient.setQueryData(
        agentWorkingDirectoryKeys.detail(wsId, agentId),
        data,
      );
    },
  });
  const { mutateAsync, isPending } = mutation;

  useEffect(() => {
    if (!query.data || dirty) return;
    setDraft(query.data.local_path);
  }, [dirty, query.data]);

  useEffect(() => {
    const getLegacyDirectory = platform?.getLegacyDirectory;
    const clearLegacyDirectory = platform?.clearLegacyDirectory;
    if (
      !query.data?.available ||
      !getLegacyDirectory ||
      !clearLegacyDirectory ||
      migratedAgentRef.current === agentId
    ) {
      return;
    }
    migratedAgentRef.current = agentId;
    let cancelled = false;
    void (async () => {
      const legacyPath = (await getLegacyDirectory(agentId)).trim();
      if (!legacyPath) return;

      if (!query.data?.local_path) {
        if (platform.validateDirectory) {
          const validation = await platform.validateDirectory(legacyPath);
          if (!validation.ok) return;
        }
        const saved = await mutateAsync(legacyPath);
        if (!cancelled) {
          setDraft(saved.local_path);
          setDirty(false);
        }
      }
      await clearLegacyDirectory(agentId);
    })().catch((error: unknown) => {
      if (!cancelled) {
        toast.error(error instanceof Error ? error.message : labels.sync_failed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, labels, mutateAsync, platform, query.data]);

  const persist = useCallback(
    async (nextPath: string) => {
      const normalized = nextPath.trim();
      setInlineError("");
      if (normalized && platform?.validateDirectory) {
        const validation = await platform.validateDirectory(normalized);
        if (!validation.ok) {
          const message = validation.error ?? labels.invalid_folder;
          setInlineError(message);
          return;
        }
      }
      try {
        const result = await mutateAsync(normalized);
        setDraft(result.local_path);
        setDirty(false);
        toast.success(result.local_path ? labels.saved : labels.reset);
      } catch (error) {
        const message = error instanceof Error ? error.message : labels.save_failed;
        setInlineError(message);
        toast.error(message);
      }
    },
    [labels, mutateAsync, platform],
  );

  const chooseFolder = useCallback(async () => {
    if (!platform?.pickDirectory) return;
    setPicking(true);
    setInlineError("");
    try {
      const picked = await platform.pickDirectory(draft || undefined);
      if (!picked.ok || !picked.path) {
        if (picked.reason === "error") {
          toast.error(picked.error ?? labels.picker_failed);
        }
        return;
      }
      await persist(picked.path);
    } finally {
      setPicking(false);
    }
  }, [draft, labels, persist, platform]);

  const data = query.data;
  const unavailable = data ? !data.available : false;
  const busy = query.isLoading || isPending || picking;
  const runtimeName = data?.runtime_name || data?.daemon_id || "";

  return (
    <SettingsSection title={labels.title} description={labels.section_hint}>
      <SettingsCard>
        <SettingsRow
          label={
            <Label htmlFor={`agent-working-directory-${agentId}`}>
              {labels.folder_label}
            </Label>
          }
          align="start"
          size="text"
          description={
            <div className="space-y-1">
              <p>{labels.folder_hint}</p>
              {runtimeName ? (
                <p>
                  {t(($) => $.inspector.private_working_directory.machine_scope, {
                    runtime: runtimeName,
                  })}
                </p>
              ) : null}
              {unavailable ? <p>{labels.unavailable}</p> : null}
            </div>
          }
        >
          <div className="space-y-2">
            <Input
              id={`agent-working-directory-${agentId}`}
              value={draft}
              placeholder={labels.default_path}
              className="font-mono text-caption"
              disabled={busy || unavailable}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
                setInlineError("");
              }}
            />
            {inlineError || query.isError ? (
              <p role="alert" className="text-caption text-destructive">
                {inlineError || labels.load_failed}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {data?.local_path ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || unavailable}
                  onClick={() => void persist("")}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {labels.use_default}
                </Button>
              ) : null}
              {platform?.pickDirectory ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || unavailable}
                  onClick={() => void chooseFolder()}
                >
                  {picking ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FolderOpen className="size-3.5" aria-hidden="true" />
                  )}
                  {picking ? labels.choosing : labels.choose}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy || unavailable || !dirty}
                onClick={() => void persist(draft)}
              >
                {isPending ? labels.saving : t(($) => $.inspector.save)}
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
