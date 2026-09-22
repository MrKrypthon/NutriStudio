import { useCallback, useEffect, useState } from 'react'
import { adminApi, clearAdminToken, getAdminToken, setAdminToken } from '../../lib/adminApi.js'
import { formatMoney, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, pesosToCents } from '../../lib/finance.js'

const formatDateUTC = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const daysLeft = (iso) => { if (!iso) return null; return Math.ceil((new Date(`${new Date(iso).toISOString().slice(0, 10)}T23:59:59.999Z`) - new Date()) / 86400000) }
const coverageLabel = (iso) => { const left = daysLeft(iso); if (left == null) return { text: 'Sin cobertura', tone: 'danger' }; if (left < 0) return { text: `Vencida hace ${Math.abs(left)} días`, tone: 'danger' }; if (left <= 7) return { text: `Vence en ${left} día${left === 1 ? '' : 's'}`, tone: 'warn' }; return { text: `Cubierto ${left} días más`, tone: 'ok' } }

export default function AdminApp() {
  const [authed, setAuthed] = useState(Boolean(getAdminToken()))
  const [admin, setAdmin] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authState, setAuthState] = useState('idle')

  const [practices, setPractices] = useState([])
  const [transactions, setTransactions] = useState([])
  const [totals, setTotals] = useState({ totalCents: 0, count: 0 })
  const [loadState, setLoadState] = useState('loading')

  const [payFor, setPayFor] = useState(null)
  const [payForm, setPayForm] = useState({ amount: '', method: 'TRANSFER', concept: 'Suscripción', date: todayIso(), extendMonths: '1' })
  const [payState, setPayState] = useState('idle')
  const [subFor, setSubFor] = useState(null)
  const [subForm, setSubForm] = useState({ paymentMethod: 'TRANSFER', paidUntil: todayIso() })
  const [subState, setSubState] = useState('idle')
  const [actionState, setActionState] = useState('idle')

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const [practiceResponse, transactionResponse] = await Promise.all([adminApi.practices(), adminApi.transactions()])
      setPractices(practiceResponse.items || [])
      setTransactions(transactionResponse.items || [])
      setTotals({ totalCents: transactionResponse.totalCents || 0, count: transactionResponse.count || 0 })
      setLoadState('ready')
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { clearAdminToken(); setAuthed(false) }
      setLoadState('error')
    }
  }, [])
  useEffect(() => { if (authed) load() }, [authed, load])

  const login = async (event) => {
    event.preventDefault()
    setAuthState('loading')
    setAuthError('')
    try {
      const response = await adminApi.login(email, password)
      setAdminToken(response.token)
      setAdmin(response.admin)
      setAuthed(true)
      setAuthState('idle')
    } catch (error) {
      setAuthState('error')
      setAuthError(error.code === 'DEMO_MODE' ? 'Conecta el API para iniciar sesión.' : (error.message || 'No se pudo iniciar sesión.'))
    }
  }
  const logout = () => { clearAdminToken(); setAdmin(null); setAuthed(false) }

  const toggleStatus = async (practice) => {
    setActionState(practice.id)
    try { await adminApi.updatePractice(practice.id, { status: practice.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); await load() } catch { /* retry */ } finally { setActionState('idle') }
  }
  const openPay = (practice) => { setPayFor(practice); setPayForm({ amount: '', method: practice.paymentMethod || 'TRANSFER', concept: 'Suscripción', date: todayIso(), extendMonths: '1' }); setPayState('idle') }
  const submitPay = async (event) => {
    event.preventDefault()
    const amountCents = pesosToCents(payForm.amount)
    if (amountCents <= 0) { setPayState('error'); return }
    setPayState('saving')
    try {
      await adminApi.addTransaction({ practiceId: payFor.id, amountCents, method: payForm.method, concept: payForm.concept, occurredAt: `${payForm.date}T12:00:00.000Z`, extendMonths: Number(payForm.extendMonths) || 0 })
      setPayFor(null)
      await load()
    } catch { setPayState('error') }
  }
  const openSub = (practice) => { setSubFor(practice); setSubForm({ paymentMethod: practice.paymentMethod || 'TRANSFER', paidUntil: practice.paidUntil ? new Date(practice.paidUntil).toISOString().slice(0, 10) : todayIso() }); setSubState('idle') }
  const submitSub = async (event) => {
    event.preventDefault()
    setSubState('saving')
    try {
      await adminApi.updatePractice(subFor.id, { paymentMethod: subForm.paymentMethod, paidUntil: `${subForm.paidUntil}T12:00:00.000Z` })
      setSubFor(null)
      await load()
    } catch { setSubState('error') }
  }

  if (!authed) return <div className="admin-shell admin-login-shell">
    <form className="admin-login panel" onSubmit={login}>
      <div className="admin-brand"><span className="brand-mark">N</span><div><strong>nutri<span>·</span>studio</strong><small>ADMINISTRACIÓN</small></div></div>
      <h1>Panel de administración</h1>
      <p className="muted">Acceso exclusivo para la administración del SaaS.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@nutristudio.local" autoFocus required /></label>
      <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {authError && <div className="form-error">⚠ {authError}</div>}
      <button className="primary" disabled={authState === 'loading'}>{authState === 'loading' ? 'Entrando…' : 'Entrar'} <span>→</span></button>
    </form>
  </div>

  const activeCount = practices.filter((practice) => practice.status === 'ACTIVE').length
  const suspendedCount = practices.filter((practice) => practice.status === 'SUSPENDED').length

  return <div className="admin-shell">
    <header className="admin-topbar"><div className="admin-brand"><span className="brand-mark">N</span><div><strong>nutri<span>·</span>studio</strong><small>ADMINISTRACIÓN · SAAS</small></div></div><div className="admin-user"><span className="avatar">{(admin?.name || 'A').slice(0, 1)}</span><b>{admin?.name || 'Administrador'}</b><button className="secondary" onClick={logout}>Salir</button></div></header>
    <main className="admin-content">
      <section className="admin-stats">
        <div className="panel admin-stat"><small>Total recaudado</small><b>{formatMoney(totals.totalCents)}</b><span>{totals.count} transacción(es)</span></div>
        <div className="panel admin-stat"><small>Cuentas activas</small><b>{activeCount}</b><span>de {practices.length} cuenta(s)</span></div>
        <div className="panel admin-stat"><small>Cuentas suspendidas</small><b>{suspendedCount}</b><span>sin acceso</span></div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head"><div><h2>Cuentas</h2><p>Habilita o deshabilita el acceso, y gestiona su suscripción.</p></div></div>
        {loadState === 'loading' && <p className="muted">Cargando cuentas…</p>}
        {loadState === 'error' && <div className="form-error">⚠ No se pudieron cargar las cuentas.</div>}
        <div className="admin-practice-list">{practices.map((practice) => { const coverage = coverageLabel(practice.paidUntil); return <article className={'panel admin-practice' + (practice.status === 'SUSPENDED' ? ' suspended' : '')} key={practice.id}>
          <div className="admin-practice-main">
            <div className="admin-practice-name"><b>{practice.name}</b><span className={'admin-badge ' + (practice.status === 'ACTIVE' ? 'ok' : 'danger')}>{practice.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</span></div>
            <div className="admin-practice-meta"><span>{practice.users} usuario(s) · {practice.patients} paciente(s)</span><span>Método: {practice.paymentMethod ? PAYMENT_METHOD_LABELS[practice.paymentMethod] : '—'}</span><span className={'admin-coverage ' + coverage.tone}>{practice.paidUntil ? `${formatDateUTC(practice.paidUntil)} · ${coverage.text}` : coverage.text}</span></div>
            <div className="admin-practice-collected">Recaudado <b>{formatMoney(practice.collectedCents)}</b> · {practice.transactionCount} pago(s)</div>
          </div>
          <div className="admin-practice-actions">
            <button className="primary" onClick={() => openPay(practice)}>Registrar pago</button>
            <button className="secondary" onClick={() => openSub(practice)}>Suscripción</button>
            <button className={practice.status === 'ACTIVE' ? 'secondary admin-danger' : 'secondary'} disabled={actionState === practice.id} onClick={() => toggleStatus(practice)}>{practice.status === 'ACTIVE' ? 'Suspender' : 'Habilitar'}</button>
          </div>
        </article> })}</div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head"><div><h2>Transacciones</h2><p>Pagos registrados de las cuentas.</p></div></div>
        {transactions.length === 0 ? <p className="muted">Todavía no hay transacciones.</p> : <div className="panel admin-table">
          <div className="admin-row admin-head"><span>Fecha</span><span>Cuenta</span><span>Concepto</span><span>Método</span><span className="admin-right">Monto</span></div>
          {transactions.map((item) => <div className="admin-row" key={item.id}><span>{formatDateUTC(item.occurredAt)}</span><span>{item.practice?.name || '—'}</span><span className="muted">{item.concept || '—'}</span><span>{item.method ? PAYMENT_METHOD_LABELS[item.method] : '—'}</span><span className="admin-right admin-amount">{formatMoney(item.amountCents)}</span></div>)}
        </div>}
      </section>
    </main>

    {payFor && <div className="modal-backdrop" onClick={() => setPayFor(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">REGISTRAR PAGO</p><h2>{payFor.name}</h2><span className="modal-subtitle">Queda en la lista de transacciones y suma al total recaudado.</span></div><button onClick={() => setPayFor(null)}>×</button></div>
      <form onSubmit={submitPay}>
        <div className="form-row"><label>Monto (MXN) *<input type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} autoFocus required /></label><label>Fecha<input type="date" value={payForm.date} onChange={(e) => setPayForm((p) => ({ ...p, date: e.target.value }))} required /></label></div>
        <div className="form-row"><label>Método de pago<select value={payForm.method} onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}>{PAYMENT_METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Extender cobertura<select value={payForm.extendMonths} onChange={(e) => setPayForm((p) => ({ ...p, extendMonths: e.target.value }))}><option value="0">No extender</option><option value="1">1 mes</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select></label></div>
        <label>Concepto<input value={payForm.concept} onChange={(e) => setPayForm((p) => ({ ...p, concept: e.target.value }))} placeholder="Ej. Suscripción mensual" /></label>
        {payState === 'error' && <div className="form-error">⚠ Revisa el monto y que el API esté activo.</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPayFor(null)}>Cancelar</button><button className="primary" disabled={payState === 'saving'}>{payState === 'saving' ? 'Guardando…' : 'Registrar pago'} <span>→</span></button></div>
      </form>
    </div></div>}

    {subFor && <div className="modal-backdrop" onClick={() => setSubFor(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">SUSCRIPCIÓN</p><h2>{subFor.name}</h2><span className="modal-subtitle">Método de pago y hasta cuándo le cubre.</span></div><button onClick={() => setSubFor(null)}>×</button></div>
      <form onSubmit={submitSub}>
        <div className="form-row"><label>Método de pago<select value={subForm.paymentMethod} onChange={(e) => setSubForm((p) => ({ ...p, paymentMethod: e.target.value }))}>{PAYMENT_METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Cubierto hasta<input type="date" value={subForm.paidUntil} onChange={(e) => setSubForm((p) => ({ ...p, paidUntil: e.target.value }))} required /></label></div>
        {subState === 'error' && <div className="form-error">⚠ No se pudo guardar.</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setSubFor(null)}>Cancelar</button><button className="primary" disabled={subState === 'saving'}>{subState === 'saving' ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </div></div>}
  </div>
}
