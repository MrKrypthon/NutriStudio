import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './app/App.jsx'
import AdminApp from './modules/admin/AdminApp.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'

// Ruta alterna del panel de administración del SaaS (/admin), fuera del chrome de la app.
const isAdminRoute = window.location.pathname.startsWith('/admin')

createRoot(document.getElementById('root')).render(isAdminRoute ? <AdminApp /> : <AuthProvider><App /></AuthProvider>)
