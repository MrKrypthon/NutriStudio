"""Especificación clínica de los 10 pliegues cutáneos del módulo antropométrico.

Cada sitio define:
  point   : punto anatómico aproximado en coordenadas del cuerpo (m)
  ray     : dirección desde la que se "busca" la superficie de la piel (se lanza un rayo hacia el
            cuerpo desde fuera; el impacto da el punto y la normal reales de la malla)
  fold    : orientación del pliegue en el plano de la piel, en grados respecto a la vertical del
            cuerpo (0 = pliegue vertical, 90 = horizontal, 45 = oblicuo hacia abajo y afuera)
  abduction: grados que se abduce el brazo derecho (el protocolo lo pide para los sitios de la
            línea axilar y la cresta ilíaca, que el brazo colgante taparía)
  cam     : (giro°, elevación°, distancia m) de la cámara, medidos DESDE la normal de la piel
            en el sitio (giro alrededor del eje del pliegue), no desde ejes del mundo
  label   : nombre corto
  desc    : descripción del sitio (ubicación + dirección del pliegue) según ISAK / Lohman

Referencias: Esparza-Ros et al. (ISAK, International Standards for Anthropometric Assessment) y
Lohman et al. (Anthropometric Standardization Reference Manual), resumidas en la revisión
"Skinfolds Measurement Protocols and Standards" (PMC13276579).

El lado derecho anatómico es x < 0, que es el lado que marca el protocolo.
"""

SITES = [
    {
        'key': 'Subescapular (mm)',
        'slug': 'subescapular-mm',
        'label': 'Subescapular',
        'point': (-0.078, 0.072, 1.320),
        'ray': (0.15, 1.0, 0.05),
        'fold': 45,
        'cam': (38, 16, 0.6),
        'desc': 'Dos centímetros por debajo del ángulo inferior de la escápula, en dirección oblicua hacia abajo y afuera (45°).',
    },
    {
        'key': 'Tricipital (mm)',
        'slug': 'tricipital-mm',
        'label': 'Tríceps',
        'point': (-0.248, 0.046, 1.285),
        'ray': (-0.30, 1.0, 0.0),
        'fold': 0,
        'cam': (40, 12, 0.46),
        'desc': 'Cara posterior del brazo, en el punto medio entre acromion y olécranon, con el brazo relajado. Pliegue vertical, paralelo al eje del brazo.',
    },
    {
        'key': 'Bicipital (mm)',
        'slug': 'bicipital-mm',
        'label': 'Bíceps',
        'point': (-0.248, -0.046, 1.285),
        'ray': (-0.30, -1.0, 0.0),
        'fold': 0,
        'cam': (40, 12, 0.46),
        'desc': 'Cara anterior del brazo, al mismo nivel que el pliegue tricipital (punto medio acromion–olécranon). Pliegue vertical.',
    },
    {
        'key': 'Cresta ilíaca (mm)',
        'slug': 'cresta-iliaca-mm',
        'abduction': 70,
        'label': 'Cresta ilíaca',
        'point': (-0.138, 0.000, 1.050),
        'ray': (-0.85, -1.0, 0.12),
        'fold': 70,
        'cam': (36, 16, 0.66),
        'desc': 'Sobre la línea axilar media, justo por encima de la cresta ilíaca. Pliegue casi horizontal, ligeramente inclinado hacia abajo y adelante.',
    },
    {
        'key': 'Supraespinal (mm)',
        'slug': 'supraespinal-mm',
        'abduction': 55,
        'label': 'Supraespinal',
        'point': (-0.105, -0.078, 1.100),
        'ray': (-0.55, -1.0, 0.1),
        'fold': 45,
        'cam': (34, 16, 0.6),
        'desc': 'Donde la línea que va del ilioespinal al borde axilar anterior cruza la horizontal de la cresta ilíaca. Pliegue oblicuo hacia abajo y adentro (45°).',
    },
    {
        'key': 'Abdominal (mm)',
        'slug': 'abdominal-mm',
        'label': 'Abdominal',
        'point': (-0.050, -0.100, 1.100),
        'ray': (-0.1, -1.0, 0.0),
        'fold': 0,
        'cam': (34, 14, 0.6),
        'desc': 'Cinco centímetros a la derecha del ombligo (ISAK). Pliegue vertical, paralelo al eje del cuerpo.',
    },
    {
        'key': 'Muslo frontal (mm)',
        'slug': 'muslo-frontal-mm',
        'label': 'Muslo frontal',
        'point': (-0.104, -0.062, 0.745),
        'ray': (-0.1, -1.0, 0.15),
        'fold': 0,
        'cam': (36, 18, 0.6),
        'desc': 'Cara anterior del muslo, a media distancia entre el pliegue inguinal y el borde proximal de la rótula. Pliegue vertical, con la rodilla flexionada a 90°.',
    },
    {
        'key': 'Pantorrilla medial (mm)',
        'slug': 'pantorrilla-medial-mm',
        'label': 'Pantorrilla medial',
        'point': (-0.063, -0.020, 0.355),
        'ray': (1.0, -0.35, 0.0),
        'fold': 0,
        'cam': (38, 14, 0.42),
        'desc': 'Cara medial de la pantorrilla, al nivel de su perímetro máximo. Pliegue vertical, con la rodilla flexionada a 90°.',
    },
    {
        'key': 'Axilar medial (mm)',
        'slug': 'axilar-medial-mm',
        'abduction': 75,
        'label': 'Axilar medial',
        'point': (-0.148, -0.020, 1.270),
        'ray': (-1.0, -0.35, 0.0),
        'fold': 0,
        'cam': (36, 14, 0.62),
        'desc': 'Sobre la línea axilar media, a la altura del apéndice xifoides. Pliegue vertical.',
    },
    {
        'key': 'Pectoral (mm)',
        'slug': 'pectoral-mm',
        'abduction': 45,
        'label': 'Pectoral',
        'point': (-0.118, -0.072, 1.360),
        'ray': (-0.5, -1.0, 0.2),
        'fold': 40,
        'cam': (36, 16, 0.58),
        'desc': 'Un centímetro por debajo del punto más alto del pliegue axilar anterior. Pliegue oblicuo, dirigido hacia el pezón.',
    },
]

SITES_BY_SLUG = {s['slug']: s for s in SITES}
