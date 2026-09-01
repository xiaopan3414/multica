import {
  AgentWorkingDirectorySettings,
  type AgentWorkingDirectoryPlatformAdapter,
} from "@multica/views/agents";

const desktopWorkingDirectoryAdapter: AgentWorkingDirectoryPlatformAdapter = {
  pickDirectory: (currentPath) =>
    window.desktopAPI.pickDirectory(currentPath),
  validateDirectory: (path) =>
    window.desktopAPI.validateLocalDirectory(path),
  getLegacyDirectory: (agentId) =>
    window.daemonAPI.getAgentWorkingDirectory(agentId),
  clearLegacyDirectory: async (agentId) => {
    await window.daemonAPI.setAgentWorkingDirectory(agentId, "");
  },
};

export function PrivateAgentWorkingDirectory({
  agentId,
}: {
  agentId: string;
}) {
  return (
    <AgentWorkingDirectorySettings
      agentId={agentId}
      platform={desktopWorkingDirectoryAdapter}
    />
  );
}
