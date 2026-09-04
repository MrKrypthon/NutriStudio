import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { authApi, practiceApi } from '../../lib/api.js'

const TIME_ZONE_OPTIONS = [
  ['America/Mexico_City', 'Ciudad de México (GMT-6)'],
  ['America/Tijuana', 'Tijuana (GMT-8/-7)'],
  ['America/Cancun', 'Cancún (GMT-5)'],
  ['America/Hermosillo', 'Hermosillo (GMT-7)'],
]

const DEFAULT_HOURS = { label: 'Lunes a viernes', ranges: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:00' }] }

const NAV_SECTIONS = [
  ['profile', '◉ Perfil profesional'],
  ['identity', '◆ Identidad visual'],
  ['hours', '◷ Horarios y disponibilidad'],
  ['security', '▣ Privacidad y seguridad'],
]

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

export default function SettingsPage({ setActive }) {
  const [loadState, setLoadState] = useState('loading')
  const [practiceName, setPracticeName] = useState('')
  const [practiceId, setPracticeId] = useState('')
  const [form, setForm] = useState({ timeZone: 'America/Mexico_City', userName: '', userEmail: '', userSpecialty: '', userPhone: '', businessHours: DEFAULT_HOURS })
  const [saveState, setSaveState] = useState('idle')
  const [error, setError] = useState('')
  const [logoState, setLogoState] = useState('idle')
  const [logoError, setLogoError] = useState('')
  const [logoVersion, setLogoVersion] = useState(0)
  const [hasLogo, setHasLogo] = useState(false)
  const [editingHours, setEditingHours] = useState(false)
  const [activeSection, setActiveSection] = useState('profile')
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwState, setPwState] = useState('idle')
  const [pwError, setPwError] = useState('')
  const fileInputRef = useRef(null)
  const sectionRefs = { profile: useRef(null), identity: useRef(null), hours: useRef(null), security: useRef(null) }

  useEffect(() => {
    practiceApi.get()
      .then((practice) => {
        setPracticeName(practice.name || '')
        setPracticeId(practice.id || '')
        setHasLogo(Boolean(practice.logoUrl))
        setForm({
          timeZone: practice.timeZone || 'America/Mexico_City',
          userName: practice.user?.name || '',
          userEmail: practice.user?.email || '',
          userSpecialty: practice.user?.specialty || '',
          userPhone: practice.user?.phone || '',
          businessHours: practice.businessHours || DEFAULT_HOURS,
        })
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

  const update = (key, value) => { setForm((prev) => ({ ...prev, [key]: value })); setSaveState('idle') }
  const updateHours = (patch) => update('businessHours', { ...form.businessHours, ...patch })
  const updateRange = (index, patch) => {
    const ranges = form.businessHours.ranges.map((range, i) => (i === index ? { ...range, ...patch } : range))
    updateHours({ ranges })
  }

  const save = async () => {
    setSaveState('saving')
    setError('')
    try {
      await practiceApi.update({ name: practiceName, ...form })
      setSaveState('saved')
      setEditingHours(false)
    } catch (err) {
      setSaveState('error')
      setError(err.message || 'No se pudo guardar la configuración.')
    }
  }

  const goToSection = (key) => { setActiveSection(key); sectionRefs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  const pickLogo = () => fileInputRef.current?.click()

  const onLogoSelected = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setLogoState('error'); setLogoError('Sube una imagen PNG, JPG o WEBP.'); return }
    if (file.size > 2 * 1024 * 1024) { setLogoState('error'); setLogoError('El logo no puede pesar más de 2 MB.'); return }
    setLogoState('uploading')
    setLogoError('')
    try {
      const dataUrl = await readAsDataUrl(file)
      const updated = await practiceApi.uploadLogo(dataUrl)
      setPracticeId(updated.id)
      setHasLogo(true)
      setLogoVersion((v) => v + 1)
      setLogoState('done')
    } catch (err) {
      setLogoState('error')
      setLogoError(err.message || 'No se pudo subir el logo.')
    }
  }

  const updatePw = (key, value) => { setPwForm((prev) => ({ ...prev, [key]: value })); setPwState('idle'); setPwError('') }

  const changePassword = async () => {
    if (!pwForm.currentPassword || !pwForm.newPassword) { setPwState('error'); setPwError('Completa ambos campos de contraseña.'); return }
    if (pwForm.newPassword.length < 8) { setPwState('error'); setPwError('La nueva contraseña debe tener al menos 8 caracteres.'); return }
    if (pwForm.newPassword !== pwForm.confirmPassword) { setPwState('error'); setPwError('La confirmación no coincide con la nueva contraseña.'); return }
    setPwState('saving')
    setPwError('')
    try {
      await authApi.changePassword(pwForm.currentPassword, pwForm.newPassword)
      setPwState('saved')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      setPwState('error')
      setPwError(err.message || 'No se pudo cambiar la contraseña.')
    }
  }

  const initials = form.userName ? form.userName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : 'GA'

  return <AppChrome active="Configuración" setActive={setActive}><div className="content settings-content">
    <ModuleHeader eyebrow="TU PRÁCTICA" title="Configuración" subtitle="Personaliza tu espacio de trabajo y la experiencia de tus pacientes." action={saveState === 'saved' ? <span className="saved">● Cambios guardados</span> : <button className="primary" disabled={loadState !== 'ready' || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button>} />
    {saveState === 'error' && <div className="form-error">⚠ {error}</div>}
    {loadState === 'loading' && <p className="muted">Cargando configuración…</p>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar la configuración — el API no responde. Verifica que el servidor esté activo para poder editar y guardar.</div>}
    <div className="settings-layout">
      <aside className="settings-nav panel">{NAV_SECTIONS.map(([key, label]) => <button key={key} className={activeSection === key ? 'active' : ''} onClick={() => goToSection(key)}>{label}</button>)}</aside>
      <section className="settings-main">
        <div className="panel settings-card" ref={sectionRefs.profile}>
          <div className="settings-card-head"><div><h2>Perfil profesional</h2><p>Esta información aparece en tus informes y comunicaciones.</p></div><span className="avatar settings-avatar">{initials}</span></div>
          <div className="form-grid">
            <label>Nombre profesional<input value={form.userName} onChange={(e) => update('userName', e.target.value)} /></label>
            <label>Especialidad<input value={form.userSpecialty} onChange={(e) => update('userSpecialty', e.target.value)} placeholder="Ej. Nutrióloga clínica" /></label>
            <label>Email de trabajo<input value={form.userEmail} onChange={(e) => update('userEmail', e.target.value)} /></label>
            <label>Teléfono<input value={form.userPhone} onChange={(e) => update('userPhone', e.target.value)} placeholder="Ej. +52 55 1234 5678" /></label>
          </div>
        </div>
        <div className="panel settings-card" ref={sectionRefs.identity}>
          <div><h2>Identidad visual</h2><p>El logo se incluirá en informes y planes nutricionales.</p></div>
          <div className="logo-row">
            {hasLogo ? <img src={`${practiceApi.logoUrl(practiceId)}?v=${logoVersion}`} alt="Logo de la práctica" className="brand-mark logo-preview" /> : <div className="brand-mark placeholder">N</div>}
            <div><b>Logo de la práctica</b><small>{logoState === 'uploading' ? 'Subiendo…' : logoState === 'error' ? logoError : 'Se incluirá en informes y planes nutricionales.'}</small></div>
            <button className="secondary" onClick={pickLogo} disabled={logoState === 'uploading'}>{logoState === 'uploading' ? 'Subiendo…' : 'Cambiar logo'}</button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onLogoSelected} />
          </div>
        </div>
        <div className="panel settings-card" ref={sectionRefs.hours}>
          <h2>Horarios de atención</h2>
          <p>Configura la disponibilidad que se mostrará al agendar citas.</p>
          {editingHours ? (
            <div className="schedule-row schedule-edit">
              <input value={form.businessHours.label} onChange={(e) => updateHours({ label: e.target.value })} placeholder="Ej. Lunes a viernes" />
              {form.businessHours.ranges.map((range, i) => <span className="schedule-range" key={i}>
                <input type="time" value={range.start} onChange={(e) => updateRange(i, { start: e.target.value })} />
                <input type="time" value={range.end} onChange={(e) => updateRange(i, { end: e.target.value })} />
              </span>)}
              <button className="link-button" onClick={save}>Listo</button>
            </div>
          ) : (
            <div className="schedule-row"><b>{form.businessHours.label}</b>{form.businessHours.ranges.map((range, i) => <span key={i}>{range.start} – {range.end}</span>)}<button className="link-button" onClick={() => setEditingHours(true)}>Editar</button></div>
          )}
          <div className="schedule-row"><b>Zona horaria</b><select value={form.timeZone} onChange={(e) => update('timeZone', e.target.value)}>{TIME_ZONE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        </div>
        <div className="panel settings-card" ref={sectionRefs.security}>
          <h2>Privacidad y seguridad</h2>
          <p>Cambia tu contraseña de acceso.</p>
          {pwState === 'error' && <div className="form-error">⚠ {pwError}</div>}
          {pwState === 'saved' && <span className="saved">● Contraseña actualizada</span>}
          <div className="form-grid">
            <label>Contraseña actual<input type="password" value={pwForm.currentPassword} onChange={(e) => updatePw('currentPassword', e.target.value)} /></label>
            <label>Nueva contraseña<input type="password" value={pwForm.newPassword} onChange={(e) => updatePw('newPassword', e.target.value)} /></label>
            <label>Confirmar nueva contraseña<input type="password" value={pwForm.confirmPassword} onChange={(e) => updatePw('confirmPassword', e.target.value)} /></label>
          </div>
          <button className="secondary" disabled={pwState === 'saving'} onClick={changePassword} style={{ marginTop: 16 }}>{pwState === 'saving' ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </div>
      </section>
    </div>
  </div></AppChrome>
}
