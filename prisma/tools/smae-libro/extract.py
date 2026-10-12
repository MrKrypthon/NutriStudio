#!/usr/bin/env python3
"""Extrae las tablas del libro "Sistema Mexicano de Alimentos Equivalentes" (5a ed.) a JSON.

El PDF es un escaneo: cada hoja es una imagen de una tabla (girada) y la capa de texto que trae no
sirve. Este script vuelve a leer cada tabla celda por celda:

  1. convierte la hoja a imagen (pdftoppm, 300 dpi),
  2. localiza la tabla por sus líneas (encabezado y separadores de columna),
  3. encuentra los renglones por la tinta de las columnas numéricas,
  4. recorta cada celda y la lee con tesseract (números con lista blanca de caracteres; nombres y
     unidades en español),
  5. normaliza (ND, fracciones, punto decimal perdido) y marca lo dudoso.

Requiere: python3 con Pillow y numpy, poppler (pdftoppm) y tesseract 5 con el idioma `spa`
(si no está instalado en el sistema: TESSDATA_PREFIX=<carpeta con spa.traineddata>).

Uso:
  python3 prisma/tools/smae-libro/extract.py <libro.pdf> <salida.json> [--pages 16-205] [--jobs 8]
                                              [--work <carpeta temporal>] [--keep]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

DPI = 300
# Gris por debajo del cual un pixel es tinta. Los renglones alternos van sombreados en gris medio:
# el umbral tiene que quedar por debajo de ese sombreado o renglones enteros contarían como tinta.
INK = 150
# Las líneas de la tabla son más claras que el texto: para verlas el umbral es más alto.
LINE = 170
# Columnas numéricas de la tabla, en el orden del libro. `decimals` es cuántos decimales imprime el
# libro en esa columna: sirve para reponer el punto cuando el reconocimiento lo pierde ("09" → 0.9).
# None = el libro la imprime unas veces entera y otras con decimal (índice y carga glicémica): se
# toma tal cual se lee.
NUMERIC_COLUMNS = [
    ('grossWeight', 0), ('netWeight', 0), ('kcal', 0), ('protein', 1), ('fat', 1), ('carbs', 1),
    ('satFat', 1), ('monoFat', 1), ('polyFat', 1), ('cholesterol', 1), ('sugar', 1), ('fiber', 1),
    ('vitA', 1), ('vitC', 1), ('folicAcid', 1), ('calcium', 1), ('iron', 1), ('potassium', 1),
    ('sodium', 1), ('phosphorus', 1), ('ethanol', 1), ('gi', None), ('gl', None),
]
# Ancho de la columna del nombre, medido desde su borde derecho: más a la izquierda queda el margen
# con el número de hoja girado, que no debe entrar en la lectura.
NAME_WIDTH = 405
# Posición (px a 300 dpi) de las 26 líneas verticales de la tabla en una hoja de referencia:
# nombre | cantidad | unidad | 23 columnas numéricas. Sólo importan sus distancias relativas.
COLUMN_TEMPLATE = [564, 654, 791, 890, 989, 1089, 1190, 1289, 1389, 1488, 1589, 1689, 1788, 1888, 1988, 2087, 2187, 2286, 2387, 2486, 2585, 2684, 2784, 2883, 2984, 3243]


def runs(indices, gap=3):
    """Agrupa índices consecutivos (con huecos de hasta `gap`) en tramos (inicio, fin)."""
    groups, start, prev = [], None, None
    for value in indices:
        if start is None:
            start = prev = value
        elif value - prev <= gap:
            prev = value
        else:
            groups.append((start, prev))
            start = prev = value
    if start is not None:
        groups.append((start, prev))
    return groups


def fit_template(dark_band, width, scales, offsets):
    """Ajusta la plantilla de columnas a una franja: devuelve (coincidencia, líneas, escala)."""
    profile = dark_band.sum(axis=0).astype(float) / max(1, dark_band.shape[0])
    # Un poco de tolerancia lateral: una línea puede caer un pixel al lado.
    spread = np.maximum.reduce([np.roll(profile, shift) for shift in (-2, -1, 0, 1, 2)])
    template = np.array(COLUMN_TEMPLATE, dtype=float)
    best = (0.0, None, 1.0)
    for scale in scales:
        scaled = (template - template[0]) * scale
        for offset in offsets:
            positions = np.rint(scaled + offset).astype(int)
            if positions[0] < 0 or positions[-1] >= width:
                continue
            score = spread[positions].mean()
            if score > best[0]:
                best = (score, positions, scale)
    return best


def find_table(gray):
    """Localiza la tabla. Devuelve None si la hoja no es tabla, ('bad-columns', coincidencia) si no
    se pudo ajustar, o un dict con el cuerpo y una función `lines_at(y)` que da las 26 líneas de
    columna a esa altura (las hojas están escaneadas con una leve inclinación, así que las líneas
    no caen en la misma x arriba que abajo)."""
    height, width = gray.shape
    dark = gray < LINE
    row_ink = dark.sum(axis=1)
    long_lines = [(a, b) for a, b in runs(np.nonzero(row_ink > 0.35 * width)[0]) if a > 0.05 * height]
    # Encabezado: las dos primeras líneas largas que quedan a 250–700 px una de otra.
    header = None
    for i in range(len(long_lines) - 1):
        gap = long_lines[i + 1][0] - long_lines[i][1]
        if 250 < gap < 700 and long_lines[i][1] < 0.45 * height:
            header = (long_lines[i][1] + 1, long_lines[i + 1][0] - 1, long_lines[i + 1][1] + 1)
            break
    if not header:
        return None
    header_top, header_bottom, body_top = header
    later = [a for a, b in long_lines if a > body_top + 200]
    body_bottom = (later[0] - 4) if later else height - 40
    # Las líneas de columna no siempre salen completas en el escaneo, así que no se cuentan: se
    # ajusta la plantilla conocida —todas las hojas tienen las mismas 26 líneas— buscando el
    # desplazamiento y la escala con que cae sobre más tinta. Primero en el encabezado…
    # (sólo su parte baja: en una franja corta la inclinación casi no desplaza las líneas)
    upper_y = header_bottom - 90
    score, upper, scale = fit_template(dark[header_bottom - 170:header_bottom - 8], width, np.linspace(0.96, 1.04, 33), range(120, width))
    if upper is None or score < 0.45:
        return ('bad-columns', round(float(score), 2))
    # …y otra vez en una franja del cuerpo, cerca del encabezado y cada vez más abajo, para medir
    # cuánto se desplazan las líneas con la altura.
    lower, lower_y = upper, upper_y
    for top in range(body_top + 60, body_bottom - 260, 240):
        band_score, positions, _ = fit_template(dark[top:top + 240], width, [scale], range(int(lower[0]) - 14, int(lower[0]) + 15))
        if positions is not None and band_score > 0.3:
            lower, lower_y = positions, top + 120
    slope = (np.array(lower, dtype=float) - np.array(upper, dtype=float)) / max(1.0, lower_y - upper_y)

    def lines_at(y):
        return np.rint(np.array(upper, dtype=float) + slope * (y - upper_y)).astype(int).tolist()

    return {'header_top': header_top, 'body_top': body_top, 'body_bottom': body_bottom, 'lines_at': lines_at, 'score': round(float(score), 2), 'skew': round(float(slope[0]) * 1000, 2)}


def find_rows(gray, table):
    """Renglones de la tabla: tramos verticales con tinta en las columnas numéricas."""
    body_top, body_bottom = table['body_top'], table['body_bottom']
    ink = np.zeros(body_bottom - body_top, dtype=int)
    # Por franjas, para que la máscara de las líneas siga la inclinación de la hoja.
    for start in range(body_top, body_bottom, 60):
        end = min(body_bottom, start + 60)
        lines = table['lines_at']((start + end) / 2)
        mask = np.zeros(gray.shape[1], dtype=bool)
        mask[lines[2] + 6:lines[-1] - 6] = True
        for x in lines:
            mask[max(0, x - 5):x + 6] = False
        ink[start - body_top:end - body_top] = (gray[start:end] < INK)[:, mask].sum(axis=1)
    bands = [(a + body_top, b + body_top) for a, b in runs(np.nonzero(ink > 6)[0], gap=4)]
    rows = []
    for top, bottom in bands:
        h = bottom - top
        if h < 14:
            continue          # mota o línea suelta
        if h > 70:
            break             # fotografía o bloque al pie de la tabla: ahí termina
        rows.append((top, bottom))
    return rows


def crop(gray, x0, x1, y0, y1, scale=2, pad=14, binarize=False):
    """Recorta una celda, la agranda y le pone margen blanco (tesseract lee mejor así)."""
    cell = Image.fromarray(gray[max(0, y0):y1, max(0, x0):x1])
    cell = cell.resize((cell.width * scale, cell.height * scale), Image.LANCZOS)
    if binarize:
        # Segunda lectura: en blanco y negro puro, sin el sombreado de los renglones alternos.
        cell = cell.point(lambda value: 0 if value < 150 else 255)
    canvas = Image.new('L', (cell.width + pad * 2, cell.height + pad * 2), 255)
    canvas.paste(cell, (pad, pad))
    return canvas


def ocr_batch(images, work, tag, lang, psm, whitelist=None):
    """Lee una lista de imágenes con UNA llamada a tesseract; devuelve un texto por imagen."""
    if not images:
        return []
    paths = []
    for index, image in enumerate(images):
        path = os.path.join(work, f'{tag}-{index:04d}.png')
        image.save(path)
        paths.append(path)
    listing = os.path.join(work, f'{tag}.txt')
    with open(listing, 'w') as handle:
        handle.write('\n'.join(paths))
    command = ['tesseract', listing, '-', '-l', lang, '--psm', str(psm), '-c', 'page_separator=\f']
    if whitelist:
        command += ['-c', f'tessedit_char_whitelist={whitelist}']
    # Un hilo por proceso: las hojas ya se reparten entre procesos, y tesseract con sus propios
    # hilos encima los hace pelear por el procesador (corre varias veces más lento).
    output = subprocess.run(command, capture_output=True, text=True, env={**os.environ, 'OMP_THREAD_LIMIT': '1'}).stdout
    texts = output.split('\f')
    texts = (texts + [''] * len(images))[:len(images)]
    for path in paths:
        os.remove(path)
    os.remove(listing)
    return [text.strip() for text in texts]


def parse_number(text, decimals):
    """'0.9' → 0.9 · 'ND' → None (no determinado) · '09' en columna de 1 decimal → 0.9.
    Devuelve (valor, nd, dudoso)."""
    raw = text.replace(' ', '').replace(',', '.').replace('O', '0').replace('o', '0')
    if re.fullmatch(r'N[D0]?|ND\.?', raw, re.I) or raw.upper() in ('ND', 'N0', 'NO', 'NB'):
        return None, True, False
    cleaned = re.sub(r'[^0-9.]', '', raw)
    if not cleaned or cleaned == '.':
        return None, False, True
    doubtful = cleaned != raw
    if cleaned.count('.') > 1:
        head, _, tail = cleaned.rpartition('.')
        cleaned = head.replace('.', '') + '.' + tail
        doubtful = True
    if '.' not in cleaned and decimals:
        # El libro imprime siempre un decimal en estas columnas: si no hay punto, se perdió.
        cleaned = (cleaned[:-decimals] or '0') + '.' + cleaned[-decimals:]
        doubtful = True
    elif '.' in cleaned and decimals == 0:
        doubtful = True
    try:
        return float(cleaned), False, doubtful
    except ValueError:
        return None, False, True


def parse_quantity(text):
    """Cantidad sugerida: '1/4' → 0.25 · '1 1/2' → 1.5 · '18' → 18."""
    raw = text.replace(',', '.').strip()
    raw = re.sub(r'[^0-9/. ]', '', raw).strip()
    # "2 1/2" suele leerse pegado ("21/2"): entero + fracción de un dígito sobre un dígito.
    glued = re.fullmatch(r'(\d+)\s*(\d)\s*/\s*(\d)', raw)
    if glued and int(glued.group(3)) and int(glued.group(2)) < int(glued.group(3)):
        return round(int(glued.group(1)) + int(glued.group(2)) / int(glued.group(3)), 4)
    match = re.fullmatch(r'(?:(\d+(?:\.\d+)?)\s+)?(\d+)\s*/\s*(\d+)', raw)
    if match and int(match.group(3)):
        return round((float(match.group(1) or 0)) + int(match.group(2)) / int(match.group(3)), 4)
    match = re.fullmatch(r'\d+(?:\.\d+)?', raw)
    return float(raw) if match else None


def clean_text(text):
    text = re.sub(r'[|_~`]+', ' ', text.replace('\n', ' '))
    return re.sub(r'\s+', ' ', text).strip(' .-')


def process_page(args):
    pdf, page, work_root = args
    work = tempfile.mkdtemp(prefix=f'p{page:03d}-', dir=work_root)
    try:
        prefix = os.path.join(work, 'page')
        subprocess.run(['pdftoppm', '-r', str(DPI), '-f', str(page), '-l', str(page), '-gray', '-png', '-singlefile', pdf, prefix], check=True)
        gray = np.array(Image.open(prefix + '.png').convert('L'))
        table = find_table(gray)
        if table is None:
            return {'page': page, 'kind': 'other', 'rows': []}
        # Hoja inclinada: se endereza la imagen (hasta medio grado en este escaneo) para que las
        # columnas queden verticales y los renglones horizontales antes de recortar celdas.
        if isinstance(table, dict) and abs(table['skew']) > 0.6:
            source = Image.fromarray(gray)
            best = (abs(table['skew']), gray, table)
            for sign in (1, -1):
                angle = sign * float(np.degrees(np.arctan(table['skew'] / 1000)))
                turned = np.array(source.rotate(angle, resample=Image.BICUBIC, fillcolor=255))
                candidate = find_table(turned)
                if isinstance(candidate, dict) and abs(candidate['skew']) < best[0]:
                    best = (abs(candidate['skew']), turned, candidate)
            _, gray, table = best
        if not isinstance(table, dict):
            return {'page': page, 'kind': 'table-unreadable', 'reason': f'la plantilla de columnas no ajusta (coincidencia {table[1]})', 'rows': []}
        header_top, body_top, body_bottom = table['header_top'], table['body_top'], table['body_bottom']
        rows = find_rows(gray, table)
        if not rows:
            return {'page': page, 'kind': 'table-empty', 'rows': []}
        # Título de la hoja (grupo y subgrupo): la franja sobre el encabezado.
        title_image = crop(gray, int(gray.shape[1] * 0.2), int(gray.shape[1] * 0.8), max(0, header_top - 330), header_top - 12, scale=1)
        title = clean_text(ocr_batch([title_image], work, 'title', 'spa', 6)[0]).lower()

        centers = [(top + bottom) / 2 for top, bottom in rows]
        # El nombre puede ocupar dos o tres renglones de texto, centrados en el renglón del número.
        # Se localizan los renglones de texto de la columna del nombre y cada uno se asigna al
        # renglón de números más cercano: así la cola de un nombre largo no se cuela en el siguiente.
        first_lines = table['lines_at']((body_top + body_bottom) / 2)
        name_ink = (gray[body_top:body_bottom, max(0, first_lines[0] - NAME_WIDTH):first_lines[0] - 6] < INK).sum(axis=1)
        text_lines = [(a + body_top, b + body_top) for a, b in runs(np.nonzero(name_ink > 2)[0], gap=2) if b - a >= 8]
        name_spans = [[top - 4, bottom + 4] for top, bottom in rows]
        for a, b in text_lines:
            middle = (a + b) / 2
            nearest = min(range(len(rows)), key=lambda i: abs(centers[i] - middle))
            if abs(centers[nearest] - middle) < 110:
                name_spans[nearest][0] = min(name_spans[nearest][0], a - 5)
                name_spans[nearest][1] = max(name_spans[nearest][1], b + 5)
        name_spans = [(int(max(body_top, upper)), int(min(body_bottom, lower))) for upper, lower in name_spans]
        numeric, numeric_second, quantities, units, names = [], [], [], [], []
        for index, (top, bottom) in enumerate(rows):
            y0, y1 = top - 7, bottom + 8
            lines = table['lines_at']((top + bottom) / 2)
            for column in range(len(NUMERIC_COLUMNS)):
                numeric.append(crop(gray, lines[2 + column] + 5, lines[3 + column] - 4, y0, y1))
                numeric_second.append(crop(gray, lines[2 + column] + 5, lines[3 + column] - 4, y0, y1, scale=3, pad=20, binarize=True))
            quantities.append(crop(gray, lines[0] + 5, lines[1] - 4, y0, y1))
            units.append(crop(gray, lines[1] + 5, lines[2] - 4, y0, y1))
            upper, lower = name_spans[index]
            names.append(crop(gray, max(0, lines[0] - NAME_WIDTH), lines[0] - 4, upper, lower, scale=2))
        numeric_text = ocr_batch(numeric, work, 'num', 'eng', 7, '0123456789.ND')
        # Cada número se lee dos veces con preparación distinta; si las lecturas no coinciden, la
        # celda queda marcada para conciliarla después (ver reconcile.py).
        second_text = ocr_batch(numeric_second, work, 'num2', 'eng', 8, '0123456789.ND')
        quantity_text = ocr_batch(quantities, work, 'qty', 'eng', 7, '0123456789/ .')
        unit_text = ocr_batch(units, work, 'unit', 'spa', 7)
        name_text = ocr_batch(names, work, 'name', 'spa', 6)

        result = []
        for index in range(len(rows)):
            row = {'page': page, 'row': index + 1, 'name': clean_text(name_text[index]), 'qtyText': quantity_text[index], 'qty': parse_quantity(quantity_text[index]), 'unit': clean_text(unit_text[index]).lower(), 'nd': [], 'doubt': [], 'raw': {}, 'alt': {}, 'altNd': [], 'altValue': []}
            for column, (key, decimals) in enumerate(NUMERIC_COLUMNS):
                text = numeric_text[index * len(NUMERIC_COLUMNS) + column]
                value, nd, doubtful = parse_number(text, decimals)
                other, other_nd, _ = parse_number(second_text[index * len(NUMERIC_COLUMNS) + column], decimals)
                row[key] = value
                row['raw'][key] = text
                if other != value or other_nd != nd:
                    row['alt'][key] = None if other_nd else other
                    row['altNd' if other_nd else 'altValue'].append(key)
                    doubtful = True
                if nd:
                    row['nd'].append(key)
                if doubtful:
                    row['doubt'].append(key)
            if row['qty'] is None:
                row['doubt'].append('qty')
            result.append(row)
        return {'page': page, 'kind': 'table', 'title': title, 'fit': table['score'], 'skew': table['skew'], 'rows': result}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def parse_pages(spec, total):
    pages = set()
    for part in spec.split(','):
        if '-' in part:
            a, b = part.split('-')
            pages.update(range(int(a), int(b) + 1))
        else:
            pages.add(int(part))
    return sorted(p for p in pages if 1 <= p <= total)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pdf')
    parser.add_argument('output')
    parser.add_argument('--pages', default=None)
    parser.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2) - 2))
    parser.add_argument('--work', default=None)
    options = parser.parse_args()
    info = subprocess.run(['pdfinfo', options.pdf], capture_output=True, text=True).stdout
    total = int(re.search(r'Pages:\s+(\d+)', info).group(1))
    pages = parse_pages(options.pages, total) if options.pages else list(range(1, total + 1))
    work_root = options.work or tempfile.mkdtemp(prefix='smae-')
    os.makedirs(work_root, exist_ok=True)
    with ProcessPoolExecutor(max_workers=options.jobs) as pool:
        results = list(pool.map(process_page, [(options.pdf, page, work_root) for page in pages]))
    with open(options.output, 'w') as handle:
        json.dump({'source': os.path.basename(options.pdf), 'dpi': DPI, 'pages': results}, handle, ensure_ascii=False, indent=1)
    tables = [r for r in results if r['kind'] == 'table']
    print(f"{len(pages)} hojas · {len(tables)} tablas · {sum(len(r['rows']) for r in tables)} renglones · "
          f"ilegibles: {[r['page'] for r in results if r['kind'] not in ('table', 'other')]}", file=sys.stderr)


if __name__ == '__main__':
    main()
