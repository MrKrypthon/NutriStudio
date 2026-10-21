import { LEGAL_DOCUMENTS } from '../../lib/legal.js'
import { LEGAL_TEXTS, patientNoticeText } from './legalTexts.js'
import BrandMark from '../../components/BrandMark.jsx'

// Páginas públicas de los documentos legales (fase 117): /legal/terminos, /legal/privacidad y
// /legal/aviso-pacientes. Se abren sin sesión (desde el login o desde la pantalla para aceptarlos).
// La plantilla para pacientes se llena con ?consulta=&profesional=&domicilio=&correo= y se imprime.
const BY_PATH = Object.fromEntries(Object.entries(LEGAL_DOCUMENTS).map(([key, doc]) => [doc.path, key]))

const formatVersion = (version) => {
  const date = new Date(`${version}T12:00:00`)
  return Number.isNaN(date.getTime()) ? version : date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function LegalPage() {
  const path = window.location.pathname.replace(/\/$/, '')
  const key = BY_PATH[path]
  if (!key) {
    return <LegalShell><h1>Documento no encontrado</h1><p><a href="/legal/terminos">Términos y condiciones</a> · <a href="/legal/privacidad">Aviso de privacidad</a></p></LegalShell>
  }
  const doc = LEGAL_DOCUMENTS[key]
  const params = new URLSearchParams(window.location.search)
  const text = key === 'patientNotice'
    ? patientNoticeText({ practiceName: params.get('consulta'), professionalName: params.get('profesional'), address: params.get('domicilio'), email: params.get('correo') })
    : LEGAL_TEXTS[key]
  const isPatientNotice = key === 'patientNotice'

  return <LegalShell>
    <p className="eyebrow">{isPatientNotice ? 'PARA TUS PACIENTES' : 'MILPA'}</p>
    <h1>{doc.title}</h1>
    <p className="legal-version">Versión del {formatVersion(doc.version)}</p>
    {doc.draft && <div className="legal-draft" role="note"><b>Borrador pendiente de revisión legal.</b> Este texto describe cómo funciona la plataforma, pero todavía no lo revisa un abogado. Los datos entre [corchetes] están por completarse.</div>}
    <p className="legal-intro">{text.intro}</p>
    {text.sections.map((section) => <section key={section.title} className="legal-section">
      <h2>{section.title}</h2>
      {(section.body || []).map((line) => <p key={line}>{line}</p>)}
      {section.items && <ul>{section.items.map((line) => <li key={line}>{line}</li>)}</ul>}
      {(section.after || []).map((line) => <p key={line}>{line}</p>)}
    </section>)}
    <div className="legal-actions no-print">
      <button className="secondary" onClick={() => window.print()}>{isPatientNotice ? 'Imprimir para firma' : 'Imprimir'}</button>
      {!isPatientNotice && <span><a href="/legal/terminos">Términos</a> · <a href="/legal/privacidad">Aviso de privacidad</a> · <a href="/">Ir a Milpa</a></span>}
    </div>
  </LegalShell>
}

function LegalShell({ children }) {
  return <div className="legal-shell">
    <header className="legal-header no-print"><a href="/" className="legal-brand"><BrandMark size={30} /><strong>milpa</strong></a></header>
    <main className="legal-doc">{children}</main>
  </div>
}
