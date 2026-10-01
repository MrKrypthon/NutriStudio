// Ajusta el alto de los textarea al contenido: se usa como respaldo para navegadores que no
// soportan `field-sizing: content` (Chrome/Edge ya lo hacen solos por CSS) y para los cambios de
// valor que no disparan un `input` (p. ej. al elegir un chip de sugerencia).
export function growTextareas(root = document) {
  for (const el of root.querySelectorAll('textarea')) {
    if (el.dataset.autogrow === 'off') continue
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
}

export function scheduleGrowTextareas(root = document) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => growTextareas(root))
  else growTextareas(root)
}
