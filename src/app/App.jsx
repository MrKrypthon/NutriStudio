import { useEffect, useState } from 'react'
import { DEMO_PATIENT_ID } from '../lib/demoContext.js'
import { useAuth } from '../lib/AuthContext.jsx'

import LoginPage from '../modules/auth/LoginPage.jsx'
import DashboardPage from '../modules/dashboard/DashboardPage.jsx'
import AgendaPage from '../modules/calendar/AgendaPage.jsx'
import PatientsPage from '../modules/patients/PatientsPage.jsx'
import NewPatientPage from '../modules/patients/NewPatientPage.jsx'
import ClinicalRecordPage from '../modules/clinical-record/ClinicalRecordPage.jsx'
import ConsultationsPage from '../modules/clinical-record/ConsultationsPage.jsx'
import PlanStudioPage from '../modules/nutrition-plan/PlanStudioPage.jsx'
import RecipesPage from '../modules/recipes/RecipesPage.jsx'
import NewRecipePage from '../modules/recipes/NewRecipePage.jsx'
import IngredientsPage from '../modules/ingredients/IngredientsPage.jsx'
import ImportFoodsPage from '../modules/ingredients/ImportFoodsPage.jsx'
import TemplatesPage from '../modules/templates/TemplatesPage.jsx'
import DocumentsPage from '../modules/documents/DocumentsPage.jsx'
import DocumentPage from '../modules/documents/DocumentPage.jsx'
import FollowupsPage from '../modules/tasks/FollowupsPage.jsx'
import EducationPage from '../modules/education/EducationPage.jsx'
import NewMaterialPage from '../modules/education/NewMaterialPage.jsx'
import SettingsPage from '../modules/settings/SettingsPage.jsx'

const pathToModule = { '/': 'Hoy', '/hoy': 'Hoy', '/agenda': 'Agenda', '/pacientes': 'Pacientes', '/recetas': 'Recetas', '/ingredientes': 'Ingredientes', '/plantillas': 'Plantillas', '/constructor-plan': 'Constructor de plan', '/documentos': 'Documentos', '/nuevo-paciente': 'Nuevo paciente', '/configuracion': 'Configuración', '/importar-alimentos': 'Importar alimentos' }
const moduleToSlug = { 'Hoy': 'hoy', 'Agenda': 'agenda', 'Pacientes': 'pacientes', 'Recetas': 'recetas', 'Ingredientes': 'ingredientes', 'Plantillas': 'plantillas', 'Constructor de plan': 'constructor-plan', 'Documentos': 'documentos', 'Nuevo paciente': 'nuevo-paciente', 'Configuración': 'configuracion', 'Importar alimentos': 'importar-alimentos', 'Documento': 'documentos', 'Expediente': 'pacientes' }

export default function App() {
  const { status } = useAuth()
  const [active, setActiveState] = useState(() => pathToModule[window.location.pathname] || 'Hoy')
  const [selectedPatientId, setSelectedPatientId] = useState(DEMO_PATIENT_ID)
  const [selectedMaterialId, setSelectedMaterialId] = useState(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState(null)
  const [startAppointmentId, setStartAppointmentId] = useState(null)
  const [selectedConsultationId, setSelectedConsultationId] = useState(null)
  const [autoOpenNewAppointment, setAutoOpenNewAppointment] = useState(false)
  const [newAppointmentPatientId, setNewAppointmentPatientId] = useState('')
  const [autoAgendaFilter, setAutoAgendaFilter] = useState(null)
  const setActive = (next) => {
    setActiveState(next)
    const slug = moduleToSlug[next]
    if (slug && window.location.pathname !== `/${slug}`) window.history.pushState({}, '', `/${slug}`)
  }

  useEffect(() => {
    const onPopState = () => setActiveState(pathToModule[window.location.pathname] || 'Hoy')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // From an Agenda/Hoy appointment straight into its consultation: selects the patient, remembers
  // which appointment triggered it (so ClinicalRecordPage can mark it COMPLETED when it creates
  // the consultation), and jumps to the expediente.
  const startConsultation = (patientId, appointmentId) => {
    setSelectedPatientId(patientId)
    setSelectedConsultationId(null)
    setStartAppointmentId(appointmentId || null)
    setActive('Expediente')
  }

  // "Historial de sesiones" in Consultas opens THAT specific session in the expediente (a
  // completed one included), instead of always jumping to the current in-progress consultation.
  const openSession = (patientId, consultationId) => {
    setSelectedPatientId(patientId)
    setSelectedConsultationId(consultationId)
    setStartAppointmentId(null)
    setActive('Expediente')
  }

  // "Nueva cita" from Hoy used to just land on Agenda, where you then had to click its own
  // "Nueva cita" button again to actually open the form -- this skips straight to the form.
  // "Agendar" from a patient's expediente reuses the same mechanism, pre-selecting that patient.
  const goToNewAppointment = (patientId = '') => {
    setNewAppointmentPatientId(patientId)
    setAutoOpenNewAppointment(true)
    setActive('Agenda')
  }

  // "Por confirmar" on Hoy jumps straight into an Agenda already filtered to those
  // appointments, instead of landing on the unfiltered week (see autoFilter in AgendaPage).
  const goToAgendaFiltered = (filter) => {
    setAutoAgendaFilter(filter)
    setActive('Agenda')
  }

  if (status === 'checking') return null
  if (status === 'anonymous') return <LoginPage />

  if (active === 'Hoy') return <DashboardPage setActive={setActive} onStartConsultation={startConsultation} onNewAppointment={goToNewAppointment} onOpenAgendaFiltered={goToAgendaFiltered} />
  if (active === 'Agenda') return <AgendaPage setActive={setActive} onStartConsultation={startConsultation} autoOpenNew={autoOpenNewAppointment} autoOpenPatientId={newAppointmentPatientId} onConsumeAutoOpen={() => { setAutoOpenNewAppointment(false); setNewAppointmentPatientId('') }} autoFilter={autoAgendaFilter} onConsumeAutoFilter={() => setAutoAgendaFilter(null)} />
  if (active === 'Pacientes') return <PatientsPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Nuevo paciente') return <NewPatientPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Nueva receta') return <NewRecipePage setActive={setActive} />
  if (active === 'Editar receta') return <NewRecipePage setActive={setActive} recipeId={selectedRecipeId} />
  if (active === 'Configuración') return <SettingsPage setActive={setActive} />
  if (active === 'Importar alimentos') return <ImportFoodsPage setActive={setActive} />
  if (active === 'Expediente') return <ClinicalRecordPage setActive={setActive} patientId={selectedPatientId} consultationId={selectedConsultationId} onConsumeConsultation={() => setSelectedConsultationId(null)} appointmentId={startAppointmentId} onConsumeAppointment={() => setStartAppointmentId(null)} onScheduleAppointment={() => goToNewAppointment(selectedPatientId)} />
  if (active === 'Constructor de plan') return <PlanStudioPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={setSelectedPatientId} />
  if (active === 'Documento') return <DocumentPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Documentos') return <DocumentsPage setActive={setActive} />
  if (active === 'Seguimientos') return <FollowupsPage setActive={setActive} />
  if (active === 'Consultas') return <ConsultationsPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={setSelectedPatientId} onOpenSession={openSession} />
  if (active === 'Plantillas') return <TemplatesPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Recetas') return <RecipesPage setActive={setActive} onSelectRecipe={setSelectedRecipeId} />
  if (active === 'Ingredientes') return <IngredientsPage setActive={setActive} />
  if (active === 'Educación') return <EducationPage setActive={setActive} onSelectMaterial={setSelectedMaterialId} />
  if (active === 'Nuevo material') return <NewMaterialPage setActive={setActive} />
  if (active === 'Editar material') return <NewMaterialPage setActive={setActive} materialId={selectedMaterialId} />

  return <DashboardPage setActive={setActive} />
}
