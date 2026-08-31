import { useEffect, useState } from 'react'
import { appointmentsApi } from '../lib/api.js'
import { DEMO_PATIENT_ID } from '../lib/demoContext.js'

import DashboardPage from '../modules/dashboard/DashboardPage.jsx'
import AgendaPage from '../modules/calendar/AgendaPage.jsx'
import PatientsPage from '../modules/patients/PatientsPage.jsx'
import NewPatientPage from '../modules/patients/NewPatientPage.jsx'
import PatientWorkspacePage from '../modules/patients/PatientWorkspacePage.jsx'
import ClinicalRecordPage from '../modules/clinical-record/ClinicalRecordPage.jsx'
import ConsultationsPage from '../modules/clinical-record/ConsultationsPage.jsx'
import NutritionCalculatorPage from '../modules/nutrition-plan/NutritionCalculatorPage.jsx'
import PlanStudioPage from '../modules/nutrition-plan/PlanStudioPage.jsx'
import MacroDistributionPage from '../modules/nutrition-plan/MacroDistributionPage.jsx'
import RecipesPage from '../modules/recipes/RecipesPage.jsx'
import NewRecipePage from '../modules/recipes/NewRecipePage.jsx'
import IngredientsPage from '../modules/ingredients/IngredientsPage.jsx'
import ImportFoodsPage from '../modules/ingredients/ImportFoodsPage.jsx'
import TemplatesPage from '../modules/templates/TemplatesPage.jsx'
import DocumentsPage from '../modules/documents/DocumentsPage.jsx'
import DocumentPage from '../modules/documents/DocumentPage.jsx'
import FollowupsPage from '../modules/tasks/FollowupsPage.jsx'
import EducationPage from '../modules/education/EducationPage.jsx'
import SettingsPage from '../modules/settings/SettingsPage.jsx'

const pathToModule = { '/': 'Hoy', '/hoy': 'Hoy', '/agenda': 'Agenda', '/pacientes': 'Pacientes', '/recetas': 'Recetas', '/ingredientes': 'Ingredientes', '/plantillas': 'Plantillas', '/plan': 'Plan nutricional', '/constructor-plan': 'Constructor de plan', '/distribucion': 'Distribución de macros', '/documentos': 'Documentos', '/nuevo-paciente': 'Nuevo paciente', '/configuracion': 'Configuración', '/importar-alimentos': 'Importar alimentos' }
const moduleToSlug = { 'Hoy': 'hoy', 'Agenda': 'agenda', 'Pacientes': 'pacientes', 'Recetas': 'recetas', 'Ingredientes': 'ingredientes', 'Plantillas': 'plantillas', 'Plan nutricional': 'plan', 'Constructor de plan': 'constructor-plan', 'Distribución de macros': 'distribucion', 'Documentos': 'documentos', 'Nuevo paciente': 'nuevo-paciente', 'Configuración': 'configuracion', 'Importar alimentos': 'importar-alimentos', 'Documento': 'documentos', 'Expediente': 'pacientes' }

export default function App() {
  const [active, setActiveState] = useState(() => pathToModule[window.location.pathname] || 'Hoy')
  const [selectedPatientId, setSelectedPatientId] = useState(DEMO_PATIENT_ID)
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

  useEffect(() => {
    const onSidebarConfig = (event) => {
      const button = event.target.closest('.sidebar > button.nav-item')
      if (button?.textContent.includes('Configuración')) setActive('Configuración')
    }
    document.addEventListener('click', onSidebarConfig)
    return () => document.removeEventListener('click', onSidebarConfig)
  }, [])

  useEffect(() => {
    const onAppointmentSubmit = async (event) => {
      const button = event.target.closest('.appointment-modal .modal-actions .primary')
      if (!button) return
      const modal = button.closest('.appointment-modal')
      const fields = modal?.querySelectorAll('select')
      const date = modal?.querySelector('input[type="date"]')?.value
      const time = fields?.[1]?.value || '14:00'
      const duration = Number((fields?.[2]?.value || '60').match(/\d+/)?.[0] || 60)
      const notes = modal?.querySelectorAll('textarea')
      try {
        await appointmentsApi.create({ patientId: DEMO_PATIENT_ID, startAt: `${date}T${time}:00`, durationMinutes: duration, type: 'FOLLOW_UP', notifyVia: ['whatsapp'], internalNote: notes?.[0]?.value, patientNote: notes?.[1]?.value })
      } catch { /* The modal remains usable in demo mode. */ }
    }
    document.addEventListener('click', onAppointmentSubmit)
    return () => document.removeEventListener('click', onAppointmentSubmit)
  }, [])

  if (active === 'Hoy') return <DashboardPage setActive={setActive} />
  if (active === 'Agenda') return <AgendaPage setActive={setActive} />
  if (active === 'Pacientes') return <PatientsPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Nuevo paciente') return <NewPatientPage setActive={setActive} onSelectPatient={setSelectedPatientId} />
  if (active === 'Nueva receta') return <NewRecipePage setActive={setActive} />
  if (active === 'Configuración') return <SettingsPage setActive={setActive} />
  if (active === 'Importar alimentos') return <ImportFoodsPage setActive={setActive} />
  if (active === 'Expediente') return <ClinicalRecordPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Plan nutricional') return <NutritionCalculatorPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Constructor de plan') return <PlanStudioPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Distribución de macros') return <MacroDistributionPage setActive={setActive} />
  if (active === 'Documento') return <DocumentPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Documentos') return <DocumentsPage setActive={setActive} />
  if (active === 'Seguimientos') return <FollowupsPage setActive={setActive} />
  if (active === 'Consultas') return <ConsultationsPage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Consulta + plan') return <PatientWorkspacePage setActive={setActive} patientId={selectedPatientId} />
  if (active === 'Plantillas') return <TemplatesPage setActive={setActive} />
  if (active === 'Recetas') return <RecipesPage setActive={setActive} />
  if (active === 'Ingredientes') return <IngredientsPage setActive={setActive} />
  if (active === 'Educación') return <EducationPage setActive={setActive} />

  return <DashboardPage setActive={setActive} />
}
