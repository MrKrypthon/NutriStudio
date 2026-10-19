import { useEffect, useRef, useState } from 'react'
import { plansApi, practiceApi } from '../../lib/api.js'
import { DEFAULT_PDF_THEME, PDF_FONTS, PDF_THEME_PRESETS, mixColor, normalizePdfTheme, textOn } from '../../../server/domain/pdfTheme.js'

const sameTheme = (a, b) => JSON.stringify(normalizePdfTheme(a)) === JSON.stringify(normalizePdfTheme(b))
const COLOR_FIELDS = [['primary', 'Color principal', 'Títulos y encabezado de la tabla'], ['accent', 'Color de acento', 'Ondas y datos de contacto'], ['fill', 'Fondo de las celdas', 'Detrás de cada receta']]
const OPTION_SAMPLE = ['#D81B7A', '#7B68EE', '#1E88E5']
const OPTION_CELL_SAMPLE = ['#FDE3EC', '#D5CEEB', '#CDE1FA']

// Muestra en miniatura del plan (encabezado, tabla, círculos de grupo y pie) para ver el diseño sin
// generar el PDF. Sólo aproxima: la vista previa real es el PDF del paso Guardar.
function MiniPreview({ theme, logoUrl }) {
  const font = PDF_FONTS[theme.font]?.css
  const timeFill = theme.colorfulOptions ? '#B8C8EE' : mixColor(theme.primary, 0.84)
  const badge = theme.colorfulGroups ? { background: '#6FD145', color: '#1A1A1A', border: 0 } : { background: mixColor(theme.primary, 0.88), color: theme.primary, border: `1px solid ${theme.primary}` }
  return <div className="pdfd-mini" style={{ fontFamily: font }} aria-label="Muestra del diseño del PDF">
    {theme.waves ? <svg className="pdfd-waves" viewBox="0 0 792 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0,0 L600,0 C460,40 250,78 0,88 Z" fill={mixColor(theme.accent, 0.82)} /><path d="M0,0 L572,0 C410,34 220,56 0,59 Z" fill={mixColor(theme.accent, 0.45)} /><path d="M0,0 L530,0 C380,20 180,30 0,29 Z" fill={theme.accent} /></svg> : <i className="pdfd-rule" style={{ background: mixColor(theme.primary, 0.7) }} />}
    {theme.showLogo && logoUrl && <img className="pdfd-logo" src={logoUrl} alt="" />}
    <b className="pdfd-title" style={{ color: theme.primary }}>Plan de Alimentación</b>
    <small className="pdfd-sub">Nombre: Paciente de ejemplo · Peso: 64 Kg</small>
    <div className="pdfd-table">
      <span style={{ background: theme.primary, color: textOn(theme.primary) }} />
      <span style={{ background: theme.primary, color: textOn(theme.primary) }}>Porción</span>
      {[0, 1, 2].map((index) => { const head = theme.colorfulOptions ? OPTION_SAMPLE[index] : theme.primary; return <span key={index} style={{ background: head, color: theme.colorfulOptions ? '#fff' : textOn(head) }}>Opción {index + 1}</span> })}
      <span className="pdfd-time" style={{ background: timeFill, color: theme.colorfulOptions ? '#46507A' : theme.primary }}>Desayuno</span>
      <span className="pdfd-badges"><i style={badge}>C</i><i style={badge}>F</i></span>
      {[0, 1, 2].map((index) => <span key={index} className="pdfd-cell" style={{ background: theme.colorfulOptions ? OPTION_CELL_SAMPLE[index] : theme.fill }}><em /><b>Receta {index + 1}</b><small>-1 taza de avena</small><small>-1 pieza de fruta</small></span>)}
    </div>
    <small className="pdfd-contact" style={{ color: theme.accent }}><i style={{ background: theme.accent }} /> 999 123 4567 · consultorio@correo.com</small>
  </div>
}

// Diseño del plan en PDF: paletas listas, colores, tipografía, ondas, logo y los colores del
// formato original. Se guarda para todo el consultorio. Con `planId` muestra el PDF real de ese
// plan con el diseño en edición (sin guardarlo); sin él, una muestra en miniatura.
export default function PdfDesignEditor({ planId = null, onSaved }) {
  const [state, setState] = useState('loading')
  const [saved, setSaved] = useState(DEFAULT_PDF_THEME)
  const [theme, setTheme] = useState(DEFAULT_PDF_THEME)
  const [logoUrl, setLogoUrl] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const [preview, setPreview] = useState({ url: '', state: 'idle' })
  const previewRef = useRef('')

  useEffect(() => {
    practiceApi.get().then((practice) => {
      const current = normalizePdfTheme(practice.pdfTheme)
      setSaved(current); setTheme(current)
      if (practice.logoUrl) setLogoUrl(practiceApi.logoUrl(practice.id))
      setState('ready')
    }).catch(() => setState('error'))
  }, [])

  // Vista previa real: se pide el PDF con el diseño en edición, medio segundo después del último cambio.
  useEffect(() => {
    if (!planId || state !== 'ready') return undefined
    let cancelled = false
    setPreview((prev) => ({ ...prev, state: 'loading' }))
    const timer = setTimeout(() => {
      plansApi.previewPdfBlob(planId, theme).then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreview({ url, state: 'ready' })
      }).catch(() => { if (!cancelled) setPreview((prev) => ({ ...prev, state: 'error' })) })
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [planId, state, theme])
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  const update = (patch) => { setTheme((prev) => normalizePdfTheme({ ...prev, ...patch })); setSaveState('idle') }
  const dirty = !sameTheme(theme, saved)
  const save = async () => {
    setSaveState('saving')
    try {
      const response = await practiceApi.updatePdfTheme(theme)
      const next = normalizePdfTheme(response.pdfTheme)
      setSaved(next); setTheme(next); setSaveState('saved')
      onSaved?.(next)
    } catch { setSaveState('error') }
  }
  const activePreset = PDF_THEME_PRESETS.find((preset) => sameTheme(preset.theme, theme))?.key

  if (state === 'loading') return <p className="muted">Cargando diseño…</p>
  if (state === 'error') return <div className="form-error">⚠ No se pudo cargar el diseño del PDF.</div>

  return <div className={'pdfd' + (planId ? ' with-pdf' : '')}>
    <div className="pdfd-controls">
      <div className="pdfd-block">
        <small className="pdfd-label">Paletas</small>
        <div className="pdfd-presets">{PDF_THEME_PRESETS.map((preset) => <button type="button" key={preset.key} className={activePreset === preset.key ? 'active' : ''} onClick={() => { setTheme(normalizePdfTheme(preset.theme)); setSaveState('idle') }}>
          <span className="pdfd-swatch" aria-hidden="true">{preset.theme.colorfulOptions ? OPTION_SAMPLE.map((color) => <i key={color} style={{ background: color }} />) : [preset.theme.primary, preset.theme.accent, preset.theme.fill].map((color, index) => <i key={index} style={{ background: color }} />)}</span>{preset.label}
        </button>)}</div>
      </div>
      <div className="pdfd-block pdfd-colors">{COLOR_FIELDS.map(([key, label, hint]) => <label key={key} className="pdfd-color"><input type="color" value={theme[key].toLowerCase()} onChange={(event) => update({ [key]: event.target.value })} /><span><b>{label}</b><small>{hint}</small></span><code>{theme[key]}</code></label>)}</div>
      <label className="pdfd-block pdfd-font"><small className="pdfd-label">Tipografía</small>
        <select value={theme.font} onChange={(event) => update({ font: event.target.value })} style={{ fontFamily: PDF_FONTS[theme.font]?.css }}>{Object.entries(PDF_FONTS).map(([key, font]) => <option key={key} value={key} style={{ fontFamily: font.css }}>{font.label}</option>)}</select>
        <span className="pdfd-font-sample" style={{ fontFamily: PDF_FONTS[theme.font]?.css }}>Plan de Alimentación · Avena con fruta y nuez</span>
      </label>
      <div className="pdfd-block pdfd-toggles">
        <label><input type="checkbox" checked={theme.showLogo} onChange={(event) => update({ showLogo: event.target.checked })} /><span><b>Logo del consultorio</b><small>{logoUrl ? 'El que tienes en Configuración' : 'Aún no subes un logo en Configuración'}</small></span></label>
        <label><input type="checkbox" checked={theme.waves} onChange={(event) => update({ waves: event.target.checked })} /><span><b>Ondas decorativas</b><small>Arriba y abajo de cada hoja; sin ellas, líneas finas</small></span></label>
        <label><input type="checkbox" checked={theme.colorfulOptions} onChange={(event) => update({ colorfulOptions: event.target.checked })} /><span><b>Un color por opción</b><small>Cada columna de recetas en su tono, como el formato original</small></span></label>
        <label><input type="checkbox" checked={theme.colorfulGroups} onChange={(event) => update({ colorfulGroups: event.target.checked })} /><span><b>Grupos de alimentos a color</b><small>Círculos de porciones y listas de equivalentes</small></span></label>
      </div>
      <div className="pdfd-actions">
        <button type="button" className="primary" disabled={!dirty || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : 'Guardar diseño'}</button>
        {dirty && <button type="button" className="link-button" onClick={() => { setTheme(saved); setSaveState('idle') }}>Descartar cambios</button>}
        {!dirty && !sameTheme(theme, DEFAULT_PDF_THEME) && <button type="button" className="link-button" onClick={() => update(DEFAULT_PDF_THEME)}>Volver a blanco y negro</button>}
        {saveState === 'saved' && !dirty && <span className="saved">● Diseño guardado</span>}
        {saveState === 'error' && <span className="form-error">⚠ No se pudo guardar.</span>}
      </div>
      <small className="muted">Aplica a todos los planes que descargues o regeneres desde ahora.</small>
    </div>
    <div className="pdfd-preview">
      {planId
        ? <>{preview.url && <iframe className="plan-pdf-frame" title="Vista previa del PDF con este diseño" src={`${preview.url}#toolbar=0&navpanes=0&view=FitH`} />}
          {preview.state === 'loading' && <span className="pdfd-loading">Actualizando vista previa…</span>}
          {preview.state === 'error' && <p className="form-error">⚠ No se pudo generar la vista previa.</p>}</>
        : <MiniPreview theme={theme} logoUrl={logoUrl} />}
    </div>
  </div>
}
