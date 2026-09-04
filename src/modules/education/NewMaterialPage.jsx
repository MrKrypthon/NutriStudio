import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { educationApi } from '../../lib/api.js'

const CATEGORIES = ['Guías prácticas', 'Material para paciente', 'Hábitos saludables', 'Infografía', 'Guía de consulta']
const COLORS = ['mint', 'yellow', 'blue', 'coral', 'purple']

export default function NewMaterialPage({ setActive, materialId }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [color, setColor] = useState('mint')
  const [readMinutes, setReadMinutes] = useState(5)
  const [saved, setSaved] = useState(false)
  const [saveState, setSaveState] = useState(materialId ? 'loading' : 'idle')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!materialId) return
    educationApi.get(materialId).then((material) => {
      setTitle(material.title)
      setCategory(material.category)
      setDescription(material.description || '')
      setBody(material.body || '')
      setColor(material.color || 'mint')
      setReadMinutes(material.readMinutes || 5)
      setSaveState('idle')
    }).catch(() => { setSaveState('error'); setSaveError('No se pudo cargar el material — el API no responde.') })
  }, [materialId])

  const save = async () => {
    if (!title || !category) return
    setSaveState('saving')
    setSaveError('')
    try {
      const payload = { title, category, description, body, color, readMinutes }
      if (materialId) await educationApi.update(materialId, payload)
      else await educationApi.create(payload)
      setSaveState('idle')
      setSaved(true)
    } catch { setSaveState('error'); setSaveError('No se pudo guardar el material — verifica que el API esté activo.') }
  }

  return <AppChrome active="Educación" setActive={setActive}><div className="content new-recipe">
    <button className="back-button" onClick={() => setActive('Educación')}>← Educación</button>
    <ModuleHeader eyebrow="BIBLIOTECA · MATERIAL EDUCATIVO" title={materialId ? 'Editar material' : 'Crear material'} subtitle="Comparte contenido claro que refuerce lo trabajado en consulta." action={<span className="draft-label">Borrador</span>} />

    {saved
      ? <div className="success-panel panel">
          <span>✓</span>
          <h2>Material guardado correctamente</h2>
          <p>Ya está disponible en tu biblioteca de educación.</p>
          <button className="primary" onClick={() => setActive('Educación')}>Ver biblioteca <span>→</span></button>
        </div>
      : <div className="new-recipe-layout">
          <section className="panel recipe-form">
            <div className="form-section-title"><span>01</span><div><h2>Información del material</h2><p>Define cómo aparecerá en la biblioteca.</p></div></div>
            <label>Título *<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Método visual de porciones" /></label>
            <div className="form-grid">
              <label>Categoría<select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Tiempo de lectura (min)<input type="number" min="1" value={readMinutes} onChange={(e) => setReadMinutes(Number(e.target.value))} /></label>
            </div>
            <label>Color de portada<select value={color} onChange={(e) => setColor(e.target.value)}>{COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <div className="form-section-title second"><span>02</span><div><h2>Contenido</h2><p>Lo que verá y podrá compartir la paciente.</p></div></div>
            <label>Descripción breve<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Una línea que resuma el material" /></label>
            <textarea className="wide-textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe el contenido completo..." />
            {saveState === 'error' && <div className="form-error">⚠ {saveError}</div>}
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setActive('Educación')}>Cancelar</button>
              <button type="button" className="primary" disabled={!title || !category || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : 'Guardar material'} <span>→</span></button>
            </div>
          </section>
          <aside className="panel recipe-preview">
            <p className="eyebrow">VISTA PREVIA</p>
            <div className={'recipe-preview-image ' + color}>✦</div>
            <span className="recipe-meal">{category}</span>
            <h2>{title || 'Título de tu material'}</h2>
            <p className="muted">{description || 'Descripción breve del material'} · {readMinutes} min</p>
            <div className="preview-note">El contenido completo se comparte copiándolo desde la biblioteca.</div>
          </aside>
        </div>}
  </div></AppChrome>
}
