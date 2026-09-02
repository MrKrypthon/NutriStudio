// Sidebar structure. Each group renders under its own label; items that are really a sub-action
// of another screen (crear paciente, nueva receta, importar alimento...) live as buttons on that
// screen instead of as their own top-level entry — see the module they belong to.
export const navGroups = [
  {
    label: 'Tu espacio',
    items: [
      ['⌂', 'Hoy'],
      ['▣', 'Agenda'],
      ['♧', 'Pacientes'],
      ['◫', 'Consultas'],
      ['◌', 'Seguimientos'],
    ],
  },
  {
    label: 'Planificación',
    items: [
      ['▥', 'Constructor de plan'],
      ['◉', 'Recetas'],
      ['◈', 'Ingredientes'],
      ['▤', 'Plantillas'],
      ['▦', 'Documentos'],
    ],
  },
  {
    label: 'Biblioteca',
    items: [
      ['♡', 'Educación'],
    ],
  },
]
