import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { bodyComposition, bodyFatEstimates, energyFromMacros, somatotype, theoreticalWeights } from '../lib/anthropometry.js'

// Módulo antropométrico con el menú superior y el submenú de tipos al estilo de las capturas
// (Mediciones / Cálculos / Calorías / Somatocarta / Notas / Fotos). En esta fase sólo Mediciones
// está funcional; el resto muestra un aviso de "próxima fase".
const TABS = [['Mediciones', 'scan'], ['Cálculos', 'calculator'], ['Calorías', 'flame'], ['Somatocarta', 'triangle'], ['Notas', 'note'], ['Fotos', 'camera']]

const TYPES = [
  ['peso', 'Peso/Estatua', 'scan'],
  ['bio', 'Bioimpedancia', 'flame'],
  ['pliegues', 'Pliegues', 'ruler'],
  ['perimetros', 'Perímetros', 'ruler'],
  ['diametros', 'Diámetros', 'ruler'],
]

const CALC_TYPES = [
  ['peso-teorico', 'Peso teórico', 'ruler'],
  ['grasa', 'Porcentaje de grasa', 'calculator'],
  ['componentes', 'Componentes corporales', 'layout'],
  ['frisancho', 'Indicadores de Frisancho', 'grid'],
  ['imc-embarazo', 'IMC embarazo', 'flame'],
]

const BALANCES = [['normo', 'Normocalórico'], ['deficit', 'Déficit'], ['superavit', 'Superávit']]
const EMBARAZO_GAIN = [
  { label: 'Bajo peso', to: 18.5, range: '12.5 – 18 kg' },
  { label: 'Normal', to: 25, range: '11.5 – 16 kg' },
  { label: 'Sobrepeso', to: 30, range: '7 – 11.5 kg' },
  { label: 'Obesidad', to: 99, range: '5 – 9 kg' },
]

const F = (label, key, unit = '') => ({ label, key, unit })
const GROUP_FIELDS = {
  peso: [F('Estatura', 'Talla (cm)', 'cm'), F('Peso', 'Peso (kg)', 'kg')],
  bio: [
    { ...F('Grasa total', '% Grasa corporal', '%'), derived: 'fatKg' },
    F('Grasa en sección superior', 'Grasa superior (%)', '%'),
    F('Grasa en sección inferior', 'Grasa inferior (%)', '%'),
    F('Grasa visceral', 'Grasa visceral', 'rating'),
    F('Masa libre de grasa', 'Masa libre de grasa (kg)', 'kg'),
    { ...F('Masa muscular', 'Kg de músculo', 'kg'), derived: 'musclePct' },
    F('Peso óseo', 'Peso óseo (kg)', 'kg'),
    F('Agua corporal', 'Agua corporal (%)', '%'),
    F('Edad metabólica', 'Edad metabólica', 'años'),
  ],
  pliegues: [
    F('Subescapular', 'Subescapular (mm)', 'mm'), F('Tríceps', 'Tricipital (mm)', 'mm'), F('Bíceps', 'Bicipital (mm)', 'mm'),
    F('Cresta ilíaca', 'Cresta ilíaca (mm)', 'mm'), F('Supraespinal', 'Supraespinal (mm)', 'mm'), F('Abdominal', 'Abdominal (mm)', 'mm'),
    F('Muslo frontal', 'Muslo frontal (mm)', 'mm'), F('Pantorrilla medial', 'Pantorrilla medial (mm)', 'mm'),
    F('Axilar medial', 'Axilar medial (mm)', 'mm'), F('Pectoral', 'Pectoral (mm)', 'mm'),
  ],
  perimetros: [
    F('Cefálico', 'Cefálico (cm)', 'cm'), F('Cuello', 'Cuello (cm)', 'cm'), F('Mitad del brazo relajado', 'Brazo relajado (cm)', 'cm'),
    F('Mitad del brazo contraído', 'Brazo contraído (cm)', 'cm'), F('Antebrazo', 'Antebrazo (cm)', 'cm'), F('Muñeca', 'Muñeca (cm)', 'cm'),
    F('Mesoesternal', 'Mesoesternal (cm)', 'cm'), F('Umbilical', 'Umbilical (cm)', 'cm'), F('Cintura', 'Cintura (cm)', 'cm'),
    F('Cadera', 'Cadera (cm)', 'cm'), F('Muslo (1 cm)', 'Muslo (cm)', 'cm'), F('Muslo medio', 'Muslo medio (cm)', 'cm'),
    F('Pantorrilla', 'Pantorrilla (cm)', 'cm'), F('Tobillo', 'Tobillo (cm)', 'cm'),
  ],
  diametros: [
    F('Blacromial', 'Blacromial (cm)', 'cm'), F('Billeocrestal', 'Billeocrestal (cm)', 'cm'), F('Longitud del pie', 'Longitud del pie (cm)', 'cm'),
    F('Transverso del tórax', 'Transverso tórax (cm)', 'cm'), F('Anteroposterior del tórax', 'Anteroposterior tórax (cm)', 'cm'), F('Húmero', 'Húmero (cm)', 'cm'),
    F('Biestiloideo de la muñeca', 'Biestiloideo (cm)', 'cm'), F('Fémur', 'Fémur (cm)', 'cm'), F('Bimaleolar', 'Bimaleolar (cm)', 'cm'),
    F('Transverso del pie', 'Transverso pie (cm)', 'cm'), F('Longitud mano', 'Longitud mano (cm)', 'cm'), F('Transverso de la mano', 'Transverso mano (cm)', 'cm'),
  ],
}

const IMC_ZONES = [
  { to: 18.5, label: 'Bajo peso', color: '#5b8fd6' },
  { to: 25, label: 'Normal', color: '#3fa46a' },
  { to: 30, label: 'Sobrepeso', color: '#d7ad56' },
  { to: 35, label: 'Obesidad I', color: '#d98b3f' },
  { to: 40, label: 'Obesidad II', color: '#c0564f' },
]
const imcCategory = (imc) => IMC_ZONES.find((zone) => imc < zone.to) || { label: 'Obesidad III', color: '#9e3d37' }

const num = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null }

// Indicadores de Frisancho (apoyo): clasifica los valores frente a rangos de referencia adulto.
const frisanchoRows = (values, sex) => {
  const female = String(sex || '').toLowerCase().startsWith('fem')
  const fold = (a, b) => (num(values[a]) && num(values[b]) ? num(values[a]) + num(values[b]) : null)
  const classify = (value, low, high) => value == null ? ['—', ''] : value < low ? ['Bajo', 'low'] : value > high ? ['Alto', 'high'] : ['Normal', 'ok']
  const mk = (label, raw, low, high, unit) => { const [band, tone] = classify(raw, low, high); return { label, value: raw != null ? `${Math.round(raw * 10) / 10} ${unit}` : null, band, tone } }
  return [
    mk('Porcentaje de grasa corporal', num(values['% Grasa corporal']), female ? 20 : 12, female ? 32 : 22, '%'),
    mk('Pliegue del tríceps', num(values['Tricipital (mm)']), female ? 16 : 8, female ? 32 : 22, 'mm'),
    mk('Sumatoria tríceps + subescapular', fold('Tricipital (mm)', 'Subescapular (mm)'), female ? 30 : 18, female ? 60 : 40, 'mm'),
    mk('Perímetro del brazo', num(values['Brazo relajado (cm)']), female ? 24 : 27, female ? 34 : 36, 'cm'),
  ]
}

// Guía ilustrada por medición: punto aproximado sobre la silueta (coordenadas 0-100 × 0-160) y una
// descripción corta. La silueta se anima (marcador pulsante) al seleccionar cada campo.
const GUIDE = {
  'Subescapular (mm)': { x: 62, y: 34, desc: 'A dos centímetros del ángulo inferior de la escápula, en dirección oblicua hacia abajo y afuera (45°).' },
  'Tricipital (mm)': { x: 26, y: 44, desc: 'En la cara posterior del brazo, a mitad de camino entre el acromion y el olécranon.' },
  'Bicipital (mm)': { x: 30, y: 42, desc: 'En la cara anterior del brazo, al nivel del punto medio entre acromion y olécranon.' },
  'Cresta ilíaca (mm)': { x: 56, y: 62, desc: 'En la línea axilar media, justo por encima de la cresta ilíaca.' },
  'Supraespinal (mm)': { x: 60, y: 56, desc: 'En la intersección de la línea axilar media con la cresta ilíaca, hacia arriba y atrás.' },
  'Abdominal (mm)': { x: 54, y: 66, desc: 'A cinco centímetros a la derecha del ombligo, en pliegue vertical.' },
  'Muslo frontal (mm)': { x: 46, y: 102, desc: 'En la cara anterior del muslo, a mitad de camino entre el pliegue inguinal y el borde proximal de la rótula.' },
  'Pantorrilla medial (mm)': { x: 40, y: 124, desc: 'En la cara medial de la pantorrilla, al nivel de la máxima circunferencia.' },
  'Axilar medial (mm)': { x: 62, y: 50, desc: 'En la línea axilar media, a la altura del apéndice xifoides.' },
  'Pectoral (mm)': { x: 60, y: 44, desc: 'En el borde inferior de la axila, sobre el músculo pectoral.' },
  'Cefálico (cm)': { x: 50, y: 14, desc: 'Perímetro máximo de la cabeza, por encima de las cejas y de las orejas.' },
  'Cuello (cm)': { x: 50, y: 26, desc: 'Perímetro del cuello, por debajo de la laringe.' },
  'Brazo relajado (cm)': { x: 28, y: 46, desc: 'Punto medio entre acromion y olécranon, con el brazo relajado.' },
  'Brazo contraído (cm)': { x: 28, y: 44, desc: 'Máximo perímetro del brazo con el codo flexionado y el bíceps contraído.' },
  'Antebrazo (cm)': { x: 20, y: 62, desc: 'Máximo perímetro del antebrazo, distal al codo.' },
  'Muñeca (cm)': { x: 16, y: 76, desc: 'Perímetro mínimo de la muñeca, distal a la apófisis estiloides.' },
  'Mesoesternal (cm)': { x: 50, y: 46, desc: 'Perímetro del tórax a la altura del mesoesternón.' },
  'Umbilical (cm)': { x: 50, y: 64, desc: 'Perímetro del abdomen a la altura del ombligo.' },
  'Cintura (cm)': { x: 50, y: 60, desc: 'Perímetro mínimo entre la última costilla y la cresta ilíaca.' },
  'Cadera (cm)': { x: 50, y: 70, desc: 'Perímetro máximo de las nalgas a la altura del trocánter mayor.' },
  'Muslo (cm)': { x: 44, y: 100, desc: 'A un centímetro por debajo del pliegue glúteo.' },
  'Muslo medio (cm)': { x: 44, y: 106, desc: 'A mitad de camino entre pliegue glúteo y rodilla.' },
  'Pantorrilla (cm)': { x: 42, y: 124, desc: 'Máximo perímetro de la pantorrilla.' },
  'Tobillo (cm)': { x: 42, y: 138, desc: 'Perímetro mínimo del tobillo, proximal a los maléolos.' },
  'Blacromial (cm)': { x: 50, y: 32, desc: 'Distancia entre los bordes externos de ambos acromion.' },
  'Billeocrestal (cm)': { x: 50, y: 68, desc: 'Distancia entre los puntos ileocrestales izquierdo y derecho.' },
  'Longitud del pie (cm)': { x: 46, y: 150, desc: 'De la parte posterior del talón a la punta del dedo más largo.' },
  'Transverso tórax (cm)': { x: 50, y: 48, desc: 'Diámetro transverso del tórax a la altura mesoesternal.' },
  'Anteroposterior tórax (cm)': { x: 50, y: 46, desc: 'Diámetro anteroposterior del tórax.' },
  'Húmero (cm)': { x: 26, y: 40, desc: 'Distancia entre los bordes medial y lateral del húmero a la altura del epicóndilo.' },
  'Biestiloideo (cm)': { x: 16, y: 76, desc: 'Distancia entre las apófisis estiloides del radio y del cúbito.' },
  'Fémur (cm)': { x: 46, y: 96, desc: 'Distancia entre el borde medial y lateral del fémur.' },
  'Bimaleolar (cm)': { x: 42, y: 140, desc: 'Distancia entre los maléolos medial y lateral.' },
  'Transverso pie (cm)': { x: 46, y: 150, desc: 'Distancia entre la cabeza del primer y del quinto metatarsiano.' },
  'Longitud mano (cm)': { x: 16, y: 86, desc: 'Del pliegue de la muñeca a la punta del dedo medio.' },
  'Transverso mano (cm)': { x: 16, y: 80, desc: 'Ancho de la mano a la altura de los nudillos.' },
}
const guideFor = (key) => GUIDE[key] || { x: 50, y: 50, desc: 'Sigue el protocolo ISAK para tomar esta medición.' }

// Guías 3D animadas (WebP con giro 360° y marcador pulsante por medición). El nombre del archivo
// se deriva de la clave del campo (misma normalización usada al generarlas con Blender).
const GUIDE_IMAGES = import.meta.glob('../assets/mediciones/*.webp', { eager: true, query: '?url', import: 'default' })
const slug = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const guideImage = (key) => GUIDE_IMAGES[`../assets/mediciones/${slug(key)}.webp`] || null
const PLIEGUES = new Set(GROUP_FIELDS.pliegues.map((field) => field.key))
const SKIN_FOLD_NOTE = 'Se usan en fórmulas de: Siri, Brozek, Faulkner, Ledesma y cálculo del somatotipo.'

function BodyFigure({ x, y }) {
  return <svg className="anthro-figure" viewBox="0 0 100 160" role="img" aria-label="Guía de medición">
    <circle className="anthro-figure-head" cx="50" cy="15" r="10" />
    <path className="anthro-figure-body" d="M40 27 h20 a6 6 0 0 1 6 6 l3 34 h-6 l-2 -22 -2 22 h-4 v40 h-9 v-40 h-4 l-2 -22 -2 22 h-6 l3 -34 a6 6 0 0 1 6 -6 Z" />
    <path className="anthro-figure-body" d="M34 32 l-10 34 5 2 9 -30 Z M66 32 l10 34 -5 2 -9 -30 Z" />
    <path className="anthro-figure-body" d="M43 87 h6 v56 h-6 Z M51 87 h6 v56 h-6 Z" />
    <circle className="anthro-pulse" cx={x} cy={y} r="4" />
    <circle className="anthro-pulse-dot" cx={x} cy={y} r="2" />
  </svg>
}

export default function Anthropometry({ values = {}, onFieldChange, registerMeasurement, measurementState = 'idle', todayMeasured = false, patientSex = '', patientAge = null }) {
  const [tab, setTab] = useState('Mediciones')
  const [type, setType] = useState('peso')
  const [activeField, setActiveField] = useState(GROUP_FIELDS.pliegues[0].key)
  const [calcType, setCalcType] = useState('grasa')
  const [balance, setBalance] = useState('superavit')
  const [perKg, setPerKg] = useState(true)
  const [macros, setMacros] = useState({ carbs: 4, protein: 3.1, fat: 3 })
  const [gestWeek, setGestWeek] = useState('28')
  const [photoError, setPhotoError] = useState('')
  const selectType = (key) => { setType(key); const first = GROUP_FIELDS[key]?.[0]; if (first) setActiveField(first.key) }

  const peso = num(values['Peso (kg)'])
  const talla = num(values['Talla (cm)'])
  const imc = peso && talla ? peso / ((talla / 100) ** 2) : null
  const category = imc ? imcCategory(imc) : null
  const markerPct = imc ? Math.min(100, Math.max(0, ((imc - 4) / (40 - 4)) * 100)) : 0

  const renderField = (field, index) => {
    const value = values[field.key] ?? ''
    let derived = null
    if (field.derived === 'fatKg' && peso && num(value)) derived = `${((peso * Number(value)) / 100).toFixed(1)} kg`
    if (field.derived === 'musclePct' && peso && num(value)) derived = `${((Number(value) / peso) * 100).toFixed(0)} %`
    return <div className={'anthro-field' + (activeField === field.key ? ' active' : '')} key={field.key + index}>
      <span className="anthro-field-label">{field.label}</span>
      <input className="anthro-field-input" type="number" step="0.1" value={value} onFocus={() => setActiveField(field.key)} onChange={(event) => onFieldChange?.(field.key, event.target.value)} />
      <span className="anthro-unit">{field.unit}</span>
      <span className="anthro-derived">{derived || ''}</span>
    </div>
  }

  const renderGuide = (fields) => {
    const active = fields.find((field) => field.key === activeField) || fields[0]
    const guide = guideFor(active.key)
    const image = guideImage(active.key)
    return <aside className="anthro-guide">
      <b className="anthro-guide-title">{active.label}</b>
      <div className="anthro-guide-frame">{image ? <img className="anthro-guide-media" src={image} alt={`Guía de medición: ${active.label}`} /> : <BodyFigure x={guide.x} y={guide.y} />}</div>
      <p className="anthro-guide-desc">{guide.desc}</p>
      {PLIEGUES.has(active.key) && <p className="anthro-guide-formula">{SKIN_FOLD_NOTE}</p>}
    </aside>
  }
  const renderMeasureGroup = (fields) => <div className="anthro-with-guide"><div className="anthro-fields">{fields.map(renderField)}</div>{renderGuide(fields)}</div>

  const downscaleImage = (file) => new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 900
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.onerror = () => resolve(null)
      img.src = reader.result
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
  const photos = Array.isArray(values['Fotos antropométricas']) ? values['Fotos antropométricas'] : []
  const addPhotos = async (fileList) => {
    const incoming = []
    for (const file of Array.from(fileList || [])) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > 6 * 1024 * 1024) { setPhotoError('Una imagen supera 6 MB y no se agregó.'); continue }
      const dataUrl = await downscaleImage(file)
      if (dataUrl) incoming.push(dataUrl)
    }
    if (incoming.length) { setPhotoError(''); onFieldChange?.('Fotos antropométricas', [...photos, ...incoming]) }
  }

  const renderCalculations = () => {
    const fat = bodyFatEstimates(values, { sex: patientSex })
    const composition = bodyComposition(values, { sex: patientSex, fatPercent: fat.average })
    const weights = theoreticalWeights(values['Talla (cm)'], patientSex)
    const maxFat = Math.max(1, ...fat.rows.filter((r) => r.value != null).map((r) => r.value))
    const totalPct = composition.parts.reduce((a, p) => a + (p.pct || 0), 0) || 1
    let acc = 0
    const stops = composition.parts.filter((p) => p.pct).map((p) => { const from = acc; acc += (p.pct / totalPct) * 100; return `${p.color} ${from}% ${acc}%` })
    const gest = peso && talla ? peso / ((talla / 100) ** 2) : null
    const gestZone = gest ? EMBARAZO_GAIN.find((z) => gest < z.to) : null
    return <div className="anthro-layout panel">
      <aside className="anthro-types"><p className="eyebrow">Tipo</p>{CALC_TYPES.map(([key, label, icon]) => <button type="button" className={'anthro-type' + (calcType === key ? ' active' : '')} key={key} onClick={() => setCalcType(key)}><Icon>{icon}</Icon>{label}</button>)}</aside>
      <section className="anthro-main">
        <h2 className="anthro-title"><Icon>{CALC_TYPES.find((t) => t[0] === calcType)?.[2]}</Icon>{CALC_TYPES.find((t) => t[0] === calcType)?.[1]}</h2>

        {calcType === 'grasa' && <>
          <p className="anthro-hint">Estimaciones a partir de los pliegues capturados en Mediciones. El promedio reúne las fórmulas con datos disponibles.</p>
          <div className="calc-table">
            <div className="calc-table-head"><span>Autor</span><span>Resultado</span></div>
            {fat.rows.map((r) => <div className="calc-table-row" key={r.label}>
              <span className="calc-table-name">{r.label}<small>{r.detail}</small></span>
              <span className="calc-table-value">{r.value != null ? `${r.value} %` : '—'}{r.value != null && <i style={{ width: `${Math.min(100, (r.value / maxFat) * 100)}%` }} />}</span>
            </div>)}
            <div className="calc-table-row total"><span className="calc-table-name"><b>Promedio</b></span><span className="calc-table-value"><b>{fat.average != null ? `${fat.average} %` : '—'}</b></span></div>
          </div>
        </>}

        {calcType === 'componentes' && <div className="calc-components">
          <div className="calc-table three">
            <div className="calc-table-head"><span>Componente</span><span>Kg</span><span>%</span></div>
            {composition.parts.map((p) => <div className="calc-table-row" key={p.label}>
              <span className="calc-table-name"><i className="calc-dot" style={{ background: p.color }} />{p.label}</span>
              <span className="calc-table-value">{p.kg != null ? p.kg : '—'}</span>
              <span className="calc-table-value">{p.pct != null ? `${p.pct} %` : '—'}</span>
            </div>)}
          </div>
          <div className="calc-chart"><div className="calc-donut" style={{ background: stops.length ? `conic-gradient(${stops.join(',')})` : '#eef0f4' }}><span>{composition.weight ? `${composition.weight} kg` : '—'}</span></div></div>
        </div>}

        {calcType === 'peso-teorico' && <div className="calc-table">
          <div className="calc-table-head"><span>Fórmula</span><span>Peso ideal</span></div>
          {weights.length ? weights.map((w) => <div className="calc-table-row" key={w.label}><span className="calc-table-name">{w.label}</span><span className="calc-table-value">{w.value} kg</span></div>) : <p className="anthro-hint">Captura la estatura en Mediciones.</p>}
          {talla && <div className="calc-table-row total"><span className="calc-table-name"><b>Rango saludable (IMC 18.5–24.9)</b></span><span className="calc-table-value"><b>{(18.5 * (talla / 100) ** 2).toFixed(1)}–{(24.9 * (talla / 100) ** 2).toFixed(1)} kg</b></span></div>}
        </div>}

        {calcType === 'frisancho' && <div className="calc-table three">
          <div className="calc-table-head"><span>Indicador</span><span>Valor</span><span>Referencia</span></div>
          {frisanchoRows(values, patientSex).map((row) => <div className="calc-table-row" key={row.label}>
            <span className="calc-table-name">{row.label}</span>
            <span className="calc-table-value">{row.value || '—'}</span>
            <span className={'calc-tag ' + row.tone}>{row.band}</span>
          </div>)}
        </div>}

        {calcType === 'imc-embarazo' && <>
          <label className="anthro-inline-field">Semana de gestación<input type="number" min="1" max="42" value={gestWeek} onChange={(event) => setGestWeek(event.target.value)} /></label>
          <div className="calc-table">
            <div className="calc-table-head"><span>Categoría (IMC previo)</span><span>Ganancia total</span></div>
            {EMBARAZO_GAIN.map((z) => <div className={'calc-table-row' + (gestZone === z ? ' selected' : '')} key={z.label}><span className="calc-table-name">{z.label}</span><span className="calc-table-value">{z.range}</span></div>)}
          </div>
          <p className="anthro-hint">{gest ? `IMC con el peso actual: ${gest.toFixed(1)}${gestZone ? ` · ${gestZone.label} (semana ${gestWeek})` : ''}.` : 'Captura peso y estatura para ubicar la categoría.'}</p>
        </>}
      </section>
    </div>
  }

  const renderCalories = () => {
    const target = energyFromMacros(values['Peso (kg)'], macros, perKg)
    const setMacro = (key, value) => setMacros((prev) => ({ ...prev, [key]: value }))
    const balanceLabel = BALANCES.find(([k]) => k === balance)?.[1] || ''
    const rows = [['Hidratos', 'carbs', 0, 10, 0.1], ['Proteína', 'protein', 0, 5, 0.1], ['Lípidos', 'fat', 0, 3, 0.1]]
    return <div className="anthro-layout panel">
      <aside className="anthro-types"><p className="eyebrow">Balance energético</p>{BALANCES.map(([key, label]) => <button type="button" className={'anthro-type' + (balance === key ? ' active' : '')} key={key} onClick={() => setBalance(key)}><Icon>flame</Icon>{label}</button>)}</aside>
      <section className="anthro-main">
        <h2 className="anthro-title"><Icon>flame</Icon>Cálculo para {balanceLabel.toLowerCase()} calórico</h2>
        <p className="anthro-hint">Frecuentemente utilizado en pacientes para el aumento de masa muscular o la reducción de grasa.</p>
        <div className="calc-sliders">
          {rows.map(([label, key, min, max, step]) => <div className="calc-slider-row" key={key}>
            <span className="calc-slider-label">{label}</span>
            <input type="range" min={min} max={max} step={step} value={macros[key]} onChange={(event) => setMacro(key, Number(event.target.value))} />
            <input className="calc-slider-input" type="number" min={min} max={max} step={step} value={macros[key]} onChange={(event) => setMacro(key, Number(event.target.value))} />
            <span className="calc-slider-unit">{perKg ? 'g/kg' : 'g'}</span>
          </div>)}
          <label className="anthro-check"><input type="checkbox" checked={perKg} onChange={(event) => setPerKg(event.target.checked)} /> Gramos por kilos</label>
        </div>
        <div className="calc-result-strip">
          <div><small>Objetivo energético</small><b>{target.kcal.toLocaleString()} kcal</b><span>{balanceLabel} calórico · {target.carbs} g H · {target.protein} g P · {target.fat} g G</span></div>
          <button type="button" className="primary" onClick={() => onFieldChange?.('Objetivo calórico (kcal)', String(target.kcal))}>Guardar como objetivo</button>
        </div>
        <p className="anthro-note">Las calorías seleccionadas aparecen como Objetivo en la sección de Dietas.</p>
      </section>
    </div>
  }

  const renderSomatocarta = () => {
    const s = somatotype(values)
    const total = (s.endo || 0) + (s.meso || 0) + (s.ecto || 0)
    const V = { endo: [46, 214], meso: [150, 36], ecto: [254, 214] }
    const C = [150, 154.7]
    let point = null
    if (total > 0) {
      const we = (s.endo || 0) / total, wm = (s.meso || 0) / total, wx = (s.ecto || 0) / total
      point = [we * V.endo[0] + wm * V.meso[0] + wx * V.ecto[0], we * V.endo[1] + wm * V.meso[1] + wx * V.ecto[1]]
    }
    const metrics = [['Endomorfo', s.endo], ['Mesomorfo', s.meso], ['Ectomorfo', s.ecto], ['Eje X', s.x], ['Eje Y', s.y]]
    return <div className="anthro-layout panel">
      <aside className="anthro-types"><p className="eyebrow">Tipo</p>
        {metrics.map(([label, value]) => <div className="somato-metric" key={label}><span>{label}</span><b>{value ?? '—'}</b></div>)}
        <span className="somato-link">¿Qué es la somatocarta?</span>
      </aside>
      <section className="anthro-main">
        <h2 className="anthro-title"><Icon>triangle</Icon>Somatocarta (Heath-Carter)</h2>
        <div className="somato-chart">
          <svg viewBox="0 0 300 260" role="img" aria-label="Somatocarta">
            <polygon points={`${C[0]},${C[1]} ${V.endo[0]},${V.endo[1]} ${V.meso[0]},${V.meso[1]}`} fill="#e0583f" opacity="0.78" />
            <polygon points={`${C[0]},${C[1]} ${V.meso[0]},${V.meso[1]} ${V.ecto[0]},${V.ecto[1]}`} fill="#3fa46a" opacity="0.78" />
            <polygon points={`${C[0]},${C[1]} ${V.ecto[0]},${V.ecto[1]} ${V.endo[0]},${V.endo[1]}`} fill="#d7ad56" opacity="0.78" />
            <polygon points="150,36 46,214 254,214" fill="none" stroke="var(--line)" />
            <text x="150" y="26" textAnchor="middle" className="somato-vertex">Mesomorfo</text>
            <text x="40" y="234" textAnchor="middle" className="somato-vertex">Endomorfo</text>
            <text x="260" y="234" textAnchor="middle" className="somato-vertex">Ectomorfo</text>
            {point && <circle cx={point[0]} cy={point[1]} r="6.5" fill="var(--green)" stroke="#fff" strokeWidth="2.5" />}
          </svg>
        </div>
        <p className="anthro-hint">{total > 0 ? `Predominio ${s.meso >= s.endo && s.meso >= s.ecto ? 'mesomorfo' : s.endo >= s.ecto ? 'endomorfo' : 'ectomorfo'} · valores calculados de pliegues, perímetros y diámetros.` : 'Captura pliegues, perímetros y diámetros en Mediciones para calcular el somatotipo.'}</p>
      </section>
    </div>
  }

  const renderNotes = () => <div className="panel anthro-panel">
    <div className="anthro-panel-head"><h2><Icon>note</Icon>Notas de antropometría</h2><span className="muted">Se guarda automáticamente</span></div>
    <textarea className="anthro-textarea" value={values['Notas antropométricas'] ?? ''} onChange={(event) => onFieldChange?.('Notas antropométricas', event.target.value)} placeholder="Observaciones sobre la medición, condiciones del paciente, incidencias…" />
    <div className="anthro-note-grid">
      <label>Indicaciones<textarea value={values['Indicaciones antropométricas'] ?? ''} onChange={(event) => onFieldChange?.('Indicaciones antropométricas', event.target.value)} placeholder="Recomendaciones derivadas de la evaluación" /></label>
      <label>Próxima medición<textarea value={values['Próxima medición (nota)'] ?? ''} onChange={(event) => onFieldChange?.('Próxima medición (nota)', event.target.value)} placeholder="Cuándo repetir la medición" /></label>
    </div>
  </div>

  const renderPhotos = () => <div className="panel anthro-panel">
    <div className="anthro-panel-head"><h2><Icon>camera</Icon>Fotos de progreso</h2><label className="secondary anthro-upload">+ Agregar fotos<input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(event) => { addPhotos(event.target.files); event.target.value = '' }} /></label></div>
    {photoError && <p className="form-error">⚠ {photoError}</p>}
    {photos.length ? <div className="photo-grid">{photos.map((src, i) => <figure key={`${i}-${src.slice(-12)}`}><img src={src} alt={`Foto ${i + 1}`} /><button type="button" onClick={() => onFieldChange?.('Fotos antropométricas', photos.filter((_, index) => index !== i))}>×</button></figure>)}</div>
      : <div className="result-empty anthro-empty"><span>◌</span><h3>Sin fotos todavía</h3><p>Agrega fotos frontales, laterales o de progreso para dar seguimiento visual.</p></div>}
  </div>

  return <div className="anthro-module">
    <div className="anthro-tabs">{TABS.map(([label, icon]) => <button type="button" className={'anthro-tab' + (tab === label ? ' active' : '')} key={label} onClick={() => setTab(label)}><Icon>{icon}</Icon>{label}</button>)}</div>

    {tab === 'Mediciones' ? <div className="anthro-layout panel">
      <aside className="anthro-types"><p className="eyebrow">Tipo</p>{TYPES.map(([key, label, icon]) => <button type="button" className={'anthro-type' + (type === key ? ' active' : '')} key={key} onClick={() => selectType(key)}><Icon>{icon}</Icon>{label}</button>)}</aside>
      <section className="anthro-main">
        <h2 className="anthro-title"><Icon>{TYPES.find((t) => t[0] === type)?.[2]}</Icon>{TYPES.find((t) => t[0] === type)?.[1]}</h2>

        {type === 'peso' && <>
          <div className="anthro-fields">{GROUP_FIELDS.peso.map(renderField)}<label className="anthro-check"><input type="checkbox" checked={Boolean(values['Embarazo (antropometría)'])} onChange={(event) => onFieldChange?.('Embarazo (antropometría)', event.target.checked)} /> Embarazo</label></div>
          <div className="imc-block">
            <div className="imc-head"><b>Índice de masa corporal</b><span className="imc-value" style={{ color: imc ? category.color : undefined }}>{imc ? `IMC=${imc.toFixed(1)} · ${category.label}` : 'Ingresa peso y estatura'}</span></div>
            <div className="imc-row">
              <span className="imc-row-label">IMC</span>
              <div className="imc-scale">
                <div className="imc-bar">{IMC_ZONES.map((zone) => <span key={zone.to} style={{ width: `${((zone.to - (IMC_ZONES[IMC_ZONES.indexOf(zone) - 1]?.to || 4)) / 36) * 100}%`, background: zone.color }} />)}</div>
                {imc && <div className="imc-marker" style={{ left: `${markerPct}%` }}><i /></div>}
              </div>
            </div>
            <div className="imc-ticks">{[4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40].map((tick) => <span key={tick}>{tick}</span>)}</div>
          </div>
          <div className="anthro-actions"><span className="muted">Se guarda solo con cada cambio.</span><button type="button" className="primary" disabled={measurementState === 'saving' || (!peso && !talla)} onClick={() => registerMeasurement?.()}>{measurementState === 'saving' ? 'Registrando…' : todayMeasured ? 'Actualizar medición de hoy' : 'Registrar medición de hoy'} <span>→</span></button></div>
        </>}

        {type === 'bio' && <div className="anthro-fields">{GROUP_FIELDS.bio.map(renderField)}</div>}
        {type === 'pliegues' && renderMeasureGroup(GROUP_FIELDS.pliegues)}
        {type === 'perimetros' && renderMeasureGroup(GROUP_FIELDS.perimetros)}
        {type === 'diametros' && renderMeasureGroup(GROUP_FIELDS.diametros)}

        <p className="anthro-note">No es necesario completar todos los campos; sin embargo, entre más datos captures, más óptima será la evaluación de tu paciente.</p>
      </section>
    </div>
      : tab === 'Cálculos' ? renderCalculations()
      : tab === 'Calorías' ? renderCalories()
      : tab === 'Somatocarta' ? renderSomatocarta()
      : tab === 'Notas' ? renderNotes()
      : renderPhotos()}
  </div>
}
