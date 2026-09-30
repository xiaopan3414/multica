"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Filter,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useWorkspaceId } from "@multica/core/hooks";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import { useWorkspacePresenceMap } from "@multica/core/agents";
import { api } from "@multica/core/api";
import {
  pendingChatTasksOptions,
  chatFoldersOptions,
  chatKeys,
  sortChatSessions,
} from "@multica/core/chat/queries";
import {
  useCreateChatFolder,
  useDeleteChatFolder,
  useDeleteChatSession,
  useReorderChatFolders,
  useSetChatSessionFolder,
  useSetChatSessionArchived,
  useSetChatSessionPinned,
  useUpdateChatFolder,
} from "@multica/core/chat/mutations";
import { useChatStore } from "@multica/core/chat";
import type { Agent, ChatFolder, ChatSession, PendingChatTasksResponse } from "@multica/core/types";
import { ActorAvatar } from "../../common/actor-avatar";
import {
  RowActionsMenu,
  handleRowActivationKey,
  type RowActionItem,
} from "../../common/row-actions-menu";
import { resolveClickIntent, useOptionalNavigation } from "../../navigation";
import { createLogger } from "@multica/core/logger";
import { removeChatMessageFromCaches } from "@multica/core/realtime";
import { useT } from "../../i18n";

const apiLogger = createLogger("chat.api");
const UNGROUPED_FOLDER_KEY = "__ungrouped__";

// IM-style timestamp: today → clock, this year → M/D, else full date.
function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString();
}

// Collapse a (possibly markdown / multi-line) message into a one-line preview.
function toPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * IM-style conversation list: each row is agent avatar + session title + agent
 * name + last-message preview + time, with a red unread *count* badge. An
 * in-flight agent shows a "typing…" indicator; a failed last reply shows a
 * destructive hint. Rows are rendered in the server's order (most-recent
 * activity first). Renaming lives in the conversation header's ⋯ menu, not
 * here.
 *
 * Two views, toggled locally: the default "history" view lists active chats and
 * hovering a row reveals pin + archive (or stop, while running) — archiving is
 * the reversible, one-click default so nothing is destroyed by accident. A
 * footer entry ("Archived · N") switches to the "archived" view, which lists
 * archived chats and is the ONLY place a chat can be hard-deleted (hover →
 * unarchive + delete). Both views read the same flat sessions cache and split
 * on `status` locally.
 */
export function ChatThreadList({
  sessions,
  agents,
  activeSessionId,
  onSelectSession,
  onArchive,
}: {
  sessions: ChatSession[];
  agents: Agent[];
  activeSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  // Archiving is owned by the parent so the selection advance stays layout-
  // aware (desktop advances to the next chat; mobile drops back to the list)
  // and routes through the shared controller — see ChatPage.handleArchive.
  onArchive: (session: ChatSession) => void;
}) {
  const { t } = useT("chat");
  const wsId = useWorkspaceId();
  // Null-safe slug (not useWorkspacePaths, which throws): the list renders in
  // tests outside a workspace route; without a slug the web modifier-click
  // affordance simply stays off.
  const slug = useWorkspaceSlug();
  const sessionHref = (sessionId: string) =>
    slug ? `${paths.workspace(slug).chat()}?session=${sessionId}` : null;
  // Optional: the list renders bare in tests; without an adapter the web
  // modifier-click affordance stays off (desktop keeps selection anyway).
  const navigation = useOptionalNavigation();
  const openInNewTab = navigation?.openInNewTab;
  const getShareableUrl = navigation?.getShareableUrl;
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [agentFilterId, setAgentFilterId] = useState<string | null>(null);
  const { data: folderData } = useQuery(chatFoldersOptions(wsId));
  const folders = Array.isArray(folderData) ? folderData : [];
  const collapsedFolderIds = useChatStore((s) => s.collapsedChatFolderIds);
  const toggleFolderCollapsed = useChatStore((s) => s.toggleChatFolderCollapsed);

  // Split the flat cache locally: active chats fill the default history view,
  // archived chats fill the "Archived" view. Both sorted pinned-first (then by
  // activity) so the list stays ordered even after an optimistic pin/archive or
  // a WS patch mutates the flat cache in place.
  const historySessions = useMemo(
    () => sortChatSessions(sessions.filter(
      (s) => s.status !== "archived" && (!agentFilterId || s.agent_id === agentFilterId),
    )),
    [sessions, agentFilterId],
  );
  const archivedSessions = useMemo(
    () => sortChatSessions(sessions.filter(
      (s) => s.status === "archived" && (!agentFilterId || s.agent_id === agentFilterId),
    )),
    [sessions, agentFilterId],
  );

  // Which view is showing. Falls back to history when the archived list drains
  // (last chat unarchived / deleted) so we never strand the user on an empty
  // archive.
  const [view, setView] = useState<"history" | "archived">("history");
  useEffect(() => {
    if (view === "archived" && archivedSessions.length === 0) setView("history");
  }, [view, archivedSessions.length]);

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingStopId, setConfirmingStopId] = useState<string | null>(null);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const [folderEditor, setFolderEditor] = useState<{
    mode: "create" | "rename";
    folder?: ChatFolder;
  } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [movingSession, setMovingSession] = useState<ChatSession | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<ChatFolder | null>(null);
  const deleteSession = useDeleteChatSession();
  const createFolder = useCreateChatFolder();
  const updateFolder = useUpdateChatFolder();
  const deleteFolder = useDeleteChatFolder();
  const reorderFolders = useReorderChatFolders();
  const setSessionFolder = useSetChatSessionFolder();
  const setPinned = useSetChatSessionPinned();
  const setArchived = useSetChatSessionArchived();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const queryClient = useQueryClient();

  const { data: pending } = useQuery(pendingChatTasksOptions(wsId));
  const pendingTaskBySessionId = useMemo(
    () => new Map((pending?.tasks ?? []).map((task) => [task.chat_session_id, task])),
    [pending],
  );

  // Per-agent presence, so a pending task on an OFFLINE agent shows "waiting"
  // rather than a misleading "typing…" (the task is queued until the agent is
  // back). Same availability source the conversation pane's status pill uses,
  // keeping the two surfaces consistent.
  const presence = useWorkspacePresenceMap(wsId);

  useEffect(() => {
    if (!confirmingStopId || pendingTaskBySessionId.has(confirmingStopId)) return;
    setConfirmingStopId(null);
  }, [confirmingStopId, pendingTaskBySessionId]);

  const handleConfirmDelete = (session: ChatSession) => {
    const sessionId = session.id;
    if (activeSessionId === sessionId) setActiveSession(null);
    deleteSession.mutate(sessionId, {
      onSettled: () => setConfirmingDeleteId(null),
    });
  };

  const openFolderEditor = (folder?: ChatFolder) => {
    setFolderName(folder?.name ?? "");
    setFolderEditor(folder ? { mode: "rename", folder } : { mode: "create" });
  };

  const submitFolderEditor = () => {
    const name = folderName.trim();
    if (!name || !folderEditor) return;
    if (folderEditor.mode === "create") {
      createFolder.mutate(name, { onSuccess: () => setFolderEditor(null) });
      return;
    }
    updateFolder.mutate(
      { folderId: folderEditor.folder!.id, name },
      { onSuccess: () => setFolderEditor(null) },
    );
  };

  const moveFolder = (folderId: string, offset: -1 | 1) => {
    const ordered = [...folders].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((folder) => folder.id === folderId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    reorderFolders.mutate(ordered.map((folder) => folder.id));
  };

  const handleConfirmStop = (
    session: ChatSession,
    task: PendingChatTasksResponse["tasks"][number],
  ) => {
    setStoppingTaskId(task.task_id);
    queryClient.setQueryData<PendingChatTasksResponse>(chatKeys.pendingTasks(wsId), (current) => {
      if (!current) return current;
      return {
        ...current,
        tasks: current.tasks.filter((item) => item.task_id !== task.task_id),
      };
    });
    queryClient.setQueryData(chatKeys.pendingTask(session.id), {});
    queryClient.invalidateQueries({ queryKey: chatKeys.messages(session.id) });
    queryClient.invalidateQueries({ queryKey: chatKeys.messagesPage(session.id) });

    api.cancelTaskById(task.task_id).then(
      (result) => {
        const restored = result.cancelled_chat_message;
        if (restored?.restore_to_input) {
          removeChatMessageFromCaches(queryClient, restored.chat_session_id, restored.message_id);
        }
        apiLogger.info("cancelTask.success (list row)", { taskId: task.task_id, sessionId: session.id });
      },
      (err) =>
        apiLogger.warn("cancelTask.error (list row; task may have already finished)", {
          taskId: task.task_id,
          sessionId: session.id,
          err,
        }),
    ).finally(() => {
      queryClient.invalidateQueries({ queryKey: chatKeys.pendingTasks(wsId) });
      queryClient.invalidateQueries({ queryKey: chatKeys.pendingTask(session.id) });
      setStoppingTaskId(null);
      setConfirmingStopId(null);
    });
  };

  const renderRow = (session: ChatSession) => {
    const isCurrent = session.id === activeSessionId;
    const agent = agentById.get(session.agent_id) ?? null;
    const agentName = agent?.name.trim() || null;
    const pendingTask = pendingTaskBySessionId.get(session.id);
    const isRunning = !!pendingTask;
    // Only "offline" (definitively long-offline) downgrades typing → waiting.
    // Unknown/loading presence keeps the optimistic "typing…" so we never
    // suppress it just because presence data hasn't landed yet.
    const agentOffline = agent
      ? presence.byAgent.get(agent.id)?.availability === "offline"
      : false;
    const unread = isCurrent ? 0 : (session.unread_count ?? 0);
    const isConfirmingDelete = confirmingDeleteId === session.id;
    const isConfirmingStop = confirmingStopId === session.id && !!pendingTask;
    const isConfirmingAction = isConfirmingDelete || isConfirmingStop;
    const titleText = session.title?.trim() || t(($) => $.window.untitled);
    const last = session.last_message ?? null;
    const timeText = last ? formatChatTime(last.created_at) : formatChatTime(session.updated_at);

    // The second line: typing/waiting → failed → preview.
    let previewNode: React.ReactNode;
    if (isRunning && agentOffline) {
      // Task is queued but the agent is offline — it will run once the agent
      // is back. Show a static "waiting", not an animated "typing".
      previewNode = (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Clock className="size-3 shrink-0" />
          <span className="truncate">{t(($) => $.list.waiting)}</span>
        </span>
      );
    } else if (isRunning) {
      previewNode = (
        <span className="flex min-w-0 items-center gap-1.5 text-emerald-500">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="truncate">{t(($) => $.list.typing)}</span>
        </span>
      );
    } else if (last?.failure_reason) {
      previewNode = <span className="block truncate text-destructive">{t(($) => $.list.failed)}</span>;
    } else if (last?.message_kind === "no_response") {
      // A no_response turn stores a non-empty English fallback as its content,
      // so the preview is never blank even on older clients; new clients show a
      // localized, italic hint instead of that fallback text (MUL-4351).
      previewNode = (
        <span className="block truncate italic text-muted-foreground">
          {t(($) => $.list.no_response_preview)}
        </span>
      );
    } else if (last) {
      previewNode = (
        <span className={cn("block truncate", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
          {last.role === "user" ? t(($) => $.list.you_prefix) : ""}
          {toPreview(last.content)}
        </span>
      );
    } else {
      previewNode = <span className="block truncate text-muted-foreground">{t(($) => $.list.no_messages)}</span>;
    }

    // One list drives both action surfaces — the compact menu without hover
    // and the hover strip with it — so they cannot drift. The archived view
    // is the only place hard-delete lives; the history view offers the
    // reversible archive instead.
    const rowActions: RowActionItem[] =
      view === "archived"
        ? [
            {
              key: "unarchive",
              icon: <ArchiveRestore className="size-3.5" />,
              label: t(($) => $.list.unarchive),
              onSelect: () =>
                setArchived.mutate({ sessionId: session.id, archived: false }),
            },
            {
              key: "delete",
              icon: <Trash2 className="size-3.5" />,
              label: t(($) => $.session_history.row_delete_aria),
              danger: true,
              onSelect: () => setConfirmingDeleteId(session.id),
            },
          ]
        : [
            {
              key: "pin",
              icon: session.pinned ? (
                <PinOff className="size-3.5" />
              ) : (
                <Pin className="size-3.5 -rotate-45" />
              ),
              label: session.pinned
                ? t(($) => $.list.unpin)
                : t(($) => $.list.pin),
              onSelect: () =>
                setPinned.mutate({ sessionId: session.id, pinned: !session.pinned }),
            },
            ...((folders.length > 0 || session.folder_id)
              ? [{
                  key: "move-to-folder",
                  icon: <FolderInput className="size-3.5" />,
                  label: t(($) => $.list.move_to_group),
                  onSelect: () => setMovingSession(session),
                } satisfies RowActionItem]
              : []),
            isRunning
              ? {
                  key: "stop",
                  icon: <Square className="size-3 fill-current" />,
                  label: t(($) => $.session_history.row_stop_aria),
                  danger: true,
                  onSelect: () => setConfirmingStopId(session.id),
                }
              : {
                  key: "archive",
                  icon: <Archive className="size-3.5" />,
                  label: t(($) => $.list.archive),
                  onSelect: () => onArchive(session),
                },
          ];

    return (
      <div
        key={session.id}
        aria-current={isCurrent ? "true" : undefined}
        tabIndex={0}
        onClick={(e) => {
          if (isConfirmingAction || e.defaultPrevented) return;
          // Plain click keeps the master-detail selection. On web, a modifier
          // click opens the session as its own browser tab. Desktop tabs
          // dedupe chat by pathname (a session is view state, not a subject —
          // see tab-store resourceKey), so a second chat tab cannot exist
          // there; modifier clicks keep the selection behavior instead.
          const href = sessionHref(session.id);
          if (
            href &&
            getShareableUrl &&
            !openInNewTab &&
            resolveClickIntent(e) !== "push"
          ) {
            window.open(
              getShareableUrl(href),
              "_blank",
              "noopener,noreferrer",
            );
            return;
          }
          onSelectSession(session);
        }}
        onAuxClick={(e) => {
          if (isConfirmingAction || e.defaultPrevented || e.button !== 1) return;
          if (openInNewTab) return; // desktop: no second chat tab exists
          const href = sessionHref(session.id);
          if (!href || !getShareableUrl) return;
          e.preventDefault();
          window.open(getShareableUrl(href), "_blank", "noopener,noreferrer");
        }}
        onKeyDown={(e) => {
          if (isConfirmingAction) return;
          handleRowActivationKey(e, () => onSelectSession(session));
        }}
        className={cn(
          // Fixed height so nothing (hover actions, confirm prompts) can change
          // the row size and make the list jump. Content is vertically centered.
          "group/row relative flex h-14 min-w-0 cursor-default items-center gap-3 rounded-md px-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
          isCurrent ? "bg-accent" : "hover:bg-accent/50",
          isConfirmingAction && "bg-destructive/5 hover:bg-destructive/5",
        )}
      >
        {/* Thin ring keeps photo + fallback avatars reading as the same circle
            (the fallback's faint bg otherwise looks smaller). */}
        {agent ? (
          <ActorAvatar actorType="agent" actorId={agent.id} size="lg" enableHoverCard className="ring-1 ring-inset ring-border" />
        ) : (
          <span className="size-8 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          {/* Line 1: name + time (time stays put; hover actions overlay below) */}
          <div className="flex items-center gap-1.5">
            {session.pinned && (
              <Pin
                aria-label={t(($) => $.list.pinned)}
                className="size-3 shrink-0 -rotate-45 fill-current text-muted-foreground"
              />
            )}
            <span className={cn("min-w-0 flex-1 truncate text-body", unread > 0 ? "font-semibold text-foreground" : "font-medium")}>
              {titleText}
            </span>
            <span className="ml-auto shrink-0 text-micro text-muted-foreground">{timeText}</span>
          </div>

          {/* Line 2: preview + unread badge, or an inline confirm prompt */}
          <div className="mt-0.5 flex items-center gap-2">
            {isConfirmingDelete ? (
                <ConfirmRow
                  label={t(($) => $.session_history.delete_dialog.title)}
                  cancelText={t(($) => $.session_history.delete_dialog.cancel)}
                  confirmText={
                    deleteSession.isPending
                      ? t(($) => $.session_history.delete_dialog.confirming)
                      : t(($) => $.session_history.delete_dialog.confirm)
                  }
                  pending={deleteSession.isPending}
                  onCancel={() => setConfirmingDeleteId(null)}
                  onConfirm={() => handleConfirmDelete(session)}
                />
              ) : isConfirmingStop && pendingTask ? (
                <ConfirmRow
                  label={t(($) => $.session_history.stop_dialog.title)}
                  cancelText={t(($) => $.session_history.stop_dialog.cancel)}
                  confirmText={
                    stoppingTaskId === pendingTask.task_id
                      ? t(($) => $.session_history.stop_dialog.confirming)
                      : t(($) => $.session_history.stop_dialog.confirm)
                  }
                  pending={stoppingTaskId === pendingTask.task_id}
                  onCancel={() => setConfirmingStopId(null)}
                  onConfirm={() => handleConfirmStop(session, pendingTask)}
                />
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-caption">
                    {agentName && (
                      <>
                        <span className="max-w-[40%] shrink-0 truncate font-medium text-muted-foreground">
                          {agentName}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-faint-foreground">
                          ·
                        </span>
                      </>
                    )}
                    <div className="min-w-0 flex-1 overflow-hidden">{previewNode}</div>
                  </div>
                  {unread > 0 && (
                    <span
                      aria-label={t(($) => $.session_history.row_subtitle.new_reply)}
                      // Softer, warmer red than the vivid `destructive` token —
                      // an IM unread badge, not an error.
                      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[oklch(0.62_0.14_18)] px-1 text-micro font-semibold text-white"
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </>
              )}
            </div>
        </div>

        {/* Compact action menu — the touch equivalent of the hover strip
            below, which a pointer without hover can never reach. It takes real
            layout space (rather than overlaying the preview) and gives way to
            the hover strip on a hover-capable pointer. */}
        {!isConfirmingAction && (
          <RowActionsMenu
            label={t(($) => $.list.row_actions_aria)}
            groups={[rowActions]}
          />
        )}

        {/* Hover actions — absolutely positioned so showing/hiding them never
            changes the row height (which was making the list jump). Keyboard
            focus reveals them too, so they are reachable without a mouse. */}
        {!isConfirmingAction && (
          <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 rounded-md bg-gradient-to-l from-accent from-40% to-transparent pl-10 pr-1 [@media(hover:hover)]:group-hover/row:flex [@media(hover:hover)]:group-focus-within/row:flex">
            {rowActions.map((action) => (
              <RowAction
                key={action.key}
                icon={action.icon}
                label={action.label}
                danger={action.danger}
                onClick={action.onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  // Archived view: a back header, then the archived rows. Delete lives only
  // here (via each row's hover actions).
  if (view === "archived") {
    return (
      <>
        <button
          type="button"
          onClick={() => setView("history")}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-caption font-medium text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4 shrink-0" />
          <span className="truncate">{t(($) => $.list.archived_title)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {archivedSessions.length}
          </span>
        </button>
        {archivedSessions.map(renderRow)}
      </>
    );
  }

  // History (default) view: active rows + a footer entry into the archive.
  const filterAgents = agents.filter((agent) =>
    sessions.some((session) => session.agent_id === agent.id),
  );
  const selectedFilterAgent = agentFilterId ? agentById.get(agentFilterId) : null;
  const historyToolbar = (
    <div className="mb-1 flex h-9 items-center gap-1 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant={agentFilterId ? "brandSubtle" : "ghost"}
              size={selectedFilterAgent ? "sm" : "icon-sm"}
              aria-label={t(($) => $.list.filter_by_agent)}
              title={t(($) => $.list.filter_by_agent)}
              className={selectedFilterAgent ? "min-w-0 max-w-[calc(100%-2rem)]" : undefined}
            >
              <Filter className="size-3.5" />
              {selectedFilterAgent && <span className="truncate">{selectedFilterAgent.name}</span>}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(($) => $.list.filter_by_agent)}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={agentFilterId ?? "all"}
              onValueChange={(value) => setAgentFilterId(value === "all" ? null : value)}
            >
              <DropdownMenuRadioItem value="all">
                {t(($) => $.list.all_agents)}
              </DropdownMenuRadioItem>
              {filterAgents.map((agent) => (
                <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                  <span className="truncate">{agent.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t(($) => $.list.create_group)}
        title={t(($) => $.list.create_group)}
        onClick={() => openFolderEditor()}
      >
        <FolderPlus className="size-4" />
      </Button>
    </div>
  );

  const archivedEntry = archivedSessions.length > 0 && (
    <button
      type="button"
      onClick={() => setView("archived")}
      className="mt-1 flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-caption text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center">
        <Archive className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{t(($) => $.list.archived_title)}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{archivedSessions.length}</span>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" />
    </button>
  );

  const knownFolderIDs = new Set(folders.map((folder) => folder.id));
  const orderedFolders = [...folders].sort((a, b) => a.position - b.position);
  const ungroupedSessions = historySessions.filter(
    (session) => !session.folder_id || !knownFolderIDs.has(session.folder_id),
  );

  const renderGroup = (
    key: string,
    name: string,
    groupSessions: ChatSession[],
    folder?: ChatFolder,
  ) => {
    const collapsed = collapsedFolderIds.includes(key);
    const folderIndex = folder
      ? orderedFolders.findIndex((candidate) => candidate.id === folder.id)
      : -1;
    return (
      <section key={key} aria-label={name} className="mt-1">
        <div className="group/folder flex h-8 min-w-0 items-center gap-1 rounded-md px-1 hover:bg-accent/40">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed
              ? t(($) => $.list.expand_group, { name })
              : t(($) => $.list.collapse_group, { name })}
            onClick={() => toggleFolderCollapsed(key)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-caption font-medium">{name}</span>
            <span className="shrink-0 tabular-nums text-micro text-muted-foreground">
              {groupSessions.length}
            </span>
          </button>
          {folder && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t(($) => $.list.group_actions, { name })}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openFolderEditor(folder)}>
                  <Pencil />
                  {t(($) => $.list.rename_group)}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={folderIndex <= 0}
                  onClick={() => moveFolder(folder.id, -1)}
                >
                  <ChevronUp />
                  {t(($) => $.list.move_group_up)}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={folderIndex < 0 || folderIndex >= orderedFolders.length - 1}
                  onClick={() => moveFolder(folder.id, 1)}
                >
                  <ChevronDown />
                  {t(($) => $.list.move_group_down)}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeletingFolder(folder)}>
                  <Trash2 />
                  {t(($) => $.list.delete_group)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!collapsed && groupSessions.map(renderRow)}
      </section>
    );
  };

  const groupedHistory = folders.length > 0 ? (
    <>
      {orderedFolders.map((folder) => renderGroup(
        folder.id,
        folder.name,
        historySessions.filter((session) => session.folder_id === folder.id),
        folder,
      ))}
      {ungroupedSessions.length > 0 && renderGroup(
        UNGROUPED_FOLDER_KEY,
        t(($) => $.list.ungrouped),
        ungroupedSessions,
      )}
    </>
  ) : (
    historySessions.map(renderRow)
  );

  return (
    <>
      {historyToolbar}
      {historySessions.length > 0 ? groupedHistory : (
        <div className="px-2 py-1.5 text-caption text-muted-foreground">
          {agentFilterId ? t(($) => $.list.no_filter_matches) : t(($) => $.window.no_previous)}
        </div>
      )}
      {archivedEntry}
      <Dialog
        open={folderEditor !== null}
        onOpenChange={(open) => {
          if (!open) setFolderEditor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {folderEditor?.mode === "rename"
                ? t(($) => $.list.rename_group)
                : t(($) => $.list.create_group)}
            </DialogTitle>
            <DialogDescription>{t(($) => $.list.group_name_description)}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitFolderEditor();
            }}
            className="contents"
          >
            <Input
              autoFocus
              value={folderName}
              maxLength={80}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder={t(($) => $.list.group_name_placeholder)}
              aria-label={t(($) => $.list.group_name)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFolderEditor(null)}>
                {t(($) => $.list.cancel)}
              </Button>
              <Button
                type="submit"
                disabled={!folderName.trim() || createFolder.isPending || updateFolder.isPending}
              >
                {t(($) => $.list.save_group)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={movingSession !== null}
        onOpenChange={(open) => {
          if (!open) setMovingSession(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(($) => $.list.move_to_group)}</DialogTitle>
            <DialogDescription>
              {movingSession?.title || t(($) => $.window.untitled)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {[
              { id: null, name: t(($) => $.list.ungrouped) },
              ...orderedFolders.map((folder) => ({ id: folder.id, name: folder.name })),
            ].map((target) => (
              <button
                key={target.id ?? UNGROUPED_FOLDER_KEY}
                type="button"
                onClick={() => {
                  if (!movingSession) return;
                  setSessionFolder.mutate(
                    { sessionId: movingSession.id, folderId: target.id },
                    { onSuccess: () => setMovingSession(null) },
                  );
                }}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-body outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{target.name}</span>
                {(movingSession?.folder_id ?? null) === target.id && <Check className="size-4" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFolder(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.list.delete_group)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.list.delete_group_description, { name: deletingFolder?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.list.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteFolder.isPending}
              onClick={() => {
                if (!deletingFolder) return;
                deleteFolder.mutate(deletingFolder.id, {
                  onSuccess: () => setDeletingFolder(null),
                });
              }}
            >
              {t(($) => $.list.delete_group)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors focus-visible:outline-none",
        danger
          ? "hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
          : "hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

function ConfirmRow({
  label,
  cancelText,
  confirmText,
  pending,
  onCancel,
  onConfirm,
}: {
  label: string;
  cancelText: string;
  confirmText: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-caption font-medium text-destructive">{label}</span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onCancel();
          }}
          disabled={pending}
          className="inline-flex h-6 items-center rounded px-2 text-micro font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onConfirm();
          }}
          disabled={pending}
          className="inline-flex h-6 items-center rounded px-2 text-micro font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          {confirmText}
        </button>
      </div>
    </div>
  );
}
