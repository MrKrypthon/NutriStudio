import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'
import { authApi } from '../../lib/api.js'
import { renderGoogleButton } from '../../lib/googleIdentity.js'
import BrandMark from '../../components/BrandMark.jsx'

// Dos maneras de entrar (fase 109): con Google (y así se registran las cuentas nuevas) o con el
// identificador o correo y la contraseña que dio el administrador.
export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [googleClientId, setGoogleClientId] = useState(null)
  const [googleError, setGoogleError] = useState('')
  const googleButtonRef = useRef(null)

  const submit = async (event) => {
    event.preventDefault()
    setState('loading')
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setState('error')
      setError(err.message || 'No se pudo iniciar sesión.')
    }
  }

  const onGoogleCredential = useCallback(async (credential) => {
    setState('google')
    setError('')
    try {
      await loginWithGoogle(credential)
    } catch (err) {
      setState('error')
      setError(err.message || 'No se pudo entrar con Google.')
    }
  }, [loginWithGoogle])

  useEffect(() => { authApi.config().then((config) => setGoogleClientId(config.googleClientId || null)).catch(() => {}) }, [])
  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return
    renderGoogleButton(googleButtonRef.current, googleClientId, onGoogleCredential).catch((err) => setGoogleError(err.message))
  }, [googleClientId, onGoogleCredential])

  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
    <div style={{ width: 'min(380px, calc(100% - 32px))', padding: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28, justifyContent: 'center' }}>
        <BrandMark size={64} />
        {/* Dos renglones que juntos miden lo mismo que el ícono. */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 64 }}>
          <strong style={{ font: '700 34px Outfit', lineHeight: 0.86, letterSpacing: '-1px', color: 'var(--ink)', whiteSpace: 'nowrap' }}>milpa</strong>
          <small style={{ font: '400 17px Outfit', lineHeight: 1, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Atención Integral</small>
        </div>
      </div>
      <form className="panel login-card" onSubmit={submit} style={{ padding: 28 }}>
        <p className="eyebrow">TU ESPACIO</p>
        <h1 style={{ font: '600 22px Outfit', margin: '0 0 4px' }}>Inicia sesión</h1>
        <p className="subtitle" style={{ margin: '0 0 22px' }}>Entra con tu cuenta de la consulta.</p>
        {googleClientId && <>
          <div className="login-google" ref={googleButtonRef} aria-busy={state === 'google'} />
          {state === 'google' && <p className="login-hint">Preparando tu cuenta…</p>}
          {googleError ? <div className="form-error">⚠ {googleError}</div> : <p className="login-hint">¿Primera vez? Crea tu cuenta con Google y pruébala 7 días gratis.</p>}
          <div className="login-divider"><span>o con tu identificador</span></div>
        </>}
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 12, fontWeight: 500, marginBottom: 15 }}>Correo o identificador
          <input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!googleClientId} style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 12, fontWeight: 500, marginBottom: 15 }}>Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        {state === 'error' && <div className="form-error">⚠ {error}</div>}
        <button className="primary full-button" disabled={state === 'loading' || state === 'google'}>{state === 'loading' ? 'Entrando…' : 'Iniciar sesión'}</button>
      </form>
      <p className="login-legal"><a href="/legal/terminos" target="_blank" rel="noopener noreferrer">Términos y condiciones</a> · <a href="/legal/privacidad" target="_blank" rel="noopener noreferrer">Aviso de privacidad</a></p>
    </div>
  </div>
}
