import { useEffect, useRef, useState } from 'react'

// Visor de PDF dentro de la app (sin descargar el archivo). En computadora usa el visor del propio
// navegador en un iframe (zoom, búsqueda, imprimir); en celular —o donde el navegador no muestra
// PDFs, `navigator.pdfViewerEnabled === false`— dibuja las páginas con pdf.js, que funciona en todos.
//
// `loadBlob()` trae el PDF; `actions` son los botones de la barra (descargar, entregar…), y
// `onPrev`/`onNext` permiten recorrer los documentos de la lista sin cerrar el visor.
const prefersCanvas = () => (typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === false) || (typeof window !== 'undefined' && window.innerWidth < 760)

async function renderPdfPages(blob, container, isCancelled) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false })
  try {
    const pdf = await task.promise
    const width = Math.max(280, container.clientWidth - 24)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    for (let number = 1; number <= pdf.numPages; number++) {
      if (isCancelled()) return
      const page = await pdf.getPage(number)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (width / base.width) * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${width}px`
      canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages}`)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise
      if (isCancelled()) return
      container.appendChild(canvas)
    }
  } finally {
    await task.destroy()
  }
}

export default function PdfPreviewModal({ title, subtitle, loadBlob, onClose, actions = null, onPrev, onNext, position = '' }) {
  const [state, setState] = useState({ status: 'loading', url: '', error: '' })
  const [useCanvas] = useState(prefersCanvas)
  const pagesRef = useRef(null)
  const blobRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let url = ''
    setState({ status: 'loading', url: '', error: '' })
    if (pagesRef.current) pagesRef.current.replaceChildren()
    loadBlob()
      .then(async (blob) => {
        if (cancelled) return
        blobRef.current = blob
        url = URL.createObjectURL(blob)
        setState({ status: 'ready', url, error: '' })
      })
      .catch((error) => { if (!cancelled) setState({ status: 'error', url: '', error: error.message || 'No se pudo abrir el documento.' }) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadBlob])

  // Modo celular: dibujar las páginas cuando el PDF ya llegó.
  useEffect(() => {
    if (!useCanvas || state.status !== 'ready' || !pagesRef.current || !blobRef.current) return undefined
    let cancelled = false
    pagesRef.current.replaceChildren()
    renderPdfPages(blobRef.current, pagesRef.current, () => cancelled).catch(() => { if (!cancelled) setState((prev) => ({ ...prev, status: 'error', error: 'No se pudo mostrar el PDF en este dispositivo. Descárgalo para verlo.' })) })
    return () => { cancelled = true }
  }, [useCanvas, state.status, state.url])

  // Teclado: Esc cierra; ← y → recorren los documentos.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return
      if (event.key === 'ArrowLeft' && onPrev) onPrev()
      if (event.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  return <div className="modal-backdrop pdf-preview-backdrop" onClick={onClose}><div className="pdf-preview" role="dialog" aria-modal="true" aria-label={`Vista previa: ${title}`} onClick={(event) => event.stopPropagation()}>
    <header className="pdf-preview-head">
      <div className="pdf-preview-title"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</div>
      <div className="pdf-preview-nav">
        {(onPrev || onNext) && <><button type="button" className="secondary pdf-preview-icon" disabled={!onPrev} onClick={onPrev} aria-label="Documento anterior" title="Anterior (←)">‹</button>{position && <span>{position}</span>}<button type="button" className="secondary pdf-preview-icon" disabled={!onNext} onClick={onNext} aria-label="Documento siguiente" title="Siguiente (→)">›</button></>}
      </div>
      <div className="pdf-preview-actions">
        {actions}
        {state.status === 'ready' && <a className="secondary pdf-preview-link" href={state.url} target="_blank" rel="noopener noreferrer" title="Abrir el PDF en otra pestaña">↗ Pestaña</a>}
        <button type="button" className="pdf-preview-close" onClick={onClose} aria-label="Cerrar vista previa">×</button>
      </div>
    </header>
    <div className="pdf-preview-body">
      {state.status === 'loading' && <div className="pdf-preview-status"><span className="loading-dot">●</span><p>Abriendo el documento…</p></div>}
      {state.status === 'error' && <div className="pdf-preview-status"><p className="form-error">⚠ {state.error}</p></div>}
      {state.status === 'ready' && !useCanvas && <iframe className="pdf-preview-frame" title={title} src={`${state.url}#view=FitH&navpanes=0`} />}
      {useCanvas && <div className="pdf-preview-pages" ref={pagesRef} />}
    </div>
  </div></div>
}
