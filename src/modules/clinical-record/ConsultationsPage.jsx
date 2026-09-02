import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

const STATUS_LABELS = { IN_PROGRESS: 'En progreso', COMPLETED: 'Completada', DRAFT: 'Borrador' }
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const formatUTCDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const summarize = (consultation) => consultation.plans?.some((p) => p.status === 'PUBLISHED') ? 'Plan publicado' : consultation.sections?.length ? `${consultation.sections.length} sección(es) registradas` : 'Sin registros aún'

export default function ConsultationsPage({ setActive, patientId }) {
  const { patient: patientRecord } = usePatient(patientId)
  const patient = patientRecord ? `${patientRecord.firstName} ${patientRecord.lastName}` : 'Cargando…'
  const patientInitials = patientRecord ? `${patientRecord.firstName[0] || ''}${patientRecord.lastName[0] || ''}` : '··'

  const [sessions, setSessions] = useState([])
  const [loadState, setLoadState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    patientsApi.consultations(patientId)
      .then((response) => { if (!cancelled) { setSessions(response.items || []); setLoadState('ready') } })
      .catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [patientId])

  const lastSession = sessions[0]

  return <AppChrome active="Consultas" setActive={setActive}><div className="content consultation-content">
    <ModuleHeader eyebrow="CONSULTAS · SESIÓN DE HOY" title="Nueva sesión" subtitle="Registra la consulta y crea el siguiente paso para tu paciente." action={<button className="secondary">Historial de sesiones</button>} />
    <div className="session-selector panel"><span className="person-avatar coral">{patientInitials}</span><div><p className="eyebrow">PACIENTE</p><b>{patient}</b><small>{patientRecord?.sex || 'Paciente'}{lastSession ? ` · Última consulta: ${formatUTCDate(lastSession.startedAt || lastSession.createdAt)}` : ' · Sin consultas previas'}</small></div></div>
    <div className="session-question">
      <p className="eyebrow">¿POR DÓNDE QUIERES COMENZAR HOY?</p>
      <div className="session-options">
        <button className="session-option" onClick={() => setActive('Expediente')}><span className="session-icon mint">▤</span><b>Grabar consulta / informe</b><small>Registra la anamnesis, evaluación y diagnóstico nutricio.</small><strong>Ir al informe <span>→</span></strong></button>
        <button className="session-option" onClick={() => setActive('Constructor de plan')}><span className="session-icon blue">▦</span><b>Diseñar plan de alimentación</b><small>Distribuye macros, crea menús y programa la semana.</small><strong>Ir al plan <span>→</span></strong></button>
      </div>
      <div className="session-note">↗ Podrás cambiar entre Consulta y Plan en cualquier momento.</div>
    </div>
    <div className="recent-sessions panel">
      <div className="panel-title"><div><h2>Sesiones recientes</h2><p>El historial de {patient}</p></div></div>
      {loadState === 'loading' && <p className="muted">Cargando historial…</p>}
      {loadState === 'error' && <p className="muted">No se pudo cargar el historial de consultas.</p>}
      {loadState === 'ready' && sessions.length === 0 && <p className="muted">Todavía no hay consultas registradas para {patient}.</p>}
      {sessions.map((session) => <div className="recent-row" key={session.id}><span className="recent-date">{formatUTCDate(session.startedAt || session.createdAt)}</span><b>{STATUS_LABELS[session.status] || session.status}</b><span className="muted">{summarize(session)}</span><span className={'status ' + (session.status === 'COMPLETED' ? 'confirmed' : 'pending')}>{STATUS_LABELS[session.status] || session.status}</span><button className="row-arrow" onClick={() => setActive('Expediente')}>→</button></div>)}
    </div>
  </div></AppChrome>
}
