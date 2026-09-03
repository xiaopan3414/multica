import { describe, expect, it } from "vitest";
import type { MemberWithUser, RuntimeDevice } from "@multica/core/types";
import {
  sortWorkspaceMembersForPermissionPicker,
  usableRuntimesForAgentCreation,
} from "./agent-picker-order";

function runtime(
  id: string,
  ownerId: string | null,
  overrides: Partial<RuntimeDevice> = {},
): RuntimeDevice {
  return {
    id,
    workspace_id: "workspace-1",
    daemon_id: `${id}-daemon`,
    name: id,
    runtime_mode: "local",
    provider: "codex",
    launch_header: "",
    status: "online",
    device_info: id,
    metadata: {},
    owner_id: ownerId,
    visibility: ownerId === "current-user" ? "private" : "public",
    last_seen_at: "2026-09-03T00:00:00Z",
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

function member(
  userId: string,
  role: MemberWithUser["role"],
): MemberWithUser {
  return {
    id: `member-${userId}`,
    workspace_id: "workspace-1",
    user_id: userId,
    role,
    created_at: "2026-09-03T00:00:00Z",
    name: userId,
    email: `${userId}@example.com`,
    avatar_url: null,
  };
}

describe("agent picker ordering", () => {
  it("defaults creation to the current user's runtime before the workspace owner's", () => {
    const workspaceOwnerRuntime = runtime("owner-runtime", "workspace-owner");
    const currentUserRuntime = runtime("my-runtime", "current-user");

    expect(
      usableRuntimesForAgentCreation(
        [workspaceOwnerRuntime, currentUserRuntime],
        "current-user",
      ).map((item) => item.id),
    ).toEqual(["my-runtime", "owner-runtime"]);
  });

  it("excludes an offline current-user runtime from the default candidates", () => {
    const offlineCurrentUserRuntime = runtime("my-offline", "current-user", {
      status: "offline",
    });
    const onlineSharedRuntime = runtime("shared-online", "workspace-owner");

    expect(
      usableRuntimesForAgentCreation(
        [offlineCurrentUserRuntime, onlineSharedRuntime],
        "current-user",
      ).map((item) => item.id),
    ).toEqual(["shared-online"]);
  });

  it("waits for current-user identity before selecting a workspace runtime", () => {
    expect(
      usableRuntimesForAgentCreation(
        [runtime("owner-runtime", "workspace-owner")],
        null,
      ),
    ).toEqual([]);
  });

  it("orders owners and administrators before ordinary members", () => {
    const members = [
      member("member-a", "member"),
      member("admin-a", "admin"),
      member("owner", "owner"),
      member("member-b", "member"),
      member("admin-b", "admin"),
    ];

    expect(
      sortWorkspaceMembersForPermissionPicker(members).map(
        (item) => item.user_id,
      ),
    ).toEqual(["owner", "admin-a", "admin-b", "member-a", "member-b"]);
    expect(members[0]?.user_id).toBe("member-a");
  });
});
