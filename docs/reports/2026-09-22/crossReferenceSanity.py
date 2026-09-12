"""How often does USDA's own FoodOn cross-reference name a different food than the USDA row describes?

Found by example: fdc 169099 `Orange juice, canned, unsweetened` carries `FoodOn Ontology Name #1 For FDC Item =
olives (canned)`, while the same row's `Scientific Name` is `Citrus sinensis` (orange). So the cross-reference is
not trustworthy as-is. This counts mappings where the FoodOn label and the USDA description share no content word,
ignoring generic words and plural endings, and lists them for review.
"""

import csv
import re

SANDBOX = '/home/brandon/Development/KitchenSink/.local-sandbox/'
SR = SANDBOX + 'fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = SANDBOX + 'fdc/FoodData_Central_csv_2026-04-30/'
GENERIC = {'raw', 'cooked', 'canned', 'frozen', 'dried', 'fresh', 'food', 'product', 'products', 'meat', 'piece',
           'of', 'and', 'or', 'with', 'without', 'the', 'a', 'in', 'whole', 'plain', 'dish', 'beverage', 'beverages',
           'sauce', 'juice', 'oil', 'cured', 'ground', 'boneless', 'skinless', 'sliced'}


def singular(w):
    """A small English singular rule; enough to stop plurals reading as a mismatch. Pure."""
    if len(w) <= 3:
        return w
    for suffix, repl in (('ies', 'y'), ('oes', 'o'), ('ches', 'ch'), ('shes', 'sh'), ('xes', 'x'), ('sses', 'ss')):
        if w.endswith(suffix):
            return w[: -len(suffix)] + repl
    return w[:-1] if w.endswith('s') and not w.endswith('ss') else w


def content(text):
    out = set()
    for w in re.findall(r'[a-z]+', text.lower()):
        if w in GENERIC:
            continue
        out.add(singular(w))
    return out


desc = {r['fdc_id']: r['description'] for r in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace'))}
foodon, sci = {}, {}
for r in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
    name, value = (r.get('name') or '').strip(), (r.get('value') or '').strip()
    if r['fdc_id'] not in desc or not value:
        continue
    if name == 'FoodOn Ontology Name #1 For FDC Item' or (name.startswith('FoodOn Ontology Name') and r['fdc_id'] not in foodon):
        foodon[r['fdc_id']] = value
    if name == 'Scientific Name':
        sci[r['fdc_id']] = value

suspects = [(i, foodon[i]) for i in foodon if not (content(foodon[i]) & content(desc[i]))]
print(f'SR Legacy rows with a USDA FoodOn term : {len(foodon)}')
print(f'  ... sharing NO content word          : {len(suspects)}  ({len(suspects) / len(foodon):.1%})')
print('\nevery suspect (FoodOn term  <-  USDA description  [scientific name]):')
for fdc_id, term in sorted(suspects, key=lambda s: s[1]):
    print(f'  {term[:34]:<36} <- {desc[fdc_id][:58]:<60} [{sci.get(fdc_id, "")}]')
