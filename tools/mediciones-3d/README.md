# Guías 3D del módulo antropométrico

Genera las animaciones (`src/assets/mediciones/*.webp`) que acompañan a cada medición del módulo
antropométrico del expediente: 10 pliegues, 14 perímetros y 12 diámetros. Cada guía muestra, en
bucle, el sitio marcado sobre la piel, las manos del evaluador ejecutando el movimiento y el
instrumento que corresponde (plicómetro, cinta métrica o antropómetro).

## Requisitos

- Blender 5.x (`blender --version`)
- ImageMagick con soporte WebP (`magick -list format | grep WEBP`)

## Regenerar

```bash
cd tools/mediciones-3d

# imagen fija de una medición (lo práctico para encuadrar)
blender --background --python render_site.py  -- tricipital-mm --still --out /tmp/guias   # pliegues
blender --background --python render_girth.py -- cintura-cm    --still --out /tmp/guias   # perímetros/diámetros

# animación (48 cuadros PNG)
blender --background --python render_girth.py -- cintura-cm --out /tmp/guias

# todas
PLIEGUES=$(python3 -c "import re;print(' '.join(re.findall(r\"'slug': '([^']+)'\", open('sites.py').read())))")
OTRAS=$(python3 -c "import re;print(' '.join(re.findall(r\"'slug': '([^']+)'\", open('sites_girth.py').read())))")
for s in $PLIEGUES; do blender -b -P render_site.py  -- "$s" --out /tmp/guias; done
for s in $OTRAS;    do blender -b -P render_girth.py -- "$s" --out /tmp/guias; done

# PNG -> WebP animado (24 cuadros, 260 px): se toma uno de cada dos para bajar el peso
for d in /tmp/guias/*/; do
  slug=$(basename "$d")
  (cd "$d" && magick -delay 16 -loop 0 $(ls f_*.png | awk 'NR%2==1') \
      -resize 260x260 -quality 58 "../../$slug.webp")
done
```

El nombre del archivo sale del `slug` de cada sitio, que a su vez corresponde a la clave del campo
en `src/components/Anthropometry.jsx` (`'Tricipital (mm)'` → `tricipital-mm.webp`). Si se agrega
una medición hay que darla de alta en `sites.py` o en `sites_girth.py` con el mismo slug.

## Cómo está armado

- **`body.py`** — cuerpo base con metaballs. Dos constantes importan: el radio de cada metaball
  rinde ~0.55 de su valor (`BLEND`) y las esferas sólo se funden si su separación es menor que su
  radio, por eso las extremidades se interpolan con paso corto. `right_arm_abduction` mueve el
  brazo derecho: en positivo lo cruza sobre el pecho (deja libre la línea axilar, como piden los
  pliegues del tronco) y en negativo lo separa del costado (deja sitio al paquímetro en el codo o
  la muñeca). `right_arm_point` / `right_arm_vector` aplican esa misma rotación a un punto o a una
  dirección escritos sobre el cuerpo en reposo.
- **`hand.py`** — mano del evaluador. Va con mallas normales y no con metaballs porque, a los
  radios que necesita un dedo, los vecinos se funden y la mano sale como un mitón. Tiene dos poses:
  pinza (pulgar e índice, para los pliegues) y garra (`grip=True`, para empuñar cinta y
  antropómetro). El pulgar es un objeto aparte con el origen en el nudillo, para poder abrir y
  cerrar la pinza girándolo sin rehacer la malla en cada cuadro.
- **`sites.py`** — los 10 pliegues: punto anatómico, dirección del pliegue (0° vertical, 45°
  oblicuo, 90° horizontal), abducción del brazo, encuadre y descripción.
- **`sites_girth.py`** — los 14 perímetros (`kind='girth'`: nivel, eje del segmento y `max_radius`
  de búsqueda) y los 12 diámetros (`kind='breadth'`: los dos accidentes óseos con su rayo, y el
  lado desde el que se aplica el instrumento).
- **`guide.py`** — las piezas de la escena: marca del sitio, pliegue levantado, plicómetro, cinta
  ceñida al contorno real y antropómetro. El tamaño de cada pieza se hornea en la malla y no en la
  escala del objeto, porque la animación anima `scale` y un keyframe sobre una escala "con tamaño"
  la sobreescribe (el pliegue terminaba midiendo un metro).
- **`render_site.py`** / **`render_girth.py`** — colocan el sitio con rayos contra la piel, animan
  el ciclo y renderizan.

Las fuentes clínicas son ISAK (Esparza-Ros et al.) y Lohman et al., resumidas en la revisión
"Skinfolds Measurement Protocols and Standards" (PMC13276579).

## Decisiones que no son obvias

- **La cinta no es un círculo.** `ring_points` lanza un rayo por cada ángulo y toma el impacto en
  la piel, así que la cinta sigue la silueta verdadera. `max_radius` acota desde dónde se lanza:
  en una extremidad hay que dejarlo corto (~0.10 m) o los rayos que apuntan hacia adentro pasan de
  largo el brazo y enganchan el tronco.
- **`reach` en los diámetros.** Mismo problema al buscar un accidente óseo: desde lejos, el rayo
  dirigido a la cara interna del codo se cuela por el hueco entre el brazo y el tronco y acaba
  impactando en el torso. Los sitios de extremidad lo bajan a ~0.09 m.
- **La cámara no usa una restricción TRACK_TO.** Con TRACK_TO el "arriba" lo decide el eje Z del
  mundo y, al orbitar alrededor de un eje horizontal, la imagen sale inclinada: la barra del
  antropómetro aparecía en diagonal. `aim_camera` fija el eje de la medición como horizontal de la
  imagen, que es como se ve en cualquier manual.
- **Dos tamaños de antropómetro.** Los diámetros grandes (biacromial, biileocrestal, tórax) usan la
  barra larga; los pequeños (codo, muñeca, rodilla, tobillo, mano, pie) usan un paquímetro con las
  ramas y la barra reducidas, porque si no el instrumento tapa la articulación entera.

## El ciclo de la animación

48 cuadros a 12 fps (4 s en bucle).

| Cuadros | Pliegue | Perímetro | Diámetro |
|---|---|---|---|
| 1–8 | sitio marcado, piel lisa | la cinta llega floja | las ramas abiertas, el instrumento fuera |
| 9–18 | las manos toman y levantan el pliegue | la cinta se ciñe | el instrumento se acerca |
| 19–26 | el plicómetro baja y cierra a 1 cm de los dedos | — | las ramas cierran sobre los puntos óseos |
| 27–38 | lectura (se mantiene ~2 s, como pide el protocolo) | lectura | lectura |
| 39–48 | abre, se retira y el pliegue baja → vuelve al inicio | la cinta se afloja | las ramas abren y el instrumento se retira |
