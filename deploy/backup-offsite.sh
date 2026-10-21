#!/bin/sh
# Respaldo cifrado fuera del servidor (fase 115). Hace un respaldo con deploy/backup.sh y lo sube con
# restic (cifrado de extremo a extremo y deduplicado) al repositorio de RESTIC_REPOSITORY; después
# aplica la política de retención. Lo corre a diario el temporizador deploy/systemd/milpa-backup.timer.
#
# Variables (en /etc/milpa/restic.env, sólo legible por root):
#   RESTIC_REPOSITORY   p. ej. b2:mi-bucket:milpa  ·  s3:s3.amazonaws.com/mi-bucket/milpa  ·  /ruta/local
#   RESTIC_PASSWORD     la clave del repositorio: SIN ELLA LOS RESPALDOS NO SE PUEDEN LEER. Guárdala
#                       también fuera del servidor (gestor de contraseñas).
#   B2_ACCOUNT_ID / B2_ACCOUNT_KEY   o   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, según el destino.
#   MILPA_KEEP          retención de restic (por defecto: 7 diarios, 4 semanales, 12 mensuales).
set -eu

cd "$(dirname "$0")/.."
: "${RESTIC_REPOSITORY:?Falta RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?Falta RESTIC_PASSWORD}"
restic_image="restic/restic:0.17.3"
keep="${MILPA_KEEP:---keep-daily 7 --keep-weekly 4 --keep-monthly 12}"

work="$(mktemp -d /var/tmp/milpa-respaldo.XXXXXX)"
trap 'rm -rf "$work"' EXIT
deploy/backup.sh "$work" >/dev/null
snapshot_dir="$(ls -d "$work"/milpa-*)"

# restic corre en su propio contenedor (no hay que instalarlo). Un repositorio local se monta.
restic() {
  repo_mount=""
  case "$RESTIC_REPOSITORY" in /*) repo_mount="-v $RESTIC_REPOSITORY:$RESTIC_REPOSITORY" ;; esac
  # shellcheck disable=SC2086
  docker run --rm -i --hostname milpa $repo_mount -v "$snapshot_dir:/respaldo:ro" \
    -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -e B2_ACCOUNT_ID -e B2_ACCOUNT_KEY \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    "$restic_image" "$@"
}

if ! restic cat config >/dev/null 2>&1; then
  echo "[respaldo] Repositorio nuevo: se inicializa"
  restic init
fi
restic backup /respaldo --tag milpa --quiet
# shellcheck disable=SC2086
restic forget --tag milpa $keep --prune --quiet
# Una vez por semana (domingo) se verifica una parte de los datos guardados.
[ "$(date -u +%u)" = 7 ] && restic check --read-data-subset=10% --quiet
echo "[respaldo] Listo: $(restic snapshots --tag milpa --compact 2>/dev/null | grep -c '^[0-9a-f]\{8\}') respaldos en el repositorio"
