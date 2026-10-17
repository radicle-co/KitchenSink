"""Can FoodOn's OWN hierarchy replace a hand-rolled split rule for over-coarse roots?

⛔ THE QUESTION. `rootSplit.py` shows 74 roots resist an automatic energy-spread split, led by
`ham (cured)` at n=90. Rather than invent a splitting rule, ask whether FoodOn already names the
finer level — FoodOn deciding its own granularity beats us imposing one.

Source: `foodon-synonyms.tsv` from the FoodOn repo (10,089,343 bytes,
sha256 1900fb2c80d834287cfdd0b52a98957b18269e86c197617711bc3a5d8541deb2). Columns are
`?class ?parent ?type ?label`; a row with an EMPTY type states a parent edge, otherwise it states a
label or a synonym.

⚠️ TWO SEPARATE QUESTIONS, and only the first is answered here:
  (a) does FoodOn have children under the over-coarse roots?        <- this script
  (b) could USDA's members be ASSIGNED to those children?           <- a matching problem, unsolved
If (a) is no, (b) is moot and the idea dies cheaply.
"""

import csv
import sys
from collections import defaultdict

TSV = sys.argv[1] if len(sys.argv) > 1 else '/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodonSynonyms.tsv'

# Roots that `rootSplit.py` could not resolve, with their USDA member counts.
PROBLEM_ROOTS = [
    ('ham (cured)', 90), ('beef (ground)', 36), ('potato (french-fried)', 17),
    ('beef strip steak (boneless, raw)', 17), ('beef small end rib roast (raw)', 13),
    ('turkey meat (ground)', 10), ('beef (ground, raw)', 9), ('sweet red bell pepper', 7),
]


def strip(value):
    """`<iri>`, `"text"` or `text@en` -> bare string. Pure.

    ⚠️ The reader below uses `QUOTE_NONE`. With Python's default quoting, `csv` consumes the TSV's
    own double quotes as CSV quoting and hands back `ham (cured)@en` — a label that matches nothing
    and reports every lookup as NOT FOUND. The quotes are DATA here, not framing.
    """
    value = value.strip()
    if value.startswith('<') and value.endswith('>'):
        return value[1:-1]
    if value.startswith('"'):
        end = value.rfind('"')
        value = value[1:end] if end > 0 else value[1:]
    if value.endswith('@en'):
        value = value[:-3]
    return value.strip('"')


label_of, children, synonyms = {}, defaultdict(set), defaultdict(list)
with open(TSV, encoding='utf-8', errors='replace') as handle:
    for row in csv.reader(handle, delimiter='\t', quoting=csv.QUOTE_NONE):
        if len(row) < 4 or row[0].startswith('?'):
            continue
        cls, parent, kind, text = strip(row[0]), strip(row[1]), strip(row[2]), strip(row[3])
        if not kind and parent:
            children[parent].add(cls)
        elif kind == 'label' and text:
            label_of[cls] = text
        elif kind and text and 'synonym' in kind or kind == 'label (alternative)':
            synonyms[cls].append(text)

by_label = {v.strip().lower(): k for k, v in label_of.items()}
print(f'classes with a label : {len(label_of):>7}')
print(f'parent edges         : {sum(len(v) for v in children.values()):>7}')
print(f'classes with synonyms: {len(synonyms):>7}   ({sum(len(v) for v in synonyms.values())} strings)')


def descend(iri, depth=0, cap=3):
    """Every descendant within `cap` levels. Pure-ish (reads the module-level tree)."""
    if depth >= cap:
        return []
    out = []
    for child in sorted(children.get(iri, ())):
        out.append((depth, child, label_of.get(child, '(unlabelled)')))
        out.extend(descend(child, depth + 1, cap))
    return out


print('\n⛔ DO THE OVER-COARSE ROOTS HAVE CHILDREN IN FoodOn?\n')
print(f'  {"root":<34} {"USDA":>5} {"direct":>7} {"≤3 deep":>8}')
print(f'  {"-"*34} {"-"*5} {"-"*7} {"-"*8}')
for label, usda_n in PROBLEM_ROOTS:
    iri = by_label.get(label)
    if iri is None:
        print(f'  {label:<34} {usda_n:>5} {"NOT FOUND":>16}')
        continue
    direct = len(children.get(iri, ()))
    deep = len(descend(iri))
    print(f'  {label:<34} {usda_n:>5} {direct:>7} {deep:>8}')

print('\n  children of the worst root, if any:')
iri = by_label.get('ham (cured)')
if iri:
    for depth, child, name in descend(iri)[:14]:
        print(f'    {"  " * depth}- {name}')
    if not children.get(iri):
        print('    (none — FoodOn treats `ham (cured)` as a leaf)')
