import { describe, expect, it } from 'vitest'
import { invoiceConcept, subscriptionPeriodPaid, invoicePeriodEnd, invoiceSubscriptionId, isStaleEvent, isSupersededSubscription, practiceIdFromMetadata, practicePatchFromSubscription, subscriptionInterval, subscriptionPeriodEnd } from './billing.js'

const sub = (overrides = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  items: { data: [{ current_period_end: 1798761600, price: { recurring: { interval: 'month' } } }] },
  ...overrides,
})

describe('suscripción de Stripe → práctica', () => {
  it('lee el fin del periodo en la forma nueva (renglones) y en la vieja', () => {
    expect(subscriptionPeriodEnd(sub())?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(subscriptionPeriodEnd({ current_period_end: 1798761600 })?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(subscriptionPeriodEnd({ items: { data: [] } })).toBeNull()
  })

  it('toma el intervalo del precio', () => {
    expect(subscriptionInterval(sub())).toBe('month')
    expect(subscriptionInterval(sub({ items: { data: [{ price: { recurring: { interval: 'week' } } }] } }))).toBeNull()
  })

  it('una suscripción activa con su última factura pagada mueve la cobertura al fin del periodo', () => {
    const patch = practicePatchFromSubscription(sub({ latest_invoice: { status: 'paid' } }), new Date('2026-11-01'))
    expect(patch).toMatchObject({ stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', subscriptionStatus: 'active', subscriptionInterval: 'month', cancelAtPeriodEnd: false })
    expect(patch.paidUntil.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('nunca recorta una cobertura más larga (por ejemplo, pagada a mano)', () => {
    expect(practicePatchFromSubscription(sub({ latest_invoice: { status: 'paid' } }), new Date('2027-06-01')).paidUntil).toBeUndefined()
  })

  it('al renovar sin cobro confirmado no regala el periodo nuevo', () => {
    expect(subscriptionPeriodPaid(sub())).toBe(false)
    expect(subscriptionPeriodPaid(sub({ latest_invoice: 'in_1' }))).toBe(false)
    expect(subscriptionPeriodPaid(sub({ latest_invoice: { status: 'open' } }))).toBe(false)
    expect(subscriptionPeriodPaid(sub({ status: 'past_due', latest_invoice: { status: 'paid' } }))).toBe(false)
    expect(subscriptionPeriodPaid(sub({ status: 'trialing' }))).toBe(true)
    expect(practicePatchFromSubscription(sub(), new Date('2026-11-01')).paidUntil).toBeUndefined()
  })

  it('una suscripción incompleta o cancelada no extiende la cobertura', () => {
    expect(practicePatchFromSubscription(sub({ status: 'incomplete' })).paidUntil).toBeUndefined()
    const canceled = practicePatchFromSubscription(sub({ status: 'canceled', cancel_at_period_end: true }))
    expect(canceled.paidUntil).toBeUndefined()
    expect(canceled.cancelAtPeriodEnd).toBe(false)
  })

  it('marca la cancelación programada (cancel_at_period_end o cancel_at)', () => {
    expect(practicePatchFromSubscription(sub({ cancel_at_period_end: true })).cancelAtPeriodEnd).toBe(true)
    expect(practicePatchFromSubscription(sub({ cancel_at: 1798761600 })).cancelAtPeriodEnd).toBe(true)
  })

  it('acepta el cliente expandido como objeto', () => {
    expect(practicePatchFromSubscription(sub({ customer: { id: 'cus_9' } })).stripeCustomerId).toBe('cus_9')
  })
})

describe('facturas y eventos', () => {
  it('encuentra la suscripción de la factura en la forma nueva y la vieja', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_1' })).toBe('sub_1')
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_2' } } })).toBe('sub_2')
    expect(invoiceSubscriptionId({})).toBeNull()
  })

  it('toma el fin del periodo pagado de los renglones', () => {
    expect(invoicePeriodEnd({ lines: { data: [{ period: { end: 1798761600 } }] } })?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(invoicePeriodEnd({ lines: { data: [] } })).toBeNull()
  })

  it('la práctica sale de metadata o de client_reference_id', () => {
    expect(practiceIdFromMetadata({ metadata: { practiceId: 'p1' } })).toBe('p1')
    expect(practiceIdFromMetadata({ metadata: {}, client_reference_id: 'p2' })).toBe('p2')
    expect(practiceIdFromMetadata({})).toBeNull()
  })

  it('ignora avisos anteriores al último aplicado', () => {
    expect(isStaleEvent(1000, new Date(2000 * 1000))).toBe(true)
    expect(isStaleEvent(3000, new Date(2000 * 1000))).toBe(false)
    expect(isStaleEvent(1000, null)).toBe(false)
  })

  it('una suscripción terminada distinta no pisa la vigente', () => {
    const practice = { stripeSubscriptionId: 'sub_new', subscriptionStatus: 'active' }
    expect(isSupersededSubscription(sub({ id: 'sub_old', status: 'canceled' }), practice)).toBe(true)
    expect(isSupersededSubscription(sub({ id: 'sub_new', status: 'canceled' }), practice)).toBe(false)
    expect(isSupersededSubscription(sub({ id: 'sub_old', status: 'active' }), practice)).toBe(false)
    expect(isSupersededSubscription(sub({ id: 'sub_old', status: 'canceled' }), { stripeSubscriptionId: 'sub_new', subscriptionStatus: 'canceled' })).toBe(false)
    expect(isSupersededSubscription(sub({ status: 'canceled' }), { stripeSubscriptionId: null })).toBe(false)
  })

  it('describe el concepto del pago según el intervalo', () => {
    expect(invoiceConcept('year')).toBe('Suscripción anual (Stripe)')
    expect(invoiceConcept('month')).toBe('Suscripción mensual (Stripe)')
    expect(invoiceConcept(null)).toBe('Suscripción (Stripe)')
  })
})
