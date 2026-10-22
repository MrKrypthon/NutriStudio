#!/bin/sh
# Despliegue en el servidor (fase 115), desde la carpeta del repositorio:
#   deploy/deploy.sh                 trae origin/main y despliega
#   deploy/deploy.sh <commit|tag>    despliega esa versión (también sirve para volver a una anterior)
#
# 1. Respaldo local de la base y los archivos (si el stack ya corría).
# 2. Cambia el código a la versión pedida.
# 3. Construye las imágenes y levanta el stack: `migrate` aplica las migraciones antes de la API.
# 4. Verifica con deploy/smoke.sh contra el dominio.
# Si algo falla, dice cómo volver a la versión anterior.
set -eu

cd "$(dirname "$0")/.."
env_file="${MILPA_ENV_FILE:-.env.docker}"
[ -f "$env_file" ] || { echo "[deploy] Falta $env_file (copia .env.docker.example y llénalo)." >&2; exit 1; }
export MILPA_ENV_FILE="$env_file"
compose() { docker compose --env-file "$env_file" -f docker-compose.app.yml -f docker-compose.prod.yml "$@"; }
domain="$(sed -n 's/^MILPA_DOMAIN=//p' "$env_file" | tail -n 1)"
[ -n "$domain" ] || { echo "[deploy] Falta MILPA_DOMAIN en $env_file." >&2; exit 1; }
if [ "$(sed -n 's/^MILPA_CADDY_SITES=//p' "$env_file" | tail -n 1)" = dev ]; then
  for var in MILPA_DEV_DOMAIN MILPA_DEV_BASIC_USER MILPA_DEV_BASIC_HASH; do
    grep -q "^$var=." "$env_file" || { echo "[deploy] MILPA_CADDY_SITES=dev necesita $var en $env_file." >&2; exit 1; }
  done
fi

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "[deploy] Hay cambios sin commit en el servidor; no se despliega encima de ellos." >&2; exit 1; }

previous="$(git rev-parse HEAD)"
git fetch --quiet --tags origin
target="${1:-origin/main}"
target_commit="$(git rev-parse --verify "$target^{commit}")"

if [ -n "$(compose ps --status running --quiet db 2>/dev/null)" ]; then
  echo "[deploy] Respaldo antes de desplegar"
  deploy/backup.sh respaldos/antes-de-desplegar
  # Se quedan los 5 respaldos más recientes de esta carpeta.
  ls -1d respaldos/antes-de-desplegar/milpa-* 2>/dev/null | head -n -5 | xargs -r rm -rf
fi

echo "[deploy] $(git rev-parse --short "$previous") → $(git rev-parse --short "$target_commit")"
git log --oneline "$previous..$target_commit" | head -n 20
git checkout --quiet --detach "$target_commit"

rollback_hint() {
  echo "[deploy] Algo falló. Para volver a la versión anterior: deploy/deploy.sh $previous" >&2
  echo "[deploy] Si una migración dejó la base mal, restaura el respaldo de respaldos/antes-de-desplegar con deploy/restore.sh." >&2
}
trap 'rollback_hint' EXIT

compose build --pull
compose up -d --remove-orphans --wait --wait-timeout 300
sh deploy/smoke.sh "${MILPA_SMOKE_URL:-https://$domain}"

trap - EXIT
docker image prune -f >/dev/null
echo "[deploy] Listo: $(git rev-parse --short HEAD) en https://$domain"
