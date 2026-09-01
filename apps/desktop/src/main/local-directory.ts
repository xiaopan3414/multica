import { ipcMain, dialog, BrowserWindow } from "electron";
import { access, readdir, readFile, stat } from "fs/promises";
import { constants as fsConstants } from "fs";
import { basename, dirname, isAbsolute, join } from "path";

export interface PickDirectoryResult {
  ok: boolean;
  path?: string;
  basename?: string;
  /** Set when ok=false. "cancelled" = user dismissed; otherwise an error blurb. */
  reason?: "cancelled" | "no_window" | "error";
  error?: string;
}

export interface ValidateLocalDirectoryResult {
  ok: boolean;
  /** When ok=false, identifies which check failed so the renderer can render a
   *  specific message without parsing free-form text. */
  reason?:
    | "not_absolute"
    | "not_found"
    | "not_a_directory"
    | "not_readable"
    | "not_writable"
    | "error";
  error?: string;
  /**
   * Whether the directory sits inside a git working tree. Only set when ok=true.
   *
   * Worktree execution mode requires a git repo, and only the desktop app can
   * see the filesystem — the server cannot. Reporting it here lets the picker
   * disable that mode with a reason at selection time, instead of letting the
   * user save a resource whose very first task fails.
   */
  is_git_repo?: boolean;
}

export interface ValidateWorkspacesRootResult {
  ok: boolean;
  reason?: ValidateLocalDirectoryResult["reason"] | "contains_unmanaged_content";
  error?: string;
}

const WORKSPACES_ROOT_MARKER = join(
  ".multica",
  "daemon_task_context.json",
);
const WORKSPACES_ROOT_INTERNAL_ENTRIES = new Set([
  ".multica",
  ".repos",
  ".skill-cache",
]);
const CANONICAL_UUID_DIRECTORY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateLocalDirectory(
  path: string,
): Promise<ValidateLocalDirectoryResult> {
  if (!path || !isAbsolute(path)) {
    return { ok: false, reason: "not_absolute" };
  }
  try {
    const st = await stat(path);
    if (!st.isDirectory()) return { ok: false, reason: "not_a_directory" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "error", error: errorMessage(err) };
  }
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    return { ok: false, reason: "not_readable" };
  }
  try {
    await access(path, fsConstants.W_OK);
  } catch {
    return { ok: false, reason: "not_writable" };
  }
  return { ok: true, is_git_repo: await isInsideGitWorkTree(path) };
}

/**
 * A workspaces root is daemon-owned storage, not a parent folder for existing
 * projects. Accept a new empty directory or a directory whose marker and
 * top-level layout prove that Multica already owns it.
 */
export async function validateWorkspacesRootDirectory(
  path: string,
): Promise<ValidateWorkspacesRootResult> {
  const basic = await validateLocalDirectory(path);
  if (!basic.ok) return basic;

  try {
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.length === 0) return { ok: true };

    let marker: { managed_by?: unknown };
    try {
      marker = JSON.parse(
        await readFile(join(path, WORKSPACES_ROOT_MARKER), "utf-8"),
      ) as { managed_by?: unknown };
    } catch {
      return { ok: false, reason: "contains_unmanaged_content" };
    }
    if (marker.managed_by !== "multica-daemon-task") {
      return { ok: false, reason: "contains_unmanaged_content" };
    }

    const hasUnmanagedEntry = entries.some((entry) => {
      if (WORKSPACES_ROOT_INTERNAL_ENTRIES.has(entry.name)) return false;
      return !entry.isDirectory() || !CANONICAL_UUID_DIRECTORY.test(entry.name);
    });
    return hasUnmanagedEntry
      ? { ok: false, reason: "contains_unmanaged_content" }
      : { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", error: errorMessage(err) };
  }
}

/**
 * Walks up from `path` looking for a `.git` entry, mirroring how git itself
 * resolves a working tree — so a subdirectory of a repo reports true, matching
 * what the daemon does with `rev-parse --show-toplevel` at task time.
 *
 * `.git` is accepted as either a directory (ordinary clone) or a file (a linked
 * worktree, where it holds a gitdir pointer). Any error means "can't tell",
 * which is reported as not-a-repo: this only drives a UI hint, and the daemon
 * re-checks authoritatively before running anything.
 */
async function isInsideGitWorkTree(path: string): Promise<boolean> {
  let current = path;
  for (;;) {
    try {
      await stat(join(current, ".git"));
      return true;
    } catch {
      // Not here — keep walking up.
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function setupLocalDirectory(
  windowGetter: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    "local-directory:pick",
    async (event, defaultPath?: string): Promise<PickDirectoryResult> => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? windowGetter();
      if (!win) return { ok: false, reason: "no_window" };
      try {
        const result = await dialog.showOpenDialog(win, {
          // Multiple-selection is intentionally disabled — a project_resource
          // points at a single directory, and the create flow expects one
          // path per click. Multi-add would have to be a separate UX.
          properties: ["openDirectory", "createDirectory"],
          ...(defaultPath ? { defaultPath } : {}),
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, reason: "cancelled" };
        }
        const picked = result.filePaths[0];
        if (!picked) return { ok: false, reason: "cancelled" };
        return { ok: true, path: picked, basename: basename(picked) };
      } catch (err) {
        return { ok: false, reason: "error", error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    "local-directory:validate",
    (_event, path: string): Promise<ValidateLocalDirectoryResult> =>
      validateLocalDirectory(path),
  );

  ipcMain.handle(
    "local-directory:validate-workspaces-root",
    (_event, path: string): Promise<ValidateWorkspacesRootResult> =>
      validateWorkspacesRootDirectory(path),
  );
}
