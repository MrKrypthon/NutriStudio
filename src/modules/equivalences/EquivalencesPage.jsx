import { useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { smaeApi } from '../../lib/smaeApi.js'

// Columnas de las tablas del libro, en su orden. `short` es el encabezado de la tabla.
const COLUMNS = [
  ['grossWeight', 'Peso bruto', 'g', 'Bruto'], ['netWeight', 'Peso neto', 'g', 'Neto'], ['kcal', 'Energía', 'kcal', 'Kcal'],
  ['protein', 'Proteína', 'g', 'Prot'], ['fat', 'Lípidos', 'g', 'Líp'], ['carbs', 'Hidratos de carbono', 'g', 'HdC'],
  ['satFat', 'AG saturados', 'g', 'AGS'], ['monoFat', 'AG monoinsaturados', 'g', 'AGM'], ['polyFat', 'AG poliinsaturados', 'g', 'AGP'],
  ['cholesterol', 'Colesterol', 'mg', 'Col'], ['sugar', 'Azúcar', 'g', 'Azúc'], ['fiber', 'Fibra', 'g', 'Fibra'],
  ['vitA', 'Vitamina A', 'µg RE', 'Vit A'], ['vitC', 'Ácido ascórbico', 'mg', 'Vit C'], ['folicAcid', 'Ácido fólico', 'µg', 'Fólico'],
  ['calcium', 'Calcio', 'mg', 'Ca'], ['iron', 'Hierro', 'mg', 'Fe'], ['potassium', 'Potasio', 'mg', 'K'],
  ['sodium', 'Sodio', 'mg', 'Na'], ['phosphorus', 'Fósforo', 'mg', 'P'], ['ethanol', 'Etanol', 'g', 'Etanol'],
  ['gi', 'Índice glicémico', '', 'IG'], ['gl', 'Carga glicémica', '', 'CG'],
]
const REASONS = { 'lecturas distintas': 'Las dos lecturas del libro no coinciden', 'difiere del catálogo': 'No coincide con el catálogo de Ingredientes', ilegible: 'No se pudo leer', 'nombre dudoso': 'El nombre puede traer texto del renglón de arriba', 'no cuadra con los macros': 'La energía no cuadra con los macronutrimentos' }
const PAGE_SIZE = 50
const show = (value) => (value === null || value === undefined ? 'ND' : String(value))
// Cantidad como se escribe en el libro: "3 1/2", "1/4". La lectura a veces pega el entero con la
// fracción ("31/2"), así que se arma a partir del número.
const FRACTIONS = [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']]
const formatQty = (food) => {
  if (food.qty == null) return food.qtyText || '—'
  const value = Number(food.qty)
  const whole = Math.floor(value)
  const fraction = FRACTIONS.find(([part]) => Math.abs(value - whole - part) < 0.02)
  if (fraction) return whole ? `${whole} ${fraction[1]}` : fraction[1]
  return String(Math.round(value * 100) / 100)
}

// Detalle de un alimento: todos sus valores, editables. Las celdas marcadas para revisión muestran
// por qué y ofrecen las otras lecturas para elegir con un clic.
function FoodDetail({ food, onClose, onSaved }) {
  const [draft, setDraft] = useState({})
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const review = food.review || {}
  const valueOf = (key) => (key in draft ? draft[key] : food.nutrients?.[key])
  const set = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }))
  const pending = Object.keys(review)
  const dirty = Object.keys(draft).length > 0
  const save = async (values) => {
    setState('saving'); setError('')
    try { onSaved(await smaeApi.update(food.id, values)); setDraft({}); setState('idle') }
    catch (err) { setState('error'); setError(err.message || 'No se pudo guardar.') }
  }
  // "Confirmar" da por buenos los valores que se ven en las celdas marcadas (más lo editado).
  const confirmAll = () => save({ ...Object.fromEntries(pending.filter((key) => COLUMNS.some(([column]) => column === key)).map((key) => [key, food.nutrients?.[key] ?? null])), ...(review.name ? { name: food.name } : {}), ...(review.unit ? { unit: food.unit } : {}), ...(review.qty && food.qty != null ? { qty: Number(food.qty) } : {}), ...draft })
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !dirty) onClose() }}><div className="modal smae-detail">
    <div className="modal-head"><div><p className="eyebrow">{food.group.toUpperCase()} · SMAE 5ª ED. · HOJA {food.page}, RENGLÓN {food.row}</p><h2>{food.name}</h2><span className="modal-subtitle">1 equivalente = {formatQty(food)} {food.unit || ''} · valores por equivalente. Deja un campo vacío para "ND" (no determinado).</span></div><button onClick={onClose} aria-label="Cerrar">×</button></div>
    {pending.length > 0 && <div className="smae-review-note"><b>{pending.length} dato{pending.length === 1 ? '' : 's'} por revisar.</b> La lectura automática del libro no es segura en las celdas marcadas: compáralas con tu ejemplar (hoja {food.page}) y corrige o confirma.</div>}
    <div className="smae-fields">{COLUMNS.map(([key, label, unit]) => {
      const flag = review[key]
      const current = valueOf(key)
      const options = flag ? [...new Set([flag.alt, flag.catalog, flag.expected].filter((value) => value !== undefined && value !== null && value !== food.nutrients?.[key]))] : []
      return <label key={key} className={'smae-field' + (flag ? ' flagged' : '') + (key in draft ? ' edited' : '')}>
        <span>{label}{unit ? <small> ({unit})</small> : null}</span>
        <input type="number" step="0.1" min="0" value={current ?? ''} placeholder="ND" onChange={(event) => set(key, event.target.value === '' ? null : Number(event.target.value))} />
        {flag && <small className="smae-flag">{REASONS[flag.reason] || flag.reason}{options.length > 0 && <> · otra lectura: {options.map((option) => <button type="button" key={option} onClick={() => set(key, option)}>{option}</button>)}</>}</small>}
      </label>
    })}</div>
    {error && <div className="form-error">⚠ {error}</div>}
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
      {pending.length > 0 && <button type="button" className="secondary" disabled={state === 'saving'} onClick={confirmAll}>{dirty ? 'Guardar y confirmar todo' : 'Confirmar: está correcto'}</button>}
      <button type="button" className="primary" disabled={!dirty || state === 'saving'} onClick={() => save(draft)}>{state === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button>
    </div>
  </div></div>
}

// Equivalencias: los alimentos del Sistema Mexicano de Alimentos Equivalentes (5ª ed.) tal como
// vienen en las tablas del libro, por grupo, con búsqueda y con las celdas dudosas a la vista.
export default function EquivalencesPage({ setActive }) {
  const [groups, setGroups] = useState([])
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0 })
  const [state, setState] = useState('loading')
  const [selected, setSelected] = useState(null)

  const loadGroups = () => smaeApi.groups().then((response) => setGroups(response.items || [])).catch(() => {})
  useEffect(() => { loadGroups() }, [])
  useEffect(() => { setPage(1) }, [group, search, onlyReview])
  useEffect(() => {
    let cancelled = false
    setState('loading')
    const timer = setTimeout(() => {
      smaeApi.list({ group, search: search.trim(), review: onlyReview ? '1' : '', page, pageSize: PAGE_SIZE })
        .then((response) => { if (!cancelled) { setData(response); setState('ready') } })
        .catch(() => { if (!cancelled) setState('error') })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [group, search, onlyReview, page])

  const totals = useMemo(() => ({ foods: groups.reduce((sum, item) => sum + item.count, 0), pending: groups.reduce((sum, item) => sum + item.pending, 0) }), [groups])
  const pages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE))
  const onSaved = (updated) => {
    setData((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === updated.id ? updated : item)) }))
    setSelected(updated)
    loadGroups()
  }

  return <AppChrome active="Equivalencias" setActive={setActive}><div className="content smae-page">
    <ModuleHeader eyebrow="BIBLIOTECA · SMAE 5ª EDICIÓN" title="Equivalencias" subtitle="Los alimentos del Sistema Mexicano de Alimentos Equivalentes, por grupo: la porción que vale un equivalente y su aporte." action={totals.foods > 0 ? <span className="sync-label online">{totals.foods.toLocaleString()} alimentos{totals.pending ? ` · ${totals.pending} con datos por revisar` : ''}</span> : null} />
    <div className="smae-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar alimento…" /></div>
      <select value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Grupo"><option value="">Todos los grupos</option>{groups.map((item) => <option value={item.group} key={item.group}>{item.group} ({item.count})</option>)}</select>
      <label className="smae-check"><input type="checkbox" checked={onlyReview} onChange={(event) => setOnlyReview(event.target.checked)} /> Sólo con datos por revisar</label>
    </div>
    <div className="module-body">
      {state === 'error' && <div className="form-error">⚠ No se pudieron cargar los alimentos.</div>}
      {state !== 'error' && totals.foods === 0 && state === 'ready' && <div className="result-empty panel"><span>◌</span><h3>Todavía no se ha cargado el libro</h3><p>Carga los alimentos con <code>npm run db:import-smae-libro</code>.</p></div>}
      {totals.foods > 0 && <div className="panel smae-table-panel">
        <div className="smae-table-scroll"><table className="smae-table">
          <thead><tr><th className="smae-name">Alimento</th><th>Cantidad</th><th>Unidad</th>{COLUMNS.map(([key, label, unit, short]) => <th key={key} title={`${label}${unit ? ` (${unit})` : ''}`}>{short}</th>)}<th>Hoja</th></tr></thead>
          <tbody>{data.items.map((food) => { const review = food.review || {}; return <tr key={food.id} className={Object.keys(review).length ? 'has-review' : ''} onClick={() => setSelected(food)}>
            <td className={'smae-name' + (review.name ? ' flagged' : '')}><b>{food.name}</b>{!group && <small>{food.group}</small>}</td>
            <td className={review.qty ? 'flagged' : ''}>{formatQty(food)}</td>
            <td className={review.unit ? 'flagged' : ''}>{food.unit}</td>
            {COLUMNS.map(([key]) => <td key={key} className={(review[key] ? 'flagged ' : '') + (food.nutrients?.[key] == null ? 'nd' : '')} title={review[key] ? REASONS[review[key].reason] || review[key].reason : undefined}>{show(food.nutrients?.[key])}</td>)}
            <td className="nd">{food.page}</td>
          </tr> })}</tbody>
        </table></div>
        {state === 'ready' && data.items.length === 0 && <p className="muted smae-empty">Sin alimentos con ese filtro.</p>}
        <div className="smae-pager"><span className="muted">{data.total.toLocaleString()} alimento{data.total === 1 ? '' : 's'} · las celdas en ámbar tienen la lectura por revisar · "ND" = no determinado en el libro</span><div><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Anterior</button><b>{page} / {pages}</b><button type="button" className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente →</button></div></div>
      </div>}
    </div>
    {selected && <FoodDetail key={selected.id} food={selected} onClose={() => setSelected(null)} onSaved={onSaved} />}
  </div></AppChrome>
}
