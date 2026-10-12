# Lectura del libro SMAE (5ª ed.)

El libro "Sistema Mexicano de Alimentos Equivalentes" llega como un PDF escaneado: cada hoja es la
imagen de una tabla y su capa de texto no sirve. Estas dos herramientas lo convierten en
`prisma/data/smae-libro.json`, que es lo que carga `npm run db:import-smae-libro` y muestra el
módulo **Equivalencias**.

```
# 1. Leer las tablas (≈2 min con 10 procesos). El PDF no se versiona.
python3 prisma/tools/smae-libro/extract.py "SMAE 5a ed - ….pdf" /tmp/smae-raw.json --jobs 10

# 2. Conciliar con el catálogo existente y marcar lo dudoso (≈3 min)
python3 prisma/tools/smae-libro/reconcile.py /tmp/smae-raw.json prisma/data/smae.json \
        prisma/data/smae-libro.json --report /tmp/smae-reporte.md

# 3. Cargar a la base (respeta lo corregido a mano en la app)
npm run db:import-smae-libro
```

Requisitos: Python 3 con Pillow y numpy, poppler (`pdftoppm`, `pdfinfo`) y tesseract 5 con los
idiomas `spa` y `eng`. Si `spa` no está instalado, descarga `spa.traineddata` y `eng.traineddata`
de <https://github.com/tesseract-ocr/tessdata_best> a una carpeta y apunta `TESSDATA_PREFIX` a ella.

## Cómo lee

1. Cada hoja se convierte a imagen a 300 dpi y, si está inclinada, se endereza.
2. La tabla se localiza ajustando una plantilla de sus 26 líneas de columna (todas las hojas tienen
   la misma tabla); los renglones salen de la tinta de las columnas numéricas.
3. Cada celda se recorta y se lee por separado. Los números se leen **dos veces**, con distinta
   preparación de la imagen.
4. `reconcile.py` compara las dos lecturas y el catálogo que ya tenía la app. Una celda se da por
   buena cuando coinciden al menos dos de los tres; si no, queda en `review` con el motivo y las
   lecturas alternativas, para resolverla en la app contra el libro impreso.

En la última corrida: 176 tablas, 2,855 alimentos, 65,665 celdas; 99.1 % confirmadas por al menos
dos testigos y 527 alimentos con algún dato por revisar.

## Lo que no hace

- No lee las hojas 12–14 (tablas de la introducción, con otro formato).
- "ND" (no determinado) se guarda como nulo; una celda en blanco en el libro también.
- Los nombres se corrigen con la grafía del catálogo cuando casan de cerca; los que no tienen par
  (p. ej. las bebidas alcohólicas nuevas de esta edición) quedan como se leyeron.
