import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { authApi } from './api.js'
import { clearToken, getToken, onSubscriptionRequired, onUnauthorized, setToken } from './auth.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [practice, setPractice] = useState(null)
  const [status, setStatus] = useState('checking') // checking | authenticated | anonymous
  // ¿La cuenta puede usar el sistema? { allowed, reason, inGrace } — sin suscripción pagada la app
  // sólo muestra la pantalla de pago (fase 109).
  const [access, setAccess] = useState(null)

  const logout = useCallback(() => {
    // Fire this while the token is still attached — it's the last authenticated call this
    // session makes. Stateless session, so nothing to undo locally if it fails.
    authApi.logout().catch(() => {})
    clearToken()
    setUser(null)
    setPractice(null)
    setAccess(null)
    setStatus('anonymous')
  }, [])

  const applySession = useCallback((response) => {
    setUser(response.user)
    setPractice(response.practice)
    setAccess(response.access || { allowed: true })
  }, [])

  useEffect(() => { onUnauthorized(() => { clearToken(); setUser(null); setPractice(null); setAccess(null); setStatus('anonymous') }) }, [])
  useEffect(() => { onSubscriptionRequired(() => setAccess({ allowed: false, reason: 'SUBSCRIPTION_REQUIRED' })) }, [])

  useEffect(() => {
    if (!getToken()) { setStatus('anonymous'); return }
    authApi.me()
      .then((response) => { applySession(response); setStatus('authenticated') })
      // Sólo una sesión rechazada borra el token; una red caída o un error del servidor al abrir la
      // app no deben cerrar la sesión (al recargar se recupera).
      .catch((err) => { if (err.code === 'UNAUTHORIZED' || err.code === 'ACCOUNT_SUSPENDED') clearToken(); setStatus('anonymous') })
  }, [applySession])

  const login = useCallback(async (email, password) => {
    const response = await authApi.login(email, password)
    setToken(response.token)
    applySession(response)
    setStatus('authenticated')
  }, [applySession])

  // Entrar (o registrarse) con Google: `credential` es el token que entrega el botón de Google.
  const loginWithGoogle = useCallback(async (credential) => {
    const response = await authApi.google(credential)
    setToken(response.token)
    applySession(response)
    setStatus('authenticated')
    return response
  }, [applySession])

  // Re-sync user/practice after profile/logo edits in Configuración so the sidebar (which reads
  // them from here) updates without a full reload.
  const refreshPractice = useCallback(async () => {
    try {
      const response = await authApi.me()
      applySession(response)
      return response
    } catch { return null /* keep the current state; a reload will retry */ }
  }, [applySession])

  return <AuthContext.Provider value={{ user, practice, status, access, login, loginWithGoogle, logout, refreshPractice }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return context
}
