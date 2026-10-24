"""Examples of roots and their kinds, as the catalog would show them today, for the naming review.

Roots are FoodOn labels (bare roots, owner ruling 2026-09-22). A kind's label is its source description with
the root's words removed, segment by segment, keeping the source's order and dropping empty segments (R55's
strip rule). Kinds are listed by calories per 100 g, the picker's order. `*` marks the default kind (a plain
member if one exists, else the most eaten, else the middle calorie value). The second section lists the
most-eaten foods with NO FoodOn term, whose root name is the source description itself.
"""

import csv
import re
import sys
from collections import defaultdict

sys.path.insert(0, '/home/brandon/Development/KitchenSink/docs/reports/2026-09-22')
from specializationDisclosurePopulation import load_weights  # noqa: E402

SANDBOX = '/home/brandon/Development/KitchenSink/.local-sandbox/'
SR = SANDBOX + 'fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = SANDBOX + 'fdc/FoodData_Central_csv_2026-04-30/'
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}
ROOTS_SHOWN, KINDS_SHOWN, UNNAMED_SHOWN = 36, 5, 12


def words(text):
    return re.findall(r'[a-z0-9]+', text.lower())


def kind_label(description, root):
    root_words = set(words(root))
    kept = []
    for segment in description.split(','):
        remaining = [w for w in re.findall(r'[A-Za-z0-9][A-Za-z0-9%/\'-]*', segment) if w.lower() not in root_words]
        if [w for w in remaining if re.search(r'[a-z0-9]', w.lower())]:
            kept.append(' '.join(remaining).lower())
    return ', '.join(kept)


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

weight = load_weights()
groups = defaultdict(list)
for fdc_id, label in foodon.items():
    if fdc_id in desc and fdc_id in kcal:
        groups[label.strip()].append(fdc_id)


def default_of(root, members):
    plain = [m for m in members if not kind_label(desc[m], root)]
    if plain:
        return plain[0]
    eaten = [m for m in members if weight.get(m, 0) > 0]
    if eaten:
        return max(eaten, key=lambda m: (weight[m], -int(m)))
    return sorted(members, key=lambda m: (kcal[m], int(m)))[len(members) // 2]


grouped = [(sum(weight.get(m, 0) for m in ms), root, ms) for root, ms in groups.items() if len(ms) > 1]
grouped.sort(reverse=True)
print(f'ROOTS WITH KINDS: the {ROOTS_SHOWN} most eaten, kinds by calories per 100 g, * = default\n')
for _, root, members in grouped[:ROOTS_SHOWN]:
    d = default_of(root, members)
    print(f'{root}   ({len(members)} kinds)')
    ordered = sorted(members, key=lambda m: (kcal[m], int(m)))
    for m in ordered[:KINDS_SHOWN]:
        label = kind_label(desc[m], root) or '(same as the root)'
        print(f'  {"*" if m == d else " "} {kcal[m]:>4.0f}  {label}')
    if len(ordered) > KINDS_SHOWN:
        print(f'         (+{len(ordered) - KINDS_SHOWN} more)')
    print()

unnamed = sorted((weight.get(i, 0), i) for i in desc if i not in foodon)
print(f'ROOTS WITH NO FoodOn TERM: the {UNNAMED_SHOWN} most eaten; the root name is the source description\n')
for _, fdc_id in list(reversed(unnamed))[:UNNAMED_SHOWN]:
    print(f'  {desc[fdc_id]}')
