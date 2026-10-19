import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'
import BrandMark from '../../components/BrandMark.jsx'
import SubscriptionCard from './SubscriptionCard.jsx'

// Pantalla de pago (fase 109): una cuenta sin suscripción pagada sólo ve esto. Al regresar de
// Stripe la tarjeta sincroniza el estado y aquí se vuelve a pedir el acceso; si ya quedó pagada, la
// app entra sola.
export default function PaywallPage() {
  const { user, practice, logout, refreshPractice } = useAuth()
  const [checking, setChecking] = useState(false)
  const [stillBlocked, setStillBlocked] = useState(false)

  const recheck = async () => {
    setChecking(true)
    const session = await refreshPractice()
    setChecking(false)
    setStillBlocked(Boolean(session && !session.access?.allowed))
  }

  const firstName = (user?.name || '').split(' ')[0]
  return <div className="paywall-shell">
    <div className="paywall">
      <div className="paywall-brand"><BrandMark size={40} /><div><strong>milpa</strong><small>Atención Integral</small></div></div>
      <div className="paywall-intro">
        <p className="eyebrow">{practice?.name || 'TU CONSULTA'}</p>
        <h1>{firstName ? `${firstName}, activa tu suscripción` : 'Activa tu suscripción'}</h1>
        <p className="subtitle">Con la suscripción tienes Milpa completo: expedientes, agenda, planes de alimentación, recetas y finanzas. Tus datos se conservan aunque la suscripción esté inactiva.</p>
      </div>
      <SubscriptionCard onLoaded={(_, back) => { if (back) recheck() }} />
      {stillBlocked && <div className="sub-notice tone-info">Todavía no vemos tu pago. Si acabas de pagar, espera unos segundos y vuelve a revisar.</div>}
      <div className="paywall-foot">
        <button className="link-button" onClick={recheck} disabled={checking}>{checking ? 'Revisando…' : 'Ya pagué, revisar de nuevo'}</button>
        <span>Sesión de <b>{user?.loginId || user?.email || user?.name}</b> · <button className="link-button" onClick={logout}>Cerrar sesión</button></span>
      </div>
    </div>
  </div>
}
