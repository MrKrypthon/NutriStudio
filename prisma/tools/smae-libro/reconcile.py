#!/usr/bin/env python3
"""Concilia la lectura del libro (extract.py) y produce el catálogo final con sus dudas marcadas.

Un reconocimiento óptico nunca es perfecto (en pruebas falla ~1 % de las celdas: un 5 leído como 9,
un punto decimal de más). Para no dar por bueno un número mal leído, cada celda tiene hasta tres
testigos:

  A  primera lectura del libro
  B  segunda lectura, con otra preparación de la imagen
  C  el catálogo que ya tiene la app (prisma/data/smae.json, transcrito a mano del mismo sistema)

y se decide así:

  · A = B              → se toma. Si además hay C y difiere, la celda queda como "difiere del
                         catálogo" (el libro manda, pero conviene verla: o el catálogo traía un
                         error de captura, o las dos lecturas fallaron igual).
  · A ≠ B, C = alguna  → se toma la que coincide con C (dos de tres).
  · A ≠ B, sin C igual → se toma A y la celda queda "por revisar".

Además se revisa que la energía cuadre con los macronutrimentos (4·P + 9·L + 4·HC + 7·etanol).

"ND" (no determinado) del libro se guarda como null con su marca; el catálogo anterior lo tenía
como 0, así que un ND contra un 0 no cuenta como diferencia.

Uso:
  python3 prisma/tools/smae-libro/reconcile.py <raw.json> <smae.json> <salida.json> [--report r.md]
"""
import argparse
import difflib
import json
import re
import unicodedata
from collections import Counter, defaultdict

NUMERIC = ['grossWeight', 'netWeight', 'kcal', 'protein', 'fat', 'carbs', 'satFat', 'monoFat', 'polyFat', 'cholesterol',
           'sugar', 'fiber', 'vitA', 'vitC', 'folicAcid', 'calcium', 'iron', 'potassium', 'sodium', 'phosphorus', 'ethanol', 'gi', 'gl']

# Título impreso en la hoja → grupo, con los mismos nombres que usa el catálogo de Ingredientes.
GROUP_RULES = [
    (r'verdura', None, 'Verduras'),
    (r'fruta', None, 'Frutas'),
    (r'cereal', r'con\s+grasa', 'Cereales C/G'),
    (r'cereal', None, 'Cereales S/G'),
    (r'leguminosa', None, 'Leguminosas'),
    (r'animal', r'muy\s+bajo', 'AOA MBAG'),
    (r'animal', r'moderado', 'AOA MAG'),
    (r'animal', r'alto', 'AOA AAG'),
    (r'animal', r'bajo', 'AOA BAG'),
    (r'leche', r'semi', 'Leche semidescremada'),
    (r'leche', r'descremada', 'Leche descremada'),
    (r'leche', r'az[uú]car', 'Leche con azúcar'),
    (r'leche', r'entera', 'Leche entera'),
    (r'grasa|aceite', r'con\s+prote', 'Grasas con proteínas'),
    (r'grasa|aceite', r'sin\s+prote', 'Grasas sin proteínas'),
    (r'az[uú]car', r'con\s+grasa', 'Azucares con grasa'),
    (r'az[uú]car', r'sin\s+grasa', 'Azucares sin grasa'),
    (r'libres', None, 'Libres en energía'),
    (r'alcoh', None, 'Alcohol'),
]


def fold(text):
    text = unicodedata.normalize('NFD', str(text or '').lower())
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z0-9 ]+', ' ', text).strip()


def group_from_title(title):
    folded = unicodedata.normalize('NFC', title or '').lower()
    for main, sub, group in GROUP_RULES:
        if re.search(main, folded) and (sub is None or re.search(sub, folded)):
            return group
    return None


def same(a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) < 0.051


def match_catalog(row, candidates):
    """Mejor renglón del catálogo para un renglón del libro: por nombre y por sus números."""
    name = fold(row['name'])
    best, best_score = None, 0.0
    for candidate in candidates:
        ratio = difflib.SequenceMatcher(None, name, candidate['_fold']).ratio()
        if ratio < 0.55:
            continue
        agree = sum(1 for key in NUMERIC if row.get(key) is not None and same(row[key], candidate.get(key)))
        known = sum(1 for key in NUMERIC if row.get(key) is not None) or 1
        score = ratio * 0.6 + (agree / known) * 0.4
        if score > best_score:
            best, best_score = candidate, score
    return (best, best_score) if best_score >= 0.62 else (None, best_score)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('raw')
    parser.add_argument('catalog')
    parser.add_argument('output')
    parser.add_argument('--report')
    options = parser.parse_args()

    raw = json.load(open(options.raw))
    catalog = json.load(open(options.catalog))
    for item in catalog:
        item['_fold'] = fold(item['name'])
    by_category = defaultdict(list)
    for item in catalog:
        by_category[item['category']].append(item)

    foods, stats, used = [], Counter(), set()
    last_group = None
    unreadable = [page['page'] for page in raw['pages'] if page['kind'] not in ('table', 'other')]
    for page in raw['pages']:
        if page['kind'] != 'table':
            continue
        title_group = group_from_title(page.get('title'))
        # El grupo también se puede deducir de con qué parte del catálogo casan los renglones: sirve
        # de respaldo cuando el título no se leyó bien.
        votes = Counter()
        for row in page['rows']:
            match, _ = match_catalog(row, catalog)
            if match:
                votes[match['category']] += 1
        voted = votes.most_common(1)[0][0] if votes and votes.most_common(1)[0][1] >= max(2, len(page['rows']) * 0.4) else None
        group = voted or title_group or last_group or 'Sin grupo'
        if title_group and voted and title_group != voted:
            stats['hojas con título y contenido en desacuerdo'] += 1
        last_group = group

        for row in page['rows']:
            # Mota o pie de tabla tomado por renglón: sin nombre legible y sin un solo número.
            if sum(ch.isalpha() for ch in row['name']) < 3 and all(row.get(key) is None for key in NUMERIC):
                stats['renglones descartados (no eran alimentos)'] += 1
                continue
            candidates = [item for item in by_category.get(group, []) if id(item) not in used] or by_category.get(group, [])
            match, score = match_catalog(row, candidates)
            if match:
                used.add(id(match))
            food = {'page': row['page'], 'row': row['row'], 'group': group, 'name': row['name'], 'qtyText': row['qtyText'], 'qty': row['qty'], 'unit': row['unit'],
                    'nutrients': {}, 'nd': [], 'review': {}, 'catalogName': match['name'] if match else None}
            stats['renglones'] += 1
            if not match:
                stats['renglones sin par en el catálogo'] += 1
            # Nombre: la lectura del libro puede traer una letra mal; si casa de cerca con el catálogo
            # se usa la grafía del catálogo y se guarda la leída.
            if match and difflib.SequenceMatcher(None, fold(row['name']), match['_fold']).ratio() >= 0.8:
                if row['name'] != match['name']:
                    food['nameRead'] = row['name']
                food['name'] = match['name']
            elif not row['name'] or len(row['name']) < 3:
                food['review']['name'] = {'reason': 'ilegible', 'read': row['name']}
            elif not match and row['name'][:1].islower():
                # Sin par en el catálogo y empezando en minúscula: suele traer pegada la cola del
                # nombre del renglón de arriba.
                food['review']['name'] = {'reason': 'nombre dudoso', 'read': row['name']}
            if match and match.get('unit') and fold(row['unit']) != fold(match['unit']):
                if difflib.SequenceMatcher(None, fold(row['unit']), fold(match['unit'])).ratio() >= 0.6:
                    food['unit'] = match['unit']
                else:
                    food['review']['unit'] = {'reason': 'difiere del catálogo', 'read': row['unit'], 'catalog': match['unit']}
            if row['qty'] is None:
                if match and match.get('qty') is not None:
                    food['qty'] = match['qty']
                else:
                    food['review']['qty'] = {'reason': 'ilegible', 'read': row['qtyText']}
            elif match and match.get('qty') is not None and not same(row['qty'], match['qty']):
                # El catálogo guarda fracciones redondeadas (1/3 → 0.33): eso no es una diferencia.
                if abs(row['qty'] - match['qty']) > 0.02:
                    food['review']['qty'] = {'reason': 'difiere del catálogo', 'read': row['qty'], 'catalog': match['qty']}

            for key in NUMERIC:
                first = row.get(key)
                first_nd = key in row['nd']
                has_alt = key in row['alt']
                second = row['alt'][key] if has_alt else first
                second_nd = (key in row['altNd']) if has_alt else first_nd
                known = match is not None and match.get(key) is not None
                cat = match.get(key) if known else None
                # ND del libro ≡ 0 del catálogo anterior.
                agrees = lambda value, nd: known and (same(value, cat) or (nd and same(cat, 0.0)))
                stats['celdas'] += 1
                if not has_alt:
                    value, nd = first, first_nd
                    # Celda en blanco en las dos lecturas y sin dato (o 0) en el catálogo: el libro
                    # la dejó vacía. Se trata como "ND".
                    if value is None and not nd and not str(row['raw'].get(key) or '').strip() and (not known or same(cat, 0.0)):
                        nd = True
                        stats['celdas en blanco en el libro (→ ND)'] += 1
                    elif value is None and not nd:
                        food['review'][key] = {'reason': 'ilegible', 'read': row['raw'].get(key), 'catalog': cat}
                        stats['celdas ilegibles'] += 1
                    elif known and not agrees(value, nd):
                        food['review'][key] = {'reason': 'difiere del catálogo', 'catalog': cat}
                        stats['celdas que difieren del catálogo'] += 1
                    else:
                        stats['celdas confirmadas'] += 1
                elif agrees(first, first_nd):
                    value, nd = first, first_nd
                    stats['celdas resueltas 2 de 3'] += 1
                elif agrees(second, second_nd):
                    value, nd = second, second_nd
                    stats['celdas resueltas 2 de 3'] += 1
                else:
                    value, nd = first, first_nd
                    food['review'][key] = {'reason': 'lecturas distintas', 'alt': None if second_nd else second, 'catalog': cat}
                    stats['celdas por revisar (lecturas distintas)'] += 1
                food['nutrients'][key] = value
                if nd:
                    food['nd'].append(key)

            n = food['nutrients']
            if all(n.get(key) is not None for key in ('kcal', 'protein', 'fat', 'carbs')):
                expected = 4 * n['protein'] + 9 * n['fat'] + 4 * n['carbs'] + 7 * (n.get('ethanol') or 0)
                if abs(expected - n['kcal']) > max(18, 0.25 * max(expected, n['kcal'])):
                    food['review'].setdefault('kcal', {'reason': 'no cuadra con los macros', 'expected': round(expected)})
                    stats['renglones cuya energía no cuadra'] += 1
            if food['review']:
                stats['renglones con algo por revisar'] += 1
            foods.append(food)

    missing = [item for item in catalog if id(item) not in used]
    summary = {'source': raw.get('source'), 'edition': '5', 'foods': len(foods), 'stats': dict(stats), 'unreadablePages': unreadable,
               'groups': dict(Counter(food['group'] for food in foods)), 'catalogRowsNotFoundInBook': len(missing)}
    with open(options.output, 'w') as handle:
        json.dump({'summary': summary, 'foods': foods}, handle, ensure_ascii=False, indent=1)
    if options.report:
        with open(options.report, 'w') as handle:
            handle.write('# Extracción del SMAE 5ª ed.\n\n')
            for key, value in summary['stats'].items():
                handle.write(f'- {key}: {value}\n')
            handle.write(f"- hojas de tabla ilegibles: {unreadable}\n- renglones del catálogo no hallados en el libro: {len(missing)}\n\n## Por grupo\n\n")
            for group, count in sorted(summary['groups'].items()):
                handle.write(f'- {group}: {count}\n')
            handle.write('\n## Catálogo sin par en el libro (primeros 80)\n\n')
            for item in missing[:80]:
                handle.write(f"- {item['category']} · {item['name']}\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
