import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import ThemePicker from '../../components/ThemePicker.jsx'
import { practiceApi } from '../../lib/api.js'

const TIME_ZONE_OPTIONS = [
  ['America/Mexico_City', 'Ciudad de México (GMT-6)'],
  ['America/Tijuana', 'Tijuana (GMT-8/-7)'],
  ['America/Cancun', 'Cancún (GMT-5)'],
  ['America/Hermosillo', 'Hermosillo (GMT-7)'],
]

export default function SettingsPage({ setActive }) {
  const [loadState, setLoadState] = useState('loading')
  const [practiceName, setPracticeName] = useState('')
  const [form, setForm] = useState({ timeZone: 'America/Mexico_City', userName: '', userEmail: '' })
  const [saveState, setSaveState] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    practiceApi.get()
      .then((practice) => {
        setPracticeName(practice.name || '')
        setForm({ timeZone: practice.timeZone || 'America/Mexico_City', userName: practice.user?.name || '', userEmail: practice.user?.email || '' })
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

  const update = (key, value) => { setForm((prev) => ({ ...prev, [key]: value })); setSaveState('idle') }

  const save = async () => {
    setSaveState('saving')
    setError('')
    try {
      await practiceApi.update({ name: practiceName, ...form })
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      setError(err.message || 'No se pudo guardar la configuración.')
    }
  }

  const initials = form.userName ? form.userName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : 'GA'

  return <AppChrome active="Configuración" setActive={setActive}><div className="content settings-content">
    <ModuleHeader eyebrow="TU PRÁCTICA" title="Configuración" subtitle="Personaliza tu espacio de trabajo y la experiencia de tus pacientes." action={saveState === 'saved' ? <span className="saved">● Cambios guardados</span> : <button className="primary" disabled={loadState !== 'ready' || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button>} />
    {saveState === 'error' && <div className="form-error">⚠ {error}</div>}
    <div className="settings-layout">
      <aside className="settings-nav panel"><button className="active">◉ Perfil profesional</button><button>◆ Identidad visual</button><button>◷ Horarios y disponibilidad</button><button>♧ Notificaciones</button><button>▣ Privacidad y seguridad</button></aside>
      <section className="settings-main">
        <div className="panel settings-card">
          <div className="settings-card-head"><div><h2>Perfil profesional</h2><p>Esta información aparece en tus informes y comunicaciones.</p></div><span className="avatar settings-avatar">{initials}</span></div>
          <div className="form-grid">
            <label>Nombre profesional<input value={form.userName} onChange={(e) => update('userName', e.target.value)} /></label>
            <label>Especialidad<input value="Nutrióloga clínica" readOnly /></label>
            <label>Email de trabajo<input value={form.userEmail} onChange={(e) => update('userEmail', e.target.value)} /></label>
            <label>Teléfono<input value="+52 55 1234 5678" readOnly /></label>
          </div>
        </div>
        <div className="panel settings-card">
          <div><h2>Identidad visual</h2><p>Elige los colores que se usarán en la aplicación y en tus documentos.</p></div>
          <div className="settings-theme-row"><div><b>Apariencia de la aplicación</b><small>La paleta predeterminada es minimalista y de bajo contraste.</small></div><ThemePicker /></div>
          <div className="logo-row"><div className="brand-mark">N</div><div><b>Logo de la práctica</b><small>Se incluirá en informes y planes nutricionales.</small></div><button className="secondary">Cambiar logo</button></div>
        </div>
        <div className="panel settings-card">
          <h2>Horarios de atención</h2>
          <p>Configura la disponibilidad que se mostrará al agendar citas.</p>
          <div className="schedule-row"><b>Lunes a viernes</b><span>09:00 – 13:00</span><span>15:00 – 19:00</span><button className="link-button">Editar</button></div>
          <div className="schedule-row"><b>Zona horaria</b><select value={form.timeZone} onChange={(e) => update('timeZone', e.target.value)}>{TIME_ZONE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        </div>
      </section>
    </div>
  </div></AppChrome>
}
