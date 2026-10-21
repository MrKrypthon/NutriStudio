// Documentos legales y sus versiones (fase 117). Lo comparten la API (qué hay que aceptar) y el
// frontend (qué se muestra). Al cambiar el texto de un documento se cambia su `version`: la API pide
// de nuevo la aceptación a todos y queda el historial de qué versión aceptó cada quien.
//
// `draft: true`: el texto es un BORRADOR técnico pendiente de revisión por un abogado. La app lo
// muestra con un aviso visible. Quitarlo sólo cuando el texto esté revisado.

export const LEGAL_DOCUMENTS = {
  terms: { version: '2026-10-21', draft: true, title: 'Términos y condiciones de uso', path: '/legal/terminos' },
  privacy: { version: '2026-10-21', draft: true, title: 'Aviso de privacidad', path: '/legal/privacidad' },
  // Plantilla que cada consulta entrega a sus pacientes; no la acepta el nutriólogo, se registra su
  // versión junto con el consentimiento de cada paciente.
  patientNotice: { version: '2026-10-21', draft: true, title: 'Aviso de privacidad para pacientes', path: '/legal/aviso-pacientes' },
}

// Lo que cada usuario de la app tiene que aceptar para usarla.
export const REQUIRED_ACCEPTANCES = ['terms', 'privacy']

// Qué documentos (de los requeridos) le faltan a alguien, según lo que ya aceptó.
// `accepted`: [{ document, version }]. Devuelve [{ document, version, title, path }].
export function pendingAcceptances(accepted = []) {
  const have = new Set(accepted.map((row) => `${row.document}@${row.version}`))
  return REQUIRED_ACCEPTANCES
    .filter((document) => !have.has(`${document}@${LEGAL_DOCUMENTS[document].version}`))
    .map((document) => ({ document, version: LEGAL_DOCUMENTS[document].version, title: LEGAL_DOCUMENTS[document].title, path: LEGAL_DOCUMENTS[document].path }))
}

// Valida lo que manda el cliente al aceptar: sólo documentos requeridos y en su versión vigente.
export function validateAcceptance(items) {
  if (!Array.isArray(items) || !items.length) return { ok: false, message: 'Indica qué documentos aceptas.' }
  const documents = new Set()
  for (const item of items) {
    const current = LEGAL_DOCUMENTS[item?.document]
    if (!current || !REQUIRED_ACCEPTANCES.includes(item.document)) return { ok: false, message: 'Documento desconocido.' }
    if (item.version !== current.version) return { ok: false, message: `${current.title} cambió; vuelve a leerlo antes de aceptarlo.`, stale: true }
    documents.add(item.document)
  }
  return { ok: true, documents: [...documents] }
}
