#!/bin/sh
# Restaura un respaldo de deploy/backup.sh en un stack de docker-compose.app.yml (fase 113).
#   deploy/restore.sh <carpeta-del-respaldo> --si-reemplazar
# REEMPLAZA la base y los archivos del proyecto MILPA_PROJECT (por defecto milpa): pensado para un
# servidor nuevo o un stack de prueba. Comprueba las sumas antes de tocar nada.
set -eu

cd "$(dirname "$0")/.."
src="${1:?Uso: deploy/restore.sh <carpeta-del-respaldo> --si-reemplazar}"
[ "${2:-}" = "--si-reemplazar" ] || { echo "[restaurar] Esto reemplaza la base y los archivos. Repite con --si-reemplazar." >&2; exit 2; }
project="${MILPA_PROJECT:-milpa}"
# Con MILPA_DOMAIN en el archivo de variables es el stack de producción (Caddy delante, fase 115):
# se usan los dos archivos de compose, para no recrear Nginx sin Caddy.
env_file="${MILPA_ENV_FILE:-.env.docker}"
if [ -f "$env_file" ] && grep -q '^MILPA_DOMAIN=.' "$env_file"; then
  compose() { docker compose -p "$project" --env-file "$env_file" -f docker-compose.app.yml -f docker-compose.prod.yml "$@"; }
else
  compose() { docker compose -p "$project" -f docker-compose.app.yml "$@"; }
fi

(cd "$src" && sha256sum -c SHA256SUMS) || { echo "[restaurar] Las sumas no coinciden; no se tocó nada." >&2; exit 1; }

echo "[restaurar] Deteniendo la API y el frontend de $project"
compose stop web api 2>/dev/null || true
compose up -d --wait db
echo "[restaurar] Base de datos"
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < "$src/db.dump"
echo "[restaurar] Archivos"
compose run --rm --no-deps -T --entrypoint sh api -c 'find /app/storage -mindepth 1 -delete && tar xzf - -C /app/storage' < "$src/storage.tgz"
echo "[restaurar] Levantando el stack (migrate aplica lo que falte)"
compose up -d --wait --wait-timeout 300
echo "[restaurar] Listo: el stack está arriba y sano."
