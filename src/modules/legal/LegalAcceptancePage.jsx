import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'
import BrandMark from '../../components/BrandMark.jsx'

// Pantalla para aceptar los términos y el aviso de privacidad (fase 117). La ve cada usuario la
// primera vez y cada que cambia la versión de un documento; mientras tanto la API no responde nada
// más. Las casillas empiezan sin marcar: el consentimiento tiene que ser un acto expreso.
export default function LegalAcceptancePage() {
  const { user, legal, logout, acceptLegal } = useAuth()
  const pending = legal?.pending || []
  const [checked, setChecked] = useState({})
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const allChecked = pending.every((doc) => checked[doc.document])

  const accept = async () => {
    setState('saving')
    setError('')
    try {
      await acceptLegal(pending.map(({ document, version }) => ({ document, version })))
    } catch (err) {
      setState('idle')
      // La versión cambió mientras leía: recargar trae la vigente.
      setError(err.code === 'LEGAL_VERSION_CHANGED' ? `${err.message} Recarga la página.` : err.message || 'No se pudo guardar. Intenta de nuevo.')
    }
  }

  const label = {
    terms: 'He leído y acepto los Términos y condiciones de uso.',
    privacy: 'He leído el Aviso de privacidad y otorgo mi consentimiento expreso para el tratamiento de mis datos personales, incluido su alojamiento con los proveedores que ahí se indican.',
  }

  return <div className="paywall-shell">
    <div className="paywall legal-accept">
      <div className="paywall-brand"><BrandMark size={40} /><div><strong>milpa</strong><small>Atención Integral</small></div></div>
      <div className="paywall-intro">
        <p className="eyebrow">ANTES DE CONTINUAR</p>
        <h1>Términos y aviso de privacidad</h1>
        <p className="subtitle">Para usar Milpa necesitamos que leas y aceptes estos documentos (también cuando los actualizamos). Queda registrado qué versión aceptaste y cuándo.</p>
      </div>
      <div className="legal-accept-list">
        {pending.map((doc) => <label key={doc.document} className="consent-check legal-accept-item">
          <input type="checkbox" checked={Boolean(checked[doc.document])} onChange={(event) => setChecked((prev) => ({ ...prev, [doc.document]: event.target.checked }))} />
          <span>{label[doc.document] || `Acepto: ${doc.title}.`} <a href={doc.path} target="_blank" rel="noopener noreferrer">Leer {doc.title.toLowerCase()} ↗</a></span>
        </label>)}
      </div>
      {error && <div className="form-error">⚠ {error}</div>}
      <button className="primary full-button" disabled={!allChecked || state === 'saving'} onClick={accept}>{state === 'saving' ? 'Guardando…' : 'Aceptar y continuar'}</button>
      <div className="paywall-foot">
        <span />
        <span>Sesión de <b>{user?.loginId || user?.email || user?.name}</b> · <button className="link-button" onClick={logout}>Cerrar sesión</button></span>
      </div>
    </div>
  </div>
}
