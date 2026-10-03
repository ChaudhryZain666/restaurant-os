#!/usr/bin/env bash
# GarnishTable server bootstrap (Phase 87) — run ONCE, as root, on a fresh Ubuntu 24.04 VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<commit>/infrastructure/production/scripts/bootstrap.sh -o bootstrap.sh
#   less bootstrap.sh            # read it first
#   sudo bash bootstrap.sh <git clone URL> <your-ssh-user>
#
# Idempotent: safe to re-run. It does NOT touch SSH authentication (harden-ssh.sh does that, as a
# separate, deliberately two-step operation) and it never deploys anything.
#
#   1. base packages, unattended security upgrades, time sync, a swap file if there is none
#   2. Docker Engine + Compose plugin from Docker's official apt repository
#   3. Docker daemon defaults: log rotation for every container, live-restore
#   4. firewall: deny inbound except 22/tcp, 80/tcp, 443/tcp, 443/udp
#   5. /opt/garnishtable layout, the repository clone, the systemd timers
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
REPO_URL="${1:?usage: bootstrap.sh <git clone URL> <ssh user>}"
OPERATOR="${2:?usage: bootstrap.sh <git clone URL> <ssh user>}"
GT_ROOT=/opt/garnishtable
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = "24.04" ] || echo "WARNING: written for Ubuntu 24.04, this is $PRETTY_NAME" >&2
id "$OPERATOR" > /dev/null 2>&1 || { echo "user $OPERATOR does not exist — create it (adduser) and install its SSH key first" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

step "Base packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git gnupg ufw unattended-upgrades fail2ban jq
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-ntp true || true

if ! swapon --show | grep -q .; then
  step "Swap file (2 GB) — headroom for image pulls and memory spikes, not a substitute for RAM"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-garnishtable.conf
fi

step "Docker Engine and Compose plugin (official repository)"
if ! command -v docker > /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

step "Docker daemon defaults (log rotation for every container, live-restore)"
mkdir -p /etc/docker
desired='{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"},"live-restore":true}'
if [ ! -f /etc/docker/daemon.json ] || [ "$(jq -cS . /etc/docker/daemon.json)" != "$(jq -cS . <<< "$desired")" ]; then
  [ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)"
  jq . <<< "$desired" > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker containerd > /dev/null
docker info --format 'Docker {{.ServerVersion}}, log driver {{.LoggingDriver}}, live-restore {{.LiveRestoreEnabled}}'
docker compose version

step "Firewall (UFW): inbound 22/tcp, 80/tcp, 443/tcp, 443/udp only"
# Docker-published ports bypass UFW's INPUT rules, so the compose file is the real control for
# container ports: only Caddy publishes anything (80/443). UFW covers everything else on the host.
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw allow 443/udp > /dev/null
ufw --force enable > /dev/null
ufw status verbose

step "fail2ban for SSH"
cat > /etc/fail2ban/jail.d/garnishtable.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban > /dev/null && systemctl restart fail2ban

step "Layout under $GT_ROOT"
install -d -m 755 "$GT_ROOT" "$GT_ROOT/releases" "$GT_ROOT/state"
install -d -m 700 "$GT_ROOT/config" "$GT_ROOT/backups"
if [ ! -d "$GT_ROOT/repo/.git" ]; then git clone --quiet "$REPO_URL" "$GT_ROOT/repo"; fi
git -C "$GT_ROOT/repo" fetch --quiet origin
for f in edge.env api.env; do
  [ -f "$GT_ROOT/config/$f" ] || install -m 600 /dev/null "$GT_ROOT/config/$f"
done
usermod -aG docker "$OPERATOR"
echo "NOTE: membership of the docker group is root-equivalent; only give it to trusted operators."

step "systemd: health watch (5 min), backups (daily), image cleanup (weekly)"
units="$GT_ROOT/repo/infrastructure/production/systemd"
for u in "$units"/*.service "$units"/*.timer; do install -m 644 "$u" /etc/systemd/system/; done
systemctl daemon-reload
echo "Timers are installed but NOT enabled; enable them after the first successful deploy:"
echo "  systemctl enable --now garnishtable-healthwatch.timer garnishtable-backup.timer garnishtable-cleanup.timer"

cat <<EOF

Bootstrap complete. Next (docs/production-deployment-runbook.md):
  1. SSH hardening:  sudo bash $GT_ROOT/repo/infrastructure/production/scripts/harden-ssh.sh check $OPERATOR
  2. Fill $GT_ROOT/config/edge.env and api.env (mode 600)
  3. Registry login (private images):  echo <read:packages token> | docker login ghcr.io -u <github user> --password-stdin
  4. First deploy:   $GT_ROOT/repo/infrastructure/production/scripts/deploy.sh sha-<commit> --init
EOF
