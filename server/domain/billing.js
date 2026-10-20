// Suscripción del SaaS con Stripe (fase 108): traduce los objetos de Stripe a los campos de la
// práctica. Son funciones puras para poder probarlas sin red; server/index.js hace las llamadas.
//
// Desde la API 2025-03-31 («basil») Stripe movió algunos campos: el fin del periodo vive en cada
// renglón de la suscripción (`items.data[].current_period_end`) y la suscripción de una factura en
// `invoice.parent.subscription_details.subscription`. Se leen ambas formas.

// Estados en los que la práctica tiene una suscripción vigente (no debe abrir otro checkout).
export const LIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete']

export const SUBSCRIPTION_INTERVALS = ['month', 'year']

const idOf = (value) => (value && typeof value === 'object' ? value.id : value) || null
const fromUnix = (seconds) => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null)

export function subscriptionPeriodEnd(subscription) {
  if (!subscription) return null
  if (subscription.current_period_end) return fromUnix(subscription.current_period_end)
  const ends = (subscription.items?.data || []).map((item) => item.current_period_end).filter(Number.isFinite)
  return ends.length ? fromUnix(Math.max(...ends)) : null
}

export function subscriptionInterval(subscription) {
  const interval = subscription?.items?.data?.[0]?.price?.recurring?.interval
  return SUBSCRIPTION_INTERVALS.includes(interval) ? interval : null
}

// La práctica dueña del objeto: primero la que pusimos en metadata al crear el checkout.
export const practiceIdFromMetadata = (object) => object?.metadata?.practiceId || object?.client_reference_id || null

export function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.subscription) || idOf(invoice?.parent?.subscription_details?.subscription) || null
}

// Fin del periodo que paga la factura (el renglón de la suscripción).
export function invoicePeriodEnd(invoice) {
  const ends = (invoice?.lines?.data || []).map((line) => line.period?.end).filter(Number.isFinite)
  return ends.length ? fromUnix(Math.max(...ends)) : null
}

// ¿El periodo actual de la suscripción ya está pagado? Al renovar, Stripe adelanta el periodo
// antes de cobrar (y la deja `active` hasta que el cobro falla), así que el estado solo no basta:
// cuenta el periodo de prueba, o la última factura pagada cuando viene expandida (`latest_invoice`).
// Sin ella, la cobertura la mueve el aviso `invoice.paid`.
export function subscriptionPeriodPaid(subscription) {
  if (subscription?.status === 'trialing') return true
  const invoice = subscription?.latest_invoice
  return subscription?.status === 'active' && Boolean(invoice && typeof invoice === 'object' && invoice.status === 'paid')
}

/**
 * Cambios a la práctica a partir de una suscripción de Stripe. `paidUntil` sólo avanza (nunca
 * recorta una cobertura pagada a mano o un periodo ya cubierto), y sólo cuando el periodo está
 * pagado; una suscripción cancelada conserva lo que ya se pagó.
 */
export function practicePatchFromSubscription(subscription, currentPaidUntil = null) {
  const patch = {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status || null,
    subscriptionInterval: subscriptionInterval(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
  }
  const customerId = idOf(subscription.customer)
  if (customerId) patch.stripeCustomerId = customerId
  const end = subscriptionPeriodEnd(subscription)
  if (end && subscriptionPeriodPaid(subscription) && (!currentPaidUntil || end > new Date(currentPaidUntil))) patch.paidUntil = end
  if (subscription.status === 'canceled') patch.cancelAtPeriodEnd = false
  return patch
}

// Un aviso de OTRA suscripción ya terminada (una anterior, o un reintento atrasado de Stripe) no
// debe pisar la suscripción vigente de la práctica: la dejaría como «cancelada» y permitiría abrir
// otro checkout (doble cobro).
export function isSupersededSubscription(subscription, practice) {
  return Boolean(practice?.stripeSubscriptionId && subscription?.id !== practice.stripeSubscriptionId
    && LIVE_SUBSCRIPTION_STATUSES.includes(practice.subscriptionStatus) && !LIVE_SUBSCRIPTION_STATUSES.includes(subscription?.status))
}

// Un aviso de suscripción más viejo que el último aplicado no debe deshacer el estado actual.
export function isStaleEvent(eventCreatedSeconds, lastSyncedAt) {
  if (!lastSyncedAt || !Number.isFinite(eventCreatedSeconds)) return false
  return eventCreatedSeconds * 1000 < new Date(lastSyncedAt).getTime()
}

export function invoiceConcept(interval) {
  return interval === 'year' ? 'Suscripción anual (Stripe)' : interval === 'month' ? 'Suscripción mensual (Stripe)' : 'Suscripción (Stripe)'
}
