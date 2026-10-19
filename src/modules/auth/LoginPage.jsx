import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'
import BrandMark from '../../components/BrandMark.jsx'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')

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

  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
    <div style={{ width: 'min(380px, calc(100% - 32px))' }}>
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
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 12, fontWeight: 500, marginBottom: 15 }}>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 12, fontWeight: 500, marginBottom: 15 }}>Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        {state === 'error' && <div className="form-error">⚠ {error}</div>}
        <button className="primary full-button" disabled={state === 'loading'}>{state === 'loading' ? 'Entrando…' : 'Iniciar sesión'}</button>
      </form>
    </div>
  </div>
}
