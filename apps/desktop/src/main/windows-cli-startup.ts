export const WINDOWS_CLI_SERVICE_START_ARG = "--start-cli-service";

export interface WindowsCliLoginItemSettings {
  openAtLogin: boolean;
  path: string;
  args: string[];
}

export function windowsCliLoginItemSettings(
  enabled: boolean,
  executablePath: string,
): WindowsCliLoginItemSettings {
  return {
    openAtLogin: enabled,
    path: executablePath,
    args: [WINDOWS_CLI_SERVICE_START_ARG],
  };
}

export function isWindowsCliServiceStartup(
  platform: NodeJS.Platform,
  argv: readonly string[],
): boolean {
  return (
    platform === "win32" && argv.includes(WINDOWS_CLI_SERVICE_START_ARG)
  );
}
