# Guías 3D de los pliegues cutáneos

Genera las animaciones (`src/assets/mediciones/*.webp`) que acompañan a cada pliegue en el módulo
antropométrico del expediente. Cada guía muestra, en bucle: el sitio marcado sobre la piel con la
dirección del pliegue, los dedos del evaluador tomando el pliegue, y el plicómetro aplicándose
perpendicular a él.

## Requisitos

- Blender 5.x (`blender --version`)
- ImageMagick con soporte WebP (`magick -list format | grep WEBP`)

## Regenerar

```bash
cd tools/mediciones-3d

# una sola medición, imagen fija (para encuadrar rápido)
blender --background --python render_site.py -- tricipital-mm --still --out /tmp/guias

# animación de una medición (48 cuadros PNG)
blender --background --python render_site.py -- tricipital-mm --out /tmp/guias

# todas
for slug in subescapular-mm tricipital-mm bicipital-mm cresta-iliaca-mm supraespinal-mm \
            abdominal-mm muslo-frontal-mm pantorrilla-medial-mm axilar-medial-mm pectoral-mm; do
  blender --background --python render_site.py -- "$slug" --out /tmp/guias
done

# PNG -> WebP animado (24 cuadros, 260 px): se toma uno de cada dos para bajar el peso
for d in /tmp/guias/*/; do
  slug=$(basename "$d")
  (cd "$d" && magick -delay 16 -loop 0 $(ls f_*.png | awk 'NR%2==1') \
      -resize 260x260 -quality 58 "../../$slug.webp")
done
```

El nombre del archivo sale del `slug` de cada sitio, que a su vez corresponde a la clave del campo
en `src/components/Anthropometry.jsx` (`'Tricipital (mm)'` → `tricipital-mm.webp`). Si se agrega un
pliegue nuevo hay que darlo de alta en `sites.py` con el mismo slug.

## Cómo está armado

- **`body.py`** — cuerpo base con metaballs. Dos constantes importan: el radio de cada metaball
  rinde ~0.55 de su valor (`BLEND`) y las esferas sólo se funden si su separación es menor que su
  radio, por eso las extremidades se interpolan con paso corto. Acepta `right_arm_abduction` para
  los sitios de la línea axilar, donde el protocolo pide abducir el brazo derecho.
- **`sites.py`** — la especificación clínica de los 10 pliegues: punto anatómico, dirección del
  pliegue (0° vertical, 45° oblicuo, 90° horizontal), abducción del brazo, encuadre y descripción.
  Las fuentes son ISAK (Esparza-Ros et al.) y Lohman et al., resumidas en la revisión
  "Skinfolds Measurement Protocols and Standards" (PMC13276579).
- **`guide.py`** — la escena: marca del sitio, pliegue levantado, dedos y plicómetro. El tamaño de
  cada pieza se hornea en la malla y no en la escala del objeto, porque la animación anima `scale`
  y un keyframe sobre una escala "con tamaño" la sobreescribe (el pliegue terminaba midiendo un
  metro).
- **`render_site.py`** — coloca el sitio con un rayo contra la piel (obtiene punto y normal reales),
  arma el marco del pliegue, anima el ciclo y renderiza. La cámara orbita partiendo de la normal
  del sitio y girando sobre el eje transversal, para que el plicómetro se vea de perfil y no en
  escorzo.

## El ciclo de la animación

| Cuadros | Qué pasa |
|---|---|
| 1–8 | Sitio marcado, piel lisa |
| 9–18 | Los dedos toman y levantan el pliegue |
| 19–26 | El plicómetro baja y cierra sus puntas a 1 cm de los dedos |
| 27–38 | Lectura (se mantiene ~2 s, como pide el protocolo) |
| 39–48 | Abre, se retira y el pliegue baja → vuelve al inicio |
