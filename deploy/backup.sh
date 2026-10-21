#!/bin/sh
# Respaldo del stack de docker-compose.app.yml (fase 113): la base (pg_dump en formato custom) y el
# volumen de storage (documentos, estudios, logos, fotos), con sus sumas SHA-256.
#   deploy/backup.sh [carpeta-destino]          (por defecto ./respaldos)
# Variables: MILPA_PROJECT (proyecto de compose, por defecto milpa) y MILPA_ENV_FILE.
# Los respaldos llevan datos clínicos: guárdalos cifrados y fuera del servidor.
set -eu

cd "$(dirname "$0")/.."
project="${MILPA_PROJECT:-milpa}"
dest="${1:-respaldos}/milpa-$(date -u +%Y%m%d-%H%M%S)"
# Con MILPA_DOMAIN en el archivo de variables es el stack de producción (Caddy delante, fase 115):
# se usan los dos archivos de compose, para no recrear Nginx sin Caddy.
env_file="${MILPA_ENV_FILE:-.env.docker}"
if [ -f "$env_file" ] && grep -q '^MILPA_DOMAIN=.' "$env_file"; then
  compose() { docker compose -p "$project" --env-file "$env_file" -f docker-compose.app.yml -f docker-compose.prod.yml "$@"; }
else
  compose() { docker compose -p "$project" -f docker-compose.app.yml "$@"; }
fi

umask 077
mkdir -p "$dest"
echo "[respaldo] Base de datos → $dest/db.dump"
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$dest/db.dump"
echo "[respaldo] Archivos → $dest/storage.tgz"
compose run --rm --no-deps -T --entrypoint tar api czf - -C /app/storage . > "$dest/storage.tgz"
(cd "$dest" && sha256sum db.dump storage.tgz > SHA256SUMS)
echo "[respaldo] Listo: $(du -sh "$dest" | cut -f1) en $dest"
