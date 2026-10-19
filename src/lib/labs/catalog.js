// Catálogo de estudios de laboratorio que el analizador de PDFs reconoce. Cada estudio tiene el
// nombre con el que se guarda en el expediente y los nombres, siglas y variantes con los que lo
// imprimen los laboratorios mexicanos (Chopo, Salud Digna, Olab, Azteca, hospitales…). Los
// sinónimos se comparan sin acentos y en minúsculas; cuando varios coinciden en un renglón gana el
// más largo, así "colesterol hdl" no se confunde con "colesterol" ni "hemoglobina glucosilada" con
// "hemoglobina".
//
// `unit` es la unidad habitual (se usa si el renglón no trae ninguna), `group` ordena la revisión y
// `plausible` es el intervalo de valores físicamente posibles en esa unidad: sirve para detectar un
// punto decimal que el OCR se comió ("312" de urea es imposible; "31.2" no).

export const LAB_CATALOG = [
  // Química sanguínea
  { key: 'glucose', name: 'Glucosa', plausible: [20, 800], group: 'Química sanguínea', unit: 'mg/dL', synonyms: ['glucosa', 'glucosa en ayuno', 'glucosa serica', 'glucosa basal', 'glucemia', 'glucemia en ayuno', 'glu'] },
  { key: 'hba1c', name: 'Hemoglobina glucosilada (HbA1c)', plausible: [3, 20], group: 'Química sanguínea', unit: '%', synonyms: ['hemoglobina glucosilada', 'hemoglobina glicosilada', 'hemoglobina glicada', 'hemoglobina a1c', 'hba1c', 'hb a1c', 'hb glucosilada', 'a1c'] },
  { key: 'urea', name: 'Urea', plausible: [3, 300], group: 'Química sanguínea', unit: 'mg/dL', synonyms: ['urea', 'urea serica'] },
  { key: 'bun', name: 'Nitrógeno ureico (BUN)', plausible: [1, 150], group: 'Química sanguínea', unit: 'mg/dL', synonyms: ['nitrogeno ureico', 'nitrogeno de urea', 'bun', 'n ureico'] },
  { key: 'creatinine', name: 'Creatinina', plausible: [0.1, 15], group: 'Química sanguínea', unit: 'mg/dL', synonyms: ['creatinina', 'creatinina serica'] },
  { key: 'uricAcid', name: 'Ácido úrico', plausible: [0.5, 20], group: 'Química sanguínea', unit: 'mg/dL', synonyms: ['acido urico', 'ac urico', 'urato'] },
  { key: 'insulin', name: 'Insulina', plausible: [0.5, 300], group: 'Química sanguínea', unit: 'µUI/mL', synonyms: ['insulina', 'insulina basal', 'insulina en ayuno'] },
  { key: 'homa', name: 'Índice HOMA-IR', plausible: [0.1, 30], group: 'Química sanguínea', unit: '', synonyms: ['homa ir', 'indice homa', 'homa'] },
  // Perfil de lípidos
  { key: 'cholesterol', name: 'Colesterol total', plausible: [50, 600], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['colesterol total', 'colesterol', 'col total'] },
  { key: 'hdl', name: 'Colesterol HDL', plausible: [5, 150], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['colesterol hdl', 'hdl colesterol', 'colesterol de alta densidad', 'lipoproteinas de alta densidad', 'c hdl', 'hdl'] },
  { key: 'ldl', name: 'Colesterol LDL', plausible: [10, 400], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['colesterol ldl', 'ldl colesterol', 'colesterol de baja densidad', 'lipoproteinas de baja densidad', 'c ldl', 'ldl'] },
  { key: 'vldl', name: 'Colesterol VLDL', plausible: [2, 150], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['colesterol vldl', 'vldl colesterol', 'lipoproteinas de muy baja densidad', 'vldl'] },
  { key: 'nonHdl', name: 'Colesterol no HDL', plausible: [20, 500], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['colesterol no hdl', 'no hdl'] },
  { key: 'triglycerides', name: 'Triglicéridos', plausible: [20, 3000], group: 'Perfil de lípidos', unit: 'mg/dL', synonyms: ['trigliceridos', 'trigliceridos sericos', 'tg'] },
  { key: 'atherogenic', name: 'Índice aterogénico', plausible: [1, 15], group: 'Perfil de lípidos', unit: '', synonyms: ['indice aterogenico', 'indice de castelli', 'relacion colesterol hdl'] },
  // Pruebas de función hepática
  { key: 'totalProtein', name: 'Proteínas totales', plausible: [2, 12], group: 'Función hepática', unit: 'g/dL', synonyms: ['proteinas totales', 'proteina total'] },
  { key: 'albumin', name: 'Albúmina', plausible: [1, 7], group: 'Función hepática', unit: 'g/dL', synonyms: ['albumina', 'albumina serica'] },
  { key: 'globulin', name: 'Globulina', plausible: [0.5, 7], group: 'Función hepática', unit: 'g/dL', synonyms: ['globulinas', 'globulina'] },
  { key: 'agRatio', name: 'Relación albúmina/globulina', plausible: [0.2, 4], group: 'Función hepática', unit: '', synonyms: ['relacion albumina globulina', 'relacion a g', 'indice a g'] },
  { key: 'totalBilirubin', name: 'Bilirrubina total', plausible: [0.05, 30], group: 'Función hepática', unit: 'mg/dL', synonyms: ['bilirrubina total', 'bt'] },
  { key: 'directBilirubin', name: 'Bilirrubina directa', plausible: [0, 20], group: 'Función hepática', unit: 'mg/dL', synonyms: ['bilirrubina directa', 'bilirrubina conjugada', 'bd'] },
  { key: 'indirectBilirubin', name: 'Bilirrubina indirecta', plausible: [0, 20], group: 'Función hepática', unit: 'mg/dL', synonyms: ['bilirrubina indirecta', 'bilirrubina no conjugada', 'bi'] },
  { key: 'ast', name: 'TGO / AST', plausible: [1, 3000], group: 'Función hepática', unit: 'U/L', synonyms: ['aspartato aminotransferasa', 'transaminasa glutamico oxalacetica', 'tgo ast', 'ast tgo', 'tgo', 'ast'] },
  { key: 'alt', name: 'TGP / ALT', plausible: [1, 3000], group: 'Función hepática', unit: 'U/L', synonyms: ['alanino aminotransferasa', 'alanina aminotransferasa', 'transaminasa glutamico piruvica', 'tgp alt', 'alt tgp', 'tgp', 'alt'] },
  { key: 'ggt', name: 'Gamma glutamil transferasa (GGT)', plausible: [1, 3000], group: 'Función hepática', unit: 'U/L', synonyms: ['gamma glutamil transferasa', 'gamma glutamil transpeptidasa', 'gamma gt', 'ggt'] },
  { key: 'alp', name: 'Fosfatasa alcalina', plausible: [5, 3000], group: 'Función hepática', unit: 'U/L', synonyms: ['fosfatasa alcalina', 'fal', 'alp'] },
  { key: 'ldh', name: 'Deshidrogenasa láctica (DHL)', plausible: [30, 5000], group: 'Función hepática', unit: 'U/L', synonyms: ['deshidrogenasa lactica', 'dhl', 'ldh'] },
  // Electrolitos y minerales
  { key: 'sodium', name: 'Sodio', plausible: [100, 180], group: 'Electrolitos y minerales', unit: 'mEq/L', synonyms: ['sodio', 'sodio serico', 'na'] },
  { key: 'potassium', name: 'Potasio', plausible: [1.5, 9], group: 'Electrolitos y minerales', unit: 'mEq/L', synonyms: ['potasio', 'potasio serico', 'k'] },
  { key: 'chloride', name: 'Cloro', plausible: [60, 140], group: 'Electrolitos y minerales', unit: 'mEq/L', synonyms: ['cloro', 'cloruro', 'cloruros', 'cl'] },
  { key: 'calcium', name: 'Calcio', plausible: [4, 16], group: 'Electrolitos y minerales', unit: 'mg/dL', synonyms: ['calcio', 'calcio serico', 'calcio total', 'ca'] },
  { key: 'phosphorus', name: 'Fósforo', plausible: [0.5, 12], group: 'Electrolitos y minerales', unit: 'mg/dL', synonyms: ['fosforo', 'fosforo serico', 'fosfato'] },
  { key: 'magnesium', name: 'Magnesio', plausible: [0.5, 6], group: 'Electrolitos y minerales', unit: 'mg/dL', synonyms: ['magnesio', 'magnesio serico', 'mg serico'] },
  { key: 'iron', name: 'Hierro sérico', plausible: [5, 500], group: 'Perfil de hierro', unit: 'µg/dL', synonyms: ['hierro serico', 'hierro', 'fe serico'] },
  { key: 'ferritin', name: 'Ferritina', plausible: [1, 5000], group: 'Perfil de hierro', unit: 'ng/mL', synonyms: ['ferritina', 'ferritina serica'] },
  { key: 'transferrin', name: 'Transferrina', plausible: [50, 600], group: 'Perfil de hierro', unit: 'mg/dL', synonyms: ['transferrina'] },
  { key: 'tibc', name: 'Capacidad total de fijación de hierro', plausible: [100, 700], group: 'Perfil de hierro', unit: 'µg/dL', synonyms: ['capacidad total de fijacion de hierro', 'capacidad total de fijacion', 'ctfh', 'tibc'] },
  { key: 'transferrinSaturation', name: 'Saturación de transferrina', plausible: [1, 100], group: 'Perfil de hierro', unit: '%', synonyms: ['saturacion de transferrina', 'porcentaje de saturacion', 'indice de saturacion'] },
  // Tiroides
  { key: 'tsh', name: 'TSH', plausible: [0.005, 150], group: 'Perfil tiroideo', unit: 'µUI/mL', synonyms: ['hormona estimulante de tiroides', 'tirotropina', 'tsh'] },
  { key: 'freeT4', name: 'T4 libre', plausible: [0.1, 8], group: 'Perfil tiroideo', unit: 'ng/dL', synonyms: ['tiroxina libre', 't4 libre', 't4l'] },
  { key: 'totalT4', name: 'T4 total', plausible: [1, 25], group: 'Perfil tiroideo', unit: 'µg/dL', synonyms: ['tiroxina total', 't4 total'] },
  { key: 'freeT3', name: 'T3 libre', plausible: [0.5, 30], group: 'Perfil tiroideo', unit: 'pg/mL', synonyms: ['triyodotironina libre', 't3 libre', 't3l'] },
  { key: 'totalT3', name: 'T3 total', plausible: [20, 600], group: 'Perfil tiroideo', unit: 'ng/dL', synonyms: ['triyodotironina total', 't3 total'] },
  // Vitaminas e inflamación
  { key: 'vitaminD', name: 'Vitamina D (25-OH)', plausible: [2, 200], group: 'Vitaminas', unit: 'ng/mL', synonyms: ['25 hidroxivitamina d', '25 hidroxi vitamina d', '25 oh vitamina d', 'vitamina d 25 oh', 'vitamina d total', 'vitamina d'] },
  { key: 'vitaminB12', name: 'Vitamina B12', plausible: [50, 3000], group: 'Vitaminas', unit: 'pg/mL', synonyms: ['vitamina b12', 'vitamina b 12', 'cobalamina', 'cianocobalamina'] },
  { key: 'folate', name: 'Ácido fólico', plausible: [0.5, 40], group: 'Vitaminas', unit: 'ng/mL', synonyms: ['acido folico', 'folato serico', 'folatos', 'folato'] },
  { key: 'crp', name: 'Proteína C reactiva', plausible: [0.01, 400], group: 'Inflamación', unit: 'mg/L', synonyms: ['proteina c reactiva ultrasensible', 'proteina c reactiva', 'pcr ultrasensible', 'pcr us', 'pcr'] },
  { key: 'esr', name: 'Velocidad de sedimentación globular', plausible: [0, 150], group: 'Inflamación', unit: 'mm/h', synonyms: ['velocidad de sedimentacion globular', 'velocidad de sedimentacion', 'vsg'] },
  // Biometría hemática
  { key: 'hemoglobin', name: 'Hemoglobina', plausible: [3, 25], group: 'Biometría hemática', unit: 'g/dL', synonyms: ['hemoglobina', 'hb', 'hgb'] },
  { key: 'hematocrit', name: 'Hematocrito', plausible: [10, 75], group: 'Biometría hemática', unit: '%', synonyms: ['hematocrito', 'hto', 'hct'] },
  { key: 'rbc', name: 'Eritrocitos', plausible: [1, 9], group: 'Biometría hemática', unit: 'millones/µL', synonyms: ['eritrocitos', 'globulos rojos', 'recuento de eritrocitos', 'rbc'] },
  { key: 'mcv', name: 'Volumen corpuscular medio (VCM)', plausible: [50, 130], group: 'Biometría hemática', unit: 'fL', synonyms: ['volumen corpuscular medio', 'volumen globular medio', 'vcm', 'mcv'] },
  { key: 'mch', name: 'Hemoglobina corpuscular media (HCM)', plausible: [15, 45], group: 'Biometría hemática', unit: 'pg', synonyms: ['hemoglobina corpuscular media', 'hcm', 'mch'] },
  { key: 'mchc', name: 'Concentración de hemoglobina corpuscular media (CHCM)', plausible: [25, 40], group: 'Biometría hemática', unit: 'g/dL', synonyms: ['concentracion media de hemoglobina corpuscular', 'concentracion de hemoglobina corpuscular media', 'chcm', 'mchc'] },
  { key: 'rdw', name: 'Amplitud de distribución eritrocitaria (ADE/RDW)', plausible: [8, 30], group: 'Biometría hemática', unit: '%', synonyms: ['amplitud de distribucion eritrocitaria', 'ancho de distribucion eritrocitaria', 'rdw cv', 'rdw', 'ade'] },
  { key: 'wbc', name: 'Leucocitos', plausible: [0.5, 100], group: 'Biometría hemática', unit: 'miles/µL', synonyms: ['leucocitos', 'globulos blancos', 'leucocitos totales', 'wbc'] },
  { key: 'neutrophils', name: 'Neutrófilos', plausible: [0, 100], group: 'Biometría hemática', unit: '%', synonyms: ['neutrofilos totales', 'neutrofilos segmentados', 'neutrofilos', 'segmentados'] },
  { key: 'lymphocytes', name: 'Linfocitos', plausible: [0, 100], group: 'Biometría hemática', unit: '%', synonyms: ['linfocitos'] },
  { key: 'monocytes', name: 'Monocitos', plausible: [0, 100], group: 'Biometría hemática', unit: '%', synonyms: ['monocitos'] },
  { key: 'eosinophils', name: 'Eosinófilos', plausible: [0, 100], group: 'Biometría hemática', unit: '%', synonyms: ['eosinofilos'] },
  { key: 'basophils', name: 'Basófilos', plausible: [0, 100], group: 'Biometría hemática', unit: '%', synonyms: ['basofilos'] },
  { key: 'platelets', name: 'Plaquetas', plausible: [10, 1500], group: 'Biometría hemática', unit: 'miles/µL', synonyms: ['plaquetas', 'recuento de plaquetas', 'plt'] },
  { key: 'mpv', name: 'Volumen plaquetario medio (VPM)', plausible: [5, 15], group: 'Biometría hemática', unit: 'fL', synonyms: ['volumen plaquetario medio', 'vpm', 'mpv'] },
  // Hormonas frecuentes en consulta de nutrición
  { key: 'cortisol', name: 'Cortisol', plausible: [0.5, 80], group: 'Hormonas', unit: 'µg/dL', synonyms: ['cortisol matutino', 'cortisol serico', 'cortisol'] },
  { key: 'prolactin', name: 'Prolactina', plausible: [0.5, 500], group: 'Hormonas', unit: 'ng/mL', synonyms: ['prolactina'] },
  { key: 'testosterone', name: 'Testosterona total', plausible: [1, 1500], group: 'Hormonas', unit: 'ng/dL', synonyms: ['testosterona total', 'testosterona'] },
]

export const LAB_GROUP_ORDER = [...new Set(LAB_CATALOG.map((item) => item.group))]
