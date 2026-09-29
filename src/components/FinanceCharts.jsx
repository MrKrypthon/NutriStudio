import { useRef, useState } from 'react'
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Legend, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

export function IncomeExpenseChart({ daily = [], selectedDate = null, onSelectDay }) {
  const [mode, setMode] = useState('area')
  // Recharts no expone de forma fiable el día en el onClick; la fecha se captura del tooltip
  // (que sí recibe el payload al pasar el mouse) y el clic alterna ese día. El ref va antes del
  // return temprano para no romper el orden de hooks.
  const hoverDateRef = useRef(null)
  const data = daily.map((day) => ({ date: day.date, label: `${new Date(day.date).getUTCDate()}`, Ingresos: toPesos(day.incomeCents), Egresos: toPesos(day.expenseCents) }))
  if (!data.length) return <p className="muted chart-empty">Sin movimientos en el periodo.</p>
  const selectedPoint = selectedDate ? data.find((point) => point.date === selectedDate) : null
  const handleClick = () => {
    const date = hoverDateRef.current
    if (date && onSelectDay) onSelectDay(selectedDate === date ? null : date)
  }
  return <div className="chart-frame">
    <div className="chart-mode">
      <div className="view-switch"><button className={mode === 'area' ? 'selected' : ''} onClick={() => setMode('area')}>Área</button><button className={mode === 'bars' ? 'selected' : ''} onClick={() => setMode('bars')}>Barras</button></div>
      <span className="chart-hint">{onSelectDay ? 'Clic en un día para filtrar los movimientos.' : ''}</span>
    </div>
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} onClick={handleClick} style={{ cursor: onSelectDay ? 'pointer' : 'default' }}>
        <defs>
          <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b9674" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#2b9674" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c0564f" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#c0564f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" vertical={false} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} width={44} tickFormatter={compact} />
        <Tooltip cursor={{ stroke: '#c9ccd3', strokeDasharray: '3 3' }} content={(props) => { if (props.active && props.payload?.[0]?.payload?.date) hoverDateRef.current = props.payload[0].payload.date; return <MoneyTooltip {...props} /> }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        {selectedPoint && <ReferenceLine x={selectedPoint.label} stroke="#7267ef" strokeDasharray="3 3" />}
        {mode === 'area' ? <>
          <Area type="monotone" dataKey="Egresos" stroke="#c0564f" strokeWidth={2} fill="url(#expenseFill)" animationDuration={700} activeDot={{ r: 4 }} />
          <Area type="monotone" dataKey="Ingresos" stroke="#2b9674" strokeWidth={2} fill="url(#incomeFill)" animationDuration={700} activeDot={{ r: 4 }} />
        </> : <>
          <Bar dataKey="Ingresos" fill="#2b9674" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
          <Bar dataKey="Egresos" fill="#c0564f" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
        </>}
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
