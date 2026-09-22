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

export default function Anthropometry({ values = {}, onFieldChange, registerMeasurement, measurementState = 'idle', todayMeasured = false }) {
  const [tab, setTab] = useState('Mediciones')
  const [type, setType] = useState('peso')

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
    return <div className="anthro-field" key={field.key + index}>
      <span className="anthro-field-label">{field.label}</span>
      <div className="anthro-field-input">
        <input type="number" step="0.1" value={value} onChange={(event) => onFieldChange?.(field.key, event.target.value)} />
        <span className="anthro-unit">{field.unit}</span>
      </div>
      <span className="anthro-derived">{derived || ''}</span>
    </div>
  }

  const renderPlaceholder = (label) => <div className="result-empty panel anthro-placeholder"><span>◌</span><h3>{label}</h3><p>Esta sección llega en la siguiente entrega del módulo antropométrico.</p></div>

  return <div className="anthro-module">
    <div className="anthro-tabs">{TABS.map(([label, icon]) => <button type="button" className={'anthro-tab' + (tab === label ? ' active' : '')} key={label} onClick={() => setTab(label)}><Icon>{icon}</Icon>{label}</button>)}</div>

    {tab === 'Mediciones' ? <div className="anthro-layout panel">
      <aside className="anthro-types"><p className="eyebrow">Tipo</p>{TYPES.map(([key, label, icon]) => <button type="button" className={'anthro-type' + (type === key ? ' active' : '')} key={key} onClick={() => setType(key)}><Icon>{icon}</Icon>{label}</button>)}</aside>
      <section className="anthro-main">
        <h2 className="anthro-title"><Icon>{TYPES.find((t) => t[0] === type)?.[2]}</Icon>{TYPES.find((t) => t[0] === type)?.[1]}</h2>

        {type === 'peso' && <>
          <div className="anthro-fields">{GROUP_FIELDS.peso.map(renderField)}<label className="anthro-check"><input type="checkbox" checked={Boolean(values['Embarazo (antropometría)'])} onChange={(event) => onFieldChange?.('Embarazo (antropometría)', event.target.checked)} /> Embarazo</label></div>
          <div className="imc-block">
            <div className="imc-head"><b>Índice de masa corporal</b>{imc && <span className="imc-value" style={{ color: category.color }}>IMC {imc.toFixed(1)} · {category.label}</span>}</div>
            <div className="imc-scale">
              <div className="imc-bar">{IMC_ZONES.map((zone) => <span key={zone.to} style={{ width: `${((zone.to - (IMC_ZONES[IMC_ZONES.indexOf(zone) - 1]?.to || 4)) / 36) * 100}%`, background: zone.color }} />)}</div>
              {imc && <div className="imc-marker" style={{ left: `${markerPct}%` }}><i /></div>}
            </div>
            <div className="imc-ticks">{[4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40].map((tick) => <span key={tick}>{tick}</span>)}</div>
          </div>
          <div className="anthro-actions"><span className="muted">Se guarda solo con cada cambio.</span><button type="button" className="primary" disabled={measurementState === 'saving' || (!peso && !talla)} onClick={() => registerMeasurement?.()}>{measurementState === 'saving' ? 'Registrando…' : todayMeasured ? 'Actualizar medición de hoy' : 'Registrar medición de hoy'} <span>→</span></button></div>
        </>}

        {type === 'bio' && <div className="anthro-fields">{GROUP_FIELDS.bio.map(renderField)}</div>}
        {type === 'pliegues' && <div className="anthro-fields">{GROUP_FIELDS.pliegues.map(renderField)}</div>}
        {type === 'perimetros' && <div className="anthro-fields">{GROUP_FIELDS.perimetros.map(renderField)}</div>}
        {type === 'diametros' && <div className="anthro-fields">{GROUP_FIELDS.diametros.map(renderField)}</div>}

        <p className="anthro-note">No es necesario completar todos los campos; entre más datos captures, más completa será la evaluación.</p>
      </section>
    </div>
      : renderPlaceholder(tab)}
  </div>
}
