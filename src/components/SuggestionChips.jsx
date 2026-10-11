import { useEffect, useMemo, useState } from 'react'
import { suggestionsApi } from '../lib/api.js'
import { scheduleGrowTextareas } from '../lib/autoGrow.js'

/**
 * Chips de sugerencia para un campo de texto libre: clic en un chip completa el campo con una frase
 * hecha, y "+ Agregar" agrega una sugerencia nueva sin salir del formulario.
 *
 * Las sugerencias de arranque (`seed`) son fijas en el código — son las comunes en consulta
 * (Diabetes, Hipertensión, Metformina…). Las que la nutrióloga agrega con "+ Agregar" se guardan en
 * el **servidor** por `fieldKey`: son atajos de redacción de toda la práctica, así que aparecen en
 * cualquier paciente y en cualquier dispositivo. No van dentro de la consulta porque no son datos
 * clínicos del paciente. Si el API no está disponible (modo demo), caen a `localStorage` para que al
 * menos sobrevivan en este navegador.
 *
 * Al elegir un chip, cada entrada se acomoda en su propia línea con viñeta (· …), para que una lista
 * de antecedentes o medicamentos quede como lista y no como un párrafo corrido.
 */

const LOCAL_PREFIX = 'suggestion-chips:'
const readLocal = (fieldKey) => {
  try { const parsed = JSON.parse(localStorage.getItem(LOCAL_PREFIX + fieldKey) || '[]'); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}
const writeLocal = (fieldKey, items) => { try { localStorage.setItem(LOCAL_PREFIX + fieldKey, JSON.stringify(items)) } catch { /* almacenamiento no disponible */ } }

// Compara sin distinguir mayúsculas ni acentos ("Pérdida" ≈ "perdida").
const normalize = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function useSuggestions(fieldKey, seed) {
  const [custom, setCustom] = useState([])

  useEffect(() => {
    let alive = true
    setCustom([])
    suggestionsApi.list(fieldKey)
      .then((data) => { if (alive) setCustom(data?.items || []) })
      .catch(() => { if (alive) setCustom(readLocal(fieldKey)) })
    return () => { alive = false }
  }, [fieldKey])

  const add = (suggestion) => {
    const temp = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, label: suggestion.label, text: suggestion.text }
    setCustom((prev) => [...prev, temp])
    suggestionsApi.create({ fieldKey, label: suggestion.label, text: suggestion.text })
      .then((created) => setCustom((cur) => cur.map((s) => (s.id === temp.id ? created : s))))
      .catch(() => writeLocal(fieldKey, [...readLocal(fieldKey), { label: suggestion.label, text: suggestion.text }]))
  }

  const remove = (id) => {
    setCustom((prev) => prev.filter((s) => s.id !== id))
    if (!String(id).startsWith('local-')) suggestionsApi.remove(id).catch(() => { /* ya no está en el servidor */ })
  }

  return useMemo(() => {
    const seedLabels = new Set(seed.map((s) => s.label))
    const merged = [
      ...seed.map((s) => ({ ...s, custom: false })),
      ...custom.filter((s) => !seedLabels.has(s.label)).map((s) => ({ id: s.id, label: s.label, text: s.text, custom: true })),
    ]
    return [merged, add, remove]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, custom])
}

/**
 * `fieldKey`    clave del campo (agrupa sus sugerencias en el servidor).
 * `seed`        sugerencias de arranque: [{ label, text }].
 * `value`       valor actual del campo (para decidir si se reemplaza o se añade).
 * `onPick(next)` se llama con el valor ya completado al hacer clic en un chip.
 */
export default function SuggestionChips({ fieldKey, seed, value, onPick }) {
  const [suggestions, addSuggestion, removeSuggestion] = useSuggestions(fieldKey, seed)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')

  const pick = (suggestionText) => {
    const current = (value || '').replace(/\s+$/, '')
    if (!current) { onPick(`· ${suggestionText}`); scheduleGrowTextareas(); return }
    // Cada entrada va en su propia línea con viñeta (·). Si ya está en la lista, no se duplica.
    const existing = current.split('\n').map((line) => line.replace(/^·\s*/, '').trim())
    if (existing.includes(suggestionText)) return
    onPick(`${current}\n· ${suggestionText}`)
    scheduleGrowTextareas()
  }

  // Autocompletado: mientras se escribe la línea actual, se ofrecen las sugerencias que empiezan o
  // contienen ese texto. Al elegir una, se reemplaza la línea en curso por la entrada completa.
  const fragment = (() => {
    const raw = value || ''
    const nl = raw.lastIndexOf('\n')
    return (nl >= 0 ? raw.slice(nl + 1) : raw).replace(/^·\s*/, '')
  })()
  const matches = (() => {
    const q = normalize(fragment).trim()
    if (q.length < 2) return []
    const used = new Set((value || '').split('\n').map((line) => normalize(line.replace(/^·\s*/, '')).trim()))
    return suggestions
      .filter((s) => !used.has(normalize(s.text).trim()) && (normalize(s.label).startsWith(q) || normalize(s.label).includes(q) || normalize(s.text).includes(q)))
      .slice(0, 6)
  })()
  const complete = (suggestion) => {
    const raw = value || ''
    const nl = raw.lastIndexOf('\n')
    const prefix = nl >= 0 ? raw.slice(0, nl + 1) : ''
    onPick(`${prefix}· ${suggestion.text}`)
    scheduleGrowTextareas()
  }

  const submitQuick = () => {
    const name = label.trim()
    if (!name) return
    // Sólo se captura el nombre: es lo que se ve en el chip y lo que se escribe al elegirlo.
    addSuggestion({ label: name, text: name })
    setLabel(''); setOpen(false)
  }

  return <div className="chip-suggestions">
    {fragment.trim().length >= 2 && matches.length > 0 && <div className="chip-autocomplete">
      <span>Autocompletar:</span>
      {matches.map((s) => <button type="button" key={s.id || s.label} className="chip-ac-item" title={s.text} onClick={() => complete(s)}>{s.label}</button>)}
    </div>}
    <div className="chip-row">
      {suggestions.map((s, i) => <span className="chip-wrap" key={s.id || `${s.label}-${i}`}>
        {s.custom
          ? <span className="chip chip-removable"><button type="button" className="chip-removable-label" onClick={() => pick(s.text)} title={s.text}>{s.label}</button><button type="button" className="chip-remove" title="Quitar sugerencia" onClick={() => removeSuggestion(s.id)}>×</button></span>
          : <button type="button" className="chip" onClick={() => pick(s.text)} title={s.text}>{s.label}</button>}
      </span>)}
      <button type="button" className="chip chip-add" onClick={() => setOpen((v) => !v)}>{open ? '× Cancelar' : '+ Agregar'}</button>
    </div>
    {open && <div className="chip-quick-form">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nueva sugerencia…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitQuick() } }} />
      <button type="button" className="secondary" onClick={submitQuick} disabled={!label.trim()}>Agregar</button>
    </div>}
  </div>
}
