import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { authApi } from './api.js'
import { clearToken, getToken, onUnauthorized, setToken } from './auth.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [practice, setPractice] = useState(null)
  const [status, setStatus] = useState('checking') // checking | authenticated | anonymous

  const logout = useCallback(() => {
    // Fire this while the token is still attached — it's the last authenticated call this
    // session makes. Stateless session, so nothing to undo locally if it fails.
    authApi.logout().catch(() => {})
    clearToken()
    setUser(null)
    setPractice(null)
    setStatus('anonymous')
  }, [])

  useEffect(() => { onUnauthorized(() => { clearToken(); setUser(null); setPractice(null); setStatus('anonymous') }) }, [])

  useEffect(() => {
    if (!getToken()) { setStatus('anonymous'); return }
    authApi.me()
      .then((response) => { setUser(response.user); setPractice(response.practice); setStatus('authenticated') })
      .catch(() => { clearToken(); setStatus('anonymous') })
  }, [])

  const login = useCallback(async (email, password) => {
    const response = await authApi.login(email, password)
    setToken(response.token)
    setUser(response.user)
    setPractice(response.practice)
    setStatus('authenticated')
  }, [])

  // Re-sync user/practice after profile/logo edits in Configuración so the sidebar (which reads
  // them from here) updates without a full reload.
  const refreshPractice = useCallback(async () => {
    try {
      const response = await authApi.me()
      setUser(response.user)
      setPractice(response.practice)
    } catch { /* keep the current state; a reload will retry */ }
  }, [])

  return <AuthContext.Provider value={{ user, practice, status, login, logout, refreshPractice }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return context
}
