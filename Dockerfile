# Imagen de la API (Fastify + Prisma), fase 113. La usan dos servicios de docker-compose.app.yml:
# `migrate` (prisma migrate deploy, una vez) y `api`. Las dependencias se instalan y Prisma se genera
# AQUÍ: los binarios nativos de la máquina de desarrollo no sirven en el contenedor.
FROM node:24-bookworm-slim

# openssl: el motor de Prisma para Debian (debian-openssl-3.0.x) lo necesita.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero, para que la capa se reutilice mientras el lockfile no cambie. Sólo las de
# producción (fase 114): lo del frontend (React, Vite, OCR, pdf.js) es devDependency y lo usa
# Dockerfile.web; la CLI de Prisma sí va, porque `migrate` la usa. --ignore-scripts: el único script
# del proyecto copia el OCR, que aquí no existe; Prisma genera el cliente abajo.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY prisma ./prisma
# Descarga los motores de Prisma para Debian y genera el cliente; la caché de la descarga no viaja.
RUN npx prisma generate && rm -rf /root/.cache /root/.npm

COPY server ./server
# La API comparte con el frontend algunas funciones puras de src/lib (líneas de ingredientes, campos
# del paciente).
COPY src/lib ./src/lib
COPY .env.example ./
# Fotos base del recetario (versionadas): el volumen de storage las ocultaría, así que viajan aparte
# y el entrypoint copia al volumen las que falten.
COPY storage/recipes ./seed/recipes
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh

# El volumen con nombre hereda estas carpetas (y su dueño) la primera vez que se monta.
RUN chmod 755 /usr/local/bin/api-entrypoint.sh \
  && mkdir -p storage/documents storage/logos storage/recipes storage/ingredients storage/lab-attachments storage/education-materials \
  && chown -R node:node /app/storage

ENV NODE_ENV=production \
    TZ=UTC \
    PORT=3001
USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "server/index.js"]
