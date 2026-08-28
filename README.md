# Nutri Studio

Prototipo web y base técnica para software de práctica nutricional.

## Desarrollo de la interfaz

```bash
npm install
npm run dev
```

Este comando ejecuta la interfaz en modo demo y no intenta conectarse al API. Por eso no debe mostrar errores de proxy.

## API y base de datos local

Requiere Docker para PostgreSQL:

```bash
cp .env.example .env
docker compose up -d postgres
npm run db:push
npm run db:seed
npm run api
```

La API queda disponible en `http://localhost:3001`. El frontend utiliza `/api/v1` por defecto y puede cambiarse con `VITE_API_URL`.

Para levantar frontend y API simultáneamente:

```bash
npm run dev:all
```

Este comando define automáticamente `VITE_API_URL=http://localhost:3001` para conectar la interfaz con el API.

Si aparece `ECONNREFUSED`, el frontend no encuentra el API en `localhost:3001`. Ejecuta `npm run dev:all` o levanta `npm run api` en otra terminal. Si el API responde con errores de base de datos, verifica `docker compose ps`.

## Rutas de prueba

- `GET http://localhost:3001/health`
- `GET http://localhost:3001/api/v1/patients`
- `GET http://localhost:3001/api/v1/appointments?from=2026-08-24&to=2026-08-30`
- `GET http://localhost:3001/api/v1/dashboard/today?date=2026-08-26`
- `GET http://localhost:3001/api/v1/food/search?q=avocado&source=usda`

En desarrollo, las rutas que dependen de práctica usan el valor de `DEFAULT_PRACTICE_ID` o el header `x-practice-id`.

## Documentación

- `ARQUITECTURA.md`: visión de producto y arquitectura.
- `REQUERIMIENTOS_Y_MAPA.md`: módulos, requisitos y roadmap.
- `ESPECIFICACIONES_TECNICAS.md`: contratos, reglas, seguridad y definición de terminado.
- `API_ALIMENTOS_Y_RECETAS.md`: investigación de Avena y alternativas de alimentos/recetas.
- `prisma/schema.prisma`: modelo persistente.
