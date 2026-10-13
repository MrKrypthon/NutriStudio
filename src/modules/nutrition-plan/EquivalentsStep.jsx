import { useEffect, useMemo, useState } from 'react'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { ingredientsApi } from '../../lib/api.js'
import {
  CATALOG_GROUP, EQUIVALENT_MEALS, EQUIVALENT_TABLE,
  addTotals, adequacyStatus, equivalentAdequacy, equivalentTotals, extrasTotals, macroTargets, remainingEquivalents, suggestDistribution, suggestEquivalents, toHalf,
} from '../../../server/domain/equivalents.js'

const MACROS = [['kcal', 'Energía', 'kcal'], ['protein', 'Proteína', 'g'], ['fat', 'Lípidos', 'g'], ['carbs', 'HdC', 'g']]
const STATUS_LABEL = { ok: 'En rango', low: 'Falta', high: 'Excede', none: '—' }
const formatCount = (value) => { const number = Number(value) || 0; return Number.isInteger(number) ? String(number) : number.toFixed(1) }
const formatTime = (time) => { const match = /^(\d{2}):(\d{2})$/.exec(time || ''); if (!match) return ''; const hours = Number(match[1]); return `${hours % 12 || 12}${match[2] === '00' ? '' : `:${match[2]}`} ${hours < 12 ? 'am' : 'pm'}` }

// Campo de equivalentes: − / + de medio en medio, o escribir la cantidad. Mientras se teclea se
// conserva el texto tal cual y sólo se normaliza al salir: antes cada tecla pasaba por `toHalf`, así
// que al escribir "1.5" el punto se descartaba y se guardaba "15".
function CountField({ value, onChange, disabled, label, compact = false }) {
  const count = Number(value) || 0
  const [text, setText] = useState(null)
  const shown = text != null ? text : (count || '')
  const commit = (raw) => { setText(null); onChange(toHalf(raw)) }
  return <div className={'eq-count' + (compact ? ' compact' : '') + (count > 0 ? ' filled' : '')}>
    {!compact && <button type="button" disabled={disabled || count <= 0} onClick={() => commit(count - 0.5)} aria-label={`Menos ${label}`}>−</button>}
    <input type="number" min="0" max="40" step="0.5" inputMode="decimal" disabled={disabled} value={shown} placeholder="0" aria-label={label} onChange={(event) => setText(event.target.value)} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    {!compact && <button type="button" disabled={disabled} onClick={() => commit(count + 0.5)} aria-label={`Más ${label}`}>+</button>}
  </div>
}

// Paso "Equivalentes" del Constructor: el cuadro dietosintético de la hoja EQ del Excel. La
// nutrióloga fija cuántos equivalentes de cada grupo cubren el requerimiento (con una propuesta
// automática como punto de partida) y los reparte entre los tiempos de comida; ese reparto es la
// columna "Porción" del plan que recibe la paciente.
export default function EquivalentsStep({ plan, value, onChange, locked, mealTimes, expediente, activeMeals, visibleMeals, mealLabels, onGoToCalculation }) {
  const groups = value?.groups || {}
  const distribution = value?.distribution || {}
  const hasTarget = plan?.targetKcal != null
  const targets = useMemo(() => macroTargets({ kcal: plan?.targetKcal, carbsPercent: plan?.carbsPercent, proteinPercent: plan?.proteinPercent, fatPercent: plan?.fatPercent }), [plan?.targetKcal, plan?.carbsPercent, plan?.proteinPercent, plan?.fatPercent])
  // Renglones propios (suplemento, bebida): cuentan en el total del día y en el de su tiempo.
  const extras = value?.extras || []
  const totals = addTotals(equivalentTotals(groups), extrasTotals(extras))
  const adequacy = equivalentAdequacy(totals, hasTarget ? targets : null)
  const weightKg = Number(plan?.evaluation?.inputs?.weightKg) || null
  const activeGroups = EQUIVALENT_TABLE.filter((group) => (Number(groups[group.code]) || 0) > 0 || EQUIVALENT_MEALS.some((meal) => (Number(distribution[meal.key]?.[group.code]) || 0) > 0))
  // Columnas del reparto: los tiempos de comida del plan, más cualquiera que ya tenga equivalentes.
  const meals = EQUIVALENT_MEALS.filter((meal) => !visibleMeals || visibleMeals.includes(meal.key) || Object.keys(distribution[meal.key] || {}).length > 0).map((meal) => ({ ...meal, label: mealLabels?.[meal.key] || meal.label }))
  const distColumns = { gridTemplateColumns: `minmax(150px,1.6fr) 48px repeat(${meals.length},minmax(62px,1fr)) 104px` }
  const [catalogCode, setCatalogCode] = useState(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalog, setCatalog] = useState({ state: 'idle', items: [] })

  // Alimentos del grupo elegido, tal como están en el catálogo de Ingredientes (SMAE): cada uno con
  // la porción que vale un equivalente.
  useEffect(() => {
    if (!catalogCode) return undefined
    let cancelled = false
    setCatalog((prev) => ({ ...prev, state: 'loading' }))
    const timer = setTimeout(() => {
      ingredientsApi.list(`?group=${encodeURIComponent(CATALOG_GROUP[catalogCode])}${catalogSearch.trim() ? `&search=${encodeURIComponent(catalogSearch.trim())}` : ''}`)
        .then((response) => { if (!cancelled) setCatalog({ state: 'ready', items: (response.items || []).filter((item) => item.equivalence?.serving) }) })
        .catch(() => { if (!cancelled) setCatalog({ state: 'error', items: [] }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [catalogCode, catalogSearch])

  const emit = (nextGroups, nextDistribution, nextExtras = extras) => onChange({ groups: nextGroups, distribution: nextDistribution, extras: nextExtras })
  const setExtra = (index, patch) => emit(groups, distribution, extras.map((extra, position) => (position === index ? { ...extra, ...patch } : extra)))
  const addExtra = () => emit(groups, distribution, [...extras, { id: (globalThis.crypto?.randomUUID?.() || `x${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`), name: '', kcal: 0, protein: 0, fat: 0, carbs: 0, meals: {} }])
  const removeExtra = (index) => emit(groups, distribution, extras.filter((_, position) => position !== index))
  const setGroup = (code, count) => {
    const next = { ...groups }
    if (count > 0) next[code] = count
    else delete next[code]
    emit(next, distribution)
  }
  const setMealCount = (mealKey, code, count) => {
    const meal = { ...(distribution[mealKey] || {}) }
    if (count > 0) meal[code] = count
    else delete meal[code]
    emit(groups, { ...distribution, [mealKey]: meal })
  }
  const hasGroups = Object.keys(groups).length > 0
  const hasDistribution = EQUIVALENT_MEALS.some((meal) => Object.keys(distribution[meal.key] || {}).length > 0)
  const confirmReplace = (message) => window.confirm(message)
  const suggestGroups = () => {
    if (hasGroups && !confirmReplace('Esto reemplaza los equivalentes que ya capturaste por una propuesta nueva. ¿Continuar?')) return
    const next = suggestEquivalents(targets)
    emit(next, hasDistribution ? suggestDistribution(next, activeMeals) : distribution)
  }
  const distribute = () => {
    if (hasDistribution && !confirmReplace('Esto reemplaza el reparto que ya hiciste por tiempo de comida. ¿Continuar?')) return
    emit(groups, suggestDistribution(groups, activeMeals))
  }
  const catalogGroup = EQUIVALENT_TABLE.find((group) => group.code === catalogCode)

  return <>
    <ModuleHeader eyebrow="PLAN ALIMENTARIO · EQUIVALENTES" title="Calcula los equivalentes" subtitle="Define cuántos equivalentes de cada grupo cubren el requerimiento y repártelos por tiempo de comida. Son las porciones que verá la paciente en su plan." action={<button type="button" className="primary" disabled={locked || !hasTarget} onClick={suggestGroups}>✦ Sugerir equivalentes</button>} />
    {!hasTarget && <div className="eq-notice">Todavía no hay requerimiento guardado: sin él no se puede sugerir ni medir la adecuación. <button type="button" className="link-button" onClick={onGoToCalculation}>Ir a Plan alimentario</button></div>}
    {locked && <div className="eq-notice">Este plan ya está publicado: los equivalentes se muestran sólo para consulta.</div>}

    <div className="eq-layout">
      <section className="panel eq-table-panel">
        <div className="eq-panel-head"><div><p className="eyebrow">CUADRO DIETOSINTÉTICO</p><h3>Equivalentes por grupo</h3></div><small className="muted">Aporte promedio por equivalente (SMAE)</small></div>
        <div className="eq-table" role="table">
          <div className="eq-row eq-head" role="row"><span className="eq-group">Grupo</span><span>Equivalentes</span><span>Kcal</span><span>Prot</span><span>Líp</span><span>HdC</span><span /></div>
          {EQUIVALENT_TABLE.map((group, index) => {
            const count = Number(groups[group.code]) || 0
            const firstOfGroup = index === 0 || EQUIVALENT_TABLE[index - 1].label !== group.label
            return <div className={'eq-row' + (count > 0 ? ' active' : '') + (firstOfGroup ? ' group-start' : '')} role="row" key={group.code}>
              <span className="eq-group">{firstOfGroup && <b>{group.label}</b>}{group.sub && <small>{group.sub}</small>}</span>
              <CountField value={count} disabled={locked} label={`equivalentes de ${group.label}${group.sub ? ` ${group.sub}` : ''}`} onChange={(next) => setGroup(group.code, next)} />
              <span>{count ? Math.round(count * group.kcal) : '—'}</span>
              <span>{count ? formatCount(count * group.protein) : '—'}</span>
              <span>{count ? formatCount(count * group.fat) : '—'}</span>
              <span>{count ? formatCount(count * group.carbs) : '—'}</span>
              <button type="button" className={'eq-catalog-button' + (catalogCode === group.code ? ' selected' : '')} onClick={() => { setCatalogSearch(''); setCatalogCode(catalogCode === group.code ? null : group.code) }} title="Ver los alimentos de este grupo">Alimentos</button>
            </div>
          })}
          <div className="eq-row eq-total" role="row"><span className="eq-group"><b>Total prescrito</b></span><span /><span>{Math.round(totals.kcal)}</span><span>{formatCount(totals.protein)}</span><span>{formatCount(totals.fat)}</span><span>{formatCount(totals.carbs)}</span><span /></div>
          {hasTarget && <div className="eq-row eq-target" role="row"><span className="eq-group"><b>Requerimiento</b></span><span /><span>{targets.kcal}</span><span>{formatCount(targets.protein)}</span><span>{formatCount(targets.fat)}</span><span>{formatCount(targets.carbs)}</span><span /></div>}
          {hasTarget && <div className="eq-row eq-adequacy" role="row"><span className="eq-group"><b>% Adecuación</b><small>Meta: 95–105 %</small></span><span />{['kcal', 'protein', 'fat', 'carbs'].map((key) => <span key={key}><i className={'eq-chip ' + adequacyStatus(adequacy[key])}>{adequacy[key] ?? '—'}%</i></span>)}<span /></div>}
        </div>
      </section>

      <aside className="eq-side">
        <section className="panel eq-summary">
          <p className="eyebrow">REQUERIMIENTO DE LA PACIENTE</p>
          {hasTarget ? <div className="eq-macros">{MACROS.map(([key, label, unit]) => {
            const status = adequacyStatus(adequacy[key])
            return <div className="eq-macro" key={key}>
              <div><b>{label}</b><small>{formatCount(totals[key])} de {formatCount(targets[key])} {unit}{key !== 'kcal' && weightKg ? ` · ${formatCount(targets[key] / weightKg)} g/kg` : ''}</small></div>
              <div className="eq-bar"><i className={status} style={{ width: `${Math.min(100, adequacy[key] || 0)}%` }} /></div>
              <span className={'eq-chip ' + status}>{STATUS_LABEL[status]}</span>
            </div>
          })}</div> : <p className="muted">Calcula el requerimiento en "Plan alimentario" para ver aquí la meta de energía y macronutrimentos.</p>}
          {weightKg && <p className="muted eq-weight">Peso usado en el cálculo: {formatCount(weightKg)} kg.</p>}
        </section>

        {(expediente?.allergies?.length > 0 || expediente?.avoid?.length > 0 || expediente?.prefers || expediente?.conditions?.length > 0) && <section className="panel eq-considerations">
          <p className="eyebrow">A CONSIDERAR · DEL EXPEDIENTE</p>
          {expediente.allergies?.length > 0 && <p><b>Alergias / intolerancias:</b> {expediente.allergies.join(' · ')}</p>}
          {expediente.avoid?.length > 0 && <p><b>No le gusta / evitar:</b> {expediente.avoid.join(' · ')}</p>}
          {expediente.prefers && <p><b>Prefiere:</b> {expediente.prefers}</p>}
          {expediente.conditions?.length > 0 && <p><b>Padecimientos:</b> {expediente.conditions.join(' · ')}</p>}
        </section>}

        {catalogGroup && <section className="panel eq-catalog">
          <div className="eq-panel-head"><div><p className="eyebrow">ALIMENTOS EQUIVALENTES · INGREDIENTES</p><h3>{catalogGroup.label}{catalogGroup.sub ? ` · ${catalogGroup.sub}` : ''}</h3></div><button type="button" className="link-button" onClick={() => setCatalogCode(null)}>Cerrar</button></div>
          <div className="search-field">⌕ <input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Buscar en el grupo…" /></div>
          {catalog.state === 'loading' && <p className="muted">Cargando alimentos…</p>}
          {catalog.state === 'error' && <p className="form-error">⚠ No se pudo consultar el catálogo.</p>}
          {catalog.state === 'ready' && catalog.items.length === 0 && <p className="muted">No hay alimentos de este grupo{catalogSearch.trim() ? ' con ese nombre' : ''} en Ingredientes.</p>}
          {catalog.state === 'ready' && catalog.items.length > 0 && <ul className="eq-catalog-list">{catalog.items.map((item) => <li key={item.id}><b>{item.name}</b><span>{item.equivalence.serving}{item.equivalence.grams ? ` · ${formatCount(item.equivalence.grams)} g` : ''}</span></li>)}</ul>}
          <small className="muted">Porción que vale 1 equivalente, según el catálogo de Ingredientes.</small>
        </section>}
      </aside>
    </div>

    <section className="panel eq-distribution">
      <div className="eq-panel-head"><div><p className="eyebrow">DISTRIBUCIÓN</p><h3>Equivalentes por tiempo de comida</h3><small className="muted">Es la columna "Porción" del plan que recibe la paciente. El reparto automático usa sólo los tiempos que ya tienen recetas.</small></div><button type="button" className="secondary" disabled={locked || !hasGroups} onClick={distribute}>Repartir automáticamente</button></div>
      {activeGroups.length === 0 ? <p className="muted">Captura o sugiere los equivalentes de arriba para repartirlos entre los tiempos de comida.</p> : <div className="eq-dist-table" role="table">
        <div className="eq-dist-row eq-head" role="row" style={distColumns}><span className="eq-group">Grupo</span><span>Total</span>{meals.map((meal) => <span key={meal.key}>{meal.label}{mealTimes?.[meal.key] ? <small>{formatTime(mealTimes[meal.key])}</small> : null}{activeMeals && !activeMeals.includes(meal.key) ? <small className="eq-inactive" title="Este tiempo de comida todavía no tiene recetas: no aparece en el plan impreso.">sin recetas</small> : null}</span>)}<span>Por repartir</span></div>
        {activeGroups.map((group) => {
          const remaining = remainingEquivalents(groups, distribution, group.code)
          return <div className="eq-dist-row" role="row" style={distColumns} key={group.code}>
            <span className="eq-group"><b>{group.label}</b>{group.sub && <small>{group.sub}</small>}</span>
            <span><b>{formatCount(groups[group.code])}</b></span>
            {meals.map((meal) => <CountField compact key={meal.key} value={distribution[meal.key]?.[group.code]} disabled={locked} label={`${group.label}${group.sub ? ` ${group.sub}` : ''} en ${meal.label}`} onChange={(next) => setMealCount(meal.key, group.code, next)} />)}
            <span><i className={'eq-chip ' + (remaining === 0 ? 'ok' : remaining > 0 ? 'low' : 'high')}>{remaining === 0 ? '✓ Completo' : remaining > 0 ? `Faltan ${formatCount(remaining)}` : `Sobran ${formatCount(-remaining)}`}</i></span>
          </div>
        })}
        <div className="eq-dist-row eq-meal-totals" role="row" style={distColumns}>
          <span className="eq-group"><b>Aporte del tiempo</b><small>kcal · P / HC / L en gramos</small></span><span />
          {meals.map((meal) => { const mealTotals = addTotals(equivalentTotals(distribution[meal.key]), extrasTotals(extras, meal.key)); return <span key={meal.key} className="eq-meal-total">{mealTotals.kcal > 0 ? <><b>{Math.round(mealTotals.kcal)} kcal</b><small>{formatCount(mealTotals.protein)} / {formatCount(mealTotals.carbs)} / {formatCount(mealTotals.fat)}</small></> : <small>—</small>}</span> })}
          <span />
        </div>
      </div>}

      <div className="eq-extras">
        <div className="eq-panel-head"><div><h3>Suplementos y bebidas</h3><small className="muted">Renglones que no son un grupo de equivalentes (un suplemento, una bebida): su aporte por porción y cuántas porciones tocan en cada tiempo. Salen en las indicaciones del plan.</small></div><button type="button" className="secondary" disabled={locked || extras.length >= 8} onClick={addExtra}>+ Agregar</button></div>
        {extras.map((extra, index) => <div className="eq-extra" key={extra.id || index}>
          <input className="eq-extra-name" value={extra.name} disabled={locked} placeholder="Nombre (ej. Proteína en polvo)" aria-label="Nombre del suplemento o bebida" onChange={(event) => setExtra(index, { name: event.target.value })} />
          {[['kcal', 'Kcal'], ['protein', 'Prot'], ['carbs', 'HdC'], ['fat', 'Líp']].map(([key, label]) => <label key={key}><small>{label}</small><input type="number" min="0" step="0.5" disabled={locked} value={extra[key] || ''} placeholder="0" onChange={(event) => setExtra(index, { [key]: Math.max(0, Number(event.target.value) || 0) })} /></label>)}
          <div className="eq-extra-meals">{meals.map((meal) => <label key={meal.key}><small>{meal.label}</small><CountField compact value={extra.meals?.[meal.key]} disabled={locked} label={`${extra.name || 'Renglón'} en ${meal.label}`} onChange={(next) => { const mealsNext = { ...(extra.meals || {}) }; if (next > 0) mealsNext[meal.key] = next; else delete mealsNext[meal.key]; setExtra(index, { meals: mealsNext }) }} /></label>)}</div>
          {!locked && <button type="button" className="link-button" onClick={() => removeExtra(index)} aria-label="Quitar renglón" title="Quitar">×</button>}
        </div>)}
      </div>
    </section>
  </>
}