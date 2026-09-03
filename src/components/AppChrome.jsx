import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { navGroups } from '../app/navItems.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { dashboardApi, patientsApi } from '../lib/api.js'

const ROLE_LABELS = { OWNER: 'Propietaria', NUTRITIONIST: 'Nutrióloga', ASSISTANT: 'Asistente' }
// Same "today" definition DashboardPage uses, kept local since this is the only other place
// that needs it just to size the notification badge.
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function AppChrome({ active, setActive, children }) {
  const { user, practice, logout } = useAuth()
  const initials = user ? user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() : '··'
  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : ''

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifData, setNotifData] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const searchRef = useRef(null)
  const notifRef = useRef(null)
  const profileRef = useRef(null)

  useEffect(() => { dashboardApi.today(todayIso()).then(setNotifData).catch(() => {}) }, [])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return undefined }
    let cancelled = false
    const timer = setTimeout(() => {
      patientsApi.list(`?search=${encodeURIComponent(searchQuery)}&status=ACTIVE`)
        .then((response) => { if (!cancelled) setSearchResults((response.items || []).slice(0, 6)) })
        .catch(() => {})
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery])

  useEffect(() => {
    const onClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false)
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const goToPatients = () => { setActive('Pacientes'); setSearchOpen(false); setSearchQuery('') }
  const pendingConfirmations = notifData?.stats?.pendingConfirmations || 0
  const pendingTasks = notifData?.tasks?.length || 0
  const hasNotifications = pendingConfirmations > 0 || pendingTasks > 0

  return <div className="app-shell"><aside className="pc-sidebar"><button type="button" className="pc-brand" onClick={() => setActive('Hoy')} title="Ir a Hoy"><div className="brand-mark">N</div><div><strong>nutri<span>·</span>studio</strong><small>CLINICAL WORKSPACE</small></div></button><button type="button" className="pc-workspace" onClick={() => setActive('Configuración')} title="Ir a Configuración"><span className="avatar small">{initials}</span><div style={{ minWidth: 0 }}><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || 'Cargando…'}</b><small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{practice?.name || 'Consulta privada'}</small></div><span className="chevron">⌄</span></button><div className="pc-navbar">{navGroups.map((group) => <div className="pc-nav-group" key={group.label}><div className="pc-caption">{group.label}</div><nav>{group.items.map(([icon, label]) => <button key={label} className={active === label ? 'pc-link active' : 'pc-link'} onClick={() => setActive(label)}><span className="pc-micon"><Icon>{icon}</Icon></span><span className="pc-mtext">{label}</span>{label === 'Pacientes' && notifData?.stats?.activePatients != null && <span className="pc-badge">{notifData.stats.activePatients}</span>}</button>)}</nav></div>)}<button className={active === 'Configuración' ? 'pc-link pc-settings-link active' : 'pc-link pc-settings-link'} onClick={() => setActive('Configuración')}><span className="pc-micon"><Icon>⚙</Icon></span><span className="pc-mtext">Configuración</span></button></div><div className="pc-sidebar-footer"><div className="plan-tag"><span className="spark">✦</span><div><b>Plan profesional</b><small>Tu periodo termina en 18 días</small></div></div><button className="help">? <span>Centro de ayuda</span></button></div></aside><main className="main"><header className="pc-header"><div className="crumb"><span>Tu espacio</span><b>/</b><strong>{active}</strong></div><div className="top-actions">
    <div className="header-pop" ref={searchRef}>
      <button className="icon-button" onClick={() => setSearchOpen((v) => !v)} title="Buscar paciente">⌕</button>
      {searchOpen && <div className="dropdown-panel search-dropdown">
        <input autoFocus placeholder="Buscar paciente…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        {searchQuery.trim() && searchResults.length === 0 && <p className="dropdown-empty">Sin resultados</p>}
        {searchResults.map((p) => <button key={p.id} className="dropdown-item" onClick={goToPatients}><span className="person-avatar coral">{(p.firstName?.[0] || '') + (p.lastName?.[0] || '')}</span><div><b>{p.firstName} {p.lastName}</b><small>{p.status === 'ARCHIVED' ? 'Archivado' : 'Activo'}</small></div></button>)}
        {searchResults.length > 0 && <button className="dropdown-footer" onClick={goToPatients}>Ver todos en Pacientes →</button>}
      </div>}
    </div>
    <div className="header-pop" ref={notifRef}>
      <button className="icon-button notification" onClick={() => setNotifOpen((v) => !v)} title="Notificaciones">♧{hasNotifications && <i />}</button>
      {notifOpen && <div className="dropdown-panel notif-dropdown">
        <p className="dropdown-title">Notificaciones</p>
        {!hasNotifications && <p className="dropdown-empty">Todo al día.</p>}
        {pendingConfirmations > 0 && <button className="dropdown-item" onClick={() => { setActive('Agenda'); setNotifOpen(false) }}><span className="stat-icon orange">◌</span><div><b>{pendingConfirmations} cita{pendingConfirmations === 1 ? '' : 's'} por confirmar</b><small>Ir a Agenda →</small></div></button>}
        {pendingTasks > 0 && <button className="dropdown-item" onClick={() => { setActive('Seguimientos'); setNotifOpen(false) }}><span className="stat-icon purple">◒</span><div><b>{pendingTasks} seguimiento{pendingTasks === 1 ? '' : 's'} pendiente{pendingTasks === 1 ? '' : 's'}</b><small>Ir a Seguimientos →</small></div></button>}
      </div>}
    </div>
    <span className="divider" />
    <div className="header-pop" ref={profileRef}>
      <button className="icon-button profile-button" onClick={() => setProfileOpen((v) => !v)} title="Tu cuenta" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="avatar">{initials}</span><div className="user-name"><b>{user?.name || 'Cargando…'}</b><small>{roleLabel}</small></div><span className="chevron">⌄</span></button>
      {profileOpen && <div className="dropdown-panel profile-dropdown">
        <button className="dropdown-item" onClick={() => { setActive('Configuración'); setProfileOpen(false) }}><span className="stat-icon purple">⚙</span><div><b>Configuración</b><small>Perfil, logo, horarios</small></div></button>
        <button className="dropdown-item" onClick={logout}><span className="stat-icon orange">⏻</span><div><b>Cerrar sesión</b></div></button>
      </div>}
    </div>
  </div></header>{children}</main></div>
}
