// Ícono de marca de milpa CLINICAL: cuadrícula 3×3 (esquinas + cruz central). `surface` controla
// el color de las esquinas para mantener contraste según dónde se coloque: "light" (esquinas Milpa
// oscuro) para fondos claros/blancos, "dark" (esquinas Hoja, más claras) para el sidebar oscuro —
// la cruz central siempre es Maíz, como en el logo original.
const CORNER_COLOR = { light: '#1F5A3A', dark: '#5FA052' }
const CROSS_COLOR = '#F2B705'
const CORNERS = new Set(['0-0', '0-2', '2-0', '2-2'])

export default function BrandMark({ size = 28, surface = 'light', className }) {
  const cell = 14
  const gap = 3
  const corner = CORNER_COLOR[surface] || CORNER_COLOR.light
  const cells = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      cells.push({ row, col, fill: CORNERS.has(`${row}-${col}`) ? corner : CROSS_COLOR })
    }
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {cells.map(({ row, col, fill }) => (
        <rect key={`${row}-${col}`} x={col * (cell + gap)} y={row * (cell + gap)} width={cell} height={cell} rx={4} fill={fill} />
      ))}
    </svg>
  )
}
