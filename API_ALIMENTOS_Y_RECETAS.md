# Investigación: APIs de alimentos y recetas

Investigación realizada para decidir cómo alimentar el catálogo de Nutri Studio. Fecha de revisión: 26 de agosto de 2026.

## Resumen ejecutivo

No se encontró una API pública, documentación de desarrolladores, OpenAPI ni programa de acceso para el catálogo interno de recetas de **Avena Health**. `avena.io` presenta el catálogo como una característica de su producto comercial, pero el panel está protegido y `panel.avena.io/openapi.json` devuelve 404. Sus `robots.txt` también excluyen el panel y subdominios privados.

No debemos copiar, raspar ni depender de endpoints internos de Avena. Además de ser técnicamente frágil, podría incumplir sus términos de servicio y derechos sobre contenido, imágenes y recetas.

### Recomendación

Usar una arquitectura híbrida:

```text
USDA FoodData Central / Open Food Facts
              ↓ nutrientes base
       Normalizador Nutri Studio
              ↓
Catálogo propio de ingredientes + SMAE/equivalencias licenciadas
              ↓
       Recetas propias y planes versionados
```

La fuente externa no debe aparecer directamente en la consulta clínica. Se importa, normaliza, valida y conserva la atribución/licencia correspondiente.

## Comparativa

| Fuente | Tipo | Gratis | Nutrición | Recetas e imágenes | Licencia/limitaciones | Recomendación |
|---|---|---:|---|---|---|---|
| Avena Health | Software cerrado | No pública | Alta dentro de su producto | Sí, catálogo propietario | Sin API pública encontrada; no raspar | No integrar |
| USDA FoodData Central | Alimentos e ingredientes | Sí | Muy alta | No es un recetario | Datos CC0; requiere API key; 1,000 req/h por IP | Fuente principal de nutrientes |
| Open Food Facts | Productos empaquetados | Sí | Variable | Imágenes de productos, no recetas clínicas | ODbL/DBCL; imágenes CC BY-SA; 10 búsquedas/min y 15 lecturas/min | Complemento para productos y etiquetas |
| TheMealDB | Recetas | Sí para desarrollo | No suficiente para clínica | Sí, imágenes y preparación | API siempre gratis; key `1` para pruebas; supporter para publicar apps y catálogo completo | Prototipo/inspiración, no fuente clínica principal |
| Edamam | Recetas y análisis NLP | No para producción | Alta | Sí, pero términos restrictivos | Planes desde USD 9/mes; atribución; restricciones de caché y contenido | No para MVP gratuito |
| Spoonacular | Recetas, nutrientes y meal planning | Cuota gratuita limitada | Alta | Sí | Requiere key y cuota; revisar licencia comercial | Evaluación posterior |

## 1. Avena Health

### Hallazgos

- El sitio público promociona más de 30,000 recetas y plantillas como parte de sus planes.
- El panel de especialistas requiere autenticación.
- No se encontró documentación pública de API, portal de developers, API key pública, webhook u OpenAPI.
- El contenido de recetas, imágenes, plantillas y equivalentes debe tratarse como propiedad/control de Avena hasta obtener autorización escrita.

### Decisión

**No consumir Avena directamente.** Si en el futuro se busca colaboración, solicitar formalmente:

- Acceso a API y documentación.
- Permisos de uso comercial y sublicencia.
- Derechos de almacenar nutrientes, recetas e imágenes.
- Límites, SLA, costos y atribución.
- Política de exportación y eliminación de datos.

## 2. USDA FoodData Central

Documentación: <https://fdc.nal.usda.gov/api-guide.html>

### Ventajas

- Datos en dominio público bajo CC0 1.0.
- Incluye Foundation Foods, SR Legacy, FNDDS y alimentos de marca.
- Tiene búsqueda, detalle por `fdcId`, nutrientes, unidades y porciones.
- Límite documentado de 1,000 solicitudes por hora por IP.
- Es apropiada como base de ingredientes, no como catálogo de recetas terminadas.

### Requisitos

- Solicitar una API key en FoodData Central.
- No colocar la key en React; usar el backend como proxy.
- Guardar `fdcId`, `dataType`, fecha de importación y versión del dataset.
- Mostrar atribución recomendada: USDA ARS, FoodData Central.
- Implementar caché interno respetando la política vigente y actualizar por lotes.

### Integración propuesta

```http
GET https://api.nal.usda.gov/fdc/v1/foods/search
  ?api_key=SERVER_SECRET
  &query=avocado
  &dataType=Foundation,SR%20Legacy
```

El backend debe transformar la respuesta a nuestro modelo `Ingredient`: kcal, proteína, carbohidratos, grasa, fibra, micronutrientes, unidad y fuente.

## 3. Open Food Facts

Documentación: <https://openfoodfacts.github.io/openfoodfacts-server/api/>

### Ventajas

- API de lectura sin autenticación, usando un User-Agent identificable.
- API v3.6 actual; v2 está deprecada.
- Ingredientes, alérgenos, etiquetas, productos de marca e imágenes.
- Útil para escanear productos reales que el paciente consume.

### Riesgos

- La información es colaborativa y puede estar incompleta o ser incorrecta.
- No es equivalente a una base profesional de composición de alimentos.
- Límite documentado: 10 búsquedas/min/IP y 15 lecturas/min/IP.
- ODbL/DBCL implica obligaciones de atribución, avisos y condiciones al combinar datos.
- Las imágenes tienen licencia CC BY-SA y requisitos de atribución/compartir igual.

### Uso recomendado

Usarlo como módulo complementario de `Producto escaneado`, no como única fuente para calcular planes. Aplicar validación profesional y guardar la fuente exacta del dato.

## 4. TheMealDB

Documentación: <https://www.themealdb.com/api.php>

### Ventajas

- API sencilla para buscar por nombre, ingrediente, categoría y área.
- Incluye instrucciones, ingredientes y thumbnails.
- El key de prueba `1` permite desarrollo educativo.
- El API y el sitio indican que permanecen gratuitos en el punto de acceso.

### Limitaciones

- No tiene la profundidad de micronutrientes requerida por el PDF.
- La cobertura está orientada a recetas generales, no al sistema mexicano de equivalentes.
- Para publicar en App Store o usar catálogo completo/crear contenido propio se solicita convertirse en supporter.
- No debe asumirse libertad para copiar imágenes o contenido sin atribución.

### Uso recomendado

Sólo como fuente de inspiración o fallback de demostración. No asignar automáticamente estas recetas a un plan clínico sin normalizar ingredientes y revisar nutrición.

## 5. Edamam

Documentación: <https://developer.edamam.com/edamam-recipe-api> y <https://developer.edamam.com/edamam-docs-nutrition-api>

### Ventajas

- Búsqueda por dieta, alergias, nutrientes, cuisine, meal y dish type.
- Nutrition Analysis API con extracción NLP de ingredientes y cálculo nutricional.
- Buena capacidad de filtrado para un selector de recetas.

### Limitaciones

- No es gratis para producción; Recipe Search API muestra planes desde USD 9/mes.
- Requiere atribución.
- Las recetas web de terceros no incluyen necesariamente instrucciones y requieren enlace/atribución.
- Los términos limitan la caché; no permite construir libremente una copia del catálogo.
- El análisis de nuevas recetas puede implicar cargos/licenciamiento.

### Decisión

No usar en el MVP gratuito. Podría evaluarse como proveedor opcional cuando haya presupuesto y revisión contractual.

## 6. Spoonacular

Documentación: <https://spoonacular.com/food-api/docs>

### Capacidades

- Búsqueda compleja.
- Búsqueda por ingredientes y nutrientes.
- Información de receta, instrucciones, imágenes y nutrición.
- Sustitutos de ingredientes.
- Meal planner y lista de compras.

### Limitaciones

- Requiere API key.
- Opera por puntos/cuota, no como servicio ilimitado gratuito.
- Hay que revisar el plan y términos comerciales antes de almacenar o redistribuir contenido.

### Decisión

Buena opción para un piloto técnico de filtros, pero no la fuente base del producto si el objetivo es costo cero y control de datos.

## 7. Arquitectura de integración recomendada

### Fase A: MVP sin dependencia externa fuerte

- Crear 100–200 ingredientes propios con datos verificados.
- Crear 30–50 recetas propias con fotos licenciadas o propias.
- Modelar equivalentes y porciones como datos internos versionados.
- Importar USDA por backend para completar nutrientes.
- Registrar fuente, fecha y confianza de cada ingrediente.

### Fase B: importación asistida

- Buscar USDA/Open Food Facts desde un modal interno.
- Mostrar fuente y advertencia de validación.
- Permitir que la nutrióloga revise nombre, unidad, porción y grupo.
- Sólo después de confirmar, crear el ingrediente local.

### Fase C: proveedor externo opcional

```text
FoodProvider interface
├── UsdaProvider
├── OpenFoodFactsProvider
├── TheMealDbProvider
└── OptionalEdamamProvider
```

Todos los proveedores deben devolver el mismo DTO:

```ts
type FoodSearchResult = {
  externalId: string
  source: 'usda' | 'open_food_facts' | 'themealdb' | 'edamam'
  name: string
  serving?: { quantity: number; unit: string; grams?: number }
  nutrition: Record<string, number>
  allergens: string[]
  imageUrl?: string
  attribution?: string
  confidence: 'high' | 'medium' | 'low'
}
```

### Fase D: caché y límites

- El frontend nunca llama directamente a proveedores con keys.
- El backend limita búsquedas por usuario y aplica debounce de 400 ms.
- Cachear sólo resultados normalizados permitidos por la licencia.
- Ejecutar importaciones masivas como job, nunca desde una búsqueda de usuario.
- Registrar proveedor, respuesta resumida, fecha y versión.

## 8. Compatibilidad con SMAE y México

USDA y Open Food Facts no sustituyen automáticamente al **Sistema Mexicano de Alimentos Equivalentes (SMAE)**. Para la aplicación:

- No afirmar equivalencias clínicas sólo por similitud nutricional.
- Definir `Equivalence` como una capa propia revisada por nutriólogo.
- Verificar licencia o autorización para cualquier tabla SMAE que se cargue.
- Guardar grupo, subgrupo, porción, unidad doméstica y gramos.
- Permitir equivalencias personalizadas por práctica.
- Versionar cambios para que los planes publicados no se alteren.

## 9. Decisión final para Nutri Studio

### Selección

1. **USDA FoodData Central** como base nutricional de ingredientes.
2. **Open Food Facts** como complemento de productos empaquetados y lectura de etiquetas.
3. **Catálogo propio** para recetas, imágenes, preparación, equivalencias y planes clínicos.
4. **TheMealDB** sólo para demo/inspiración con atribución.
5. **Edamam/Spoonacular** como opciones futuras de pago o piloto, no dependencias del MVP.

### No hacer

- No raspar Avena.
- No copiar su catálogo de recetas, fotos o plantillas.
- No guardar una respuesta externa sin conservar origen y licencia.
- No usar una API general como sustituto de revisión clínica.
- No exponer API keys en el navegador.

## 10. Próxima implementación

1. Crear `FoodProvider` en el backend.
2. Añadir `USDA_API_KEY` al entorno del servidor.
3. Implementar `GET /api/v1/food/search` y `GET /api/v1/food/:source/:id`.
4. Crear modal de importación en Ingredientes.
5. Normalizar y confirmar antes de guardar.
6. Agregar atribución en la vista de ingrediente y documento técnico.
7. Sembrar recetas propias alineadas con desayuno, comida, colación, cena y pre/post-entreno.

## 11. Estado de implementación

La primera integración ya está disponible en el proyecto:

- Proveedores backend en `server/providers/food.js`.
- Endpoint normalizado `GET /api/v1/food/search`.
- Cliente frontend `foodApi.search()`.
- Pantalla `Importar alimentos` con fuente, porción, calorías, macros, imagen y confianza.
- USDA usa `USDA_API_KEY` y cae en `DEMO_KEY` si no se configura una key propia.
- Open Food Facts usa un User-Agent identificable y limita resultados por solicitud.
- Ningún resultado externo se guarda automáticamente: requiere revisión profesional.
