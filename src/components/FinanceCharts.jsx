import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Gráficas de Finanzas con Recharts (animadas y responsivas). Los montos llegan en centavos; aquí
// se convierten a pesos para los ejes y tooltips.
export const CHART_COLORS = ['#2b9674', '#7267ef', '#d7ad56', '#c0564f', '#5b8fd6', '#9d8abb', '#3fa46a', '#d98b3f']

const toPesos = (cents) => Math.round((Number(cents) || 0) / 100)
const compact = (value) => new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const fullMoney = (value) => `$${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(value || 0)}`

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip">
    {label != null && <b>{label}</b>}
    {payload.map((item) => <span key={item.dataKey || item.name}><i style={{ background: item.color }} />{item.name}: <strong>{fullMoney(item.value)}</strong></span>)}
  </div>
}

const axis = { tick: { fontSize: 10, fill: '#8b8d9c' }, axisLine: false, tickLine: false }

export function IncomeExpenseChart({ daily = [] }) {
  const data = daily.map((day) => ({ label: `${new Date(day.date).getUTCDate()}`, Ingresos: toPesos(day.incomeCents), Egresos: toPesos(day.expenseCents) }))
  if (!data.length) return <p className="muted chart-empty">Sin movimientos en el periodo.</p>
  return <div className="chart-frame">
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" vertical={false} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} width={44} tickFormatter={compact} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f4f5f8' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Ingresos" fill="#2b9674" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
        <Bar dataKey="Egresos" fill="#c0564f" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
}

export function BalanceTrend({ daily = [] }) {
  let acc = 0
  const data = daily.map((day) => ({ label: `${new Date(day.date).getUTCDate()}`, Saldo: (acc += toPesos(day.incomeCents) - toPesos(day.expenseCents)) }))
  if (!data.length) return <p className="muted chart-empty">Sin movimientos en el periodo.</p>
  return <div className="chart-frame">
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7267ef" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#7267ef" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" vertical={false} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} width={44} tickFormatter={compact} />
        <Tooltip content={<MoneyTooltip />} />
        <Area type="monotone" dataKey="Saldo" stroke="#7267ef" strokeWidth={2} fill="url(#balanceFill)" animationDuration={800} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
}

function Donut({ data, colors = CHART_COLORS, unit = 'ingresos' }) {
  const total = data.reduce((acc, item) => acc + item.value, 0)
  if (!total) return <p className="muted chart-empty">Sin {unit} en el periodo.</p>
  return <div className="chart-donut-wrap">
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2} animationDuration={700}>
          {data.map((item, i) => <Cell key={item.name} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip content={<MoneyTooltip />} />
      </PieChart>
    </ResponsiveContainer>
    <ul className="chart-donut-legend">
      {data.map((item, i) => <li key={item.name}><i style={{ background: colors[i % colors.length] }} /><span>{item.name}</span><b>{fullMoney(item.value)}</b></li>)}
    </ul>
  </div>
}

export function MethodDonut({ methods = [] }) {
  const data = methods.filter((item) => (item.incomeCents || 0) > 0).map((item) => ({ name: item.name, value: toPesos(item.incomeCents) }))
  return <Donut data={data} unit="ingresos" />
}

export function CategoryDonut({ entries = [], labelFor = (key) => key }) {
  const byCategory = new Map()
  for (const entry of entries) {
    if (entry.type !== 'EXPENSE') continue
    const key = entry.category || 'Otros'
    byCategory.set(key, (byCategory.get(key) || 0) + (entry.amountCents || 0))
  }
  const data = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([key, cents]) => ({ name: labelFor(key), value: toPesos(cents) }))
  return <Donut data={data} unit="egresos" colors={['#c0564f', '#d98b3f', '#d7ad56', '#9d8abb', '#5b8fd6', '#8d8f9b']} />
}
