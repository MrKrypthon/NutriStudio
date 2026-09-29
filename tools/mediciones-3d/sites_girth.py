"""Perímetros y diámetros del módulo antropométrico.

Comparte el mismo modelo que los pliegues (`sites.py`): cada sitio dice dónde está, con qué pose se
mide y cómo encuadrarlo; el renderizador coloca todo con rayos contra la piel, de modo que la cinta
y el antropómetro se apoyan en la superficie real del cuerpo.

Perímetros (`kind='girth'`)
  center      punto sobre el eje del segmento, a la altura donde se mide
  axis        eje del segmento (la cinta queda perpendicular a él)
  max_radius  hasta dónde buscar la piel; corto en extremidades para que el rayo no alcance el
              tronco, amplio en el tronco
Diámetros (`kind='breadth'`)
  point_a/b   los dos accidentes óseos, con su `ray_a`/`ray_b` para encontrarlos sobre la piel
  out         hacia dónde queda la barra del antropómetro (lado desde el que se aplica)

Comunes: `abduction` (grados del brazo derecho, como pide el protocolo en tronco y axila),
`cam` = (giro°, elevación°, distancia m) respecto a la normal del sitio, y `desc`.
"""

# --- ejes de referencia del cuerpo (coinciden con body.py) ---
ARM_AXIS = (-0.132, 0.016, -0.300)     # hombro -> codo (lado derecho)
FOREARM_AXIS = (-0.060, 0.010, -0.262)  # codo -> muñeca
LEG_AXIS = (-0.012, 0.000, -0.355)      # cadera -> rodilla
SHANK_AXIS = (-0.003, -0.002, -0.390)   # rodilla -> tobillo
VERTICAL = (0.0, 0.0, 1.0)

GIRTHS = [
    {
        'key': 'Cefálico (cm)', 'slug': 'cefalico-cm', 'label': 'Cefálico', 'kind': 'girth',
        'center': (0.0, 0.006, 1.650), 'axis': VERTICAL, 'max_radius': 0.20,
        'cam': (30, 6, 0.56),
        'desc': 'Perímetro máximo de la cabeza, por encima de las cejas y de las orejas, en el plano de Frankfort.',
    },
    {
        'key': 'Cuello (cm)', 'slug': 'cuello-cm', 'label': 'Cuello', 'kind': 'girth',
        'center': (0.0, 0.010, 1.524), 'axis': VERTICAL, 'max_radius': 0.18,
        'cam': (32, 8, 0.52),
        'desc': 'Perímetro del cuello por debajo del cartílago tiroides (la nuez), con la cinta horizontal.',
    },
    {
        'key': 'Brazo relajado (cm)', 'slug': 'brazo-relajado-cm', 'label': 'Brazo relajado', 'kind': 'girth',
        'center': (-0.248, 0.010, 1.285), 'axis': ARM_AXIS, 'max_radius': 0.10,
        'cam': (34, 10, 0.5),
        'desc': 'Punto medio entre acromion y olécranon, con el brazo relajado colgando al costado. La cinta queda perpendicular al eje del brazo.',
    },
    {
        'key': 'Brazo contraído (cm)', 'slug': 'brazo-contraido-cm', 'label': 'Brazo contraído', 'kind': 'girth',
        'center': (-0.242, 0.010, 1.300), 'axis': ARM_AXIS, 'max_radius': 0.10,
        'cam': (34, 10, 0.5),
        'desc': 'Perímetro máximo del brazo con el codo flexionado a 90° y el bíceps en contracción máxima.',
    },
    {
        'key': 'Antebrazo (cm)', 'slug': 'antebrazo-cm', 'label': 'Antebrazo', 'kind': 'girth',
        'center': (-0.318, 0.019, 1.041), 'axis': FOREARM_AXIS, 'max_radius': 0.09,
        'cam': (34, 10, 0.46),
        'desc': 'Perímetro máximo del antebrazo, unos centímetros por debajo del codo, con el brazo relajado y la palma hacia arriba.',
    },
    {
        'key': 'Muñeca (cm)', 'slug': 'muneca-cm', 'label': 'Muñeca', 'kind': 'girth',
        'center': (-0.358, 0.026, 0.872), 'axis': FOREARM_AXIS, 'max_radius': 0.08,
        'cam': (34, 10, 0.4),
        'desc': 'Perímetro mínimo de la muñeca, justo por debajo de las apófisis estiloides del radio y el cúbito.',
    },
    {
        'key': 'Mesoesternal (cm)', 'slug': 'mesoesternal-cm', 'label': 'Mesoesternal', 'kind': 'girth',
        'center': (0.0, -0.004, 1.330), 'axis': VERTICAL, 'max_radius': 0.22, 'abduction': 60,
        'cam': (30, 12, 0.72),
        'desc': 'Perímetro del tórax a la altura de la articulación mesoesternal, al final de una espiración normal.',
    },
    {
        'key': 'Umbilical (cm)', 'slug': 'umbilical-cm', 'label': 'Umbilical', 'kind': 'girth',
        'center': (0.0, -0.002, 1.100), 'axis': VERTICAL, 'max_radius': 0.22, 'abduction': 60,
        'cam': (30, 12, 0.72),
        'desc': 'Perímetro del abdomen a la altura del ombligo, con la cinta horizontal y sin comprimir la piel.',
    },
    {
        'key': 'Cintura (cm)', 'slug': 'cintura-cm', 'label': 'Cintura', 'kind': 'girth',
        'center': (0.0, -0.004, 1.155), 'axis': VERTICAL, 'max_radius': 0.22, 'abduction': 60,
        'cam': (30, 12, 0.72),
        'desc': 'Perímetro mínimo del abdomen, entre la última costilla y la cresta ilíaca, al final de una espiración normal.',
    },
    {
        'key': 'Cadera (cm)', 'slug': 'cadera-cm', 'label': 'Cadera', 'kind': 'girth',
        'center': (0.0, 0.004, 0.975), 'axis': VERTICAL, 'max_radius': 0.22, 'abduction': 60,
        'cam': (30, 12, 0.72),
        'desc': 'Perímetro máximo de los glúteos, a la altura del trocánter mayor, con los pies juntos.',
    },
    {
        'key': 'Muslo (cm)', 'slug': 'muslo-cm', 'label': 'Muslo (1 cm)', 'kind': 'girth',
        'center': (-0.095, 0.004, 0.870), 'axis': LEG_AXIS, 'max_radius': 0.13,
        'cam': (32, 14, 0.56),
        'desc': 'Perímetro del muslo un centímetro por debajo del pliegue glúteo, con el peso repartido en ambos pies.',
    },
    {
        'key': 'Muslo medio (cm)', 'slug': 'muslo-medio-cm', 'label': 'Muslo medio', 'kind': 'girth',
        'center': (-0.104, 0.004, 0.745), 'axis': LEG_AXIS, 'max_radius': 0.13,
        'cam': (32, 14, 0.54),
        'desc': 'Perímetro del muslo a media distancia entre el pliegue inguinal y el borde superior de la rótula.',
    },
    {
        'key': 'Pantorrilla (cm)', 'slug': 'pantorrilla-cm', 'label': 'Pantorrilla', 'kind': 'girth',
        'center': (-0.110, 0.004, 0.355), 'axis': SHANK_AXIS, 'max_radius': 0.11,
        'cam': (32, 12, 0.5),
        'desc': 'Perímetro máximo de la pantorrilla, con el peso repartido en ambos pies.',
    },
    {
        'key': 'Tobillo (cm)', 'slug': 'tobillo-cm', 'label': 'Tobillo', 'kind': 'girth',
        'center': (-0.111, 0.002, 0.152), 'axis': SHANK_AXIS, 'max_radius': 0.09,
        'cam': (32, 12, 0.4),
        'desc': 'Perímetro mínimo del tobillo, justo por encima de los maléolos.',
    },
]

BREADTHS = [
    {
        'key': 'Blacromial (cm)', 'slug': 'blacromial-cm', 'label': 'Biacromial', 'kind': 'breadth',
        'point_a': (-0.160, 0.0, 1.432), 'ray_a': (-1.0, -0.25, 0.45),
        'point_b': (0.160, 0.0, 1.432), 'ray_b': (1.0, -0.25, 0.45),
        'out': (0.0, -0.5, 1.0), 'cam': (34, 14, 0.86),
        'desc': 'Distancia entre los bordes más externos de ambos acromion, con el antropómetro apoyado por detrás y los hombros relajados.',
    },
    {
        'key': 'Billeocrestal (cm)', 'slug': 'billeocrestal-cm', 'label': 'Biileocrestal', 'kind': 'breadth',
        'point_a': (-0.130, 0.0, 1.050), 'ray_a': (-1.0, -0.35, 0.2),
        'point_b': (0.130, 0.0, 1.050), 'ray_b': (1.0, -0.35, 0.2),
        'out': (0.0, -1.0, 0.35), 'cam': (34, 12, 0.74), 'abduction': 60,
        'desc': 'Distancia entre los puntos ileocrestales, es decir los bordes más externos de ambas crestas ilíacas.',
    },
    {
        'key': 'Transverso tórax (cm)', 'slug': 'transverso-torax-cm', 'label': 'Transverso del tórax', 'kind': 'breadth',
        'point_a': (-0.140, -0.004, 1.310), 'ray_a': (-1.0, -0.3, 0.0),
        'point_b': (0.140, -0.004, 1.310), 'ray_b': (1.0, -0.3, 0.0),
        'out': (0.0, -1.0, 0.25), 'cam': (34, 12, 0.76), 'abduction': 65,
        'desc': 'Ancho del tórax a la altura mesoesternal, al final de una espiración normal.',
    },
    {
        'key': 'Anteroposterior tórax (cm)', 'slug': 'anteroposterior-torax-cm', 'label': 'Anteroposterior del tórax', 'kind': 'breadth',
        'point_a': (0.0, -0.090, 1.310), 'ray_a': (0.0, -1.0, 0.0),
        'point_b': (0.0, 0.090, 1.310), 'ray_b': (0.0, 1.0, 0.0),
        'out': (-1.0, 0.0, 0.3), 'cam': (34, 12, 0.76), 'abduction': 70,
        'desc': 'Profundidad del tórax entre el mesoesternón y la apófisis espinosa correspondiente, al final de una espiración normal.',
    },
    {
        'key': 'Húmero (cm)', 'slug': 'humero-cm', 'label': 'Húmero', 'kind': 'breadth',
        'point_a': (-0.300, 0.016, 1.120), 'ray_a': (-0.95, 0.30, 0.0),
        'point_b': (-0.300, 0.016, 1.120), 'ray_b': (0.95, -0.30, 0.0),
        'out': (0.0, -1.0, 0.2), 'arm': True, 'abduction': -32, 'small': True, 'reach': 0.09, 'cam': (34, 10, 0.34),
        'desc': 'Distancia entre los epicóndilos medial y lateral del húmero, con el codo flexionado a 90°.',
    },
    {
        'key': 'Biestiloideo (cm)', 'slug': 'biestiloideo-cm', 'label': 'Biestiloideo de la muñeca', 'kind': 'breadth',
        'point_a': (-0.358, 0.026, 0.872), 'ray_a': (-0.95, 0.30, 0.0),
        'point_b': (-0.358, 0.026, 0.872), 'ray_b': (0.95, -0.30, 0.0),
        'out': (0.0, -1.0, 0.2), 'arm': True, 'abduction': -32, 'small': True, 'reach': 0.07, 'cam': (34, 10, 0.28),
        'desc': 'Distancia entre las apófisis estiloides del radio y del cúbito, con la muñeca en ligera flexión.',
    },
    {
        'key': 'Fémur (cm)', 'slug': 'femur-cm', 'label': 'Fémur', 'kind': 'breadth',
        'point_a': (-0.108, 0.004, 0.540), 'ray_a': (-1.0, -0.25, 0.0),
        'point_b': (-0.108, 0.004, 0.540), 'ray_b': (1.0, -0.25, 0.0),
        'out': (0.0, -1.0, 0.2), 'small': True, 'reach': 0.1, 'cam': (34, 10, 0.38),
        'desc': 'Distancia entre los cóndilos medial y lateral del fémur, con la rodilla flexionada a 90°.',
    },
    {
        'key': 'Bimaleolar (cm)', 'slug': 'bimaleolar-cm', 'label': 'Bimaleolar', 'kind': 'breadth',
        'point_a': (-0.111, 0.002, 0.150), 'ray_a': (-1.0, -0.25, 0.0),
        'point_b': (-0.111, 0.002, 0.150), 'ray_b': (1.0, -0.25, 0.0),
        'out': (0.0, -1.0, 0.25), 'small': True, 'reach': 0.08, 'cam': (34, 10, 0.32),
        'desc': 'Distancia entre los maléolos medial (tibia) y lateral (peroné), con el pie apoyado.',
    },
    {
        'key': 'Longitud del pie (cm)', 'slug': 'longitud-del-pie-cm', 'label': 'Longitud del pie', 'kind': 'breadth',
        'point_a': (-0.111, -0.095, 0.035), 'ray_a': (0.0, -1.0, 0.25),
        'point_b': (-0.111, 0.010, 0.050), 'ray_b': (0.0, 1.0, 0.25),
        'out': (-1.0, 0.0, 0.5), 'small': True, 'reach': 0.25, 'cam': (34, 18, 0.42),
        'desc': 'Del punto más posterior del talón al extremo del dedo más largo, con el pie apoyado y el peso repartido.',
    },
    {
        'key': 'Transverso pie (cm)', 'slug': 'transverso-pie-cm', 'label': 'Transverso del pie', 'kind': 'breadth',
        'point_a': (-0.111, -0.062, 0.035), 'ray_a': (-1.0, 0.0, 0.2),
        'point_b': (-0.111, -0.062, 0.035), 'ray_b': (1.0, 0.0, 0.2),
        'out': (0.0, -0.5, 1.0), 'small': True, 'reach': 0.08, 'cam': (34, 22, 0.34),
        'desc': 'Ancho del pie entre las cabezas del primer y del quinto metatarsiano.',
    },
    {
        'key': 'Longitud mano (cm)', 'slug': 'longitud-mano-cm', 'label': 'Longitud de la mano', 'kind': 'breadth',
        'point_a': (-0.360, 0.026, 0.858), 'ray_a': (0.0, -1.0, 0.6),
        'point_b': (-0.368, 0.028, 0.760), 'ray_b': (0.0, -1.0, -0.6),
        'out': (-1.0, -0.3, 0.0), 'arm': True, 'abduction': -32, 'small': True, 'reach': 0.12, 'cam': (34, 10, 0.32),
        'desc': 'Del pliegue de la muñeca a la punta del dedo medio, con la mano extendida y los dedos juntos.',
    },
    {
        'key': 'Transverso mano (cm)', 'slug': 'transverso-mano-cm', 'label': 'Transverso de la mano', 'kind': 'breadth',
        'point_a': (-0.366, 0.028, 0.790), 'ray_a': (-1.0, -0.35, 0.0),
        'point_b': (-0.366, 0.028, 0.790), 'ray_b': (1.0, -0.35, 0.0),
        'out': (0.0, -1.0, 0.3), 'arm': True, 'abduction': -32, 'small': True, 'reach': 0.07, 'cam': (34, 12, 0.28),
        'desc': 'Ancho de la mano a la altura de las cabezas del segundo al quinto metacarpiano.',
    },
]

ALL = GIRTHS + BREADTHS
BY_SLUG = {s['slug']: s for s in ALL}
