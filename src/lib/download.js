/**
 * Descarga un blob como archivo.
 *
 * El <a> se agrega al DOM antes del click y el object URL se revoca en un `setTimeout`: revocarlo
 * justo después del click puede cancelar la descarga (Firefox) y un enlace desprendido del DOM no
 * siempre la dispara.
 */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
