import { useCallback, useEffect, useState } from 'react'
import { adminApi, clearAdminToken, getAdminToken, setAdminToken } from '../../lib/adminApi.js'
import { formatMoney, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, pesosToCents } from '../../lib/finance.js'
import BrandMark from '../../components/BrandMark.jsx'

const formatDateUTC = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const daysLeft = (iso) => { if (!iso) return null; return Math.ceil((new Date(`${new Date(iso).toISOString().slice(0, 10)}T23:59:59.999Z`) - new Date()) / 86400000) }
// Estado de la suscripción en Stripe (fase 108), cuando la cuenta paga en línea.
const STRIPE_STATUS_LABELS = { trialing: 'en prueba', active: 'activa', past_due: 'pago pendiente', unpaid: 'sin pagar', incomplete: 'incompleta', incomplete_expired: 'no completada', canceled: 'cancelada', paused: 'en pausa' }
const inMonthIso = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const emptyAccount = (suggestedLoginId = '') => ({ name: '', practiceName: '', email: '', loginId: suggestedLoginId, paidUntil: inMonthIso() })
// Las cuentas del panel o de Google se bloquean 7 días después de vencer (ACCESS_GRACE_DAYS en el
// servidor); las anteriores (sin signupSource) nunca se bloquean por falta de pago.
const GRACE_DAYS = 7
const coverageLabel = (iso, signupSource) => {
  const left = daysLeft(iso)
  if (!signupSource) return left == null ? { text: 'Sin fecha · no se bloquea', tone: '' } : left < 0 ? { text: `Vencida hace ${Math.abs(left)} días · no se bloquea`, tone: 'warn' } : { text: `Cubierto ${left} días más`, tone: 'ok' }
  if (left == null) return { text: 'Sin cobertura · sin acceso hasta pagar', tone: 'danger' }
  if (left < 0) return Math.abs(left) <= GRACE_DAYS ? { text: `Vencida hace ${Math.abs(left)} días · en gracia`, tone: 'warn' } : { text: `Vencida hace ${Math.abs(left)} días · sin acceso`, tone: 'danger' }
  if (left <= 7) return { text: `Vence en ${left} día${left === 1 ? '' : 's'}`, tone: 'warn' }
  return { text: `Cubierto ${left} días más`, tone: 'ok' }
}

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
  const [actionError, setActionError] = useState('')
  const [payError, setPayError] = useState('')
  // Cuentas creadas desde el panel (fase 109): las primeras 100; las demás se registran con Google.
  const [quota, setQuota] = useState({ used: 0, limit: 100, suggestedLoginId: '' })
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState(emptyAccount())
  const [newState, setNewState] = useState('idle')
  const [newError, setNewError] = useState('')
  const [credentials, setCredentials] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const [practiceResponse, transactionResponse] = await Promise.all([adminApi.practices(), adminApi.transactions()])
      setPractices(practiceResponse.items || [])
      if (practiceResponse.adminAccounts) setQuota(practiceResponse.adminAccounts)
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

  // Suspender deja a la cuenta sin acceso: se confirma antes, y un fallo se avisa (antes se tragaba).
  const toggleStatus = async (practice) => {
    const suspending = practice.status === 'ACTIVE'
    if (suspending && !window.confirm(`¿Suspender "${practice.name}"? Sus usuarios no podrán entrar hasta que la habilites.`)) return
    setActionState(practice.id); setActionError('')
    try { await adminApi.updatePractice(practice.id, { status: suspending ? 'SUSPENDED' : 'ACTIVE' }); await load() } catch (error) { setActionError(error.message || 'No se pudo cambiar el estado de la cuenta.') } finally { setActionState('idle') }
  }
  const openPay = (practice) => { setPayFor(practice); setPayForm({ amount: '', method: practice.paymentMethod || 'TRANSFER', concept: 'Suscripción', date: todayIso(), extendMonths: '1' }); setPayState('idle'); setPayError('') }
  const submitPay = async (event) => {
    event.preventDefault()
    const amountCents = pesosToCents(payForm.amount)
    if (amountCents <= 0) { setPayState('error'); setPayError('Escribe un monto mayor a cero.'); return }
    setPayState('saving'); setPayError('')
    try {
      await adminApi.addTransaction({ practiceId: payFor.id, amountCents, method: payForm.method, concept: payForm.concept, occurredAt: `${payForm.date}T12:00:00.000Z`, extendMonths: Number(payForm.extendMonths) || 0 })
      setPayFor(null)
      await load()
    } catch (error) { setPayState('error'); setPayError(error.message || 'No se pudo registrar el pago.') }
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

  const openNew = () => { setNewForm(emptyAccount(quota.suggestedLoginId)); setNewState('idle'); setNewError(''); setNewOpen(true) }
  const submitNew = async (event) => {
    event.preventDefault()
    setNewState('saving'); setNewError('')
    try {
      const created = await adminApi.createPractice({ ...newForm, paidUntil: newForm.paidUntil ? `${newForm.paidUntil}T23:59:59.000Z` : null })
      setNewOpen(false)
      setCopied(false)
      setCredentials({ title: 'Cuenta creada', name: created.name, practiceName: created.practiceName, loginId: created.loginId, email: created.email, tempPassword: created.tempPassword })
      await load()
    } catch (error) { setNewState('error'); setNewError(error.message || 'No se pudo crear la cuenta.') }
  }
  const resetPassword = async (practice) => {
    if (!window.confirm(`¿Generar una contraseña nueva para "${practice.name}"? La actual dejará de funcionar.`)) return
    setActionState(practice.id); setActionError('')
    try {
      const result = await adminApi.resetPassword(practice.id)
      setCopied(false)
      setCredentials({ title: 'Contraseña nueva', name: result.name, practiceName: practice.name, loginId: result.loginId, email: result.email, tempPassword: result.tempPassword })
    } catch (error) { setActionError(error.message || 'No se pudo generar la contraseña.') } finally { setActionState('idle') }
  }
  const credentialsText = (data) => [`Milpa · ${data.practiceName}`, data.loginId ? `Identificador: ${data.loginId}` : null, data.email ? `Correo: ${data.email}` : null, `Contraseña temporal: ${data.tempPassword}`, 'Cámbiala en Configuración → Privacidad y seguridad.'].filter(Boolean).join('\n')
  const copyCredentials = async () => { try { await navigator.clipboard.writeText(credentialsText(credentials)); setCopied(true) } catch { setCopied(false) } }

  if (!authed) return <div className="admin-shell admin-login-shell">
    <form className="admin-login panel" onSubmit={login}>
      <div className="admin-brand"><BrandMark size={30} /><div><strong>milpa</strong><small>ADMINISTRACIÓN</small></div></div>
      <h1>Panel de administración</h1>
      <p className="muted">Acceso exclusivo para la administración del SaaS.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@milpaclinical.local" autoFocus required /></label>
      <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {authError && <div className="form-error">⚠ {authError}</div>}
      <button className="primary" disabled={authState === 'loading'}>{authState === 'loading' ? 'Entrando…' : 'Entrar'} <span>→</span></button>
    </form>
  </div>

  const activeCount = practices.filter((practice) => practice.status === 'ACTIVE').length
  const suspendedCount = practices.filter((practice) => practice.status === 'SUSPENDED').length

  return <div className="admin-shell">
    <header className="admin-topbar"><div className="admin-brand"><BrandMark size={30} /><div><strong>milpa</strong><small>ADMINISTRACIÓN · SAAS</small></div></div><div className="admin-user"><span className="avatar">{(admin?.name || 'A').slice(0, 1)}</span><b>{admin?.name || 'Administrador'}</b><button className="secondary" onClick={logout}>Salir</button></div></header>
    <main className="admin-content">
      <section className="admin-stats">
        <div className="panel admin-stat"><small>Total recaudado</small><b>{formatMoney(totals.totalCents)}</b><span>{totals.count} transacción(es)</span></div>
        <div className="panel admin-stat"><small>Cuentas activas</small><b>{activeCount}</b><span>de {practices.length} cuenta(s)</span></div>
        <div className="panel admin-stat"><small>Cuentas suspendidas</small><b>{suspendedCount}</b><span>sin acceso</span></div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head"><div><h2>Cuentas</h2><p>Habilita o deshabilita el acceso, y gestiona su suscripción. Las cuentas que no crees aquí se registran solas con Google.</p></div>
          <div className="admin-new-account"><small>{quota.used} de {quota.limit} cuentas del panel</small><button className="primary" disabled={quota.used >= quota.limit} onClick={openNew}><span>+</span>Nueva cuenta</button></div></div>
        {loadState === 'loading' && <p className="muted">Cargando cuentas…</p>}
        {loadState === 'error' && <div className="form-error">⚠ No se pudieron cargar las cuentas.</div>}
        {actionError && <div className="form-error">⚠ {actionError}</div>}
        <div className="admin-practice-list">{practices.map((practice) => { const coverage = coverageLabel(practice.paidUntil, practice.signupSource); return <article className={'panel admin-practice' + (practice.status === 'SUSPENDED' ? ' suspended' : '')} key={practice.id}>
          <div className="admin-practice-main">
            <div className="admin-practice-name"><b>{practice.name}</b><span className={'admin-badge ' + (practice.status === 'ACTIVE' ? 'ok' : 'danger')}>{practice.status === 'ACTIVE' ? 'Activa' : 'Suspendida'}</span>{practice.signupSource && <span className="admin-badge">{practice.signupSource === 'ADMIN' ? 'Panel' : 'Google'}</span>}</div>
            {practice.owner && <div className="admin-practice-owner"><span>{practice.owner.name}</span>{practice.owner.loginId && <code>{practice.owner.loginId}</code>}{practice.owner.email && <span className="muted">{practice.owner.email}</span>}{practice.owner.google && <span className="muted">· entra con Google</span>}</div>}
            <div className="admin-practice-meta"><span>{practice.users} usuario(s) · {practice.patients} paciente(s)</span><span>Método: {practice.paymentMethod ? PAYMENT_METHOD_LABELS[practice.paymentMethod] : '—'}</span>{practice.subscriptionStatus && <span>Stripe: {STRIPE_STATUS_LABELS[practice.subscriptionStatus] || practice.subscriptionStatus}{practice.subscriptionInterval ? ` · ${practice.subscriptionInterval === 'year' ? 'anual' : 'mensual'}` : ''}{practice.cancelAtPeriodEnd ? ' · no renueva' : ''}</span>}<span className={'admin-coverage ' + coverage.tone}>{practice.paidUntil ? `${formatDateUTC(practice.paidUntil)} · ${coverage.text}` : coverage.text}</span></div>
            <div className="admin-practice-collected">Recaudado <b>{formatMoney(practice.collectedCents)}</b> · {practice.transactionCount} pago(s)</div>
          </div>
          <div className="admin-practice-actions">
            <button className="primary" onClick={() => openPay(practice)}>Registrar pago</button>
            <button className="secondary" onClick={() => openSub(practice)}>Suscripción</button>
            {practice.owner && (practice.owner.loginId || !practice.owner.google) && <button className="secondary" disabled={actionState === practice.id} onClick={() => resetPassword(practice)}>Nueva contraseña</button>}
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
        {payState === 'error' && <div className="form-error">⚠ {payError || 'No se pudo registrar el pago.'}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPayFor(null)}>Cancelar</button><button className="primary" disabled={payState === 'saving'}>{payState === 'saving' ? 'Guardando…' : 'Registrar pago'} <span>→</span></button></div>
      </form>
    </div></div>}

    {newOpen && <div className="modal-backdrop" onClick={() => setNewOpen(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">NUEVA CUENTA · {quota.used + 1} DE {quota.limit}</p><h2>Cuenta para un nutriólogo</h2><span className="modal-subtitle">Entra con su identificador y una contraseña temporal. Recibe su propio catálogo de alimentos y recetas.</span></div><button onClick={() => setNewOpen(false)}>×</button></div>
      <form onSubmit={submitNew}>
        <div className="form-row"><label>Nombre del nutriólogo *<input value={newForm.name} onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ej. Ana López" autoFocus required /></label><label>Nombre de la consulta<input value={newForm.practiceName} onChange={(e) => setNewForm((p) => ({ ...p, practiceName: e.target.value }))} placeholder={newForm.name ? `Consulta de ${newForm.name}` : 'Opcional'} /></label></div>
        <div className="form-row"><label>Identificador *<input value={newForm.loginId} onChange={(e) => setNewForm((p) => ({ ...p, loginId: e.target.value.toLowerCase().replace(/\s/g, '') }))} autoCapitalize="none" spellCheck={false} required /><small className="muted">Minúsculas, números, punto o guion.</small></label><label>Correo<input type="email" value={newForm.email} onChange={(e) => setNewForm((p) => ({ ...p, email: e.target.value }))} placeholder="Opcional" /><small className="muted">Para contacto. Si quiere entrar con Google, lo vincula desde su Configuración.</small></label></div>
        <label>Cubierto hasta<input type="date" value={newForm.paidUntil} onChange={(e) => setNewForm((p) => ({ ...p, paidUntil: e.target.value }))} /><small className="muted">Hasta esta fecha (más 7 días de gracia) puede usar Milpa sin pagar en línea. Vacío: tiene que suscribirse al entrar.</small></label>
        {newState === 'error' && <div className="form-error">⚠ {newError}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setNewOpen(false)}>Cancelar</button><button className="primary" disabled={newState === 'saving'}>{newState === 'saving' ? 'Creando cuenta…' : 'Crear cuenta'} <span>→</span></button></div>
      </form>
    </div></div>}

    {credentials && <div className="modal-backdrop"><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">{credentials.title.toUpperCase()}</p><h2>{credentials.practiceName}</h2><span className="modal-subtitle">Envíale estos datos a {credentials.name}. La contraseña no se vuelve a mostrar.</span></div><button onClick={() => setCredentials(null)}>×</button></div>
      <dl className="admin-credentials">
        {credentials.loginId && <><dt>Identificador</dt><dd><code>{credentials.loginId}</code></dd></>}
        {credentials.email && <><dt>Correo</dt><dd>{credentials.email}</dd></>}
        <dt>Contraseña temporal</dt><dd><code>{credentials.tempPassword}</code></dd>
      </dl>
      <p className="muted">Puede cambiarla en Configuración → Privacidad y seguridad.</p>
      <div className="modal-actions"><button type="button" className="secondary" onClick={copyCredentials}>{copied ? '✓ Copiado' : 'Copiar datos'}</button><button className="primary" onClick={() => setCredentials(null)}>Listo</button></div>
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
