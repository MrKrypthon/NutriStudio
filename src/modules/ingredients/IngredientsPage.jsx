import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { ingredientsApi } from '../../lib/api.js'

const GROUPS = ['Todos', 'Verduras', 'Frutas', 'Cereales S/G', 'Cereales C/G', 'AOA MBAG', 'AOA BAG', 'AOA MAG', 'AOA AAG', 'Leguminosas', 'Leche entera', 'Leche semidescremada', 'Leche descremada', 'Leche con azúcar', 'Grasas sin proteínas', 'Grasas con proteínas', 'Azucares sin grasa', 'Azucares con grasa', 'Libres en energía', 'Alcohol']

const FALLBACK = [
  { id: 'demo-a', name: 'Aguacate Hass', group: 'Grasas sin proteínas', unit: 'taza', nutrition: { kcal: 160, carbs: 8.5, protein: 2, fat: 14.7, fiber: 6.7 }, equivalence: { serving: '1/3 pieza', grams: 50 } },
  { id: 'demo-b', name: 'Avena en hojuelas', group: 'Cereales S/G', unit: 'taza', nutrition: { kcal: 389, carbs: 66.3, protein: 16.9, fat: 6.9, fiber: 10.6 }, equivalence: { serving: '1/2 taza', grams: 40 } },
]

const NUTRIENT_ROWS = [
  ['kcal', 'Energía', 'kcal'], ['protein', 'Proteína', 'g'], ['carbs', 'Carbohidratos', 'g'], ['fat', 'Grasas', 'g'],
  ['fiber', 'Fibra', 'g'], ['sugar', 'Azúcar', 'g'], ['sodium', 'Sodio', 'mg'], ['cholesterol', 'Colesterol', 'mg'],
  ['calcium', 'Calcio', 'mg'], ['iron', 'Hierro', 'mg'], ['potassium', 'Potasio', 'mg'], ['vitaminC', 'Vitamina C', 'mg'],
]

export default function IngredientsPage({ setActive }) {
  const [items, setItems] = useState(FALLBACK)
  const [selected, setSelected] = useState(FALLBACK[0])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('Todos')

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
  }, [search, group])

  const source = selected?.equivalence?.source === 'SMAE' ? 'Sistema Mexicano de Equivalentes' : 'Fuente local revisada'

  return <AppChrome active="Ingredientes" setActive={setActive}><div className="content ingredient-workspace">
    <ModuleHeader eyebrow="BIBLIOTECA · INGREDIENTES LOCALES" title="Ingredientes" subtitle="Datos nutricionales revisados y equivalencias de tu práctica." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizados' : status === 'loading' ? 'Cargando…' : 'Vista demo'}</span></div>} />

    <div className="group-pills">{GROUPS.map((g) => <button className={group === g ? 'selected' : ''} onClick={() => setGroup(g)} key={g}>{g}</button>)}</div>

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
          <small>{selected.equivalence?.grams || 100} gramos · 1 equivalente</small>
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
