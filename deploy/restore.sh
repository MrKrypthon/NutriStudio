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
compose() { docker compose -p "$project" -f docker-compose.app.yml "$@"; }

(cd "$src" && sha256sum -c SHA256SUMS) || { echo "[restaurar] Las sumas no coinciden; no se tocó nada." >&2; exit 1; }

echo "[restaurar] Deteniendo la API y el frontend de $project"
compose stop web api 2>/dev/null || true
compose up -d --wait db
echo "[restaurar] Base de datos"
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < "$src/db.dump"
echo "[restaurar] Archivos"
compose run --rm --no-deps -T --entrypoint sh api -c 'find /app/storage -mindepth 1 -delete && tar xzf - -C /app/storage' < "$src/storage.tgz"
echo "[restaurar] Levantando el stack (migrate aplica lo que falte)"
compose up -d
echo "[restaurar] Listo."
