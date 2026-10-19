import { forwardRef, useEffect, useState } from 'react'
import { billingApi } from '../../lib/api.js'
import { formatMoney } from '../../lib/finance.js'

// Suscripción del SaaS (fase 108). El pago y la tarjeta viven en Stripe: «Suscribirme» abre su
// Checkout y «Administrar suscripción» su portal. Al volver, la dirección trae `?suscripcion=…` y
// se pide el estado directo a Stripe para no depender de que el webhook ya haya llegado.
const STATUS = {
  trialing: ['Periodo de prueba', 'info'],
  active: ['Activa', 'success'],
  past_due: ['Pago pendiente', 'warning'],
  unpaid: ['Sin pagar', 'danger'],
  incomplete: ['Pago incompleto', 'warning'],
  incomplete_expired: ['Pago no completado', 'danger'],
  canceled: ['Cancelada', 'neutral'],
  paused: ['En pausa', 'neutral'],
}
const LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete']
const INTERVAL_LABEL = { month: 'Mensual', year: 'Anual' }
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

const RETURN_NOTICE = {
  ok: ['success', 'Pago recibido. Tu suscripción quedó registrada.'],
  cancelada: ['warning', 'No se completó el pago; no se hizo ningún cargo.'],
}

// `onLoaded` avisa con el estado ya sincronizado (la pantalla de pago lo usa para volver a pedir el
// acceso al regresar de Stripe).
const SubscriptionCard = forwardRef(function SubscriptionCard({ onLoaded }, ref) {
  const [billing, setBilling] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [plan, setPlan] = useState('month')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const back = params.get('suscripcion')
    if (back) {
      params.delete('suscripcion')
      const query = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''))
    }
    const load = back ? billingApi.sync().catch(() => billingApi.get()) : billingApi.get()
    load.then((data) => { setBilling(data); if (RETURN_NOTICE[back]) setNotice(RETURN_NOTICE[back]); onLoaded?.(data, back) })
      .catch((err) => setLoadError(err.message || 'No se pudo cargar la suscripción.'))
  }, [])

  const go = async (kind, interval) => {
    setBusy(kind)
    setError('')
    try {
      const { url } = kind === 'portal' ? await billingApi.portal() : await billingApi.checkout(interval)
      window.location.assign(url)
    } catch (err) {
      setError(err.message || 'No se pudo abrir Stripe.')
      setBusy('')
    }
  }

  const live = billing && LIVE.includes(billing.status)
  const [statusLabel, statusTone] = (billing?.status && STATUS[billing.status]) || ['Sin suscripción', 'neutral']
  const prices = billing?.prices || []
  const monthly = prices.find((price) => price.interval === 'month')
  const yearly = prices.find((price) => price.interval === 'year')
  const yearlySaving = monthly && yearly ? Math.round((1 - yearly.amountCents / (monthly.amountCents * 12)) * 100) : 0
  const chosen = prices.find((price) => price.interval === plan) ? plan : prices[0]?.interval

  return <div className="panel settings-card subscription-card" ref={ref}>
    <div className="settings-card-head"><div><h2>Suscripción</h2><p>Tu plan de Milpa. El cobro y tu tarjeta se manejan de forma segura en Stripe.</p></div>
      {billing && <span className={`sub-status tone-${statusTone}`}><i />{statusLabel}</span>}</div>
    {loadError && <div className="form-error">⚠ {loadError}</div>}
    {!billing && !loadError && <p className="muted">Cargando suscripción…</p>}
    {notice && <div className={`sub-notice tone-${notice[0]}`}>{notice[1]}</div>}
    {billing && <>
      {billing.testMode && <div className="sub-notice tone-info"><b>Modo de prueba:</b> no se cobra dinero real. Paga con la tarjeta 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC.</div>}

      <div className="sub-facts">
        {billing.interval && <div><small>Plan</small><b>{INTERVAL_LABEL[billing.interval]}</b></div>}
        <div><small>{live ? (billing.cancelAtPeriodEnd ? 'Termina el' : 'Próximo cobro') : 'Cubierto hasta'}</small><b>{billing.paidUntil ? formatDate(billing.paidUntil) : '—'}</b></div>
      </div>
      {billing.status === 'past_due' && <div className="sub-notice tone-warning">No se pudo cobrar tu último pago. Stripe lo reintentará; actualiza tu tarjeta para no perder el acceso.</div>}
      {live && billing.cancelAtPeriodEnd && <div className="sub-notice tone-neutral">Cancelaste la renovación: conservas el acceso hasta el {formatDate(billing.paidUntil)}. Puedes reactivarla desde «Administrar suscripción».</div>}

      {!billing.configured && <p className="muted">Los pagos en línea todavía no están activos. Mientras tanto, tu suscripción se registra manualmente.</p>}

      {billing.configured && live && <div className="sub-actions">
        <button className="primary" disabled={Boolean(busy)} onClick={() => go('portal')}>{busy === 'portal' ? 'Abriendo Stripe…' : 'Administrar suscripción'}</button>
        <small className="muted">Cambia de plan o de tarjeta, descarga tus facturas o cancela.</small>
      </div>}

      {billing.configured && !live && <>
        {prices.length === 0 ? <p className="muted">No hay planes disponibles por ahora.</p> : <div className="sub-plans" role="radiogroup" aria-label="Plan">
          {prices.map((price) => <button type="button" role="radio" aria-checked={chosen === price.interval} key={price.interval} className={'sub-plan' + (chosen === price.interval ? ' selected' : '')} onClick={() => setPlan(price.interval)}>
            <span>{INTERVAL_LABEL[price.interval]}{price.interval === 'year' && yearlySaving > 0 && <em>Ahorra {yearlySaving}%</em>}</span>
            <b>{formatMoney(price.amountCents)}<small> MXN / {price.interval === 'year' ? 'año' : 'mes'}</small></b>
            {price.interval === 'year' && <small className="muted">Equivale a {formatMoney(Math.round(price.amountCents / 12))} al mes</small>}
          </button>)}
        </div>}
        <div className="sub-actions">
          {billing.hasCustomer && <button className="secondary" disabled={Boolean(busy)} onClick={() => go('portal')}>{busy === 'portal' ? 'Abriendo Stripe…' : 'Ver facturas'}</button>}
          <button className="primary" disabled={!chosen || Boolean(busy)} onClick={() => go('checkout', chosen)}>{busy === 'checkout' ? 'Abriendo Stripe…' : billing.status === 'canceled' ? 'Volver a suscribirme' : 'Suscribirme'}</button>
        </div>
      </>}
      {error && <div className="form-error">⚠ {error}</div>}
    </>}
  </div>
})

export default SubscriptionCard
