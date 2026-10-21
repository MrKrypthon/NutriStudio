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
compose() { docker compose -p "$project" -f docker-compose.app.yml "$@"; }

umask 077
mkdir -p "$dest"
echo "[respaldo] Base de datos → $dest/db.dump"
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$dest/db.dump"
echo "[respaldo] Archivos → $dest/storage.tgz"
compose run --rm --no-deps -T --entrypoint tar api czf - -C /app/storage . > "$dest/storage.tgz"
(cd "$dest" && sha256sum db.dump storage.tgz > SHA256SUMS)
echo "[respaldo] Listo: $(du -sh "$dest" | cut -f1) en $dest"
