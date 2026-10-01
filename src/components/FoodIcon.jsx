// Iconos de "Frecuencia de consumo de alimentos": mismo patrón que Icon.jsx (SVG en línea, 24×24,
// stroke = currentColor) para que el color lo decida el badge que los envuelve y no el propio
// icono. Uno por cada clave de src/lib/foodFrequencyItems.js.
const FOOD_ICONS = {
  // — Grupos —
  fruta: <><path d="M12 9.5c-3-2.3-7 .3-7 5 0 3.6 3 6.5 6 6.5.4 0 .8-.1 1-.3.2.2.6.3 1 .3 3 0 6-2.9 6-6.5 0-4.7-4-7.3-7-5Z" /><path d="M12 9.5V7c0-1 .7-2 2-2.3" /></>,
  verdura: <><path d="M12 5c1.2 1.3 1.6 2.6 1.3 4M9.2 6.3c.7 1 1 2 .9 3" /><path d="M10 9c4 0 5.3 3 4.2 7.5-.7 2.8-2.3 4-4.2 4s-3.5-1.2-4.2-4C4.7 12 6 9 10 9Z" /></>,
  'cereales-grasa': <><path d="M8 11.5 9 20h6l1-8.5" /><path d="M7.5 11.5c0-2 2-3.3 4.5-3.3s4.5 1.3 4.5 3.3c0 .9-2 1.3-4.5 1.3s-4.5-.4-4.5-1.3Z" /><path d="M12 8.2V5c1 0 1.6-.6 1.6-1.3" /></>,
  leguminosas: <><path d="M5 15c0-5.5 4-9 8-9s6 2 6 5-2.5 4.5-6 4.5-6.5 1-6.5 4.5c0 2 1.8 3.5 4 3.5" /><circle cx="9.3" cy="11.5" r=".9" fill="currentColor" stroke="none" /><circle cx="13" cy="9" r=".9" fill="currentColor" stroke="none" /><circle cx="16" cy="12.3" r=".9" fill="currentColor" stroke="none" /></>,
  'oa-muy-bajo-grasa': <><path d="M3.5 13c2.5-3 6-4.5 10-4.5 3.8 0 6.5 2 7 4.5-.5 2.5-3.2 4.5-7 4.5-4 0-7.5-1.5-10-4.5Z" /><path d="M14 9.5 20.5 7v12L14 16.5" /><circle cx="8" cy="12.2" r=".8" fill="currentColor" stroke="none" /></>,
  'oa-moderado-grasa': <><path d="M5 7.5c3-1.5 6.5-1.8 9.5-.5 3.3 1.4 5 4 4.3 6.8-.6 2.6-3.3 4.4-6.5 4.7C8.6 19 5.3 16.8 4.3 13 4 11.6 4.2 9.3 5 7.5Z" /><path d="M8 11c2.5-.3 5 .3 7.5 2" /></>,
  'oa-alto-grasa': <><path d="M3.5 13.5c0-2.3 2-4 4.5-4h8c2 0 3.5 1.5 3.5 3.3s-1.5 3.3-3.5 3.3H8c-2.5 0-4.5-1.3-4.5-2.6Z" /><path d="M7.5 11.2 6 15.3M13 10.8l-1.6 4.9" /></>,
  'lacteos-descremados': <><path d="M10 4h4v3.2l1.8 2.6c.3.4.5 1 .5 1.5V19a1 1 0 0 1-1 1H8.7a1 1 0 0 1-1-1v-7.7c0-.5.2-1.1.5-1.5L10 7.2V4Z" /><path d="M9 13h6" /></>,
  'lacteos-semidescremados': <><path d="M10 4h4v3.2l1.8 2.6c.3.4.5 1 .5 1.5V19a1 1 0 0 1-1 1H8.7a1 1 0 0 1-1-1v-7.7c0-.5.2-1.1.5-1.5L10 7.2V4Z" /><path d="M8.7 14h6.6" /></>,
  'azucar-grasa': <><path d="M4.5 18 12 6l7.5 12Z" /><path d="M8.3 15.5h7.4" /><circle cx="12" cy="9.2" r=".9" fill="currentColor" stroke="none" /></>,
  'cereales-tuberculos': <><path d="M12 20V7" /><path d="M12 7c-1.5 0-2.6-1.1-2.6-3 1.9 0 3 1 3 2.6M12 7c1.5 0 2.6-1.1 2.6-3-1.9 0-3 1-3 2.6" /><path d="M12 11c-1.3 0-2.3-1-2.3-2.6 1.7 0 2.6.9 2.6 2.3M12 11c1.3 0 2.3-1 2.3-2.6-1.7 0-2.6.9-2.6 2.3" /><path d="M12 15c-1.3 0-2.3-1-2.3-2.6 1.7 0 2.6.9 2.6 2.3M12 15c1.3 0 2.3-1 2.3-2.6-1.7 0-2.6.9-2.6 2.3" /></>,
  grasa: <><path d="M12 4c2.8 3.6 5 6.8 5 9.5a5 5 0 0 1-10 0C7 10.8 9.2 7.6 12 4Z" /></>,
  azucar: <><circle cx="12" cy="8" r="4" /><path d="M12 12v8" /></>,
  'lacteos-enteros': <><path d="M10 4h4v3.2l1.8 2.6c.3.4.5 1 .5 1.5V19a1 1 0 0 1-1 1H8.7a1 1 0 0 1-1-1v-7.7c0-.5.2-1.1.5-1.5L10 7.2V4Z" /></>,
  'oa-bajo-grasa': <><path d="M13.5 4.5c2 0 3.5 1.6 3.5 3.5 0 2.5-2.3 4.3-4.3 6.3-1.5 1.5-2.7 3-2.7 4.7a2 2 0 1 0 4 0" /><circle cx="6.5" cy="17.5" r="2.5" /></>,

  // — Alimentos —
  cafe: <><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z" /><path d="M16 10.5h1.5a2 2 0 0 1 0 4H16" /><path d="M8.5 5.5c0 1-1 1-1 2M12 5.5c0 1-1 1-1 2" /></>,
  refresco: <><path d="M7 8h10l-1.2 11a1 1 0 0 1-1 .9H9.2a1 1 0 0 1-1-.9L7 8Z" /><path d="M6 8h12M14.5 5 17 3" /></>,
  taco: <><path d="M3.5 13.5a8.5 5 0 0 1 17 0c-5.5 2-11.5 2-17 0Z" /><circle cx="9" cy="12.3" r=".8" fill="currentColor" stroke="none" /><circle cx="12.5" cy="11.6" r=".8" fill="currentColor" stroke="none" /><circle cx="15.5" cy="12.6" r=".8" fill="currentColor" stroke="none" /></>,
  'pan-dulce': <><path d="M4.5 14.5c0-4.5 3.4-8 7.5-8s7.5 3.5 7.5 8c-2.5 1-5 1.5-7.5 1.5s-5-.5-7.5-1.5Z" /><path d="M8 9.5c.8-1.6 1.5-3 1.2-4.5M14 7.5c.8-1.2 1-2 .7-3" /><path d="M8.3 12.2c3.6-1.3 6-1.3 7.6 0M7.6 14.6c4.8-1.6 8-1.6 9 0" /></>,
  cerveza: <><path d="M6 6h8v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6Z" /><path d="M14 8.5h1.5a2 2 0 0 1 0 4H14" /><path d="M6 6c0-1.1 1.8-2 4-2s4 .9 4 2" /></>,
  nieve: <><path d="M7 11a5 5 0 0 1 10 0c0 1.6-1 2.8-2.3 3.3a5 5 0 0 1-5.4 0C8 13.8 7 12.6 7 11Z" /><path d="M9.3 14.5 12 21l2.7-6.5" /></>,
  galletas: <><circle cx="12" cy="12" r="7" /><circle cx="10" cy="10" r=".9" fill="currentColor" stroke="none" /><circle cx="14.5" cy="9.5" r=".9" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r=".9" fill="currentColor" stroke="none" /><circle cx="9.5" cy="14.5" r=".9" fill="currentColor" stroke="none" /></>,
  chocolate: <><rect x="4.5" y="7" width="15" height="10" rx="1.2" /><path d="M9.5 7v10M14.5 7v10M4.5 12h15" /></>,
  'pan-de-caja': <><path d="M5 10.5c0-3 3-5.5 7-5.5s7 2.5 7 5.5V19H5v-8.5Z" /><path d="M8.5 11.5V19M12 11.5V19M15.5 11.5V19" /></>,
  restaurante: <><path d="M4.5 13.5c0-3.3 3.4-6 7.5-6s7.5 2.7 7.5 6H4.5Z" /><path d="M3.5 13.5h17M12 7.5V5" /><circle cx="12" cy="4.2" r=".9" fill="currentColor" stroke="none" /></>,
  pizza: <><path d="M12 4 20.5 19H3.5Z" /><path d="M6.5 15.5h11" /><circle cx="12" cy="9.5" r="1" fill="currentColor" stroke="none" /><circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" /></>,
  'comida-rapida': <><path d="M4 10.5c0-3 3.6-5.5 8-5.5s8 2.5 8 5.5H4Z" /><path d="M3.5 13h17M4.5 15.5h15a1.5 1.5 0 0 1 0 3h-15a1.5 1.5 0 0 1 0-3Z" /></>,
  huevo: <><path d="M12 4C8.5 8 6.5 12 6.5 15.5a5.5 5.5 0 0 0 11 0C17.5 12 15.5 8 12 4Z" /></>,
  yogur: <><path d="M8.5 5h7l-.8 4.5H9.3L8.5 5Z" /><path d="M9.3 9.5h5.4l.8 8a1.5 1.5 0 0 1-1.5 1.7H10a1.5 1.5 0 0 1-1.5-1.7l.8-8Z" /><path d="M16 11.5c1.2.3 2 1 2 1.8s-1 1.6-2.3 1.8" /></>,
  jugo: <><path d="M8 5h8l-1 15H9L8 5Z" /><path d="M8.3 9.5h7.4" /><path d="M14.5 5c1.5-.5 2-1.5 1.5-3" /></>,
  'agua-de-sabor': <><path d="M9 4.5h6l.8 13.5a2.7 2.7 0 0 1-2.7 2.8h-2.2a2.7 2.7 0 0 1-2.7-2.8L9 4.5Z" /><path d="M8.6 12c1 .8 1.8.8 2.8 0s1.8-.8 2.8 0 1.8.8 2.8 0" /></>,
  frituras: <><path d="M7 7.5h10l-1.3 11.5a1.5 1.5 0 0 1-1.5 1.3h-4.4a1.5 1.5 0 0 1-1.5-1.3L7 7.5Z" /><path d="M8 7.5 9 4l2 1.5 1-2 1 2 2-1.5 1 3.5" /></>,
  dulces: <><path d="M9 9.5h6l1.5 2.5L15 14.5H9l-1.5-2.5Z" /><path d="M9 9.5 5.5 7v2l2 2.5-2 2.5v2L9 14.5M15 9.5l3.5-2.5v2l-2 2.5 2 2.5v2L15 14.5" /></>,
  embutidos: <><circle cx="9.5" cy="10" r="5" /><circle cx="14.5" cy="14" r="5" /><circle cx="9.5" cy="10" r="1.6" fill="currentColor" stroke="none" /><circle cx="14.5" cy="14" r="1.6" fill="currentColor" stroke="none" /></>,
}

export default function FoodIcon({ name }) {
  const paths = FOOD_ICONS[name]
  if (!paths) return null
  return <svg className="food-icon-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
}
