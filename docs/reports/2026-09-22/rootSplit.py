"""How much machinery does "split a root whose calories spread too far" actually need?

⛔ ANSWER: ONE RULE, NO CLASSIFIER. This file exists because the obvious design was to reuse the
PROTECTED-QUALIFIER class (877 tokens, derived by sibling-pair energy analysis in
`docs/reports/2026-09-21/displayLabelComposition.py`) to decide which word to add back when a root
splits. That is a GLOBAL question — "which words matter across the whole catalog?" — and it needs a
vocabulary that must be derived, stored, versioned and kept true.

Splitting does not need it, because splitting asks a LOCAL question: "which word separates THIS
group?" The rule below is the whole mechanism:

    if a group's energy spread >= threshold:
        try every segment that some members have and others lack
        keep the partition that minimises the WORST resulting spread
        recurse, at most twice

No token vocabulary, no global preprocessing, no per-food rules. It runs offline over ~8,262 rows
once per USDA release (twice a year), which is seconds.

⚠️ It does not solve everything, and the residue is the point: what it cannot resolve is a SMALL,
enumerable curation list rather than a large one.
"""

import csv
from collections import defaultdict

SR = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}
THRESHOLD = 0.10
MAX_DEPTH = 2

desc, kcal, foodon = {}, {}, {}
for row in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
    text = (row.get('description') or '').strip()
    if text:
        desc[row['fdc_id']] = text
for row in csv.DictReader(open(SR + 'food_nutrient.csv', encoding='utf-8', errors='replace')):
    if row['nutrient_id'] == '1008':
        try:
            kcal[row['fdc_id']] = float(row['amount'])
        except ValueError:
            pass
for row in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
    name, value = (row.get('name') or '').strip(), (row.get('value') or '').strip()
    if name in FOODON_ATTRS and value and (row['fdc_id'] not in foodon or name.endswith('#1 For FDC Item')):
        foodon[row['fdc_id']] = value

roots = defaultdict(list)
for fdc_id, label in foodon.items():
    if fdc_id in desc and fdc_id in kcal:
        roots[label.strip().lower()].append(fdc_id)


def spread(ids):
    """(max - min) / mean over kcal/100 g. Pure."""
    values = [kcal[i] for i in ids]
    mean = sum(values) / len(values)
    return (max(values) - min(values)) / mean if mean else 0.0


def qualifiers(fdc_id):
    """The description's comma segments after the head noun. Pure."""
    return {s.strip().lower() for s in desc[fdc_id].split(',')[1:] if s.strip()}


def split(ids, depth=0):
    """Partition until every part is tight, or we run out of depth. Pure. ⛔ THE WHOLE RULE."""
    if len(ids) < 2 or spread(ids) < THRESHOLD or depth >= MAX_DEPTH:
        return [ids]
    best = None
    for token in set().union(*(qualifiers(i) for i in ids)):
        has = [i for i in ids if token in qualifiers(i)]
        lacks = [i for i in ids if token not in qualifiers(i)]
        if not has or not lacks:
            continue
        score = max(spread(has), spread(lacks))
        if best is None or score < best[0]:
            best = (score, token, has, lacks)
    if best is None:
        return [ids]
    return split(best[2], depth + 1) + split(best[3], depth + 1)


multi = {k: v for k, v in roots.items() if len(v) > 1}
needs = {k: v for k, v in multi.items() if spread(v) >= THRESHOLD}

parts_total, resolved, residue = 0, 0, []
for label, members in needs.items():
    parts = split(members)
    parts_total += len(parts)
    if all(spread(p) < THRESHOLD or len(p) < 2 for p in parts):
        resolved += 1
    else:
        residue.append((max(spread(p) for p in parts if len(p) > 1), label, len(members)))

print(f'roots (raw FoodOn label)            : {len(roots)}')
print(f'  multi-member                      : {len(multi)}')
print(f'  needing a split (spread >= {THRESHOLD:.0%})  : {len(needs)}')
print()
print(f'after a depth<={MAX_DEPTH} local split:')
print(f'  ⛔ groups fully resolved           : {resolved}  ({resolved / len(needs):.0%})')
print(f'  ⛔ residue -> THE CURATION LIST    : {len(residue)}')
print(f'  roots after splitting             : {len(roots) - len(needs) + parts_total}  (was {len(roots)})')
print()
print('  the 10 worst unresolved (this is the whole human backlog):')
for worst, label, n in sorted(residue, reverse=True)[:10]:
    print(f'    {worst:7.0%}  n={n:<4} {label[:48]}')
