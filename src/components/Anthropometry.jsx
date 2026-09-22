import { useState } from 'react'
import Icon from './Icon.jsx'

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

export default function Anthropometry({ values = {}, onFieldChange, registerMeasurement, measurementState = 'idle', todayMeasured = false }) {
  const [tab, setTab] = useState('Mediciones')
  const [type, setType] = useState('peso')
  const [activeField, setActiveField] = useState(GROUP_FIELDS.pliegues[0].key)
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

  const renderPlaceholder = (label) => <div className="result-empty panel anthro-placeholder"><span>◌</span><h3>{label}</h3><p>Esta sección llega en la siguiente entrega del módulo antropométrico.</p></div>

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
      : renderPlaceholder(tab)}
  </div>
}
