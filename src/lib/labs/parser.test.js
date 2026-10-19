import { describe, expect, it } from 'vitest'
import { mergeAlternative, parseLabReport, parseNumber, parseRange } from './parser.js'
import { interpretLab } from './interpret.js'

const byKey = (items) => Object.fromEntries(items.map((item) => [item.key, item]))

describe('parseNumber y parseRange', () => {
  it('distingue miles de coma decimal', () => {
    expect(parseNumber('250,000')).toBe(250000)
    expect(parseNumber('5,6')).toBe(5.6)
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('92')).toBe(92)
  })
  it('lee los rangos de referencia en sus formas habituales', () => {
    expect(parseRange('70 - 100')).toBe('70-100')
    expect(parseRange('0.6 a 1.2 mg/dL')).toBe('0.6-1.2')
    expect(parseRange('Menor a 200')).toBe('<200')
    expect(parseRange('< 150')).toBe('<150')
    expect(parseRange('Hasta 150')).toBe('<150')
    expect(parseRange('Mayor de 40')).toBe('>40')
    expect(parseRange('> 40')).toBe('>40')
    expect(parseRange('150,000 - 450,000')).toBe('150000-450000')
    expect(parseRange('sin referencia')).toBeNull()
  })
})

describe('parseLabReport', () => {
  it('lee una química sanguínea y un perfil de lípidos en columnas (PDF digital)', () => {
    const text = `LABORATORIO CLÍNICO EJEMPLO
Paciente: María López   Fecha de toma: 12/05/2026
QUÍMICA SANGUÍNEA
Estudio            Resultado   Unidades   Valores de referencia
Glucosa              105        mg/dL      70 - 100
Urea                 28.5       mg/dL      15 - 45
BUN                  13.3       mg/dL      7 - 21
Creatinina           0.82       mg/dL      0.6 - 1.1
Ácido Úrico          7.1  *     mg/dL      2.4 - 5.7
PERFIL DE LÍPIDOS
Colesterol Total     215        mg/dL      Menor a 200
Colesterol HDL       38         mg/dL      Mayor de 40
Colesterol LDL       142        mg/dL      < 130
Triglicéridos        180        mg/dL      < 150`
    const { items, studyDate } = parseLabReport(text)
    const labs = byKey(items)
    expect(studyDate).toBe('2026-05-12')
    expect(labs.glucose).toMatchObject({ name: 'Glucosa', value: '105', unit: 'mg/dL', range: '70-100', status: 'Elevado' })
    expect(labs.urea).toMatchObject({ value: '28.5', range: '15-45', status: 'Normal' })
    expect(labs.bun).toMatchObject({ value: '13.3' })
    expect(labs.creatinine).toMatchObject({ value: '0.82', range: '0.6-1.1', status: 'Normal' })
    expect(labs.uricAcid).toMatchObject({ value: '7.1', status: 'Elevado' })
    expect(labs.cholesterol).toMatchObject({ value: '215', range: '<200', status: 'Elevado' })
    expect(labs.hdl).toMatchObject({ name: 'Colesterol HDL', value: '38', range: '>40', status: 'Bajo' })
    expect(labs.ldl).toMatchObject({ value: '142', status: 'Elevado' })
    expect(labs.triglycerides).toMatchObject({ value: '180', range: '<150', status: 'Elevado' })
    expect(items).toHaveLength(9)
  })

  it('no confunde hemoglobina con hemoglobina glucosilada ni colesterol con HDL', () => {
    const { items } = parseLabReport(['HEMOGLOBINA GLUCOSILADA (HbA1c)   6,4   %   4.0 - 5.6', 'Hemoglobina 13.8 g/dL 12.0 - 16.0', 'HDL-Colesterol 52 mg/dL > 40'])
    const labs = byKey(items)
    expect(labs.hba1c).toMatchObject({ value: '6.4', unit: '%', range: '4-5.6', status: 'Elevado' })
    expect(labs.hemoglobin).toMatchObject({ value: '13.8', unit: 'g/dL', status: 'Normal' })
    expect(labs.hdl).toMatchObject({ value: '52', status: 'Normal' })
    expect(labs.cholesterol).toBeUndefined()
  })

  it('lee la biometría hemática con miles, porcentajes y absolutos', () => {
    const { items } = parseLabReport(`BIOMETRÍA HEMÁTICA
Leucocitos 7.20 x10^3/uL 4.5 - 11.0
Eritrocitos 4.85 x10^6/uL 4.2 - 5.4
Hematocrito 41.2 % 37 - 47
VCM 85.0 fL 80 - 100
Plaquetas 250,000 /mm3 150,000 - 450,000
Neutrófilos 58 % 40 - 75
Neutrófilos 4.18 x10^3/uL 1.8 - 7.7
Linfocitos 32 % 20 - 45`)
    const labs = byKey(items)
    expect(labs.wbc).toMatchObject({ value: '7.2', unit: 'miles/µL', range: '4.5-11', status: 'Normal' })
    expect(labs.rbc).toMatchObject({ value: '4.85', unit: 'millones/µL' })
    expect(labs.hematocrit).toMatchObject({ value: '41.2', unit: '%' })
    expect(labs.mcv).toMatchObject({ value: '85', unit: 'fL' })
    expect(labs.platelets).toMatchObject({ value: '250000', range: '150000-450000', status: 'Normal' })
    expect(labs.neutrophils).toMatchObject({ value: '58', unit: '%' })
    expect(labs.neutrophilsAbs).toMatchObject({ name: 'Neutrófilos (absolutos)', value: '4.18' })
    expect(labs.lymphocytes).toMatchObject({ value: '32' })
  })

  it('toma el resultado del renglón de abajo y respeta las marcas H/L', () => {
    const { items } = parseLabReport(['TSH (Hormona estimulante de tiroides)', '5.80 H uUI/mL 0.4 - 4.0', 'T4 Libre 0.71 L ng/dL 0.8 - 1.8', 'Vitamina D 25-OH 18.4 ng/mL 30 - 100', 'Vitamina B12 410 pg/mL 200 - 900'])
    const labs = byKey(items)
    expect(labs.tsh).toMatchObject({ value: '5.8', unit: 'µUI/mL', range: '0.4-4', status: 'Elevado' })
    expect(labs.freeT4).toMatchObject({ value: '0.71', flag: 'Bajo', status: 'Bajo' })
    expect(labs.vitaminD).toMatchObject({ value: '18.4', status: 'Bajo' })
    expect(labs.vitaminB12).toMatchObject({ value: '410', status: 'Normal' })
  })

  it('tolera el texto ruidoso del OCR (puntos guía, mayúsculas, unidades sueltas)', () => {
    const { items } = parseLabReport(['GLUCOSA ..................... 92 mg/dl 70-100', 'TGO/AST : 45 U/L Hasta 40', 'TGP / ALT 38 U/L 7 a 56', 'POTASIO 4.1 mEq/L 3.5 - 5.1', 'Proteína C Reactiva 0,3 mg/L < 5'])
    const labs = byKey(items)
    expect(labs.glucose).toMatchObject({ value: '92', unit: 'mg/dL', status: 'Normal' })
    expect(labs.ast).toMatchObject({ value: '45', range: '<40', status: 'Elevado' })
    expect(labs.alt).toMatchObject({ value: '38', range: '7-56', status: 'Normal' })
    expect(labs.potassium).toMatchObject({ value: '4.1', unit: 'mEq/L' })
    expect(labs.crp).toMatchObject({ value: '0.3', status: 'Normal' })
  })

  it('ignora encabezados, fechas, notas y renglones sin resultado', () => {
    const { items } = parseLabReport([
      'Fecha de impresión: 15/05/2026 08:30',
      'Glucosa',
      'Se recomienda ayuno de 8 horas para glucosa y triglicéridos.',
      'Método: enzimático colorimétrico',
      'Página 1 de 2',
      'Paciente con 12 horas de ayuno, muestra de glucosa',
    ])
    expect(items).toHaveLength(0)
  })

  it('las siglas cortas sólo cuentan al inicio del renglón', () => {
    const { items } = parseLabReport(['Na 139 mEq/L 135 - 145', 'Leucocitos 6.5 K/uL 4.5 - 11', 'Vitamina K 1.2 ng/mL 0.2 - 3.2'])
    const labs = byKey(items)
    expect(labs.sodium).toMatchObject({ value: '139' })
    expect(labs.wbc).toMatchObject({ value: '6.5' })
    expect(labs.potassium).toBeUndefined()
  })
})

describe('salvaguardas para el OCR', () => {
  it('corrige un rango sin punto decimal y la marca del laboratorio manda', () => {
    const { items } = parseLabReport(['Ácido úrico 6.3 * mg/dL 24 - 57', 'Glucosa 98 H mg/dL 70 - 100'])
    const labs = byKey(items)
    expect(labs.uricAcid).toMatchObject({ range: '2.4-5.7', status: 'Elevado' })
    expect(labs.uricAcid.warnings[0]).toMatch(/punto decimal/)
    expect(labs.glucose).toMatchObject({ status: 'Elevado' })
    expect(labs.glucose.warnings[0]).toMatch(/marca como elevado/)
  })
  it('no toca rangos que sí son coherentes', () => {
    const { items } = parseLabReport(['Plaquetas 268 miles/uL 150 - 450', 'Glucosa 65 mg/dL 70 - 100'])
    const labs = byKey(items)
    expect(labs.platelets).toMatchObject({ range: '150-450', status: 'Normal', warnings: [] })
    expect(labs.glucose).toMatchObject({ range: '70-100', status: 'Bajo', warnings: [] })
  })
})

describe('escaneos de baja calidad (texto real del OCR)', () => {
  it('recupera el punto decimal perdido usando lo posible para cada estudio y su rango', () => {
    const { items } = parseLabReport([
      'Urea 312 mg/dL 15-45',
      'Creatinina 078 mglal 050-1.10',
      'Ácido úrico 63* mg/dl 24-57',
      'Hemoglobina glucosilada (HbA1 e) 59 % 40-58',
      'Hemoglobina 129 g/dL 120-16.0',
      'TSH 3.10 VUILmL 0.40 -4.00',
    ])
    const labs = byKey(items)
    expect(labs.urea).toMatchObject({ value: '31.2', range: '15-45', status: 'Normal' })
    expect(labs.urea.warnings[0]).toMatch(/punto decimal/)
    expect(labs.creatinine).toMatchObject({ value: '0.78', range: '0.5-1.1', status: 'Normal' })
    expect(labs.uricAcid).toMatchObject({ value: '6.3', range: '2.4-5.7', status: 'Elevado' })
    expect(labs.hba1c).toMatchObject({ value: '5.9', range: '4-5.8', status: 'Elevado' })
    expect(labs.hemoglobin).toMatchObject({ value: '12.9', range: '12-16', status: 'Normal' })
    expect(labs.tsh).toMatchObject({ value: '3.1', range: '0.4-4', status: 'Normal', warnings: [] })
  })
  it('reconoce nombres con una o dos letras mal leídas y lo avisa', () => {
    const { items } = parseLabReport(['Crealinina 0.78 mg/dL 0.5-1.1', 'Tíglicérios 182 mail Menor a 150', 'Hematocrio 39.1 % 36-47'])
    const labs = byKey(items)
    expect(labs.creatinine).toMatchObject({ value: '0.78' })
    expect(labs.creatinine.warnings[0]).toMatch(/aproximada/)
    expect(labs.triglycerides).toMatchObject({ value: '182', range: '<150', status: 'Elevado' })
    expect(labs.hematocrit).toMatchObject({ value: '39.1' })
  })
  it('no "corrige" valores reales aunque estén fuera de rango', () => {
    const { items } = parseLabReport(['Glucosa 312 mg/dL 70-100', 'Triglicéridos 980 mg/dL < 150', 'Plaquetas 250000 /mm3 150000-450000'])
    const labs = byKey(items)
    expect(labs.glucose).toMatchObject({ value: '312', status: 'Elevado', warnings: [] })
    expect(labs.triglycerides).toMatchObject({ value: '980', warnings: [] })
    expect(labs.platelets).toMatchObject({ value: '250000', warnings: [] })
  })
})

describe('confusiones de dígitos del OCR', () => {
  it('lee "4l" y "4 l" como 41 cuando 4 es imposible, y corrige ambos límites del rango', () => {
    const { items } = parseLabReport(['Colesterol HDL 4 l mg/dL Mayor de 40', 'Colesterol LDL 1O5 mg/dL < 130', 'Leucocitos 6.80 x10^3/uL 45-110', 'Glucosa 7O L mg/dL 74 - 106'])
    const labs = byKey(items)
    expect(labs.hdl).toMatchObject({ value: '41', status: 'Normal' })
    expect(labs.ldl).toMatchObject({ value: '105', status: 'Normal' })
    expect(labs.wbc).toMatchObject({ value: '6.8', range: '4.5-11', status: 'Normal' })
    expect(labs.glucose).toMatchObject({ value: '70', status: 'Bajo' })
  })
})

describe('mergeAlternative', () => {
  it('toma de la segunda lectura sólo lo que en la primera quedó imposible', () => {
    const merged = mergeAlternative(parseLabReport(['Colesterol HDL 4 mg/dL Mayor de 40', 'Glucosa 95 mg/dL 70-100']), parseLabReport(['Colesterol HDL 41 mg/dL Mayor de 40', 'Glucosa 59 mg/dL 70-100', 'Urea 30 mg/dL 15-45']))
    const labs = byKey(merged.items)
    expect(labs.hdl).toMatchObject({ value: '41', status: 'Normal' })
    expect(labs.hdl.warnings.at(-1)).toMatch(/segunda lectura/)
    expect(labs.glucose).toMatchObject({ value: '95' })
    expect(labs.urea.warnings.at(-1)).toMatch(/Sólo apareció/)
  })
})

describe('interpretLab', () => {
  it('decide normal, elevado o bajo según el rango', () => {
    expect(interpretLab('105', '70-100')).toBe('Elevado')
    expect(interpretLab('65', '70 - 100')).toBe('Bajo')
    expect(interpretLab('38', '>40')).toBe('Bajo')
    expect(interpretLab('180', '<200')).toBe('Normal')
    expect(interpretLab('5,6', '4 a 6')).toBe('Normal')
    expect(interpretLab('', '70-100')).toBeNull()
  })
})
