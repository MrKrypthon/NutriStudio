import { useEffect, useState } from 'react'
import { patientsApi } from './api.js'

// Shared by every patient-scoped screen so each one doesn't repeat the same fetch-by-id effect.
export function usePatient(patientId) {
  const [patient, setPatient] = useState(null)
  const [loadState, setLoadState] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setPatient(null)
    patientsApi.get(patientId)
      .then((data) => { if (!cancelled) { setPatient(data); setLoadState('ready') } })
      .catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [patientId])

  return { patient, loadState }
}
