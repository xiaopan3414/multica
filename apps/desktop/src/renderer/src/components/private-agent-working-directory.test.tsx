import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PrivateAgentWorkingDirectory } from "./private-agent-working-directory";

const AGENT_ID = "7f34eb65-30d5-44c9-9a76-723108504a72";
const mocks = vi.hoisted(() => ({
  props: vi.fn(),
}));

vi.mock("@multica/views/agents", () => ({
  AgentWorkingDirectorySettings: (props: unknown) => {
    mocks.props(props);
    return null;
  },
}));

describe("PrivateAgentWorkingDirectory", () => {
  beforeEach(() => {
    mocks.props.mockReset();
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        pickDirectory: vi.fn(),
        validateLocalDirectory: vi.fn(),
      },
    });
    Object.defineProperty(window, "daemonAPI", {
      configurable: true,
      value: {
        getAgentWorkingDirectory: vi.fn(),
        setAgentWorkingDirectory: vi.fn().mockResolvedValue({ path: "" }),
      },
    });
  });

  it("wires the native picker and legacy Desktop migration adapter", async () => {
    render(<PrivateAgentWorkingDirectory agentId={AGENT_ID} />);
    const props = mocks.props.mock.calls[0]?.[0] as {
      agentId: string;
      platform: {
        pickDirectory: (path?: string) => Promise<unknown>;
        validateDirectory: (path: string) => Promise<unknown>;
        getLegacyDirectory: (agentId: string) => Promise<string>;
        clearLegacyDirectory: (agentId: string) => Promise<void>;
      };
    };
    expect(props.agentId).toBe(AGENT_ID);

    await props.platform.pickDirectory("D:\\work");
    await props.platform.validateDirectory("D:\\work");
    await props.platform.getLegacyDirectory(AGENT_ID);
    await props.platform.clearLegacyDirectory(AGENT_ID);

    expect(window.desktopAPI.pickDirectory).toHaveBeenCalledWith("D:\\work");
    expect(window.desktopAPI.validateLocalDirectory).toHaveBeenCalledWith("D:\\work");
    expect(window.daemonAPI.getAgentWorkingDirectory).toHaveBeenCalledWith(AGENT_ID);
    expect(window.daemonAPI.setAgentWorkingDirectory).toHaveBeenCalledWith(AGENT_ID, "");
  });
});
