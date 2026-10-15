/** Reuse the authorized single-session delete; keep failures for explicit retry. */
export async function deleteChatSessions(
  sessionIds: string[],
  remove: (id: string) => Promise<unknown>,
  onProgress?: (completed: number) => void,
) {
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  for (const id of new Set(sessionIds)) {
    try {
      await remove(id);
      deletedIds.push(id);
    } catch {
      failedIds.push(id);
    }
    onProgress?.(deletedIds.length + failedIds.length);
  }
  return { deletedIds, failedIds };
}
