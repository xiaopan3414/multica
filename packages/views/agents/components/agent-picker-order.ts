import { isRuntimeUsableForUser } from "@multica/core/runtimes";
import type { MemberWithUser, RuntimeDevice } from "@multica/core/types";

const MEMBER_ROLE_PRIORITY: Record<MemberWithUser["role"], number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

export function usableRuntimesForAgentCreation(
  runtimes: RuntimeDevice[],
  currentUserId: string | null,
): RuntimeDevice[] {
  // Do not let the workspace-wide query win the startup race against auth.
  // Once a runtime is written into the draft the form intentionally preserves
  // it, so selecting while identity is unknown could pin another user's first
  // public runtime before we learn which runtimes are actually mine.
  if (!currentUserId) return [];

  return runtimes
    .filter(
      (runtime) =>
        runtime.status === "online" &&
        isRuntimeUsableForUser(runtime, currentUserId),
    )
    .toSorted((a, b) => {
      const aOwnedByCurrentUser = a.owner_id === currentUserId;
      const bOwnedByCurrentUser = b.owner_id === currentUserId;
      if (aOwnedByCurrentUser === bOwnedByCurrentUser) return 0;
      return aOwnedByCurrentUser ? -1 : 1;
    });
}

export function sortWorkspaceMembersForPermissionPicker(
  members: MemberWithUser[],
): MemberWithUser[] {
  return members.toSorted(
    (a, b) => MEMBER_ROLE_PRIORITY[a.role] - MEMBER_ROLE_PRIORITY[b.role],
  );
}
