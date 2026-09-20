export default function FormCard({ title, fields, values, onFieldChange }) {
  const editable = Boolean(onFieldChange)
  // Sintaxis del campo: "Etiqueta|valor" (input), y con "|*" se fuerza un textarea multilínea
  // (también el último campo con valor vacío es nota). Así se pueden tener varios textareas por tarjeta.
  return <div className="form-card"><h3>{title}</h3><div className="form-grid">{fields.map((f, i) => {
    const [label, meta] = f.split('|')
    const isNote = i === fields.length - 1 && meta === ''
    const isTextArea = meta === '*' || isNote
    if (editable) {
      const value = values?.[label] ?? ''
      return isTextArea
        ? <label key={label}>{label}<textarea placeholder="Añade una nota..." value={value} onChange={(e) => onFieldChange(label, e.target.value)} /></label>
        : <label key={label}>{label}<input value={value} onChange={(e) => onFieldChange(label, e.target.value)} /></label>
    }
    return isTextArea
      ? <label key={label}>{label}<textarea placeholder="Añade una nota..." /></label>
      : <label key={label}>{label}<input value={meta} readOnly /></label>
  })}</div></div>
}
