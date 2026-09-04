import type { AgentRuntime, Workspace } from "@multica/core/types";

const RUNTIME_DEFAULTS_STORAGE_PREFIX =
  "multica.desktop.runtime-defaults.v1";

interface RuntimeDefaultsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RuntimeDefaultsApi {
  listRuntimes(
    params: { workspace_id: string; owner: "me" },
    workspaceSlug: string,
  ): Promise<AgentRuntime[]>;
  updateRuntime(
    runtimeId: string,
    patch: {
      visibility?: "private" | "public";
      custom_name?: string;
    },
  ): Promise<unknown>;
}

export interface DesktopMachineDefaultsResult {
  matchedRuntimeCount: number;
  updatedRuntimeCount: number;
  failedRuntimeCount: number;
}

export function machineNameFromEmail(email: string): string {
  const normalized = email.trim();
  const separator = normalized.indexOf("@");
  if (separator <= 0) return "";
  return normalized.slice(0, separator).trim();
}

export function runtimeDefaultsStorageKey(
  apiUrl: string,
  userId: string,
): string {
  return `${RUNTIME_DEFAULTS_STORAGE_PREFIX}:${encodeURIComponent(apiUrl)}:${userId}`;
}

function loadInitializedRuntimeIds(
  storage: RuntimeDefaultsStorage,
  key: string,
): Set<string> {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

function saveInitializedRuntimeIds(
  storage: RuntimeDefaultsStorage,
  key: string,
  runtimeIds: Set<string>,
): void {
  try {
    storage.setItem(key, JSON.stringify([...runtimeIds].sort()));
  } catch {
    // A blocked storage write should not prevent the server-side update.
  }
}

export async function syncDesktopMachineDefaults({
  api,
  storage,
  apiUrl,
  userId,
  email,
  daemonId,
  workspaces,
}: {
  api: RuntimeDefaultsApi;
  storage: RuntimeDefaultsStorage;
  apiUrl: string;
  userId: string;
  email: string;
  daemonId: string;
  workspaces: Pick<Workspace, "id" | "slug">[];
}): Promise<DesktopMachineDefaultsResult> {
  const machineName = machineNameFromEmail(email);
  if (!machineName || !daemonId || workspaces.length === 0) {
    return {
      matchedRuntimeCount: 0,
      updatedRuntimeCount: 0,
      failedRuntimeCount: 0,
    };
  }

  const storageKey = runtimeDefaultsStorageKey(apiUrl, userId);
  const initializedRuntimeIds = loadInitializedRuntimeIds(storage, storageKey);
  const runtimeLists = await Promise.allSettled(
    workspaces.map((workspace) =>
      api.listRuntimes(
        { workspace_id: workspace.id, owner: "me" },
        workspace.slug,
      ),
    ),
  );

  const localRuntimes = runtimeLists
    .filter(
      (result): result is PromiseFulfilledResult<AgentRuntime[]> =>
        result.status === "fulfilled",
    )
    .flatMap((result) => result.value)
    .filter(
      (runtime) =>
        runtime.daemon_id === daemonId && runtime.owner_id === userId,
    );

  let updatedRuntimeCount = 0;
  let failedRuntimeCount = runtimeLists.filter(
    (result) => result.status === "rejected",
  ).length;

  for (const runtime of localRuntimes) {
    const needsInitialDefaults = !initializedRuntimeIds.has(runtime.id);
    const needsMachineName = (runtime.custom_name ?? "").trim() !== machineName;
    const patch: {
      visibility?: "public";
      custom_name?: string;
    } = {};

    if (needsInitialDefaults && runtime.visibility !== "public") {
      patch.visibility = "public";
    }
    if (needsMachineName) {
      patch.custom_name = machineName;
    }

    try {
      if (Object.keys(patch).length > 0) {
        await api.updateRuntime(runtime.id, patch);
        updatedRuntimeCount += 1;
      }
      initializedRuntimeIds.add(runtime.id);
      saveInitializedRuntimeIds(storage, storageKey, initializedRuntimeIds);
    } catch {
      failedRuntimeCount += 1;
    }
  }

  return {
    matchedRuntimeCount: localRuntimes.length,
    updatedRuntimeCount,
    failedRuntimeCount,
  };
}

export async function syncDesktopMachineDefaultsWithRetry(
  options: Parameters<typeof syncDesktopMachineDefaults>[0],
  retry: {
    attempts?: number;
    delayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<DesktopMachineDefaultsResult> {
  const attempts = Math.max(1, retry.attempts ?? 30);
  const delayMs = Math.max(0, retry.delayMs ?? 1_000);
  const sleep =
    retry.sleep ??
    ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  let result: DesktopMachineDefaultsResult = {
    matchedRuntimeCount: 0,
    updatedRuntimeCount: 0,
    failedRuntimeCount: 0,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await syncDesktopMachineDefaults(options);
    if (result.matchedRuntimeCount > 0 && result.failedRuntimeCount === 0) {
      return result;
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }

  return result;
}
