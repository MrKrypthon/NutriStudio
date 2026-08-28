import { useEffect, useState } from 'react'

const palettes = {
  minimal: { name: 'Minimalista (default)', green: '#34745f', dark: '#202124', mint: '#eef8f2', accent: '#8e9a94' },
  coral: { name: 'Coral', green: '#f05255', dark: '#8f3537', mint: '#f7d7d0', accent: '#f0d625' },
  natural: { name: 'Natural', green: '#a5cc4c', dark: '#4b692f', mint: '#eef0e1', accent: '#e29248' },
  berry: { name: 'Frutos rojos', green: '#982e76', dark: '#4b246d', mint: '#f2eeee', accent: '#f0d625' },
}

export default function ThemePicker() {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(() => localStorage.getItem('nutri-custom-theme') || '#355c4a')
  const applyTheme = (theme) => { document.documentElement.style.setProperty('--green', theme.green); document.documentElement.style.setProperty('--ink', theme.dark); document.documentElement.style.setProperty('--mint', theme.mint); document.documentElement.style.setProperty('--accent', theme.accent); document.documentElement.style.setProperty('--surface-tint', theme.mint); localStorage.setItem('nutri-theme', theme.name) }
  const applyCustom = (value) => { setCustom(value); applyTheme({ name: 'Personalizada', green: value, dark: '#263b36', mint: value + '20', accent: '#d3a14e' }); localStorage.setItem('nutri-custom-theme', value) }
  useEffect(() => { const saved = localStorage.getItem('nutri-theme'); const savedPalette = Object.values(palettes).find((palette) => palette.name === saved); if (savedPalette) applyTheme(savedPalette) }, [])
  return <div className="theme-picker"><button className="theme-toggle" onClick={() => setOpen(!open)}><span className="palette-dot" /> Apariencia <b>⌄</b></button>{open && <div className="theme-menu"><p className="eyebrow">PALETA DE LA APP</p><b className="theme-title">Elige tu ambiente</b>{Object.entries(palettes).map(([key, palette]) => <button className="theme-option" key={key} onClick={() => applyTheme(palette)}><span className="swatches"><i style={{background:palette.dark}} /><i style={{background:palette.green}} /><i style={{background:palette.accent}} /></span><span>{palette.name}</span>{localStorage.getItem('nutri-theme') === palette.name && <em>✓</em>}</button>)}<label className="custom-theme"><span>Tu color principal</span><input type="color" value={custom} onChange={e => applyCustom(e.target.value)} /></label><small className="theme-hint">El color se guarda en este dispositivo.</small></div>}</div>
}
