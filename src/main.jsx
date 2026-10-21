import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './app/App.jsx'
import AdminApp from './modules/admin/AdminApp.jsx'
import LegalPage from './modules/legal/LegalPage.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'

// Ruta alterna del panel de administración del SaaS (/admin), fuera del chrome de la app.
const isAdminRoute = window.location.pathname.startsWith('/admin')
// Términos, aviso de privacidad y la plantilla para pacientes (fase 117): públicos, sin sesión.
const isLegalRoute = window.location.pathname.startsWith('/legal/')

createRoot(document.getElementById('root')).render(isLegalRoute ? <LegalPage /> : isAdminRoute ? <AdminApp /> : <AuthProvider><App /></AuthProvider>)
