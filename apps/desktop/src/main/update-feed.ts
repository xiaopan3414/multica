export const INTRANET_UPDATE_SERVER_ORIGIN = "http://10.0.37.30:8090";

interface FeedConfigurableUpdater {
  setFeedURL(options: { provider: "generic"; url: string }): void;
}

export function desktopUpdateFeedUrl(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform !== "win32") return null;
  return `${INTRANET_UPDATE_SERVER_ORIGIN}/windows/${arch}`;
}

export function configureDesktopUpdateFeed(
  updater: FeedConfigurableUpdater,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): void {
  const url = desktopUpdateFeedUrl(platform, arch);
  if (!url) return;
  updater.setFeedURL({ provider: "generic", url });
}
