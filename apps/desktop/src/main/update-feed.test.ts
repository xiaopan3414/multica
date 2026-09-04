// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  configureDesktopUpdateFeed,
  desktopUpdateFeedUrl,
  INTRANET_UPDATE_SERVER_ORIGIN,
} from "./update-feed";

describe("Desktop update feed", () => {
  it("uses the intranet service for Windows x64", () => {
    expect(desktopUpdateFeedUrl("win32", "x64")).toBe(
      `${INTRANET_UPDATE_SERVER_ORIGIN}/windows/x64`,
    );
  });

  it("configures electron-updater as a generic HTTP feed", () => {
    const setFeedURL = vi.fn();
    configureDesktopUpdateFeed({ setFeedURL }, "win32", "x64");
    expect(setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "http://10.0.37.30:8090/windows/x64",
    });
  });

  it("leaves non-Windows release feeds unchanged", () => {
    const setFeedURL = vi.fn();
    configureDesktopUpdateFeed({ setFeedURL }, "darwin", "arm64");
    expect(setFeedURL).not.toHaveBeenCalled();
  });
});
