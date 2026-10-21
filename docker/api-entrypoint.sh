#!/bin/sh
# Entrada de la imagen de la API (fase 113). Prepara las carpetas de storage en el volumen y copia las
# fotos base del recetario que falten, sin pisar ningún archivo existente.
set -e

for dir in documents logos recipes ingredients lab-attachments education-materials; do
  mkdir -p "/app/storage/$dir"
done

if [ -d /app/seed/recipes ]; then
  copied=0
  for source in /app/seed/recipes/*; do
    [ -f "$source" ] || continue
    target="/app/storage/recipes/$(basename "$source")"
    if [ ! -e "$target" ]; then
      cp "$source" "$target"
      copied=$((copied + 1))
    fi
  done
  [ "$copied" -gt 0 ] && echo "[entrypoint] $copied fotos base del recetario copiadas al volumen"
fi

exec "$@"
