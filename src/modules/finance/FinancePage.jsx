import { useCallback, useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import FinanceBars from '../../components/FinanceBars.jsx'
import { financeApi, practiceApi } from '../../lib/api.js'
import { APPOINTMENT_TYPE_FEES, EMPTY_FEES, centsToPesos, formatMoney, formatShortDay, normalizeFees, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, pesosToCents } from '../../lib/finance.js'

// Fechas en calendario local (mismo criterio que "Hoy"/Agenda): el día del viewer, repackado como
// YYYY-MM-DD, que es lo que esperan los filtros por fecha del backend.
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoDay(new Date())
const firstOfMonthIso = () => { const now = new Date(); return isoDay(new Date(now.getFullYear(), now.getMonth(), 1)) }
const addDaysIso = (iso, days) => { const d = new Date(`${iso}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
const monthLabel = (iso) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const RANGES = [['month', 'Este mes'], ['last30', 'Últimos 30 días'], ['prevMonth', 'Mes anterior']]
const rangeFor = (key) => {
  const today = todayIso()
  if (key === 'last30') return { from: addDaysIso(today, -29), to: today, label: 'Últimos 30 días' }
  if (key === 'prevMonth') {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: isoDay(first), to: isoDay(last), label: monthLabel(isoDay(first)) }
  }
  return { from: firstOfMonthIso(), to: today, label: monthLabel(firstOfMonthIso()) }
}

const EXPENSE_CATEGORIES = ['Insumos', 'Renta', 'Servicios', 'Equipo', 'Publicidad', 'Sueldos', 'Otros']
const APPOINTMENT_TYPE_LABELS = Object.fromEntries(APPOINTMENT_TYPE_FEES)
const EMPTY_FORM = { amount: '', date: todayIso(), category: 'Insumos', method: 'CASH', description: '' }

export default function FinancePage({ setActive }) {
  const [rangeKey, setRangeKey] = useState('month')
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState(EMPTY_FORM)
  const [expenseState, setExpenseState] = useState('idle')
  const [expenseError, setExpenseError] = useState('')
  const [feesForm, setFeesForm] = useState(EMPTY_FEES)
  const [feesState, setFeesState] = useState('idle')
  const [feesError, setFeesError] = useState('')
  const [entryBusy, setEntryBusy] = useState(null)

  const range = rangeFor(rangeKey)
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const overview = await financeApi.overview(range.from, range.to)
      setData(overview)
      setFeesForm(normalizeFees(overview.fees))
      setStatus('online')
    } catch (error) {
      if (error.code === 'DEMO_MODE') { setData(null); setStatus('demo') } else { setData(null); setStatus('error') }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey])
  useEffect(() => { load() }, [load])

  const totals = data?.allTime || { incomeCents: 0, expenseCents: 0, balanceCents: 0 }
  const rangeTotals = data?.range || { incomeCents: 0, expenseCents: 0, balanceCents: 0 }
  const entries = data?.entries || []
  const methods = data?.byMethod || PAYMENT_METHODS.map(([method]) => ({ method, incomeCents: 0, count: 0 }))

  const openExpense = () => { setExpenseForm({ ...EMPTY_FORM, date: todayIso() }); setExpenseError(''); setExpenseState('idle'); setExpenseOpen(true) }
  const closeExpense = () => { setExpenseOpen(false); setExpenseError('') }

  const submitExpense = async (event) => {
    event.preventDefault()
    const amountCents = pesosToCents(expenseForm.amount)
    if (amountCents <= 0) { setExpenseState('error'); setExpenseError('Escribe un monto mayor a cero.'); return }
    setExpenseState('saving')
    setExpenseError('')
    try {
      await financeApi.addExpense({ amountCents, method: expenseForm.method, category: expenseForm.category, description: expenseForm.description, occurredAt: `${expenseForm.date}T12:00:00.000Z` })
      closeExpense()
      await load()
    } catch (error) {
      setExpenseState('error')
      setExpenseError(error.code === 'DEMO_MODE' ? 'Modo demostración: conecta el API para guardar egresos.' : (error.message || 'No se pudo registrar el egreso.'))
    }
  }

  const removeEntry = async (id) => {
    if (!window.confirm('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return
    setEntryBusy(id)
    try { await financeApi.removeEntry(id); await load() } catch { /* el movimiento queda; se puede reintentar */ } finally { setEntryBusy(null) }
  }

  const saveFees = async () => {
    setFeesState('saving')
    setFeesError('')
    try {
      const response = await practiceApi.updateFees(normalizeFees(feesForm))
      setFeesForm(normalizeFees(response.fees))
      setFeesState('saved')
      setTimeout(() => setFeesState('idle'), 1600)
    } catch (error) {
      setFeesState('error')
      setFeesError(error.code === 'DEMO_MODE' ? 'Modo demostración: conecta el API para guardar tarifas.' : (error.message || 'No se pudieron guardar las tarifas.'))
    }
  }

  return <AppChrome active="Finanzas" setActive={setActive}><div className="content finance-content">
    <ModuleHeader
      eyebrow="FINANZAS · CONSULTORIO"
      title="Finanzas"
      subtitle="Ingresos por consulta, gastos del consultorio y tu saldo disponible."
      action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Al día' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Datos de demostración'}</span><button className="primary" onClick={openExpense}><span>+</span> Registrar egreso</button></div>}
    />

    <div className="module-body">
    <section className="finance-stats">
      <div className="panel finance-stat income"><span className="finance-stat-label">Ingresos totales</span><b>{formatMoney(totals.incomeCents)}</b><small>{formatMoney(rangeTotals.incomeCents)} en {range.label.toLowerCase()}</small></div>
      <div className="panel finance-stat expense"><span className="finance-stat-label">Egresos totales</span><b>{formatMoney(totals.expenseCents)}</b><small>{formatMoney(rangeTotals.expenseCents)} en {range.label.toLowerCase()}</small></div>
      <div className="panel finance-stat balance"><span className="finance-stat-label">Disponible en la cuenta</span><b>{formatMoney(totals.balanceCents)}</b><small>Ingresos − egresos (histórico)</small></div>
    </section>

    <div className="finance-grid">
      <section className="panel finance-chart">
        <div className="finance-section-head"><div><h2>Ingresos y egresos</h2><p>{range.label} · ingresos en verde, egresos en rojo.</p></div>
          <div className="view-switch">{RANGES.map(([key, label]) => <button className={rangeKey === key ? 'selected' : ''} onClick={() => setRangeKey(key)} key={key}>{label}</button>)}</div>
        </div>
        <FinanceBars series={data?.daily || []} />
        <div className="finance-legend"><span><i className="income" />Ingresos</span><span><i className="expense" />Egresos</span></div>
      </section>
      <aside className="panel finance-methods">
        <div className="finance-section-head"><div><h2>Ingresos por método</h2><p>De dónde entró el dinero en {range.label.toLowerCase()}.</p></div></div>
        <div className="finance-method-list">{methods.map((item) => <div className="finance-method-row" key={item.method}><span>{PAYMENT_METHOD_LABELS[item.method]}</span><b>{formatMoney(item.incomeCents)}</b><small>{item.count} {item.count === 1 ? 'consulta' : 'consultas'}</small></div>)}</div>
      </aside>
    </div>

    <section className="panel finance-movements">
      <div className="finance-section-head"><div><h2>Movimientos</h2><p>{range.label} · ingresos automáticos por consulta y egresos que registras.</p></div></div>
      {status === 'loading' && <p className="muted">Cargando movimientos…</p>}
      {status !== 'loading' && entries.length === 0 && <p className="finance-empty muted">Todavía no hay movimientos en este periodo. Los ingresos aparecen solos al terminar una consulta.</p>}
      {entries.length > 0 && <div className="finance-table">
        <div className="finance-head"><span>Fecha</span><span>Movimiento</span><span>Método</span><span className="finance-amount-col">Monto</span><span /></div>
        {entries.map((entry) => <div className={'finance-row ' + (entry.type === 'INCOME' ? 'income' : 'expense')} key={entry.id}>
          <span className="finance-date">{formatShortDay(entry.occurredAt)}</span>
          <span className="finance-desc"><b>{entry.type === 'INCOME' ? (entry.patientName || 'Consulta') : (entry.category || 'Gasto')}</b><small>{entry.type === 'INCOME' ? (APPOINTMENT_TYPE_LABELS[entry.appointmentType] || 'Consulta') : (entry.description || 'Egreso del consultorio')}</small></span>
          <span className="finance-method">{entry.method ? PAYMENT_METHOD_LABELS[entry.method] : '—'}</span>
          <span className="finance-amount">{entry.type === 'INCOME' ? '+' : '−'}{formatMoney(entry.amountCents)}</span>
          <button className="finance-remove" disabled={entryBusy === entry.id} onClick={() => removeEntry(entry.id)} title="Eliminar movimiento">×</button>
        </div>)}
      </div>}
    </section>

    <section className="panel finance-fees">
      <div className="finance-section-head"><div><h2>Tarifas por tipo de cita</h2><p>Con estos precios se calcula el ingreso automático al terminar una consulta.</p></div><button className="primary" disabled={feesState === 'saving'} onClick={saveFees}>{feesState === 'saving' ? 'Guardando…' : feesState === 'saved' ? 'Guardado ✓' : 'Guardar tarifas'}</button></div>
      <div className="finance-fee-grid">{APPOINTMENT_TYPE_FEES.map(([key, label]) => <label key={key}>{label}<div className="finance-fee-input"><span>$</span><input type="number" min="0" step="0.01" value={feesForm[key] ? centsToPesos(feesForm[key]) : ''} placeholder="0" onChange={(event) => setFeesForm((prev) => ({ ...prev, [key]: pesosToCents(event.target.value) }))} /></div></label>)}</div>
      {APPOINTMENT_TYPE_FEES.every(([key]) => !feesForm[key]) && <p className="finance-fee-hint">Aún no defines tarifas: al terminar una consulta podrás capturar el monto a mano. Al guardarlas, el ingreso se calculará solo.</p>}
      {feesError && <div className="form-error">⚠ {feesError}</div>}
    </section>
    </div>
  </div>

  {expenseOpen && <div className="modal-backdrop" onClick={closeExpense}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">NUEVO EGRESO</p><h2>Registra un gasto</h2><span className="modal-subtitle">Insumos, renta, servicios… queda en tu cuenta del consultorio.</span></div><button onClick={closeExpense}>×</button></div>
    <form onSubmit={submitExpense}>
      <div className="form-row"><label>Monto (MXN) *<input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="Ej. 450" autoFocus required /></label><label>Fecha<input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm((prev) => ({ ...prev, date: event.target.value }))} required /></label></div>
      <div className="form-row"><label>Categoría<input list="finance-categories" value={expenseForm.category} onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))} placeholder="Ej. Insumos" /><datalist id="finance-categories">{EXPENSE_CATEGORIES.map((category) => <option value={category} key={category} />)}</datalist></label><label>Método de pago<select value={expenseForm.method} onChange={(event) => setExpenseForm((prev) => ({ ...prev, method: event.target.value }))}>{PAYMENT_METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      <label>Descripción<textarea value={expenseForm.description} onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Ej. Báscula nueva, papelería…" /></label>
      {expenseError && <div className="form-error">⚠ {expenseError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeExpense}>Cancelar</button><button className="primary" disabled={expenseState === 'saving'}>{expenseState === 'saving' ? 'Guardando…' : 'Registrar egreso'} <span>→</span></button></div>
    </form>
  </div></div>}
  </AppChrome>
}
