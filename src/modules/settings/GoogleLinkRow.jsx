import { useEffect, useRef, useState } from 'react'
import { authApi } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'
import { renderGoogleButton } from '../../lib/googleIdentity.js'
import { setToken } from '../../lib/auth.js'

// Vincular Google a una cuenta que entra con contraseña (fase 109). Se hace desde la sesión ya
// iniciada, nunca por coincidencia de correo: así nadie puede apropiarse del Google de otra persona.
export default function GoogleLinkRow() {
  const { user, refreshPractice } = useAuth()
  const [clientId, setClientId] = useState(null)
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const buttonRef = useRef(null)

  useEffect(() => { authApi.config().then((config) => setClientId(config.googleClientId || null)).catch(() => {}) }, [])
  useEffect(() => {
    if (!clientId || user?.google || !buttonRef.current) return
    renderGoogleButton(buttonRef.current, clientId, async (credential) => {
      setState('saving'); setError('')
      try { await authApi.linkGoogle(credential); await refreshPractice(); setState('linked') } catch (err) { setState('error'); setError(err.message || 'No se pudo vincular Google.') }
    }).catch((err) => setError(err.message))
  }, [clientId, user?.google, refreshPractice])

  const unlink = async () => {
    if (!window.confirm('¿Desvincular tu cuenta de Google? Se cerrarán las sesiones abiertas con Google y seguirás entrando con tu contraseña.')) return
    setState('saving'); setError('')
    // Desvincular cierra las sesiones abiertas con Google; esta sigue con el token nuevo.
    try { const { token } = await authApi.unlinkGoogle(); if (token) setToken(token); await refreshPractice(); setState('idle') } catch (err) { setState('error'); setError(err.message || 'No se pudo desvincular Google.') }
  }

  if (!clientId) return null
  return <div className="google-link-row">
    <div><b>Entrar con Google</b><small>{user?.google ? 'Tu cuenta de Google ya está vinculada: puedes entrar con ella o con tu contraseña.' : 'Vincula tu cuenta de Google para entrar con un clic.'}</small></div>
    {user?.google ? <button className="secondary" disabled={state === 'saving'} onClick={unlink}>{state === 'saving' ? 'Desvinculando…' : 'Desvincular'}</button> : <div className="google-link-button" ref={buttonRef} aria-busy={state === 'saving'} />}
    {state === 'linked' && <span className="saved">● Google vinculado</span>}
    {error && <div className="form-error">⚠ {error}</div>}
  </div>
}
