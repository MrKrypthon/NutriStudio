/**
 * Correo en la app: se normaliza al capturarlo y se valida el formato antes de guardar.
 *
 * `normalizeEmail` **delimita** el texto mientras se escribe: quita cualquier espacio (un correo no
 * puede tenerlos, así que un espacio pegado "a.b@ x.com" se corrige solo) y recorta a 254
 * caracteres, que es el máximo de una dirección de correo (RFC 5321). `isValidEmail` es el chequeo
 * pragmático de formato: usuario@dominio.tld, sin espacios.
 *
 * La validación es a propósito permisiva (no intenta cubrir cada rareza del RFC 5322): el objetivo
 * es atajar los errores de dedo típicos —sin arroba, sin dominio, sin punto—, no rechazar correos
 * válidos poco comunes.
 */
export const EMAIL_MAX_LENGTH = 254

export function normalizeEmail(value) {
  return String(value ?? '').replace(/\s+/g, '').slice(0, EMAIL_MAX_LENGTH)
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export function isValidEmail(value) {
  const email = normalizeEmail(value)
  if (!email || email.length > EMAIL_MAX_LENGTH) return false
  return EMAIL_RE.test(email)
}
