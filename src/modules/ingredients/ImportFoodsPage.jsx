import { useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { foodApi, ingredientsApi } from '../../lib/api.js'

const GROUPS = ['Verduras', 'Frutas', 'Cereales S/G', 'Cereales C/G', 'AOA MBAG', 'AOA BAG', 'AOA MAG', 'AOA AAG', 'Leguminosas', 'Leche entera', 'Leche semidescremada', 'Leche descremada', 'Leche con azúcar', 'Grasas sin proteínas', 'Grasas con proteínas', 'Azucares sin grasa', 'Azucares con grasa', 'Libres en energía', 'Alcohol']
const SOURCE_LABELS = { usda: 'USDA', openfoodfacts: 'Open Food Facts' }

export default function ImportFoodsPage({ setActive }) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [group, setGroup] = useState('Verduras')
  const [portion, setPortion] = useState('100 g')
  // Grams per equivalent (the SMAE math needs a real weight; without it the UI would fabricate one).
  const [grams, setGrams] = useState('100')
  const [saved, setSaved] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [translatedFrom, setTranslatedFrom] = useState(null)
  // idle | short | searching | done | error: antes la búsqueda no mostraba que estaba trabajando y un
  // fallo de USDA/Open Food Facts se veía igual que "0 resultados".
  const [searchState, setSearchState] = useState('idle')
  const [searchError, setSearchError] = useState('')

  const search = async (e) => {
    e.preventDefault()
    if (query.trim().length < 2) { setSearchState('short'); return }
    // Resetear el estado de "guardado" al buscar de nuevo (antes quedaba pegado y no se podía
    // importar un segundo alimento sin recargar).
    setSaved(false); setSelected(null); setSaveState('idle'); setSaveError('')
    setSearchState('searching'); setSearchError('')
    try {
      const result = await foodApi.search(query, source)
      setItems(result.items || [])
      setTranslatedFrom(result.translatedQuery || null)
      setSearchState('done')
    } catch (error) {
      setItems([]); setTranslatedFrom(null); setSearchState('error')
      setSearchError(error.code === 'DEMO_MODE' ? 'Modo demostración: conecta el API para buscar alimentos.' : (error.message || 'No se pudo consultar las fuentes externas. Intenta de nuevo.'))
    }
  }
  const importAnother = () => { setSaved(false); setSelected(null); setSaveError('') }

  const save = async () => {
    if (!selected) return
    setSaveState('saving'); setSaveError('')
    try {
      await ingredientsApi.import({
        externalId: selected.externalId,
        source: selected.source,
        name: selected.name,
        group,
        unit: 'g',
        nutrition: selected.nutrition,
        equivalence: { group, serving: portion.trim() || '100 g', grams: Number(grams) > 0 ? Number(grams) : null },
      })
      setSaveState('idle')
      setSaved(true)
    } catch (error) {
      // Antes se mostraba "Alimento guardado" aunque la importación fallara.
      setSaveState('idle')
      setSaveError(error.code === 'DEMO_MODE' ? 'Modo demostración: conecta el API para guardar el alimento.' : (error.message || 'No se pudo guardar el alimento.'))
    }
  }

  return <AppChrome active="Importar alimentos" setActive={setActive}><div className="content import-review">
    <ModuleHeader eyebrow="CATÁLOGO PROPIO · REVISIÓN" title="Revisar alimento" subtitle="Selecciona una fuente y valida los datos antes de guardarlos localmente." action={<button className="secondary" onClick={() => setActive('Ingredientes')}>Ver catálogo</button>} />

    <form className="import-search panel" onSubmit={search}>
      <div className="search-field">⌕ <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca un alimento..." /></div>
      <select value={source} onChange={(e) => setSource(e.target.value)}><option value="all">Todas las fuentes</option><option value="usda">USDA</option><option value="openfoodfacts">Open Food Facts</option></select>
      <button className="primary" disabled={searchState === 'searching'}>{searchState === 'searching' ? 'Buscando…' : 'Buscar'} <span>→</span></button>
    </form>
    {searchState === 'short' && <p className="muted" style={{ margin: '-10px 0 16px' }}>Escribe al menos 2 letras para buscar.</p>}
    {searchState === 'error' && <div className="form-error" style={{ marginBottom: 16 }}>⚠ {searchError}</div>}

    {translatedFrom && <p className="muted" style={{ margin: '-10px 0 16px' }}>Buscado como "{translatedFrom}" (traducción automática del catálogo local)</p>}

    <div className="review-layout">
      <section>
        <div className="import-results-head"><b>{searchState === 'searching' ? 'Buscando…' : `${items.length || 0} resultado${items.length === 1 ? '' : 's'}`}</b><span>Selecciona un alimento para revisar</span></div>
        {items.map((item) => <button className={'review-result panel ' + (selected?.externalId === item.externalId ? 'selected' : '')} onClick={() => { setSelected(item); setSaved(false); setSaveError('') }} key={item.source + item.externalId}>
          <span className="import-result-icon">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : '◉'}</span>
          <span><b>{item.name}</b><small>{SOURCE_LABELS[item.source] || item.source} · {item.serving.quantity}{item.serving.unit}</small></span>
          <span className="muted">{Math.round(item.nutrition.kcal || 0)} kcal</span>
        </button>)}
        {!items.length && searchState !== 'searching' && <div className="import-empty panel"><span>⌕</span><h2>{searchState === 'done' ? 'Sin resultados' : 'Busca para ver resultados'}</h2><p>{searchState === 'done' ? 'Prueba con otro nombre o con otra fuente.' : 'El alimento aún no se agregará hasta que lo revises.'}</p></div>}
      </section>

      <aside className="review-panel panel">
        {selected && !saved
          ? <>
              <p className="eyebrow">REVISIÓN PROFESIONAL</p>
              <h2>{selected.name}</h2>
              <span className="source-badge">Fuente: {SOURCE_LABELS[selected.source] || selected.source}</span>
              <div className="review-nutrients">
                <div><small>Energía</small><b>{Math.round(selected.nutrition.kcal || 0)} kcal</b></div>
                <div><small>Proteína</small><b>{Number(selected.nutrition.protein || 0).toFixed(1)} g</b></div>
                <div><small>Carbohidratos</small><b>{Number(selected.nutrition.carbs || 0).toFixed(1)} g</b></div>
                <div><small>Grasas</small><b>{Number(selected.nutrition.fat || 0).toFixed(1)} g</b></div>
              </div>
              <label>Grupo alimentario<select value={group} onChange={(e) => setGroup(e.target.value)}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
              <label>Porción equivalente<input value={portion} onChange={(e) => setPortion(e.target.value)} placeholder="Ej. 100 g, 1 pieza, 1/2 taza" /></label>
              <label>Gramos por equivalente<input type="number" min="0" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="Ej. 100" /><small className="muted" style={{ fontWeight: 400 }}>Peso real de 1 equivalente para el cálculo nutricional.</small></label>
              <div className="review-warning">ⓘ Revisa unidad, porción y grupo antes de importarlo al sistema de equivalentes.</div>
              {saveError && <div className="form-error">⚠ {saveError}</div>}
              <button className="primary full-button" disabled={saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : 'Guardar en mi catálogo'} <span>→</span></button>
            </>
          : saved
            ? <div className="saved-result"><span>✓</span><h2>Alimento guardado</h2><p>Ya puedes usarlo en tus recetas y planes nutricionales.</p><div className="form-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>{items.length > 1 && <button type="button" className="secondary" onClick={importAnother}>Importar otro de la lista</button>}<button className="primary" onClick={() => setActive('Ingredientes')}>Ir a ingredientes <span>→</span></button></div></div>
            : <div className="result-empty"><span>◌</span><h3>Selecciona un resultado</h3><p>Aquí podrás validar nutrientes y equivalencias antes de guardar.</p></div>}
      </aside>
    </div>
  </div></AppChrome>
}