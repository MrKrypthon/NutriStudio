import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './app/App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'

createRoot(document.getElementById('root')).render(<AuthProvider><App /></AuthProvider>)
