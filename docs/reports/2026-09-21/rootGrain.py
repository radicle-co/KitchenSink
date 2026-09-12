"""Root fan-out and energy spread at the RAW FoodOn-label grain (the owner's ruling).

⛔ DISTINCT FROM `displayLabelComposition.py`, AND THE DIFFERENCE IS THE WHOLE POINT. That script
groups by a COMPOSED label (FoodOn head + protected USDA tail). Under the owner's ruling the
protected tail is what a SPECIALIZATION row carries, so composing it into the root states it twice.
The root grain is therefore the RAW FoodOn label, and every fan-out figure moves.
"""

import csv
import statistics
from collections import defaultdict

SR = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}

desc, kcal = {}, {}
for r in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
    d = (r.get('description') or '').strip()
    if d:
        desc[r['fdc_id']] = d
for r in csv.DictReader(open(SR + 'food_nutrient.csv', encoding='utf-8', errors='replace')):
    if r['nutrient_id'] == '1008':
        try:
            kcal[r['fdc_id']] = float(r['amount'])
        except ValueError:
            pass

foodon = {}
for r in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
    name = (r.get('name') or '').strip()
    value = (r.get('value') or '').strip()
    if name in FOODON_ATTRS and value:
        if r['fdc_id'] not in foodon or name.endswith('#1 For FDC Item'):
            foodon[r['fdc_id']] = value

roots = defaultdict(list)
for fdc_id, label in foodon.items():
    if fdc_id in desc:
        roots[label.strip().lower()].append(fdc_id)

multi = {k: v for k, v in roots.items() if len(v) > 1}
print(f'covered SR Legacy foods        : {sum(len(v) for v in roots.values()):>6}')
print(f'ROOTS at raw FoodOn-label grain: {len(roots):>6}')
print(f'  naming exactly one food      : {len(roots) - len(multi):>6}'
      f'  ({(len(roots)-len(multi))/len(roots):.0%})')
print(f'  multi-member roots           : {len(multi):>6}')
print(f'  foods inside a multi root    : {sum(len(v) for v in multi.values()):>6}'
      f'  ({sum(len(v) for v in multi.values())/sum(len(v) for v in roots.values()):.0%})')
print('\nwidest roots:')
for label, members in sorted(roots.items(), key=lambda kv: -len(kv[1]))[:6]:
    print(f'  n={len(members):<4} {label[:52]}')

spreads = []
for label, members in multi.items():
    vals = [kcal[i] for i in members if i in kcal]
    if len(vals) > 1 and sum(vals) > 0:
        mean = sum(vals) / len(vals)
        spreads.append(((max(vals) - min(vals)) / mean if mean else 0, label, len(vals), min(vals), max(vals)))
over = [s for s in spreads if s[0] >= 0.10]
print(f'\nmulti-member roots with 2+ measurable energies : {len(spreads):>5}')
print(f'  ... min-to-max spread >= 10%                 : {len(over):>5}  ({len(over)/max(len(spreads),1):.0%})')
for s, label, n, lo, hi in sorted(spreads, reverse=True)[:5]:
    print(f'  {s:7.1%}  n={n:<4} {label[:38]:<40} {lo:.0f}-{hi:.0f} kcal')

# Election-rule comparison: worst-member relative error a cook suffers taking the default.
def errors(pick):
    out = []
    for label, members in multi.items():
        vals = {i: kcal[i] for i in members if i in kcal}
        if len(vals) < 2:
            continue
        chosen = pick(vals)
        for i, v in vals.items():
            if i != chosen and vals[chosen] > 0:
                out.append(abs(v - vals[chosen]) / vals[chosen])
    return sorted(out)

for name, pick in [('lowest fdc_id', lambda v: min(v)),
                   ('median energy', lambda v: sorted(v, key=lambda i: v[i])[len(v) // 2])]:
    e = errors(pick)
    if e:
        print(f'\n  election "{name}": median {statistics.median(e):.1%}  '
              f'p90 {e[int(len(e)*0.9)]:.1%}  max {max(e):.0%}')
