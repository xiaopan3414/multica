// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@multica/core/types";
import {
  machineNameFromEmail,
  runtimeDefaultsStorageKey,
  syncDesktopMachineDefaults,
  syncDesktopMachineDefaultsWithRetry,
} from "./desktop-machine-defaults";

const API_URL = "http://10.0.37.30:8080";
const USER_ID = "user-1";
const DAEMON_ID = "daemon-local";

function makeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "runtime-1",
    workspace_id: "workspace-1",
    daemon_id: DAEMON_ID,
    name: "Codex (10.0.0.8)",
    custom_name: null,
    runtime_mode: "local",
    provider: "codex",
    status: "online",
    device_info: "10.0.0.8",
    metadata: {},
    owner_id: USER_ID,
    visibility: "private",
    profile_id: null,
    last_seen_at: null,
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Desktop machine defaults", () => {
  it("uses the email local part as the machine name", () => {
    expect(machineNameFromEmail("  lisi@myhexin.com ")).toBe("lisi");
    expect(machineNameFromEmail("invalid-email")).toBe("");
  });

  it("makes each newly seen local runtime public and replaces its IP name", async () => {
    const storage = memoryStorage();
    const updateRuntime = vi.fn(async () => ({}));
    const listRuntimes = vi.fn(async () => [
      makeRuntime(),
      makeRuntime({ id: "runtime-other", daemon_id: "daemon-other" }),
    ]);

    const result = await syncDesktopMachineDefaults({
      api: { listRuntimes, updateRuntime },
      storage,
      apiUrl: API_URL,
      userId: USER_ID,
      email: "lisi@myhexin.com",
      daemonId: DAEMON_ID,
      workspaces: [{ id: "workspace-1", slug: "team" }],
    });

    expect(listRuntimes).toHaveBeenCalledWith(
      { workspace_id: "workspace-1", owner: "me" },
      "team",
    );
    expect(updateRuntime).toHaveBeenCalledTimes(1);
    expect(updateRuntime).toHaveBeenCalledWith("runtime-1", {
      visibility: "public",
      custom_name: "lisi",
    });
    expect(result).toEqual({
      matchedRuntimeCount: 1,
      updatedRuntimeCount: 1,
      failedRuntimeCount: 0,
    });
    expect(
      JSON.parse(
        storage.getItem(runtimeDefaultsStorageKey(API_URL, USER_ID)) ?? "[]",
      ),
    ).toEqual(["runtime-1"]);
  });

  it("preserves a later private choice while keeping the email-based name", async () => {
    const storage = memoryStorage();
    storage.setItem(
      runtimeDefaultsStorageKey(API_URL, USER_ID),
      JSON.stringify(["runtime-1"]),
    );
    const updateRuntime = vi.fn(async () => ({}));

    await syncDesktopMachineDefaults({
      api: {
        listRuntimes: vi.fn(async () => [
          makeRuntime({ visibility: "private", custom_name: "10.0.0.8" }),
        ]),
        updateRuntime,
      },
      storage,
      apiUrl: API_URL,
      userId: USER_ID,
      email: "lisi@myhexin.com",
      daemonId: DAEMON_ID,
      workspaces: [{ id: "workspace-1", slug: "team" }],
    });

    expect(updateRuntime).toHaveBeenCalledWith("runtime-1", {
      custom_name: "lisi",
    });
  });

  it("retries while the daemon runtime is still registering", async () => {
    const storage = memoryStorage();
    const listRuntimes = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeRuntime({ visibility: "public", custom_name: "lisi" }),
      ]);
    const sleep = vi.fn(async () => {});

    const result = await syncDesktopMachineDefaultsWithRetry(
      {
        api: { listRuntimes, updateRuntime: vi.fn(async () => ({})) },
        storage,
        apiUrl: API_URL,
        userId: USER_ID,
        email: "lisi@myhexin.com",
        daemonId: DAEMON_ID,
        workspaces: [{ id: "workspace-1", slug: "team" }],
      },
      { attempts: 2, delayMs: 0, sleep },
    );

    expect(listRuntimes).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.matchedRuntimeCount).toBe(1);
  });
});
