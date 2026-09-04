#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root: sudo ./install-linux.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${1:-/opt/multica-desktop-update}
PORT=${2:-8090}
SERVICE_USER=multica-update
SERVICE_NAME=multica-desktop-update

if ! getent group "$SERVICE_USER" >/dev/null 2>&1; then
  groupadd --system "$SERVICE_USER"
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  NOLOGIN=$(command -v nologin || printf '/usr/sbin/nologin')
  useradd --system --gid "$SERVICE_USER" --home-dir "$INSTALL_DIR" --shell "$NOLOGIN" "$SERVICE_USER"
fi

install -d -m 0755 "$INSTALL_DIR/bin" "$INSTALL_DIR/releases/windows/x64"
install -m 0755 "$SCRIPT_DIR/bin/multica-update-server-linux-amd64" "$INSTALL_DIR/bin/multica-update-server"
cp -a "$SCRIPT_DIR/releases/." "$INSTALL_DIR/releases/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

cat >"/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Multica Desktop update service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/bin/multica-update-server --listen 0.0.0.0:$PORT --root $INSTALL_DIR/releases
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "Installed $SERVICE_NAME on port $PORT"
echo "Health check: curl http://127.0.0.1:$PORT/healthz"
echo "Update feed: http://10.0.37.30:$PORT/windows/x64/latest.yml"
