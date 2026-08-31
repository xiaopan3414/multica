import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getPrefs: vi.fn(),
  setPrefs: vi.fn(),
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

vi.mock("../platform/daemon-reauth", () => ({
  reauthenticateDaemon: vi.fn(),
}));

import { DaemonSettingsTab } from "./daemon-settings-tab";

const initialPrefs = {
  autoStart: true,
  autoStop: false,
  launchAtLogin: false,
  workspacesRoot: "",
};

describe("DaemonSettingsTab", () => {
  beforeEach(() => {
    mocks.getPrefs.mockReset().mockResolvedValue(initialPrefs);
    mocks.setPrefs
      .mockReset()
      .mockImplementation(async (update: Partial<typeof initialPrefs>) => ({
        ...initialPrefs,
        ...update,
      }));
    mocks.pickDirectory.mockReset();
    mocks.validateLocalDirectory.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();

    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        appInfo: { version: "1.2.3", os: "windows" },
        pickDirectory: mocks.pickDirectory,
        validateLocalDirectory: mocks.validateLocalDirectory,
        openExternal: vi.fn(),
      },
    });
    Object.defineProperty(window, "daemonAPI", {
      configurable: true,
      value: {
        getPrefs: mocks.getPrefs,
        setPrefs: mocks.setPrefs,
        isCliInstalled: vi.fn().mockResolvedValue(true),
        getStatus: vi.fn().mockResolvedValue({ state: "stopped" }),
        onStatusChange: vi.fn().mockReturnValue(vi.fn()),
      },
    });
  });

  afterEach(cleanup);

  it("persists the Windows login-start preference", async () => {
    render(<DaemonSettingsTab />);

    const toggle = screen.getByRole("switch", {
      name: "Start Multica with Windows",
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.setPrefs).toHaveBeenCalledWith({ launchAtLogin: true });
      expect(toggle).toBeChecked();
    });
  });

  it("validates and saves a folder selected with the native picker", async () => {
    const selected = "D:\\Multica Workspaces";
    mocks.pickDirectory.mockResolvedValue({ ok: true, path: selected });
    mocks.validateLocalDirectory.mockResolvedValue({ ok: true });
    render(<DaemonSettingsTab />);

    const choose = await screen.findByRole("button", { name: "Choose folder" });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);

    await waitFor(() => {
      expect(mocks.validateLocalDirectory).toHaveBeenCalledWith(selected);
      expect(mocks.setPrefs).toHaveBeenCalledWith({ workspacesRoot: selected });
      expect(screen.getByText(selected)).toBeInTheDocument();
    });
  });
});
