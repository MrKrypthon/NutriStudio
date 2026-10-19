import { useEffect, useMemo, useRef, useState } from 'react'
import { readLabFile } from '../../lib/labs/readLabFile.js'
import { mergeAlternative, parseLabReport } from '../../lib/labs/parser.js'
import { interpretLab } from '../../lib/labs/interpret.js'
import { LAB_GROUP_ORDER } from '../../lib/labs/catalog.js'

const STATUSES = ['Normal', 'Elevado', 'Bajo', 'Pendiente']
const formatDate = (iso) => { if (!iso) return null; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// Importar resultados de laboratorio desde un PDF o una foto: lee el archivo (texto del PDF u OCR),
// propone los estudios encontrados como borrador editable y, al confirmar, los entrega a
// Bioquímico. Nada se guarda sin que la nutrióloga lo revise.
export default function LabImportModal({ file, existing = [], canAttach = false, onApply, onClose }) {
  const [stage, setStage] = useState({ name: 'reading', page: 0, pages: 0, progress: 0 })
  const [result, setResult] = useState(null)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [attach, setAttach] = useState(canAttach)
  const [showText, setShowText] = useState(false)
  const [applying, setApplying] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    readLabFile(file, (progress) => { if (!cancelled.current) setStage({ name: progress.stage, page: progress.page, pages: progress.pages, progress: progress.progress }) })
      .then((read) => {
        if (cancelled.current) return
        const parsed = mergeAlternative(parseLabReport(read.lines), read.altLines?.length ? parseLabReport(read.altLines) : null)
        setResult({ ...read, ...parsed })
        setRows(parsed.items.map((item, index) => {
          const current = existing.find((lab) => sameName(lab.name, item.name))
          return { ...item, id: `${index}`, include: true, replace: Boolean(current), current, manualStatus: false }
        }))
        setStage({ name: 'done' })
      })
      .catch((err) => { if (!cancelled.current) { setError(err.message || 'No se pudo leer el archivo.'); setStage({ name: 'error' }) } })
    return () => { cancelled.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const update = (id, patch) => setRows((prev) => prev.map((row) => {
    if (row.id !== id) return row
    const next = { ...row, ...patch }
    // Al corregir valor o rango se vuelve a interpretar, salvo que el estado se haya elegido a mano.
    if (('value' in patch || 'range' in patch) && !next.manualStatus) next.status = interpretLab(next.value, next.range) || next.status
    return next
  }))
  const selected = rows.filter((row) => row.include && String(row.name).trim() && String(row.value).trim())
  const grouped = useMemo(() => LAB_GROUP_ORDER.map((group) => [group, rows.filter((row) => row.group === group)]).filter(([, items]) => items.length), [rows])
  const allChecked = rows.length > 0 && rows.every((row) => row.include)

  const apply = async () => {
    setApplying(true)
    try { await onApply(selected, { attach: canAttach && attach, studyDate: result?.studyDate || null }) } finally { setApplying(false) }
  }

  const busy = stage.name === 'reading' || stage.name === 'ocr'
  const percent = stage.name === 'ocr' ? Math.round((stage.progress || 0) * 100) : null
  const methodNote = result && (result.method === 'text' ? 'Leído del texto del PDF.' : result.method === 'ocr' ? `Reconocido con OCR${result.confidence != null ? ` (confianza ${result.confidence}%)` : ''}: revisa cada valor contra el documento.` : `Texto del PDF y ${result.ocrPages} página(s) escaneada(s) reconocidas con OCR: revisa los valores.`)

  return <div className="modal-backdrop" onClick={() => !busy && !applying && onClose()}><div className="modal lab-import-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">IMPORTAR RESULTADOS DE LABORATORIO</p><h2>{file?.name || 'Archivo de laboratorio'}</h2><span className="modal-subtitle">{busy ? 'Leyendo el archivo en este equipo; no se envía a ningún servicio externo.' : 'Revisa lo que encontré antes de agregarlo al expediente.'}</span></div><button type="button" aria-label="Cerrar" disabled={busy || applying} onClick={onClose}>×</button></div>

    {busy && <div className="lab-import-progress">
      <span className="loading-dot">●</span>
      <div><b>{stage.name === 'ocr' ? `Reconociendo texto (OCR)${stage.pages ? ` · página ${stage.page} de ${stage.pages}` : ''}${percent != null ? ` · ${percent}%` : ''}` : `Leyendo el PDF${stage.pages ? ` · página ${stage.page} de ${stage.pages}` : '…'}`}</b>
        <small>{stage.name === 'ocr' ? 'Es un documento escaneado: el reconocimiento tarda unos segundos por página (la primera vez también carga el reconocedor).' : 'Los PDF que genera el laboratorio traen el texto y se leen al instante.'}</small>
        {percent != null && <div className="pp-bar"><i style={{ width: `${percent}%` }} /></div>}
      </div>
    </div>}

    {stage.name === 'error' && <div className="form-error">⚠ {error}</div>}

    {stage.name === 'done' && result && <>
      <div className="lab-import-summary">
        <span><b>{rows.length}</b> estudio{rows.length === 1 ? '' : 's'} encontrado{rows.length === 1 ? '' : 's'}</span>
        {result.studyDate && <span>Fecha de toma: <b>{formatDate(result.studyDate)}</b></span>}
        <span className={result.method === 'text' ? 'muted' : 'lab-import-warn'}>{methodNote}</span>
        {result.truncated && <span className="lab-import-warn">Sólo se leyeron las primeras 15 páginas.</span>}
      </div>

      {rows.length === 0 && <div className="lab-empty"><span>◌</span><b>No encontré estudios que reconozca</b><small>{result.lines.length ? 'El archivo se leyó, pero ningún renglón tiene la forma «estudio · resultado · unidad». Captúralos con «+ Agregar estudio».' : 'No se pudo leer texto del archivo. Si es una foto, prueba con una más nítida y derecha.'}</small></div>}

      {rows.length > 0 && <div className="lab-import-table">
        <div className="lab-import-row lab-import-head"><label className="lab-import-check"><input type="checkbox" checked={allChecked} onChange={(event) => setRows((prev) => prev.map((row) => ({ ...row, include: event.target.checked })))} aria-label="Seleccionar todos" /></label><span>Estudio</span><span>Resultado</span><span>Unidad</span><span>Referencia</span><span>Estado</span></div>
        {grouped.map(([group, items]) => <div key={group} className="lab-import-group">
          <p className="eyebrow">{group.toUpperCase()}</p>
          {items.map((row) => <div className={'lab-import-row' + (row.include ? '' : ' excluded')} key={row.id}>
            <label className="lab-import-check"><input type="checkbox" checked={row.include} onChange={(event) => update(row.id, { include: event.target.checked })} aria-label={`Incluir ${row.name}`} /></label>
            <span className="lab-import-name"><input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} aria-label="Estudio" />
              <small title={row.line}>«{row.line.length > 90 ? `${row.line.slice(0, 90)}…` : row.line}»</small>
              {row.warnings?.map((warning) => <small className="lab-import-existing" key={warning}>⚠ {warning}</small>)}
              {row.current && <small className="lab-import-existing"><label><input type="checkbox" checked={row.replace} onChange={(event) => update(row.id, { replace: event.target.checked })} /> Ya registrado ({row.current.value} {row.current.unit}): {row.replace ? 'se reemplaza' : 'se agrega otro'}</label></small>}
            </span>
            <input value={row.value} onChange={(event) => update(row.id, { value: event.target.value })} aria-label="Resultado" />
            <input value={row.unit} onChange={(event) => update(row.id, { unit: event.target.value })} aria-label="Unidad" />
            <input value={row.range} onChange={(event) => update(row.id, { range: event.target.value })} placeholder="—" aria-label="Referencia" />
            <select className={'lab-status-select ' + String(row.status).toLowerCase()} value={row.status} onChange={(event) => update(row.id, { status: event.target.value, manualStatus: true })} aria-label="Estado">{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
          </div>)}
        </div>)}
      </div>}

      {result.lines.length > 0 && <button type="button" className="link-button lab-import-text-toggle" onClick={() => setShowText((value) => !value)}>{showText ? 'Ocultar el texto leído' : 'Ver el texto leído del archivo'}</button>}
      {showText && <pre className="lab-import-text">{result.lines.slice(0, 200).join('\n')}</pre>}

      {canAttach && <label className="lab-import-attach"><input type="checkbox" checked={attach} onChange={(event) => setAttach(event.target.checked)} /> Guardar también el PDF en los adjuntos de esta consulta</label>}
    </>}

    <div className="modal-actions">
      <button type="button" className="secondary" disabled={busy || applying} onClick={onClose}>Cancelar</button>
      {stage.name === 'done' && rows.length > 0 && <button type="button" className="primary" disabled={!selected.length || applying} onClick={apply}>{applying ? 'Agregando…' : `Agregar ${selected.length} estudio${selected.length === 1 ? '' : 's'} al expediente`}</button>}
    </div>
  </div></div>
}
