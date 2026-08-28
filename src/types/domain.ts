export type UserRole = 'owner' | 'nutritionist' | 'assistant'

export type AppointmentStatus =
  | 'scheduled'
  | 'pending_confirmation'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type AppointmentType =
  | 'initial'
  | 'follow_up'
  | 'quick_control'
  | 'emergency'
  | 'block'

export interface Practice {
  id: string
  name: string
  timeZone: string
  locale: string
  defaultPalette: string
}

export interface Patient {
  id: string
  practiceId: string
  firstName: string
  lastName: string
  birthDate?: string
  sex?: string
  email?: string
  phone?: string
  status: 'active' | 'inactive'
}

export interface Appointment {
  id: string
  practiceId: string
  patientId?: string
  startAt: string
  endAt: string
  type: AppointmentType
  status: AppointmentStatus
  notifyVia: Array<'email' | 'whatsapp'>
  internalNote?: string
  patientNote?: string
  timeZone: string
}

export interface DashboardToday {
  date: string
  stats: {
    appointments: number
    pendingConfirmations: number
    followUps: number
    activePatients: number
  }
  appointments: Appointment[]
  tasks: Array<{ id: string; type: string; patientId: string; dueAt: string; status: string }>
}

export type ClinicalSectionKey =
  | 'summary'
  | 'general'
  | 'anthropometric'
  | 'biochemical'
  | 'clinical'
  | 'dietary'
  | 'lifestyle'
  | 'sociocultural'
  | 'diagnosis'
  | 'treatment'
  | 'monitoring'
  | 'notes'
