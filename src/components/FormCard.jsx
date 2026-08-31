export default function FormCard({ title, fields, values, onFieldChange }) {
  const editable = Boolean(onFieldChange)
  return <div className="form-card"><h3>{title}</h3><div className="form-grid">{fields.map((f, i) => {
    const [label, fallback] = f.split('|')
    const isNote = i === fields.length - 1 && fallback === ''
    if (editable) {
      const value = values?.[label] ?? ''
      return isNote
        ? <label key={label}>{label}<textarea placeholder="Añade una nota..." value={value} onChange={(e) => onFieldChange(label, e.target.value)} /></label>
        : <label key={label}>{label}<input value={value} onChange={(e) => onFieldChange(label, e.target.value)} /></label>
    }
    return isNote
      ? <label key={label}>{label}<textarea placeholder="Añade una nota..." /></label>
      : <label key={label}>{label}<input value={fallback} readOnly /></label>
  })}</div></div>
}
