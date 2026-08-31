export type AgentWorkingDirectories = Record<string, string>;

const AGENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAgentId(value: unknown): value is string {
  return typeof value === "string" && AGENT_ID_PATTERN.test(value.trim());
}

export function normalizeAgentWorkingDirectories(
  value: unknown,
): AgentWorkingDirectories {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: AgentWorkingDirectories = {};
  for (const [rawAgentId, rawPath] of Object.entries(value)) {
    const agentId = rawAgentId.trim();
    const path = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!isValidAgentId(agentId) || !path) continue;
    normalized[agentId] = path;
  }
  return normalized;
}
