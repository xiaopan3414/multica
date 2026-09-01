import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enAgents from "../../locales/en/agents.json";
import { AgentWorkingDirectorySettings } from "./agent-working-directory-settings";

const AGENT_ID = "7f34eb65-30d5-44c9-9a76-723108504a72";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/api", () => ({
  api: {
    getAgentWorkingDirectory: mocks.get,
    updateAgentWorkingDirectory: mocks.update,
    deleteAgentWorkingDirectory: mocks.remove,
  },
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

function directory(localPath = "") {
  return {
    agent_id: AGENT_ID,
    runtime_id: "runtime-1",
    daemon_id: "daemon-1",
    runtime_name: "Office PC",
    local_path: localPath,
    available: true,
  };
}

function renderComponent(
  platform?: Parameters<typeof AgentWorkingDirectorySettings>[0]["platform"],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" resources={{ en: { agents: enAgents } }}>
        <AgentWorkingDirectorySettings agentId={AGENT_ID} platform={platform} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AgentWorkingDirectorySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(directory(`D:\\work\\existing`));
    mocks.update.mockImplementation(async (_id: string, path: string) => directory(path));
    mocks.remove.mockResolvedValue(directory());
  });

  it("loads and updates the server-synchronized path", async () => {
    renderComponent();
    const input = await screen.findByLabelText("Run this agent in");
    await waitFor(() => expect(input).toHaveValue(`D:\\work\\existing`));
    expect(screen.getByText(/Current machine: Office PC/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, `E:\\repos\\multica`);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(AGENT_ID, `E:\\repos\\multica`);
      expect(input).toHaveValue(`E:\\repos\\multica`);
    });
  });

  it("uses the native picker and validates before saving", async () => {
    const platform = {
      pickDirectory: vi.fn().mockResolvedValue({ ok: true, path: `F:\\source\\app` }),
      validateDirectory: vi.fn().mockResolvedValue({ ok: true }),
    };
    renderComponent(platform);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Choose folder" }));
    await waitFor(() => {
      expect(platform.validateDirectory).toHaveBeenCalledWith(`F:\\source\\app`);
      expect(mocks.update).toHaveBeenCalledWith(AGENT_ID, `F:\\source\\app`);
    });
  });

  it("migrates a legacy Desktop mapping once and clears the local copy", async () => {
    mocks.get.mockResolvedValue(directory());
    const platform = {
      getLegacyDirectory: vi.fn().mockResolvedValue(`D:\\legacy\\project`),
      clearLegacyDirectory: vi.fn().mockResolvedValue(undefined),
      validateDirectory: vi.fn().mockResolvedValue({ ok: true }),
    };
    renderComponent(platform);

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(AGENT_ID, `D:\\legacy\\project`);
      expect(platform.clearLegacyDirectory).toHaveBeenCalledWith(AGENT_ID);
    });
  });
});
