// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  WINDOWS_CLI_SERVICE_START_ARG,
  isWindowsCliServiceStartup,
  windowsCliLoginItemSettings,
} from "./windows-cli-startup";

describe("Windows CLI service startup", () => {
  it("registers the packaged executable with the background startup argument", () => {
    expect(
      windowsCliLoginItemSettings(
        true,
        "C:\\Program Files\\Multica\\Multica.exe",
      ),
    ).toEqual({
      openAtLogin: true,
      path: "C:\\Program Files\\Multica\\Multica.exe",
      args: [WINDOWS_CLI_SERVICE_START_ARG],
    });
  });

  it("preserves the startup argument when disabling the login item", () => {
    expect(windowsCliLoginItemSettings(false, "C:\\Multica.exe")).toEqual({
      openAtLogin: false,
      path: "C:\\Multica.exe",
      args: [WINDOWS_CLI_SERVICE_START_ARG],
    });
  });

  it("only treats the dedicated argument as a Windows background startup", () => {
    expect(
      isWindowsCliServiceStartup("win32", [
        "C:\\Multica.exe",
        WINDOWS_CLI_SERVICE_START_ARG,
      ]),
    ).toBe(true);
    expect(isWindowsCliServiceStartup("win32", ["C:\\Multica.exe"])).toBe(
      false,
    );
    expect(
      isWindowsCliServiceStartup("darwin", [WINDOWS_CLI_SERVICE_START_ARG]),
    ).toBe(false);
  });
});
