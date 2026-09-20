import { useEffect, useState } from 'react'
import { patientsApi } from './api.js'

// Shared by every patient-scoped screen so each one doesn't repeat the same fetch-by-id effect.
// `reload` permite refrescar tras editar datos del paciente desde el expediente.
export function usePatient(patientId) {
  const [patient, setPatient] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!patientId) { setPatient(null); setLoadState('ready'); return undefined }
    let cancelled = false
    setLoadState('loading')
    setPatient(null)
    patientsApi.get(patientId)
      .then((data) => { if (!cancelled) { setPatient(data); setLoadState('ready') } })
      .catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [patientId, tick])

  return { patient, loadState, reload: () => setTick((n) => n + 1) }
}
