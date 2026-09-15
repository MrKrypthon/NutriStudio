# Nutri Studio

Prototipo web y base técnica para software de práctica nutricional.

## Desarrollo de la interfaz

```bash
npm install
npm run dev
```

Este comando ejecuta la interfaz en modo demo y no intenta conectarse al API. Por eso no debe mostrar errores de proxy.

## Poner todo en marcha en otro dispositivo

Requisitos: Node 20+, Git, Docker (para PostgreSQL).

```bash
git clone https://github.com/MrKrypthon/NutriStudio.git
cd NutriStudio
git checkout main          # o la rama de la fase mientras el PR no esté fusionado
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:setup           # push + seed + SMAE + base + recetas propias + recetario + cálculo SMAE
npm run dev:all            # API en :3001 y web en :5173
```

`db:setup` reconstruye toda la base desde cero con datos versionados en el repo:
`prisma/data/smae.json`, `prisma/data/base-alimentos.json` y `prisma/data/recetario.json`
(más las 501 fotos en `storage/recipes/`). No hace falta el PDF original ni el Excel.

### Alternativa: copiar la base tal cual (sin reimportar)

Si quieres exactamente la misma base (incluye ediciones manuales y `calculatedNutrition` ya
calculado), exporta/importa un respaldo de PostgreSQL:

```bash
# En el dispositivo origen
docker compose exec -T postgres pg_dump -U nutri -d nutri_studio > respaldo.sql

# En el dispositivo destino (misma versión del esquema; cópiale respaldo.sql)
docker compose up -d postgres
cat respaldo.sql | docker compose exec -T postgres psql -U nutri -d nutri_studio
```

`npm run db:setup` es más reproducible y ligero; el respaldo es más fiel pero acopla la versión
del esquema.

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

### Recetario `500 Recetas Cero - México`

El catálogo del libro se extrae del PDF y se importa a la base de datos:

```bash
npm run recetario:extract      # PDF -> prisma/data/recetario.json + storage/recipes/*.jpg
npm run db:import-recetario    # JSON -> tabla Recipe (requiere db:seed previo)
```

`recetario:extract` requiere `poppler-utils` (`pdftotext`, `pdfimages`) e ImageMagick (`convert`). Las recetas importadas guardan ingredientes en texto libre, tiempo de preparación, foto y macros por porción; al ajustar las porciones en la vista de recetas se escalan macros e ingredientes. Re-ejecutar `db:import-recetario` es idempotente (actualiza por nombre + tiempo de comida) y acepta `--reset` para reemplazarlas.

#### Cálculo SMAE automático (contraste)

Cada receta del recetario puede contrastar los macros originales del PDF con un cálculo hecho a partir del catálogo:

```bash
npm run recetario:link     # reporte de cobertura (no escribe nada)
npm run db:link-smae       # vincula ingredientes y calcula calculatedNutrition
```

El vinculador (`prisma/tools/link-smae.js`) empareja el texto libre con el catálogo SMAE exacto y, cuando falta un alimento, lo crea en el grupo **"Aproximados Menu 500"** con valores de referencia por 100 g (`prisma/tools/recetarioFoods.js`). Los macros originales del PDF (`nutrition`) nunca se modifican: el cálculo queda en `Recipe.calculatedNutrition` y se muestra en la ficha de la receta como "Calculado según SMAE + aprox.". Es una aproximación para contraste, no un dato de laboratorio, y las líneas sin cantidad ("al gusto") no se cuantifican.



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
