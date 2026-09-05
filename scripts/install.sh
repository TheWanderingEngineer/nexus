#!/usr/bin/env bash
#
# Nexus installer for Debian/Ubuntu.
#
#   git clone https://github.com/<you>/nexus.git
#   cd nexus
#   sudo bash scripts/install.sh
#
# Idempotent: safe to re-run to upgrade an existing install.

set -euo pipefail

APP_DIR=/opt/nexus
DATA_DIR=/var/lib/nexus
CONF_DIR=/etc/nexus
SERVICE=/etc/systemd/system/nexus.service
PORT="${NEXUS_PORT:-8080}"
NODE_MAJOR=20

c_ok()   { printf '\033[32m  ok\033[0m   %s\n' "$1"; }
c_info() { printf '\033[36m  ->\033[0m   %s\n' "$1"; }
c_warn() { printf '\033[33m  !!\033[0m   %s\n' "$1"; }
c_err()  { printf '\033[31m  xx\033[0m   %s\n' "$1" >&2; }

echo
echo "  Nexus installer"
echo

if [ "$(id -u)" -ne 0 ]; then
  c_err "run this with sudo: sudo bash scripts/install.sh"
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SRC_DIR/server/index.js" ]; then
  c_err "run this from inside the cloned repository"
  exit 1
fi

# ---------------------------------------------------------------- packages
c_info "checking packages"
export DEBIAN_FRONTEND=noninteractive

need_apt=()
command -v curl      >/dev/null 2>&1 || need_apt+=(curl)
command -v ca-certificates >/dev/null 2>&1 || true
command -v smartctl  >/dev/null 2>&1 || need_apt+=(smartmontools)
command -v script    >/dev/null 2>&1 || need_apt+=(bsdutils)
command -v lm-sensors >/dev/null 2>&1 || need_apt+=(lm-sensors)

if [ ${#need_apt[@]} -gt 0 ]; then
  c_info "installing: ${need_apt[*]}"
  apt-get update -qq
  apt-get install -y -qq "${need_apt[@]}" >/dev/null
fi
c_ok "system packages"

# ---------------------------------------------------------------- node
install_node() {
  c_info "installing Node.js ${NODE_MAJOR}.x from NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
}

if ! command -v node >/dev/null 2>&1; then
  install_node
else
  CUR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$CUR" -lt "$NODE_MAJOR" ]; then
    c_warn "found Node $CUR, need >= $NODE_MAJOR"
    install_node
  fi
fi
c_ok "node $(node -v)"

# ---------------------------------------------------------------- files
c_info "installing to $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR" "$CONF_DIR"

# Preserve node_modules across upgrades where possible; copy everything else.
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .nexus-data --exclude '.mcp.json' \
  "$SRC_DIR"/ "$APP_DIR"/ 2>/dev/null || {
    # rsync is not always present on a minimal server image
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
    cp -r "$SRC_DIR"/server "$SRC_DIR"/web "$SRC_DIR"/assets "$SRC_DIR"/scripts \
          "$SRC_DIR"/package.json "$APP_DIR"/ 2>/dev/null || true
  }

cd "$APP_DIR"
c_info "installing node dependencies (production only)"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
else
  npm install --omit=dev --no-audit --no-fund >/dev/null
fi
c_ok "dependencies"

chmod 700 "$DATA_DIR"

# ---------------------------------------------------------------- config
if [ ! -f "$CONF_DIR/config.json" ]; then
  DATA_MOUNT="/DATA"
  [ -d "$DATA_MOUNT" ] || DATA_MOUNT="/srv"
  [ -d "$DATA_MOUNT" ] || DATA_MOUNT="/home"

  cat > "$CONF_DIR/config.json" <<EOF
{
  "host": "0.0.0.0",
  "port": ${PORT},
  "allowedOrigins": [],
  "trustedProxies": [],
  "terminal": { "enabled": true, "shell": "/bin/bash" },
  "docker":   { "enabled": true, "socket": "/var/run/docker.sock" },
  "fileRoots": [
    { "name": "DATA", "path": "${DATA_MOUNT}" },
    { "name": "root", "path": "/root" }
  ],
  "smart": { "enabled": true, "cacheSeconds": 900, "devices": [] },
  "dataDir": "${DATA_DIR}",
  "sessionHours": 168
}
EOF
  chmod 600 "$CONF_DIR/config.json"
  c_ok "wrote $CONF_DIR/config.json (file roots: $DATA_MOUNT, /root)"
else
  c_ok "kept existing $CONF_DIR/config.json"
fi

# ---------------------------------------------------------------- service
c_info "installing systemd unit"
cp "$APP_DIR/scripts/nexus.service" "$SERVICE"
systemctl daemon-reload
systemctl enable nexus >/dev/null 2>&1
systemctl restart nexus
sleep 2

if systemctl is-active --quiet nexus; then
  c_ok "service running"
else
  c_err "service failed to start — journalctl -u nexus -n 50"
  exit 1
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="<this-host>"

echo
echo "  ------------------------------------------------------------"
echo "   Nexus is running"
echo
echo "     http://${IP}:${PORT}"
echo
echo "   Open that in a browser to create your admin account."
echo
echo "   Logs      journalctl -u nexus -f"
echo "   Restart   systemctl restart nexus"
echo "   Config    ${CONF_DIR}/config.json"
echo
if [ ! -S /var/run/docker.sock ]; then
  c_warn "Docker socket not found — container features will show as unavailable."
fi
echo "   The terminal gives a root shell to anyone who logs in."
echo "   Keep this port on your LAN, or set terminal.enabled=false."
echo "  ------------------------------------------------------------"
echo
