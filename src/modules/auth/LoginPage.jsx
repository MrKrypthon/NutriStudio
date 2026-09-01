import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'

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

  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--surface-soft)' }}>
    <div style={{ width: 'min(380px, calc(100% - 32px))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, justifyContent: 'center' }}>
        <div style={{ height: 34, width: 34, background: 'var(--green)', color: '#fff', borderRadius: 11, display: 'grid', placeItems: 'center', fontFamily: 'Manrope', fontWeight: 800, fontSize: 18, transform: 'rotate(-7deg)' }}>N</div>
        <strong style={{ font: '800 17px Manrope', letterSpacing: '-.6px', color: 'var(--ink)' }}>nutri·studio</strong>
      </div>
      <form className="panel" onSubmit={submit} style={{ padding: 28 }}>
        <p className="eyebrow">TU ESPACIO</p>
        <h1 style={{ font: '800 22px Manrope', margin: '0 0 4px' }}>Inicia sesión</h1>
        <p className="subtitle" style={{ margin: '0 0 22px' }}>Entra con tu cuenta de la consulta.</p>
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 10, fontWeight: 600, marginBottom: 15 }}>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        <label style={{ display: 'block', color: 'var(--muted)', fontSize: 10, fontWeight: 600, marginBottom: 15 }}>Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ display: 'block', width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: 11, marginTop: 6, font: '12px DM Sans', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        {state === 'error' && <div className="form-error">⚠ {error}</div>}
        <button className="primary full-button" disabled={state === 'loading'}>{state === 'loading' ? 'Entrando…' : 'Iniciar sesión'}</button>
      </form>
    </div>
  </div>
}
