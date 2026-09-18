import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { navGroups } from '../app/navItems.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { dashboardApi, patientsApi, practiceApi } from '../lib/api.js'

const ROLE_LABELS = { OWNER: 'Propietaria', NUTRITIONIST: 'Nutrióloga', ASSISTANT: 'Asistente' }
// Same "today" definition DashboardPage uses, kept local since this is the only other place
// that needs it just to size the notification badge.
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Aviso de cita próxima: aparece 5 min antes, se queda 15 s y se cierra solo. El intervalo refresca
// cada 20 s (suficiente para un aviso de 5 min sin golpear la API con demasiada frecuencia).
const ALERT_LEAD_MS = 5 * 60 * 1000
const ALERT_VISIBLE_MS = 15000
const ALERT_TICK_MS = 20000
const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia' }

// "Ahora" en el reloj de pared de la práctica, con la misma convención que las citas (startAt se
// guarda como hora local etiquetada con "Z"; ver nota en AgendaPage sobre por qué se usan getters UTC).
const practiceNowMs = (timeZone) => {
  if (timeZone) {
    try {
      const date = new Date().toLocaleDateString('en-CA', { timeZone })
      const time = new Date().toLocaleTimeString('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
      return new Date(`${date}T${time}:00.000Z`).getTime()
    } catch { /* cae al reloj del sistema */ }
  }
  return Date.now()
}

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
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('nutri.sidebar') !== 'collapsed')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:1000px)').matches)
  const [tip, setTip] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [tick, setTick] = useState(0)
  const [practiceTz, setPracticeTz] = useState(() => practice?.timeZone || null)
  const searchRef = useRef(null)
  const notifRef = useRef(null)
  const profileRef = useRef(null)
  const notifiedRef = useRef(new Set())
  const alertTimersRef = useRef(new Map())

  // Refresca en segundo plano (citas y contadores del encabezado) cada pocos segundos.
  useEffect(() => { const timer = setInterval(() => setTick((value) => value + 1), ALERT_TICK_MS); return () => clearInterval(timer) }, [])
  // Limpia los temporizadores de autocierre al desmontar.
  useEffect(() => () => { alertTimersRef.current.forEach((timer) => clearTimeout(timer)); alertTimersRef.current.clear() }, [])

  const dismissAlert = (id) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id))
    const timer = alertTimersRef.current.get(id)
    if (timer) { clearTimeout(timer); alertTimersRef.current.delete(id) }
  }

  // La zona horaria de la práctica puede venir ya en la sesión o requerir una consulta aparte.
  useEffect(() => {
    if (practice?.timeZone) { setPracticeTz(practice.timeZone); return undefined }
    let cancelled = false
    practiceApi.get().then((data) => { if (!cancelled) setPracticeTz(data?.timeZone || null) }).catch(() => {})
    return () => { cancelled = true }
  }, [practice?.timeZone])

  useEffect(() => {
    let cancelled = false
    const now = practiceNowMs(practiceTz)
    dashboardApi.today(todayIso()).then((payload) => {
      if (cancelled) return
      setNotifData(payload)
      const upcoming = (payload.appointments || []).filter((appointment) => {
        if (!appointment?.id || !appointment.startAt || notifiedRef.current.has(appointment.id) || appointment.status === 'COMPLETED') return false
        const diff = new Date(appointment.startAt).getTime() - now
        return diff > 0 && diff <= ALERT_LEAD_MS
      })
      if (!upcoming.length) return
      upcoming.forEach((appointment) => notifiedRef.current.add(appointment.id))
      setAlerts((prev) => [...prev, ...upcoming.map((appointment) => ({
        id: appointment.id,
        name: `${appointment.patient?.firstName || ''} ${appointment.patient?.lastName || ''}`.trim() || 'Paciente',
        time: `${String(new Date(appointment.startAt).getUTCHours()).padStart(2, '0')}:${String(new Date(appointment.startAt).getUTCMinutes()).padStart(2, '0')}`,
        minutes: Math.max(1, Math.round((new Date(appointment.startAt).getTime() - now) / 60000)),
        type: APPOINTMENT_TYPE_LABELS[appointment.type] || 'Consulta',
      }))])
      upcoming.forEach((appointment) => {
        const timer = setTimeout(() => { setAlerts((prev) => prev.filter((alert) => alert.id !== appointment.id)); alertTimersRef.current.delete(appointment.id) }, ALERT_VISIBLE_MS)
        alertTimersRef.current.set(appointment.id, timer)
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [tick, practiceTz])

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
    const media = window.matchMedia('(max-width:1000px)')
    const onChange = () => setIsMobile(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Desktop keeps the sidebar preference in localStorage; on mobile the drawer always starts closed.
  useEffect(() => { if (!isMobile) localStorage.setItem('nutri.sidebar', sidebarOpen ? 'open' : 'collapsed') }, [sidebarOpen, isMobile])
  const toggleSidebar = () => { if (isMobile) setDrawerOpen((open) => !open); else setSidebarOpen((open) => !open) }
  // El menú colapsado muestra solo iconos; al pasar el puntero aparece una etiqueta flotante con el
  // nombre de la sección. Se posiciona de forma fija (viewport) para que no la recorte el scroll del sidebar.
  const showTip = (label, element) => { if (isMobile || sidebarOpen) return; const rect = element.getBoundingClientRect(); setTip({ label, top: rect.top + rect.height / 2 }) }
  const hideTip = () => setTip(null)

  useEffect(() => {
    const onClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false)
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false)
    }
    const onKeyDown = (event) => { if (event.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('mousedown', onClickOutside); document.removeEventListener('keydown', onKeyDown) }
  }, [])

  // Close the drawer whenever navigation happens (tapping a link on mobile).
  useEffect(() => { setDrawerOpen(false) }, [active])

  const goToPatients = () => { setActive('Pacientes'); setSearchOpen(false); setSearchQuery('') }
  const pendingConfirmations = notifData?.stats?.pendingConfirmations || 0
  const pendingTasks = notifData?.tasks?.length || 0
  const hasNotifications = pendingConfirmations > 0 || pendingTasks > 0

  return <div className={'app-shell' + (isMobile && drawerOpen ? ' sidebar-open' : '') + (!isMobile && !sidebarOpen ? ' sidebar-collapsed' : '')}><aside className="pc-sidebar" id="app-sidebar"><div className="pc-sidebar-head"><button type="button" className="pc-brand" onClick={() => setActive('Hoy')} title="Ir a Hoy"><div className="brand-mark">N</div><div><strong>nutri<span>·</span>studio</strong><small>CLINICAL WORKSPACE</small></div></button><button type="button" className="sidebar-toggle" aria-label={(isMobile ? drawerOpen : sidebarOpen) ? 'Ocultar menú' : 'Mostrar menú'} aria-expanded={isMobile ? drawerOpen : sidebarOpen} aria-controls="app-sidebar" onClick={toggleSidebar}><Icon>menu</Icon></button></div><div className="pc-navbar">{navGroups.map((group) => <div className="pc-nav-group" key={group.label}><div className="pc-caption">{group.label}</div><nav>{group.items.map(([icon, label]) => <button key={label} aria-label={label} className={active === label ? 'pc-link active' : 'pc-link'} onClick={() => setActive(label)} onMouseEnter={(event) => showTip(label, event.currentTarget)} onMouseLeave={hideTip}><span className="pc-micon"><Icon>{icon}</Icon></span><span className="pc-mtext">{label}</span>{label === 'Pacientes' && notifData?.stats?.activePatients != null && <span className="pc-badge">{notifData.stats.activePatients}</span>}</button>)}</nav></div>)}<button aria-label="Configuración" className={active === 'Configuración' ? 'pc-link pc-settings-link active' : 'pc-link pc-settings-link'} onClick={() => setActive('Configuración')} onMouseEnter={(event) => showTip('Configuración', event.currentTarget)} onMouseLeave={hideTip}><span className="pc-micon"><Icon>settings</Icon></span><span className="pc-mtext">Configuración</span></button></div><div className="pc-sidebar-footer"><button type="button" className="plan-tag" onClick={() => setActive('Configuración')} title="Ir a Configuración"><span className="spark">✦</span><div><b>{practice?.name || 'Consulta privada'}</b><small>Configuración de tu práctica →</small></div></button></div></aside>{drawerOpen && <button type="button" className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)} />}{tip && <span className="pc-tooltip" role="tooltip" style={{ top: `${tip.top}px` }}>{tip.label}</span>}<main className="main"><header className="pc-header"><div className="header-left"><button type="button" className="hamburger" aria-label={(isMobile ? drawerOpen : sidebarOpen) ? 'Ocultar menú' : 'Mostrar menú'} aria-expanded={isMobile ? drawerOpen : sidebarOpen} aria-controls="app-sidebar" onClick={toggleSidebar}>☰</button><div className="crumb"><span>Tu espacio</span><b>/</b><strong>{active}</strong></div></div><div className="top-actions">
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
  </div></header>{children}</main>
    {alerts.length > 0 && <div className="appt-alerts" aria-live="polite">{alerts.map((alert) => <div className="appt-alert" key={alert.id} role="status"><span className="appt-alert-icon"><Icon>clock</Icon></span><div className="appt-alert-body"><b>{alert.name}</b><small>En {alert.minutes} min · {alert.time} · {alert.type}</small></div><button type="button" className="appt-alert-close" aria-label="Cerrar aviso" onClick={() => dismissAlert(alert.id)}>×</button><span className="appt-alert-bar" /></div>)}</div>}
  </div>
}
