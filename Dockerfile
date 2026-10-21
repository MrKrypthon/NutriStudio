# Imagen de la API (Fastify + Prisma), fase 113. La usan dos servicios de docker-compose.app.yml:
# `migrate` (prisma migrate deploy, una vez) y `api`. Las dependencias se instalan y Prisma se genera
# AQUÍ: los binarios nativos de la máquina de desarrollo no sirven en el contenedor.
FROM node:24-bookworm-slim

# openssl: el motor de Prisma para Debian (debian-openssl-3.0.x) lo necesita.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero, para que la capa se reutilice mientras el lockfile no cambie. Se instalan
# todas (también las de desarrollo): `migrate` usa la CLI de Prisma, que es devDependency.
COPY package.json package-lock.json ./
COPY tools/copy-ocr-assets.mjs tools/
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

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
