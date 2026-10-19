// Botón «Continuar con Google» (Google Identity Services). El script se carga una sola vez y sólo
// cuando el servidor tiene configurado un client id; Google devuelve un token firmado (credential)
// que el servidor verifica en POST /auth/google.
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let scriptPromise = null

export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google no respondió.')))
      script.onerror = () => { scriptPromise = null; reject(new Error('No se pudo cargar el acceso con Google.')) }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export async function renderGoogleButton(container, clientId, onCredential) {
  const identity = await loadGoogleIdentity()
  identity.initialize({ client_id: clientId, callback: (response) => onCredential(response.credential), ux_mode: 'popup', cancel_on_tap_outside: true })
  container.replaceChildren()
  identity.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', locale: 'es', logo_alignment: 'center', width: Math.min(400, Math.max(200, Math.round(container.offsetWidth || 320))) })
}
