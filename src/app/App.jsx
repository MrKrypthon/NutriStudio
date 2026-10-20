import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { isNestedModule, parseLocation, pathFor } from './routes.js'
import { growTextareas } from '../lib/autoGrow.js'

import LoginPage from '../modules/auth/LoginPage.jsx'
import PaywallPage from '../modules/settings/PaywallPage.jsx'
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
import EquivalencesPage from '../modules/equivalences/EquivalencesPage.jsx'
import NewMaterialPage from '../modules/education/NewMaterialPage.jsx'
import SettingsPage from '../modules/settings/SettingsPage.jsx'
import FinancePage from '../modules/finance/FinancePage.jsx'

export default function App() {
  const { status, access } = useAuth()
  const initial = parseLocation(window.location.pathname)
  const [active, setActiveState] = useState(() => initial.module)
  // Sin paciente por defecto: antes arrancaba con el paciente de demostración, así que Consultas y
  // el Constructor abrían con Mariana Torres sin haber elegido a nadie. Cada pantalla que necesita
  // un paciente ahora pide elegirlo — o lo toma de la dirección, al recargar.
  // Las pantallas cuya dirección no lleva paciente (Consultas, Documentos…) lo recuperan del estado
  // de la entrada del historial, que el navegador conserva al recargar y con atrás/adelante.
  const [selectedPatientId, setSelectedPatientId] = useState(() => initial.patientId || window.history.state?.patientId || '')
  const [selectedMaterialId, setSelectedMaterialId] = useState(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState(null)
  const [startAppointmentId, setStartAppointmentId] = useState(null)
  const [selectedConsultationId, setSelectedConsultationId] = useState(initial.consultationId)
  const [pendingRecipeName, setPendingRecipeName] = useState(null)
  const [autoOpenNewAppointment, setAutoOpenNewAppointment] = useState(false)
  const [newAppointmentPatientId, setNewAppointmentPatientId] = useState('')

  // Autoajuste del alto de los textarea al contenido (respaldo de `field-sizing: content`): al
  // escribir, al montarse campos nuevos y cuando cambian por código (p. ej. chips de sugerencia).
  useEffect(() => {
    const onInput = (event) => {
      const el = event.target
      if (el?.tagName === 'TEXTAREA') { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
    }
    document.addEventListener('input', onInput, true)
    growTextareas()
    let raf = 0
    const observer = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => growTextareas()) })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { document.removeEventListener('input', onInput, true); observer.disconnect(); cancelAnimationFrame(raf) }
  }, [])
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
    // La cita que inicia la consulta sólo vale para el salto que la trae (startConsultation): si se
    // quedaba guardada —p. ej. porque la carga del expediente falló— el siguiente expediente que se
    // abriera, aunque fuera de otro paciente, creaba su consulta ligada a esa cita y la completaba.
    setStartAppointmentId(options.appointmentId || null)
    setActiveState(module)
    const next = pathFor(module, patientId, consultationId)
    if (next && window.location.pathname !== next) window.history[options.replace ? 'replaceState' : 'pushState']({ patientId }, '', next)
    else if (next && module !== active) {
      // Las sub-pantallas (formulario de receta, de material, documento) comparten la dirección de
      // su lista. Sin una entrada propia, atrás desde el formulario salía del módulo entero (de la
      // receta a medio capturar a Hoy). Se apila una entrada marcada, y al volver a la lista con un
      // botón de la app se retira esa entrada para que atrás no tenga que pulsarse dos veces.
      if (isNestedModule(module)) window.history[window.history.state?.nested ? 'replaceState' : 'pushState']({ patientId, nested: true }, '', next)
      else if (window.history.state?.nested) window.history.back()
    }
  }
  const setActive = (next) => go(next)

  // Guarda el paciente elegido en la entrada actual del historial. Antes, al volver atrás desde el
  // expediente a Consultas (cuya dirección no lleva paciente) se perdía el paciente que se estaba
  // revisando y había que elegirlo de nuevo; lo mismo al recargar esas pantallas.
  useEffect(() => {
    try { window.history.replaceState({ ...(window.history.state || {}), patientId: selectedPatientId }, '') } catch { /* historial no disponible */ }
  }, [selectedPatientId])

  useEffect(() => {
    // Atrás y adelante del navegador reconstruyen el estado desde la dirección, paciente incluido.
    const onPopState = () => {
      const route = parseLocation(window.location.pathname)
      setActiveState(route.module)
      setSelectedPatientId(route.patientId || window.history.state?.patientId || '')
      setSelectedConsultationId(route.consultationId)
      setStartAppointmentId(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // From an Agenda/Hoy appointment straight into its consultation: selects the patient, remembers
  // which appointment triggered it (so ClinicalRecordPage can mark it COMPLETED when it creates
  // the consultation), and jumps to the expediente.
  const startConsultation = (patientId, appointmentId) => {
    go('Expediente', { patientId, consultationId: null, appointmentId: appointmentId || null })
  }

  // "Historial de sesiones" in Consultas opens THAT specific session in the expediente (a
  // completed one included), instead of always jumping to the current in-progress consultation.
  const openSession = (patientId, consultationId) => {
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
  // Cuenta sin suscripción pagada: sólo la pantalla de pago (fase 109).
  if (access && !access.allowed) return <PaywallPage />

  if (active === 'Hoy') return <DashboardPage setActive={setActive} onStartConsultation={startConsultation} onNewAppointment={goToNewAppointment} onOpenAgendaFiltered={goToAgendaFiltered} onOpenPlan={(pid) => go('Constructor de plan', { patientId: pid })} />
  if (active === 'Agenda') return <AgendaPage setActive={setActive} onStartConsultation={startConsultation} autoOpenNew={autoOpenNewAppointment} autoOpenPatientId={newAppointmentPatientId} onConsumeAutoOpen={() => { setAutoOpenNewAppointment(false); setNewAppointmentPatientId('') }} autoFilter={autoAgendaFilter} onConsumeAutoFilter={() => setAutoAgendaFilter(null)} />
  if (active === 'Pacientes') return <PatientsPage setActive={setActive} onSelectPatient={setSelectedPatientId} onOpenPatient={(pid, module) => go(module, { patientId: pid })} onOpenSession={openSession} onNewAppointment={goToNewAppointment} />
  if (active === 'Nuevo paciente') return <NewPatientPage setActive={setActive} onOpenPatient={(pid, module) => go(module, { patientId: pid })} onNewAppointment={goToNewAppointment} />
  if (active === 'Nueva receta') return <NewRecipePage key="new" setActive={setActive} />
  if (active === 'Editar receta') return <NewRecipePage key={selectedRecipeId || 'new'} setActive={setActive} recipeId={selectedRecipeId} />
  if (active === 'Configuración') return <SettingsPage setActive={setActive} />
  if (active === 'Importar alimentos') return <ImportFoodsPage setActive={setActive} />
  if (active === 'Expediente') return <ClinicalRecordPage setActive={setActive} patientId={selectedPatientId} consultationId={selectedConsultationId} onOpenSession={(cid) => go('Expediente', { patientId: selectedPatientId, consultationId: cid || null })} appointmentId={startAppointmentId} onConsumeAppointment={() => setStartAppointmentId(null)} onScheduleAppointment={() => goToNewAppointment(selectedPatientId)} />
  if (active === 'Constructor de plan') return <PlanStudioPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={(pid) => go('Constructor de plan', { patientId: pid, replace: true })} pendingRecipeName={pendingRecipeName} onConsumeRecipeName={() => setPendingRecipeName(null)} />
  if (active === 'Documento') return <DocumentPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Documentos') return <DocumentsPage setActive={setActive} patientId={selectedPatientId} onOpenPatient={(pid, module) => go(module, { patientId: pid })} onOpenSession={openSession} />
  if (active === 'Seguimientos') return <FollowupsPage setActive={setActive} />
  if (active === 'Finanzas') return <FinancePage setActive={setActive} />
  if (active === 'Consultas') return <ConsultationsPage setActive={setActive} patientId={selectedPatientId} onSelectPatient={setSelectedPatientId} onOpenSession={openSession} onOpenPatient={(pid, module) => go(module, { patientId: pid })} />
  if (active === 'Plantillas') return <TemplatesPage setActive={setActive} onOpenPatient={(pid, module) => go(module, { patientId: pid })} />
  if (active === 'Recetas') return <RecipesPage setActive={setActive} onSelectRecipe={setSelectedRecipeId} onAssignRecipe={assignRecipe} />
  if (active === 'Ingredientes') return <IngredientsPage setActive={setActive} />
  if (active === 'Equivalencias') return <EquivalencesPage setActive={setActive} />
  if (active === 'Educación') return <EducationPage setActive={setActive} onSelectMaterial={setSelectedMaterialId} />
  if (active === 'Nuevo material') return <NewMaterialPage setActive={setActive} />
  if (active === 'Editar material') return <NewMaterialPage setActive={setActive} materialId={selectedMaterialId} />

  return <DashboardPage setActive={setActive} />
}
