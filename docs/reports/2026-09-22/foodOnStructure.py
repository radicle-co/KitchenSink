"""What is actually INSIDE FoodOn, and which branch may a food ROOT be drawn from?

⛔ THE OPERATIONAL QUESTION. `foodOnCoverage.py` found that naive name matching pulls in
`Chondrichthyes` (the taxonomic class of sharks and rays, n=141) and `restaurant` (n=52) as food
"roots". Those are real FoodOn classes; they are just not consumer food names. A branch restriction
is the fix, and this measures which branch.

Source: `foodon-synonyms.tsv` (sha256 1900fb2c…), columns `?class ?parent ?type ?label`. A row with
an EMPTY type states a parent edge.

⚠️ Read with `QUOTE_NONE` — the TSV's double quotes are DATA. Python's csv defaults consume them as
framing and hand back `ham (cured)@en`, which matches nothing and reports every lookup as absent.
"""

import csv
import sys
from collections import defaultdict, Counter
import re
import statistics

TSV = sys.argv[1] if len(sys.argv) > 1 else '/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodonSynonyms.tsv'
_UNUSED_FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}


def strip(value):
    """`<iri>`, `"text"` or `text@en` -> bare string. Pure."""
    value = value.strip()
    if value.startswith('<') and value.endswith('>'):
        return value[1:-1]
    if value.startswith('"'):
        end = value.rfind('"')
        value = value[1:end] if end > 0 else value[1:]
    if value.endswith('@en'):
        value = value[:-3]
    return value.strip('"')


label_of, parents, synonyms = {}, defaultdict(set), defaultdict(list)
with open(TSV, encoding='utf-8', errors='replace') as handle:
    for row in csv.reader(handle, delimiter='\t', quoting=csv.QUOTE_NONE):
        if len(row) < 4 or row[0].startswith('?'):
            continue
        cls, parent, kind, text = strip(row[0]), strip(row[1]), strip(row[2]), strip(row[3])
        if not kind and parent:
            parents[cls].add(parent)
        elif kind == 'label' and text:
            label_of[cls] = text
        elif kind and text:
            synonyms[cls].append(text)

short = lambda iri: iri.rsplit('/', 1)[-1]
prefix = lambda iri: short(iri).split('_')[0]

print('=' * 74)
print('1. WHAT IS IN THE FILE — native FoodOn vs imported vocabulary')
print('=' * 74)
counts = Counter(prefix(i) for i in label_of)
for name, n in counts.most_common(9):
    print(f'  {name:<14} {n:>7}  labelled classes')
print(f'  {"TOTAL":<14} {len(label_of):>7}')

# Ancestors, memoised, cycle-safe.
cache = {}
def ancestors(iri, seen=None):
    if iri in cache:
        return cache[iri]
    seen = seen or set()
    if iri in seen:
        return set()
    seen = seen | {iri}
    out = set()
    for p in parents.get(iri, ()):
        out.add(p)
        out |= ancestors(p, seen)
    cache[iri] = out
    return out

sys.setrecursionlimit(20000)
tops = {i for i in label_of if not parents.get(i)}
print(f'\n  top-level classes (no parent): {len(tops)}')


by_label = {v.strip().lower(): k for k, v in label_of.items()}
FOOD_PRODUCT = 'http://purl.obolibrary.org/obo/FOODON_00001002'
sys.setrecursionlimit(30000)

print('\n' + '=' * 74)
print('2. THE `food product` BRANCH — the naming backbone, SOURCE-INDEPENDENT')
print('=' * 74)
print('  \u26a0\ufe0f Deliberately NOT measured against USDA. USDA is one supplier of NUMBERS into this')
print('  vocabulary and will not be the only one; the branch is the catalog regardless.')
branch = {c for c in label_of if FOOD_PRODUCT in ancestors(c)}
within = lambda c: [p for p in parents.get(c, ()) if p in branch]
print(f'  labelled classes in branch   : {len(branch):>7}   (of {len(label_of)} labelled overall)')
print(f'  ... carrying >=1 synonym     : {sum(1 for c in branch if synonyms.get(c)):>7}')
print(f'  ... total synonym strings    : {sum(len(synonyms.get(c, [])) for c in branch):>7}')
internal = {p for c in branch for p in within(c)}
print(f'  internal nodes / leaves      : {len(internal):>7} / {len(branch) - len(internal)}')

print('\n  \u26d4 CONTAMINATION CHECK — the branch predicate is the whole fix')
print('     (`foodOnCoverage.py` pulled in Chondrichthyes n=141 and restaurant n=52 without it)')
for probe in ['chondrichthyes', 'restaurant', 'gnathostomata <vertebrates>', 'infant formula',
              'bread', 'cheddar cheese', 'soy sauce', 'ham (cured)', 'beef (ground)', 'olive oil']:
    iri = by_label.get(probe)
    mark = '(not a label)' if iri is None else ('IN ' if FOOD_PRODUCT in ancestors(iri) else 'OUT')
    print(f'     {probe:<30} {mark}')

print('\n  the 16 direct children — FoodOn is FACETED, not a single tree:')
for c in sorted((c for c in branch if FOOD_PRODUCT in parents.get(c, ())), key=lambda x: label_of.get(x, '')):
    print(f'     - {label_of.get(c)}')

print('\n' + '=' * 74)
print('3. TREE OR DAG? — decides whether a parent can be ONE column')
print('=' * 74)
multi = [c for c in branch if len(within(c)) > 1]
print('  parents-within-branch:', ' '.join(f'{k}:{v}' for k, v in sorted(Counter(len(within(c)) for c in branch).items())))
print(f'  \u26d4 {len(multi)} of {len(branch)} ({len(multi)/len(branch):.0%}) have MORE THAN ONE parent.')
print('  \u26d4 So FoodOn is a DAG. A single `parent_id` column would be WRONG for one food in seven.')
for c in multi[:3]:
    print(f'     "{label_of.get(c, "?")[:40]}" sits under:')
    for p in within(c)[:3]:
        print(f'         <- {label_of.get(p, "?")[:54]}')

print('\n' + '=' * 74)
print('4. NAME QUALITY + SYNONYMS — is this consumer language?')
print('=' * 74)
ontology_word = re.compile(r'\b(product|material|entity|by organism|by process|substance|component|analog|type)\b', re.I)
plain = [c for c in branch if not ontology_word.search(label_of.get(c, ''))]
lengths = sorted(len(label_of[c]) for c in plain)
print(f'  labels reading as plain food : {len(plain):>7}  ({len(plain)/len(branch):.0%})')
print(f'  plain-name length            : median {statistics.median(lengths):.0f}  p90 {lengths[int(len(lengths)*0.9)]}  max {max(lengths)}')
print(f'  classes with >=1 synonym     : {len(synonyms):>7}   ({sum(len(v) for v in synonyms.values())} strings overall)')
print('  sample plain names:')
for c in list(plain)[:8]:
    print(f'     - {label_of.get(c)[:58]}')
