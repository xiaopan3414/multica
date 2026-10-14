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
  updateLock: vi.fn(),
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
    updateAgentDirectoryLock: mocks.updateLock,
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
    directory_lock_enabled: false,
    directory_lock_supported: true,
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
    mocks.updateLock.mockImplementation(async (_id: string, enabled: boolean) => ({
      ...directory(`D:\\work\\existing`), directory_lock_enabled: enabled,
    }));
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

  it("defaults the directory lock off and persists both toggle states", async () => {
    renderComponent();
    const toggle = await screen.findByRole("switch", { name: "Directory lock" });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    expect(toggle).not.toBeChecked();
    const user = userEvent.setup();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(mocks.updateLock).toHaveBeenLastCalledWith(AGENT_ID, true);
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(mocks.updateLock).toHaveBeenLastCalledWith(AGENT_ID, false);
  });

  it("retains the previous value on save failure", async () => {
    mocks.updateLock.mockRejectedValue(new Error("save failed"));
    renderComponent();
    const toggle = await screen.findByRole("switch", { name: "Directory lock" });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("save failed"));
    expect(toggle).not.toBeChecked();
  });

  it("disables the switch on an older daemon", async () => {
    mocks.get.mockResolvedValue({ ...directory(), directory_lock_supported: false });
    renderComponent();
    const toggle = await screen.findByRole("switch", { name: "Directory lock" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-disabled", "true"));
    await userEvent.setup().click(toggle);
    expect(mocks.updateLock).not.toHaveBeenCalled();
  });

  it("can turn off an existing lock after a daemon downgrade", async () => {
    mocks.get.mockResolvedValue({
      ...directory(), directory_lock_supported: false, directory_lock_enabled: true,
    });
    renderComponent();
    const toggle = await screen.findByRole("switch", { name: "Directory lock" });
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(mocks.updateLock).toHaveBeenCalledWith(AGENT_ID, false));
  });
});
