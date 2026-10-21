#!/bin/sh
# Restaura un respaldo de restic (deploy/backup-offsite.sh) en el stack (fase 115).
#   deploy/restore-offsite.sh [snapshot] --si-reemplazar     (por defecto el más reciente)
#   deploy/restore-offsite.sh --lista                        ver los respaldos disponibles
# Necesita las mismas variables que backup-offsite.sh. REEMPLAZA la base y los archivos.
set -eu

cd "$(dirname "$0")/.."
# Con MILPA_RESTIC_ENV=/etc/milpa/restic.env las variables se leen de ese archivo (CLAVE=valor por
# línea, como el EnvironmentFile de systemd), sin ejecutarlo como script: un valor con espacios o
# símbolos no se rompe y la clave nunca pasa por la línea de comandos.
if [ -n "${MILPA_RESTIC_ENV:-}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; value="${line#*=}"
    case "$key" in RESTIC_*|B2_*|AWS_*|MILPA_KEEP) export "$key=$value" ;; esac
  done < "$MILPA_RESTIC_ENV"
fi
: "${RESTIC_REPOSITORY:?Falta RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?Falta RESTIC_PASSWORD}"
restic_image="restic/restic:0.17.3"
work="$(mktemp -d /var/tmp/milpa-restaurar.XXXXXX)"
trap 'rm -rf "$work"' EXIT

restic() {
  repo_mount=""
  case "$RESTIC_REPOSITORY" in /*) repo_mount="-v $RESTIC_REPOSITORY:$RESTIC_REPOSITORY" ;; esac
  # shellcheck disable=SC2086
  docker run --rm --hostname milpa $repo_mount -v "$work:/restaurar" \
    -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -e B2_ACCOUNT_ID -e B2_ACCOUNT_KEY \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    "$restic_image" "$@"
}

if [ "${1:-}" = "--lista" ]; then restic snapshots --tag milpa; exit 0; fi
snapshot="latest"
case "${1:-}" in --si-reemplazar|"") ;; *) snapshot="$1"; shift ;; esac
[ "${1:-}" = "--si-reemplazar" ] || { echo "[restaurar] Esto reemplaza la base y los archivos. Repite con --si-reemplazar." >&2; exit 2; }

echo "[restaurar] Descargando el respaldo $snapshot"
restic restore "$snapshot" --tag milpa --target /restaurar --quiet
deploy/restore.sh "$work/respaldo" --si-reemplazar
