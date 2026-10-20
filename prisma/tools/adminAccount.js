// Validación del primer administrador del SaaS (prisma/create-admin.js). Todo sale de variables de
// entorno para que la contraseña no quede en el repositorio ni en el historial de la consola. Los
// mensajes de error nunca incluyen la contraseña.

export const ADMIN_PASSWORD_MIN_LENGTH = 12
// bcrypt sólo usa los primeros 72 bytes: lo que pase de ahí no protege nada.
export const ADMIN_PASSWORD_MAX_BYTES = 72
export const ADMIN_BCRYPT_ROUNDS = 12

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// El login del panel compara el correo tal cual, así que se guarda ya normalizado.
export const normalizeAdminEmail = (value) => String(value || '').trim().toLowerCase()

export function readAdminInput(env = process.env) {
  const email = normalizeAdminEmail(env.ADMIN_EMAIL)
  const name = String(env.ADMIN_NAME || '').trim() || 'Administrador'
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : ''
  const errors = []
  if (!email) errors.push('Falta ADMIN_EMAIL.')
  else if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.push('ADMIN_EMAIL no es un correo válido.')
  if (name.length > 120) errors.push('ADMIN_NAME no puede pasar de 120 caracteres.')
  if (!password) errors.push('Falta ADMIN_PASSWORD.')
  else {
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) errors.push(`ADMIN_PASSWORD debe tener al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres.`)
    if (Buffer.byteLength(password, 'utf8') > ADMIN_PASSWORD_MAX_BYTES) errors.push(`ADMIN_PASSWORD no puede pasar de ${ADMIN_PASSWORD_MAX_BYTES} bytes.`)
    if (password.trim() !== password) errors.push('ADMIN_PASSWORD no debe empezar ni terminar con espacios.')
    if (email && password.toLowerCase().includes(email.split('@')[0])) errors.push('ADMIN_PASSWORD no debe contener el correo.')
  }
  return { email, name, password, errors }
}
