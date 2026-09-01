"use client";

import { use } from "react";
import {
  AgentDetailPage,
  AgentWorkingDirectorySettings,
} from "@multica/views/agents";

export default function AgentDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AgentDetailPage
      agentId={id}
      settingsExtension={<AgentWorkingDirectorySettings agentId={id} />}
    />
  );
}
