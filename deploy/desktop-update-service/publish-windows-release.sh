#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${1:?Usage: ./publish-windows-release.sh /path/to/desktop-artifact [service-root]}
SERVICE_ROOT=${2:-/opt/multica-desktop-update}
TARGET="$SERVICE_ROOT/releases/windows/x64"

if [[ ! -f "$SOURCE_DIR/latest.yml" ]]; then
  echo "Missing $SOURCE_DIR/latest.yml" >&2
  exit 1
fi
if ! compgen -G "$SOURCE_DIR/*.exe" >/dev/null || ! compgen -G "$SOURCE_DIR/*.blockmap" >/dev/null; then
  echo "The source directory must contain an installer and blockmap." >&2
  exit 1
fi

install -d -m 0755 "$TARGET"
cp "$SOURCE_DIR"/*.exe "$SOURCE_DIR"/*.blockmap "$TARGET/"
cp "$SOURCE_DIR/latest.yml" "$TARGET/latest.yml.tmp"
mv -f "$TARGET/latest.yml.tmp" "$TARGET/latest.yml"
chown -R multica-update:multica-update "$TARGET"

echo "Published Windows Desktop update files to $TARGET"
