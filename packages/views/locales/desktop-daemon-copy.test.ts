import { describe, expect, it } from "vitest";
import zhHansSettings from "./zh-Hans/settings.json";

describe("Desktop daemon copy", () => {
  it("names the Windows startup setting after the CLI service behavior", () => {
    expect(zhHansSettings.desktop.daemon.windows_start_title).toBe(
      "开机自启 CLI 服务",
    );
    expect(zhHansSettings.desktop.daemon.windows_start_description).toContain(
      "后台启动",
    );
  });
});
