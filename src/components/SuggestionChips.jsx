import { useState } from 'react'
import { scheduleGrowTextareas } from '../lib/autoGrow.js'

/**
 * Chips de sugerencia para un campo de texto libre: clic en un chip completa el campo con una frase
 * hecha, y "+ Rápido" agrega una sugerencia nueva sin salir del formulario.
 *
 * Las sugerencias de arranque (`seed`) son fijas en el código — son las comunes en consulta
 * (Diabetes, Hipertensión, Metformina…). Las que la nutrióloga agrega con "+ Rápido" se guardan en
 * `localStorage` de este navegador bajo `storageKey`: son atajos de redacción propios de quien los
 * crea, no datos clínicos del paciente, así que no hace falta sincronizarlos entre dispositivos ni
 * mandarlos al servidor — igual que un snippet de texto que cada quien arma a su manera.
 */
function useLocalSuggestions(storageKey, seed) {
  const [custom, setCustom] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  })
  const add = (suggestion) => {
    setCustom((prev) => {
      const next = [...prev, suggestion]
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* almacenamiento no disponible: el chip no persiste, pero no rompe la pantalla */ }
      return next
    })
  }
  const remove = (index) => {
    setCustom((prev) => {
      const next = prev.filter((_, i) => i !== index)
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ídem */ }
      return next
    })
  }
  return [[...seed.map((s) => ({ ...s, custom: false })), ...custom.map((s) => ({ ...s, custom: true }))], add, remove]
}

/**
 * `storageKey`  clave única de localStorage para las sugerencias agregadas a mano en este campo.
 * `seed`        sugerencias de arranque: [{ label, text }].
 * `value`       valor actual del campo (para decidir si se reemplaza o se añade).
 * `onPick(next)` se llama con el valor ya completado al hacer clic en un chip.
 * `joiner`      separador al añadir sobre texto existente (", " para listas, ". " para prosa).
 */
export default function SuggestionChips({ storageKey, seed, value, onPick, joiner = ', ' }) {
  const [suggestions, addSuggestion, removeSuggestion] = useLocalSuggestions(storageKey, seed)
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')

  const pick = (suggestionText) => {
    const current = (value || '').trim()
    if (!current) { onPick(suggestionText); scheduleGrowTextareas(); return }
    if (current.includes(suggestionText)) return // ya está: evita duplicar al hacer doble clic
    onPick(`${current}${current.endsWith(joiner.trim()) ? ' ' : joiner}${suggestionText}`)
    scheduleGrowTextareas()
  }

  const submitQuick = () => {
    if (!label.trim() || !text.trim()) return
    addSuggestion({ label: label.trim(), text: text.trim() })
    setLabel(''); setText(''); setOpen(false)
  }

  return <div className="chip-suggestions">
    <div className="chip-row">
      {suggestions.map((s, i) => <span className="chip-wrap" key={`${s.label}-${i}`}>
        <button type="button" className="chip" onClick={() => pick(s.text)} title={s.text}>{s.label}</button>
        {s.custom && <button type="button" className="chip-remove" title="Quitar sugerencia" onClick={() => removeSuggestion(i - seed.length)}>×</button>}
      </span>)}
      <button type="button" className="chip chip-add" onClick={() => setOpen((v) => !v)}>{open ? '× Cancelar' : '+ Rápido'}</button>
    </div>
    {open && <div className="chip-quick-form">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sugerencia (lo que se ve en el chip)" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Descripción (lo que se completa al hacer clic)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitQuick() } }} />
      <button type="button" className="secondary" onClick={submitQuick} disabled={!label.trim() || !text.trim()}>Agregar</button>
    </div>}
  </div>
}
