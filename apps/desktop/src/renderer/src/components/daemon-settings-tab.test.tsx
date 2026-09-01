import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getPrefs: vi.fn(),
  setPrefs: vi.fn(),
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
  validateWorkspacesRootDirectory: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const translations = {
  desktop: {
    daemon: {
      title: "Local service",
      description: "Local service preferences",
      toast_saved: "Local service settings saved",
      toast_save_failed: "Failed to save local service settings",
      folder_picker_failed: "Could not open the folder picker",
      folder_validation_failed: "The selected folder must be readable and writable.",
      working_folder_must_be_dedicated: "Choose a dedicated empty folder.",
      working_folder_updated: "Default task working folder updated",
      working_folder_restored: "Default task working folder restored",
      auth_expired_title: "Sign-in expired",
      auth_expired_description: "Sign in again to restore the local service.",
      sign_in_again: "Sign in again",
      externally_managed_prefix: "Manage this service with",
      externally_managed_suffix: ".",
      windows_start_title: "Start Multica with Windows",
      windows_start_description: "Open after signing in to Windows.",
      auto_start_title: "Start local service automatically",
      auto_start_description: "Start after Desktop opens.",
      auto_stop_title: "Stop local service when exiting",
      auto_stop_description: "Stop after Desktop closes.",
      working_folder_title: "Default task working folder",
      working_folder_description: "Stores task data.",
      multica_default: "Multica default",
      use_default: "Use default",
      choosing_folder: "Choosing...",
      choose_folder: "Choose folder",
      cli_status_title: "CLI status",
      cli_checking: "Checking...",
      cli_installed: "multica CLI is installed and available in PATH.",
      cli_missing: "multica CLI was not found.",
      installation_guide: "Installation guide",
      diagnostics_title: "Diagnostics",
      diagnostics_description: "Connection details.",
      default_profile: "default",
      states: {
        running: "Running",
        stopped: "Stopped",
        starting: "Starting...",
        stopping: "Stopping...",
        installing_cli: "Installing CLI...",
        cli_not_found: "CLI not found",
        auth_expired: "Sign-in expired",
      },
      diagnostics: {
        state: "State",
        uptime: "Uptime",
        daemon_id: "Daemon ID",
        profile: "Profile",
        server_url: "Server URL",
        device_name: "Device name",
        workspaces: "Workspaces",
      },
    },
  },
};

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: (resources: typeof translations) => string) =>
      selector(translations),
  }),
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
    mocks.validateWorkspacesRootDirectory.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();

    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: {
        appInfo: { version: "1.2.3", os: "windows" },
        pickDirectory: mocks.pickDirectory,
        validateLocalDirectory: mocks.validateLocalDirectory,
        validateWorkspacesRootDirectory:
          mocks.validateWorkspacesRootDirectory,
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
    mocks.validateWorkspacesRootDirectory.mockResolvedValue({ ok: true });
    render(<DaemonSettingsTab />);

    const choose = await screen.findByRole("button", { name: "Choose folder" });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);

    await waitFor(() => {
      expect(mocks.validateWorkspacesRootDirectory).toHaveBeenCalledWith(
        selected,
      );
      expect(mocks.setPrefs).toHaveBeenCalledWith({ workspacesRoot: selected });
      expect(screen.getByText(selected)).toBeInTheDocument();
    });
  });

  it("refuses to use a folder containing existing projects as task storage", async () => {
    const selected = "D:\\Projects";
    mocks.pickDirectory.mockResolvedValue({ ok: true, path: selected });
    mocks.validateWorkspacesRootDirectory.mockResolvedValue({
      ok: false,
      reason: "contains_unmanaged_content",
    });
    render(<DaemonSettingsTab />);

    const choose = await screen.findByRole("button", { name: "Choose folder" });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);

    await waitFor(() => {
      expect(mocks.setPrefs).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Choose a dedicated empty folder.",
      );
    });
  });
});
