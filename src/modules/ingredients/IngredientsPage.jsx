import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { ingredientsApi } from '../../lib/api.js'

const APPROX_GROUP = 'Aproximados Menu 500'
const GROUPS = ['Todos', 'Verduras', 'Frutas', 'Cereales S/G', 'Cereales C/G', 'AOA MBAG', 'AOA BAG', 'AOA MAG', 'AOA AAG', 'Leguminosas', 'Leche entera', 'Leche semidescremada', 'Leche descremada', 'Leche con azúcar', 'Grasas sin proteínas', 'Grasas con proteínas', 'Azucares sin grasa', 'Azucares con grasa', 'Libres en energía', 'Alcohol', APPROX_GROUP]
const GROUP_OPTIONS = GROUPS.filter((g) => g !== 'Todos')

const EMPTY_FORM = { name: '', group: APPROX_GROUP, unit: 'gramos', kcal: '', protein: '', carbs: '', fat: '', fiber: '', serving: '', grams: '' }

const FALLBACK = [
  { id: 'demo-a', name: 'Aguacate Hass', group: 'Grasas sin proteínas', unit: 'taza', nutrition: { kcal: 160, carbs: 8.5, protein: 2, fat: 14.7, fiber: 6.7 }, equivalence: { serving: '1/3 pieza', grams: 50 } },
  { id: 'demo-b', name: 'Avena en hojuelas', group: 'Cereales S/G', unit: 'taza', nutrition: { kcal: 389, carbs: 66.3, protein: 16.9, fat: 6.9, fiber: 10.6 }, equivalence: { serving: '1/2 taza', grams: 40 } },
]

const NUTRIENT_ROWS = [
  ['kcal', 'Energía', 'kcal'], ['protein', 'Proteína', 'g'], ['carbs', 'Carbohidratos', 'g'], ['fat', 'Grasas', 'g'],
  ['fiber', 'Fibra', 'g'], ['sugar', 'Azúcar', 'g'], ['sodium', 'Sodio', 'mg'], ['cholesterol', 'Colesterol', 'mg'],
  ['vitaminA', 'Vitamina A', 'mg RE'], ['vitaminC', 'Vitamina C', 'mg'], ['vitaminD', 'Vitamina D', 'µg'], ['vitaminE', 'Vitamina E', 'mg'],
  ['vitaminK', 'Vitamina K', 'µg'], ['vitaminB1', 'Vitamina B1', 'mg'], ['vitaminB2', 'Vitamina B2', 'mg'], ['vitaminB3', 'Vitamina B3', 'mg'],
  ['vitaminB6', 'Vitamina B6', 'mg'], ['vitaminB12', 'Vitamina B12', 'µg'], ['folicAcid', 'Ácido fólico', 'µg'],
  ['calcium', 'Calcio', 'mg'], ['iron', 'Hierro', 'mg'], ['magnesium', 'Magnesio', 'mg'], ['potassium', 'Potasio', 'mg'],
  ['zinc', 'Zinc', 'mg'], ['iodine', 'Yodo', 'µg'], ['selenium', 'Selenio', 'µg'],
]

export default function IngredientsPage({ setActive }) {
  const [items, setItems] = useState(FALLBACK)
  const [selected, setSelected] = useState(FALLBACK[0])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('Todos')
  const [reloadKey, setReloadKey] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [createState, setCreateState] = useState('idle')
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    setStatus('loading')
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (group !== 'Todos') params.set('group', group)
    const query = params.toString() ? `?${params}` : ''
    const timer = setTimeout(() => {
      ingredientsApi.list(query)
        .then((response) => {
          const list = response.items || []
          setItems(list)
          setSelected((prev) => list.find((item) => item.id === prev?.id) || list[0] || null)
          setStatus('online')
        })
        .catch(() => setStatus('demo'))
    }, 300)
    return () => clearTimeout(timer)
  }, [search, group, reloadKey])

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const createIngredient = async () => {
    if (!form.name.trim() || !form.group) return
    setCreateState('saving')
    setCreateError('')
    const nutrition = {
      kcal: Number(form.kcal) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
      fiber: Number(form.fiber) || 0,
    }
    const payload = { name: form.name.trim(), group: form.group, unit: form.unit, nutrition }
    if (form.serving.trim() || form.grams) payload.equivalence = { serving: form.serving.trim() || 'Por definir', grams: Number(form.grams) || null }
    try {
      const created = await ingredientsApi.create(payload)
      setForm(EMPTY_FORM)
      setShowForm(false)
      setCreateState('idle')
      setSearch(created.name)
      setGroup(created.group)
      setSelected(created)
      setReloadKey((key) => key + 1)
    } catch (error) {
      setCreateState('error')
      setCreateError(error.message || 'No se pudo crear el ingrediente.')
    }
  }

  const source = selected?.equivalence?.source === 'SMAE' ? 'Sistema Mexicano de Equivalentes' : selected?.equivalence?.source?.provider ? 'Importado de fuente externa' : 'Fuente local revisada'

  return <AppChrome active="Ingredientes" setActive={setActive}><div className="content ingredient-workspace">
    <ModuleHeader eyebrow="BIBLIOTECA · INGREDIENTES LOCALES" title="Ingredientes" subtitle="Datos nutricionales revisados y equivalencias de tu práctica." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizados' : status === 'loading' ? 'Cargando…' : 'Vista demo'}</span><button className="secondary" onClick={() => setShowForm((value) => !value)}><span>+</span> Nuevo ingrediente</button><button className="primary" onClick={() => setActive('Importar alimentos')}><span>+</span> Importar alimento</button></div>} />

    <div className="group-pills">{GROUPS.map((g) => <button className={group === g ? 'selected' : ''} onClick={() => setGroup(g)} key={g}>{g}</button>)}</div>

    {showForm && <section className="panel ingredient-create">
      <div className="create-head"><div><h2>Nuevo ingrediente manual</h2><p className="muted">Útil para los faltantes del recetario: agrégalos en <b>{APPROX_GROUP}</b> y luego vincúlalos en la receta para contrastar el cálculo SMAE.</p></div><button type="button" className="link-button" onClick={() => setShowForm(false)}>Cerrar</button></div>
      <div className="form-grid three">
        <label>Nombre *<input value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="Ej. Masa de maíz nixtamalizada" /></label>
        <label>Grupo<select value={form.group} onChange={(e) => updateForm('group', e.target.value)}>{GROUP_OPTIONS.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>Unidad<select value={form.unit} onChange={(e) => updateForm('unit', e.target.value)}><option value="gramos">gramos</option><option value="ml">ml</option><option value="taza">taza</option><option value="pieza">pieza</option><option value="cucharada">cucharada</option></select></label>
      </div>
      <p className="eyebrow" style={{ marginTop: 12 }}>INFORMACIÓN NUTRICIONAL POR 100 G</p>
      <div className="form-grid five">
        <label>Energía (kcal)<input type="number" min="0" value={form.kcal} onChange={(e) => updateForm('kcal', e.target.value)} /></label>
        <label>Proteína (g)<input type="number" min="0" step="0.1" value={form.protein} onChange={(e) => updateForm('protein', e.target.value)} /></label>
        <label>Carbohidratos (g)<input type="number" min="0" step="0.1" value={form.carbs} onChange={(e) => updateForm('carbs', e.target.value)} /></label>
        <label>Grasas (g)<input type="number" min="0" step="0.1" value={form.fat} onChange={(e) => updateForm('fat', e.target.value)} /></label>
        <label>Fibra (g)<input type="number" min="0" step="0.1" value={form.fiber} onChange={(e) => updateForm('fiber', e.target.value)} /></label>
      </div>
      <div className="form-grid three" style={{ marginTop: 4 }}>
        <label>Porción de equivalencia<input value={form.serving} onChange={(e) => updateForm('serving', e.target.value)} placeholder="Ej. 1 taza" /></label>
        <label>Gramos por equivalente<input type="number" min="0" value={form.grams} onChange={(e) => updateForm('grams', e.target.value)} placeholder="Ej. 100" /></label>
      </div>
      {createState === 'error' && <div className="form-error">⚠ {createError}</div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setCreateState('idle') }}>Cancelar</button><button type="button" className="primary" disabled={!form.name.trim() || createState === 'saving'} onClick={createIngredient}>{createState === 'saving' ? 'Guardando…' : 'Crear ingrediente'} <span>→</span></button></div>
    </section>}

    <div className="ingredient-layout">
      <section>
        <div className="filter-bar panel"><div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ingrediente..." /></div></div>
        <div className="ingredient-list panel">
          {status !== 'loading' && items.length === 0 && <div className="result-empty"><span>◌</span><h3>No hay ingredientes con esos filtros</h3><p>Ajusta la búsqueda o el grupo.</p></div>}
          {items.map((item) => <button className={'ingredient-row ' + (selected?.id === item.id ? 'ingredient-selected' : '')} onClick={() => setSelected(item)} key={item.id}>
            <span className="ingredient-icon">◉</span>
            <div><b>{item.name}</b><small>{item.group} · Porción {item.equivalence?.serving || 'por definir'}</small></div>
            <span className="muted">{Math.round(item.nutrition?.kcal || 0)} kcal</span>
            <span className="row-arrow">→</span>
          </button>)}
        </div>
      </section>

      {selected && <aside className="ingredient-detail panel">
        <div className="ingredient-detail-head">
          <span className="ingredient-icon large-ingredient">◉</span>
          <div><p className="eyebrow">{selected.group}</p><h2>{selected.name}</h2><span className="muted">{source}</span></div>
        </div>
        <div className="serving-box">
          <span>Porción de equivalencia</span>
          <b>{selected.equivalence?.serving || 'Sin definir'}</b>
          <small>{selected.equivalence?.grams ? `${selected.equivalence.grams} gramos · 1 equivalente` : 'Gramos por equivalente por definir'}</small>
        </div>
        <h3>Información nutricional por 100 g</h3>
        <div className="nutrient-table">{NUTRIENT_ROWS.map(([key, label, unit]) => <div key={key}><span>{label}</span><b>{selected.nutrition?.[key] ?? 0} {unit}</b></div>)}</div>
        <div className="equivalence-box">
          <p className="eyebrow">SISTEMA MEXICANO DE EQUIVALENTES</p>
          <b>Grupo: {selected.equivalence?.group || selected.group}</b>
          <p>{selected.equivalence?.glycemicIndex ? `IG ${selected.equivalence.glycemicIndex} · Carga glicémica ${selected.equivalence.glycemicLoad ?? 0}. ` : ''}La equivalencia se conserva en el catálogo local y puede usarse en recetas y planes.</p>
        </div>
      </aside>}
    </div>
  </div></AppChrome>
}
