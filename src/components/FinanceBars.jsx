import { formatMoney, formatShortDay } from '../lib/finance.js'

// Barras pareadas por día: ingreso (verde) y egreso (rojo). Se reutiliza en Finanzas y en "Hoy".
// La altura es proporcional al mayor valor del periodo; un monto pequeño conserva un mínimo visible.
export default function FinanceBars({ series = [], compact = false }) {
  if (!series.length) return <p className="finance-bars-empty muted">Sin movimientos en el periodo.</p>
  const max = Math.max(1, ...series.flatMap((day) => [day.incomeCents || 0, day.expenseCents || 0]))
  const height = (value) => `${Math.max(value ? 6 : 0, (value / max) * 100)}%`
  return <div className={'finance-bars' + (compact ? ' compact' : '')}>
    {series.map((day) => <div className="finance-bar-col" key={day.date} title={`${formatShortDay(day.date)} · Ingresos ${formatMoney(day.incomeCents)} · Egresos ${formatMoney(day.expenseCents)}`}>
      <div className="finance-bar-pair">
        <span className="finance-bar income" style={{ height: height(day.incomeCents || 0) }} />
        <span className="finance-bar expense" style={{ height: height(day.expenseCents || 0) }} />
      </div>
      {!compact && <small>{new Date(day.date).getUTCDate()}</small>}
    </div>)}
  </div>
}
