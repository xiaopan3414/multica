import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enAgents from "@multica/views/locales/en/agents.json";
import { PrivateAgentWorkingDirectory } from "./private-agent-working-directory";

const AGENT_ID = "7f34eb65-30d5-44c9-9a76-723108504a72";
const mocks = vi.hoisted(() => ({
  getAgentWorkingDirectory: vi.fn(),
  setAgentWorkingDirectory: vi.fn(),
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

function renderComponent() {
  return render(
    <I18nProvider locale="en" resources={{ en: { agents: enAgents } }}>
      <PrivateAgentWorkingDirectory agentId={AGENT_ID} />
    </I18nProvider>,
  );
}

describe("PrivateAgentWorkingDirectory", () => {
  beforeEach(() => {
    mocks.getAgentWorkingDirectory.mockReset().mockResolvedValue("");
    mocks.setAgentWorkingDirectory
      .mockReset()
      .mockImplementation(async (_agentId: string, path: string) => ({ path }));
    mocks.pickDirectory.mockReset();
    mocks.validateLocalDirectory.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();

    Object.defineProperty(window, "daemonAPI", {
      configurable: true,
      value: {
        getAgentWorkingDirectory: mocks.getAgentWorkingDirectory,
        setAgentWorkingDirectory: mocks.setAgentWorkingDirectory,
      },
    });
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        pickDirectory: mocks.pickDirectory,
        validateLocalDirectory: mocks.validateLocalDirectory,
      },
    });
  });

  afterEach(cleanup);

  it("loads and displays the private path stored on this computer", async () => {
    const path = "D:\\work\\existing-project";
    mocks.getAgentWorkingDirectory.mockResolvedValue(path);
    renderComponent();

    expect(await screen.findByText(path)).toBeInTheDocument();
    expect(mocks.getAgentWorkingDirectory).toHaveBeenCalledWith(AGENT_ID);
  });

  it("validates and saves a directory selected with the native picker", async () => {
    const path = "D:\\work\\existing-project";
    mocks.pickDirectory.mockResolvedValue({ ok: true, path });
    mocks.validateLocalDirectory.mockResolvedValue({ ok: true });
    renderComponent();

    const choose = await screen.findByRole("button", { name: "Choose folder" });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);

    await waitFor(() => {
      expect(mocks.validateLocalDirectory).toHaveBeenCalledWith(path);
      expect(mocks.setAgentWorkingDirectory).toHaveBeenCalledWith(
        AGENT_ID,
        path,
      );
      expect(screen.getByText(path)).toBeInTheDocument();
    });
  });

  it("removes the private mapping when Use default is selected", async () => {
    const path = "D:\\work\\existing-project";
    mocks.getAgentWorkingDirectory.mockResolvedValue(path);
    renderComponent();

    fireEvent.click(
      await screen.findByRole("button", { name: "Use default" }),
    );

    await waitFor(() => {
      expect(mocks.setAgentWorkingDirectory).toHaveBeenCalledWith(AGENT_ID, "");
      expect(screen.getByText("Use the normal task workspace")).toBeInTheDocument();
    });
  });
});
