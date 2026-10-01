import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { parseLocation, pathFor } from './routes.js'

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
import FinancePage from '../modules/finance/FinancePage.jsx'

export default function App() {
  const { status } = useAuth()
  const initial = parseLocation(window.location.pathname)
  const [active, setActiveState] = useState(() => initial.module)
  // Sin paciente por defecto: antes arrancaba con el paciente de demostración, así que Consultas y
  // el Constructor abrían con Mariana Torres sin haber elegido a nadie. Cada pantalla que necesita
  // un paciente ahora pide elegirlo — o lo toma de la dirección, al recargar.
  const [selectedPatientId, setSelectedPatientId] = useState(initial.patientId)
  const [selectedMaterialId, setSelectedMaterialId] = useState(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState(null)
  const [startAppointmentId, setStartAppointmentId] = useState(null)
  const [selectedConsultationId, setSelectedConsultationId] = useState(initial.consultationId)
  const [pendingRecipeName, setPendingRecipeName] = useState(null)
  const [autoOpenNewAppointment, setAutoOpenNewAppointment] = useState(false)
  const [newAppointmentPatientId, setNewAppointmentPatientId] = useState('')
  const [autoAgendaFilter, setAutoAgendaFilter] = useState(null)

  /**
   * Único punto por el que se navega. Escribe a la vez el estado y la dirección, porque si sólo se
   * actualizara el estado la barra de direcciones quedaría mintiendo y recargar sacaría al usuario
   * de donde estaba. El paciente y la consulta se pasan explícitamente cuando cambian: leerlos del
   * estado aquí daría el valor viejo, ya que `setState` no se ha aplicado todavía.
   */
  const go = (module, options = {}) => {
    const patientId = 'patientId' in options ? options.patientId : selectedPatientId
    const consultationId = 'consultationId' in options ? options.consultationId : null
    if ('patientId' in options) setSelectedPatientId(options.patientId)
    setSelectedConsultationId(consultationId)
    setActiveState(module)
    const next = pathFor(module, patientId, consultationId)
    if (next && window.location.pathname !== next) window.history.pushState({}, '', next)
  }
  const setActive = (next) => go(next)

  useEffect(() => {
    // Atrás y adelante del navegador reconstruyen el estado desde la dirección, paciente incluido.
    const onPopState = () => {
      const route = parseLocation(window.location.pathname)
      setActiveState(route.module)
      setSelectedPatientId(route.patientId || '')
      setSelectedConsultationId(route.consultationId)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // From an Agenda/Hoy appointment straight into its consultation: selects the patient, remembers
  // which appointment triggered it (so ClinicalRecordPage can mark it COMPLETED when it creates
  // the consultation), and jumps to the expediente.
  const startConsultation = (patientId, appointmentId) => {
    setStartAppointmentId(appointmentId || null)
    go('Expediente', { patientId, consultationId: null })
  }

  // "Historial de sesiones" in Consultas opens THAT specific session in the expediente (a
  // completed one included), instead of always jumping to the current in-progress consultation.
  const openSession = (patientId, consultationId) => {
    setStartAppointmentId(null)
    go('Expediente', { patientId, consultationId })
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

  // "Asignar al plan" from a recipe's detail: jump to the plan studio and prefill the next
  // recipe picker's search with that recipe's name, so the professional doesn't have to retype it.
  const assignRecipe = (recipeName) => {
    setPendingRecipeName(recipeName)
    setActive('Constructor de plan')
  }

  if (status === 'checking') return null
  if (status === 'anonymous') return <LoginPage />

  if (active === 'Hoy') return <DashboardPage setActive={setActive} onStartConsultation={startConsultation} onNewAppointment={goToNewAppointment} onOpenAgendaFiltered={goToAgendaFiltered} onOpenPlan={(pid) => go('Constructor de plan', { patientId: pid })} />
  if (active === 'Agenda') return <AgendaPage setActive={setActive} onStartConsultation={startConsultation} autoOpenNew={autoOpenNewAppointment} autoOpenPatientId={newAppointmentPatientId} onConsumeAutoOpen={() => { setAutoOpenNewAppointment(false); setNewAppointmentPatientId('') }} autoFilter={autoAgendaFilter} onConsumeAutoFilter={() => setAutoAgendaFilter(null)} />
  if (active === 'Pacientes') return <PatientsPage setActive={setActive} onSelectPatient={setSelectedPatientId} onOpenPatient={(pid, module) => go(module, { patientId: pid })} />
  if (active === 'Nuevo paciente') return <NewPatientPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Nueva receta') return <NewRecipePage key="new" setActive={setActive} />
  if (active === 'Editar receta') return <NewRecipePage key={selectedRecipeId || 'new'} setActive={setActive} recipeId={selectedRecipeId} />
  if (active === 'Configuración') return <SettingsPage setActive={setActive} />
  if (active === 'Importar alimentos') return <ImportFoodsPage setActive={setActive} />
  if (active === 'Expediente') return <ClinicalRecordPage setActive={setActive} patientId={selectedPatientId} consultationId={selectedConsultationId} onOpenSession={(cid) => go('Expediente', { patientId: selectedPatientId, consultationId: cid || null })} appointmentId={startAppointmentId} onConsumeAppointment={() => setStartAppointmentId(null)} onScheduleAppointment={() => goToNewAppointment(selectedPatientId)} />
  if (active === 'Constructor de plan') return <PlanStudioPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={setSelectedPatientId} pendingRecipeName={pendingRecipeName} onConsumeRecipeName={() => setPendingRecipeName(null)} />
  if (active === 'Documento') return <DocumentPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Documentos') return <DocumentsPage setActive={setActive} />
  if (active === 'Seguimientos') return <FollowupsPage setActive={setActive} />
  if (active === 'Finanzas') return <FinancePage setActive={setActive} />
  if (active === 'Consultas') return <ConsultationsPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={setSelectedPatientId} onOpenSession={openSession} onOpenPatient={(pid, module) => go(module, { patientId: pid })} />
  if (active === 'Plantillas') return <TemplatesPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Recetas') return <RecipesPage setActive={setActive} onSelectRecipe={setSelectedRecipeId} onAssignRecipe={assignRecipe} />
  if (active === 'Ingredientes') return <IngredientsPage setActive={setActive} />
  if (active === 'Educación') return <EducationPage setActive={setActive} onSelectMaterial={setSelectedMaterialId} />
  if (active === 'Nuevo material') return <NewMaterialPage setActive={setActive} />
  if (active === 'Editar material') return <NewMaterialPage setActive={setActive} materialId={selectedMaterialId} />

  return <DashboardPage setActive={setActive} />
}
