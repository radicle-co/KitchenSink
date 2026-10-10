"""Are the names produced by splitting a root on calorie spread friendly to a cook?

The owner asked this directly: splitting on calorie spread was proposed to reduce disclosure, but the
purpose of the FoodOn work is short, human names. This script builds the split names the same way
`rootSplit.py` splits the groups, then measures their length and shows the most-used examples.
"""

import csv
import statistics
from collections import defaultdict

SR = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}
THRESHOLD = 0.10

desc, kcal, foodon = {}, {}, {}
for row in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
    if (row.get('description') or '').strip():
        desc[row['fdc_id']] = row['description'].strip()
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
    values = [kcal[i] for i in ids]
    mean = sum(values) / len(values)
    return (max(values) - min(values)) / mean if mean else 0.0


def qualifiers(fdc_id):
    return {s.strip().lower() for s in desc[fdc_id].split(',')[1:] if s.strip()}


def split(ids, depth=0):
    if len(ids) < 2 or spread(ids) < THRESHOLD or depth >= 2:
        return [ids]
    best = None
    for token in set().union(*(qualifiers(i) for i in ids)):
        has = [i for i in ids if token in qualifiers(i)]
        lacks = [i for i in ids if token not in qualifiers(i)]
        if has and lacks:
            score = max(spread(has), spread(lacks))
            if best is None or score < best[0]:
                best = (score, has, lacks)
    if best is None:
        return [ids]
    return split(best[1], depth + 1) + split(best[2], depth + 1)


def split_name(label, part):
    common = sorted(set.intersection(*(qualifiers(i) for i in part)))[:2]
    return label + (', ' + ', '.join(common) if common else '')


names, examples = [], []
for label, members in sorted(roots.items(), key=lambda kv: -len(kv[1])):
    parts = split(members)
    if len(parts) == 1:
        names.append(label)
        continue
    for part in parts:
        names.append(split_name(label, part))
        if len(examples) < 12:
            examples.append(split_name(label, part))

lengths = sorted(len(n) for n in names)
long_or_paren = sum(1 for n in names if len(n) > 40)
print(f'names after splitting : {len(names)}')
print(f'median length         : {statistics.median(lengths):.0f} characters (bare roots: 19)')
print(f'p90 length            : {lengths[int(len(lengths) * 0.9)]} characters')
print(f'longer than 40        : {long_or_paren} ({long_or_paren / len(names):.0%})')
print('\nsplit names on the largest roots:')
for name in examples:
    print(f'  {name[:88]}')
