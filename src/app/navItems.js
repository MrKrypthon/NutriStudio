// Sidebar structure. The first element of each item is an icon name resolved by components/Icon.jsx
// (inline SVG). Items that are really a sub-action of another screen (crear paciente, nueva receta,
// importar alimento...) live as buttons on that screen instead of as their own top-level entry.
export const navGroups = [
  {
    label: 'Tu espacio',
    items: [
      ['home', 'Hoy'],
      ['calendar', 'Agenda'],
      ['users', 'Pacientes'],
      ['clipboard', 'Consultas'],
      ['bell', 'Seguimientos'],
      ['wallet', 'Finanzas'],
    ],
  },
  {
    label: 'Planificación',
    items: [
      ['layout', 'Constructor de plan'],
      ['recipes', 'Recetas'],
      ['leaf', 'Ingredientes'],
      ['grid', 'Plantillas'],
      ['file', 'Documentos'],
    ],
  },
  {
    label: 'Biblioteca',
    items: [
      ['cap', 'Educación'],
    ],
  },
]
