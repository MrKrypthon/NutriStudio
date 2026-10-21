import { useState } from 'react'
import { patientsApi } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'
import { patientNoticeUrl } from '../legal/patientNoticeUrl.js'

// Consentimientos del paciente (fase 117). El de datos de salud se registra con la fecha y la versión
// del aviso para pacientes, sólo con una confirmación explícita; el de recordatorios va aparte.
// Registrar o retirar cualquiera queda en la bitácora del expediente.
const formatDate = (value) => new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })

export default function PatientConsentCard({ patient, onChange }) {
  const auth = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!patient) return null
  const name = patient.firstName || 'La paciente'

  const save = async (data) => {
    setSaving(true)
    setError('')
    try {
      await patientsApi.update(patient.id, data)
      setConfirming(false)
      onChange?.()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el consentimiento.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="summary-card form-card patient-consent-card">
    <div className="summary-card-head"><h3>Consentimientos</h3><div className="summary-card-actions"><a className="link-button" href={patientNoticeUrl(auth)} target="_blank" rel="noopener noreferrer">Aviso para pacientes ↗</a></div></div>
    <div className={`consent-status ${patient.consentDataAt ? 'is-given' : 'is-pending'}`}>
      <div>
        <b>Datos de salud</b>
        {patient.consentDataAt
          ? <small>Otorgado el {formatDate(patient.consentDataAt)}{patient.consentVersion ? ` · aviso versión ${patient.consentVersion}` : ''}</small>
          : <small>Pendiente: sin consentimiento expreso registrado. Entrégale el aviso para pacientes y regístralo cuando lo firme.</small>}
      </div>
      {patient.consentDataAt
        ? <button type="button" className="link-button" disabled={saving} onClick={() => { if (window.confirm(`¿Retirar el consentimiento de ${name}? Queda registrado en la bitácora.`)) save({ healthDataConsent: false }) }}>Retirar</button>
        : !confirming && <button type="button" className="secondary" disabled={saving} onClick={() => setConfirming(true)}>Registrar</button>}
    </div>
    {confirming && <div className="consent-confirm">
      <p>Confirmo que <b>{patient.firstName} {patient.lastName}</b> leyó el aviso de privacidad de la consulta y otorgó su consentimiento expreso para el tratamiento de sus datos de salud.</p>
      <div><button type="button" className="link-button" onClick={() => setConfirming(false)}>Cancelar</button><button type="button" className="primary" disabled={saving} onClick={() => save({ healthDataConsent: true })}>{saving ? 'Guardando…' : 'Confirmar'}</button></div>
    </div>}
    <label className="consent-check">
      <input type="checkbox" checked={Boolean(patient.communicationConsentAt)} disabled={saving} onChange={(event) => save({ communicationConsent: event.target.checked })} />
      <span><b>Recordatorios y materiales</b><small>{patient.communicationConsentAt ? `Autorizó recibirlos por WhatsApp o correo el ${formatDate(patient.communicationConsentAt)}.` : 'Sin autorización para enviarle recordatorios o materiales.'}</small></span>
    </label>
    {error && <div className="form-error">⚠ {error}</div>}
  </div>
}
