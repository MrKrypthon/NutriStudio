// Plegado de texto para comparar sin distinguir mayúsculas ni acentos ("Pérdida" ≈ "perdida").
// Único punto de verdad: lo comparten la búsqueda de recetas, el emparejado de ingredientes y el
// agrupado de equivalentes (antes había una copia en cada módulo).
export const foldText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
