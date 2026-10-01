import { describe, expect, it } from 'vitest'
import { PES_DOMAINS, pesTermsFor, searchPesTerms } from './pesTerms.js'

// Estas pruebas blindan los tres defectos de datos que aparecieron al transcribir el catálogo
// eNCPT: una clave duplicada entre dos categorías (rompía la búsqueda por colisión de `key` en
// React), una categoría entera mal archivada dentro de otra, y texto de encabezado/pie de página
// pegado al final de una etiqueta. Son errores de transcripción, no de lógica, así que una prueba
// de lógica normal no los habría atrapado — hace falta recorrer los datos mismos.

const flatten = () => PES_DOMAINS.flatMap((d) => d.categories.flatMap((c) => c.terms.map((t) => ({ ...t, domain: d.name, category: c.name }))))

describe('PES_DOMAINS — integridad de los datos', () => {
  it('tiene los cuatro dominios del documento fuente (eNCPT 2017)', () => {
    expect(PES_DOMAINS.map((d) => d.code).sort()).toEqual(['NB', 'NC', 'NI', 'NO'])
  })

  it('ningún término comparte clave y etiqueta con otro (evita la colisión de key en React)', () => {
    const seen = new Map()
    for (const term of flatten()) {
      const key = `${term.code}|${term.label}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1)
    expect(duplicates).toEqual([])
  })

  it('ninguna etiqueta arrastra texto de encabezado o pie de página del documento fuente', () => {
    const smells = ['Terminología de Diagnóstico', 'Copyright', 'eNCPT']
    for (const term of flatten()) {
      for (const smell of smells) expect(term.label).not.toContain(smell)
      // Una etiqueta de este catálogo nunca debería medir más de ~120 caracteres; si lo hace, es
      // señal de que se pegó texto de otra parte del documento (como pasó con Ácido pantoténico).
      expect(term.label.length).toBeLessThan(120)
    }
  })

  it('el dominio OTROS existe como tal y no como categoría de otro dominio', () => {
    const otros = PES_DOMAINS.find((d) => d.code === 'NO')
    expect(otros).toBeDefined()
    expect(otros.categories).toHaveLength(1)
    expect(otros.categories[0].terms).toEqual([{ code: 'NO-1.1', anduid: '10795', label: 'Sin diagnóstico nutricio en este momento' }])
  })

  it('Multi-nutrimentos es su propia categoría de INGESTIÓN, no parte de Minerales', () => {
    const ingestion = PES_DOMAINS.find((d) => d.code === 'NI')
    const minerales = ingestion.categories.find((c) => c.name === 'Minerales')
    const multi = ingestion.categories.find((c) => c.name === 'Multi-nutrimentos')
    expect(multi).toBeDefined()
    expect(multi.terms.map((t) => t.code)).toEqual(['NI-5.11.1', 'NI-5.11.2'])
    expect(minerales.terms.some((t) => t.code.startsWith('NI-5.11'))).toBe(false)
    // 18 minerales × 2 sentidos (inadecuada/excesiva) + 2 términos "(especificar)" = 38.
    expect(minerales.terms).toHaveLength(38)
  })

  it('búsqueda y navegación por dominio llegan a los mismos 162 términos únicos', () => {
    const total = flatten().length
    expect(total).toBe(162)
    const byDomain = PES_DOMAINS.reduce((sum, d) => sum + pesTermsFor(d.name).length, 0)
    expect(byDomain).toBe(total)
  })
})

describe('searchPesTerms — regresión del bug de "obesidad"', () => {
  it('no devuelve términos sin relación con el texto buscado', () => {
    const hits = searchPesTerms('obesidad')
    expect(hits.every((h) => `${h.label} ${h.code}`.toLowerCase().includes('obesidad'))).toBe(true)
  })

  it('encuentra el término correcto en el dominio recién corregido (OTROS)', () => {
    const hits = searchPesTerms('sin diagnóstico')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ code: 'NO-1.1', domain: 'OTROS' })
  })
})
