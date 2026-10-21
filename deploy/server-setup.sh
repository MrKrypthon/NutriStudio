#!/bin/bash
# Prepara un VPS nuevo con Ubuntu 24.04 para Milpa (fase 115). Se corre UNA vez, como root, recién
# creado el servidor y con tu llave SSH ya instalada para root (los proveedores la piden al crearlo):
#   curl -fsSL https://raw.githubusercontent.com/MrKrypthon/NutriStudio/main/deploy/server-setup.sh -o server-setup.sh
#   less server-setup.sh          # léelo antes de correrlo
#   bash server-setup.sh
#
# Qué hace:
#  - Actualiza el sistema y activa las actualizaciones de seguridad automáticas.
#  - Instala Docker (repositorio oficial) con tope en los registros, git, ufw y fail2ban.
#  - Crea el usuario `milpa` (grupo docker) con la misma llave SSH que root.
#  - SSH sólo con llave y sin entrar como root; fail2ban contra fuerza bruta.
#  - Firewall: sólo 22, 80 y 443 (Docker publica únicamente los puertos de Caddy).
#  - 2 GB de swap si no hay, zona horaria UTC, /opt/milpa para el repositorio y /etc/milpa para secretos.
#  - Instala el temporizador del respaldo diario (se activa cuando configures restic).
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Corre este script como root." >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "Pensado para Ubuntu (24.04); este sistema es ${PRETTY_NAME:-desconocido}." >&2; exit 1; }
user=milpa
[ -s /root/.ssh/authorized_keys ] || { echo "root no tiene llaves en /root/.ssh/authorized_keys: agrega la tuya antes (si no, te quedarías sin acceso al quitar las contraseñas)." >&2; exit 1; }

log() { echo -e "\n[servidor] $*"; }
export DEBIAN_FRONTEND=noninteractive

log "Sistema al día y paquetes base"
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q ca-certificates curl gnupg git ufw fail2ban unattended-upgrades
timedatectl set-timezone UTC

log "Actualizaciones de seguridad automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log "Docker (repositorio oficial)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
EOF
systemctl enable --now docker
systemctl restart docker

log "Usuario $user con tu llave SSH"
id "$user" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$user"
usermod -aG docker "$user"
install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
install -m 600 -o "$user" -g "$user" /root/.ssh/authorized_keys "/home/$user/.ssh/authorized_keys"
install -d -m 755 -o "$user" -g "$user" /opt/milpa
install -d -m 700 /etc/milpa

log "SSH sólo con llave y sin root"
cat > /etc/ssh/sshd_config.d/10-milpa.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
systemctl reload ssh

log "fail2ban para SSH"
cat > /etc/fail2ban/jail.d/milpa.conf <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Firewall: 22, 80 y 443"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

if ! swapon --show | grep -q .; then
  log "2 GB de swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Temporizador del respaldo diario (se activa al configurar restic)"
curl -fsSL https://raw.githubusercontent.com/MrKrypthon/NutriStudio/main/deploy/systemd/milpa-backup.service -o /etc/systemd/system/milpa-backup.service
curl -fsSL https://raw.githubusercontent.com/MrKrypthon/NutriStudio/main/deploy/systemd/milpa-backup.timer -o /etc/systemd/system/milpa-backup.timer
systemctl daemon-reload

cat <<EOF

[servidor] Listo. Desde ahora entra como: ssh $user@<IP-del-servidor>   (root ya no puede entrar por SSH)
Siguientes pasos (DESPLIEGUE.md): clonar el repo en /opt/milpa, llenar .env.docker, correr
deploy/deploy.sh, cargar el catálogo, crear el administrador y configurar /etc/milpa/restic.env.
EOF
