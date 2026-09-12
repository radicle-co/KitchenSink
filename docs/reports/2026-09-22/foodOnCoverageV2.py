"""FoodOn's own coverage of the foods USDA's cross-reference leaves unnamed — CORRECTED.

⛔ SUPERSEDES `docs/reports/2026-09-21/foodOnCoverage.py`, which was wrong twice:

1. It matched against EVERY FoodOn class, so it pulled in `Chondrichthyes` (the taxonomic class of
   sharks and rays, n=141) and `restaurant` (n=52) as food "roots". Fixed by restricting to the
   EDIBLE branch.
2. ⛔ THE EDIBLE BRANCH IS A UNION, NOT ONE BRANCH. `bread` climbs
   `bread food product -> food (baked) -> food (cooked) -> food material by process -> food material`
   and NEVER reaches `food product`. A class NAMED "... food product" can sit outside the
   `food product` branch. Restricting to either alone silently drops staples.

It also reads the OWL rather than `foodon-synonyms.tsv`: the TSV carries 25,175 of the OWL's 29,255
`FOODON_*` classes — 4,083 missing, ~85% of them live.

⚠️ Parsed with lxml over the DIRECT `owl:Class` children of `rdf:RDF`. Do not regex it: FoodOn nests
`owl:Class` inside restrictions, and a non-greedy match truncates at the inner class. Parentage is
read from `rdfs:subClassOf` AND from `owl:equivalentClass`/`owl:intersectionOf`, because FoodOn
asserts real parents that way (OLS4's `directParent` for `apple` is only reachable through it).
"""

import csv
import re
import sys
from collections import Counter, defaultdict

from lxml import etree

OWL = '/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodon.owl'
SR = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'

NS = {'owl': 'http://www.w3.org/2002/07/owl#', 'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'rdfs': 'http://www.w3.org/2000/01/rdf-schema#', 'obo': 'http://www.geneontology.org/formats/oboInOwl#'}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
SYN_TAGS = {f"{{{NS['obo']}}}{t}" for t in ('hasExactSynonym', 'hasRelatedSynonym', 'hasNarrowSynonym')}
# ⛔ THREE BRANCHES, AND TWO IS NOT ENOUGH. Restricting to food product + food material dropped
# **618 of 2,176** roots USDA already maps to — including `lamb shoulder`, `veal rib`, `octopus`,
# `beef top sirloin petite roast`. 579 of those 618 sit under `organism material`, which is where
# FoodOn keeps butchery cuts (`animal material` -> `vertebrate material` -> `butchery cut of
# animal`). An allow-list that excludes meat is worse than the contamination it was fixing.
# ⚠️ `food product` is itself a SUBCLASS of `food material`, so it contributes nothing the list does
# not already hold — the carrying branches are `food material` and `organism material`. That is
# PINNED, in both directions, by `foodOnBranchAllowListGuard.py`, which is the authority for it.
FOOD_PRODUCT = 'http://purl.obolibrary.org/obo/FOODON_00001002'
FOOD_MATERIAL = 'http://purl.obolibrary.org/obo/FOODON_00002403'
ORGANISM_MATERIAL = 'http://purl.obolibrary.org/obo/FOODON_03420116'
EDIBLE_ROOTS = {FOOD_PRODUCT, FOOD_MATERIAL, ORGANISM_MATERIAL}
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}


def norm(text):
    """Lowercase, strip punctuation, collapse whitespace. Pure."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', text.lower())).strip()


label_of, parents, synonyms, obsolete = {}, defaultdict(set), defaultdict(list), set()
for cls in etree.parse(OWL).getroot().findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    for child in cls:
        if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
            label_of[iri] = child.text.strip()
        elif child.tag == f"{{{NS['rdfs']}}}subClassOf":
            target = child.get(RESOURCE)
            if target:
                parents[iri].add(target)
            else:
                for nested in child.iter():
                    if nested.tag == f"{{{NS['owl']}}}Class" and nested.get(ABOUT):
                        parents[iri].add(nested.get(ABOUT))
        elif child.tag == f"{{{NS['owl']}}}equivalentClass":
            for nested in child.iter():
                if nested.tag in (f"{{{NS['owl']}}}Class", f"{{{NS['rdf']}}}Description"):
                    target = nested.get(ABOUT) or nested.get(RESOURCE)
                    if target and target != iri:
                        parents[iri].add(target)
        elif child.tag in SYN_TAGS and child.text:
            synonyms[iri].append(child.text.strip())
        elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or '').strip().lower() == 'true':
            obsolete.add(iri)

sys.setrecursionlimit(60000)
cache = {}


def ancestors(iri, seen=frozenset()):
    """Transitive parents, cycle-safe. Pure over the parsed graph."""
    if iri in cache:
        return cache[iri]
    if iri in seen:
        return set()
    guard, out = seen | {iri}, set()
    for parent in parents.get(iri, ()):
        out.add(parent)
        out |= ancestors(parent, guard)
    if not seen:
        cache[iri] = out
    return out


edible = {i for i in label_of if i not in obsolete and EDIBLE_ROOTS & ancestors(i)}
print(f'FoodOn classes (OWL)        : {len(label_of):>7}')
print(f'⛔ EDIBLE union branch      : {len(edible):>7}   <- the only terms a root may come from')

# Lookup built ONLY from edible terms, so a shark cannot become a food name.
lookup = defaultdict(set)
for iri in edible:
    lookup[norm(label_of[iri])].add(iri)
    for syn in synonyms.get(iri, ()):
        lookup[norm(syn)].add(iri)
print(f'   distinct names in lookup : {len(lookup):>7}   (labels + synonyms, edible only)')

descriptions = {}
for row in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
    text = (row.get('description') or '').strip()
    if text:
        descriptions[row['fdc_id']] = text
usda_mapped = set()
for row in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
    if (row.get('name') or '').strip() in FOODON_ATTRS and (row.get('value') or '').strip():
        usda_mapped.add(row['fdc_id'])
unmapped = {i: d for i, d in descriptions.items() if i not in usda_mapped}


def candidates(description):
    """Name forms to try, best first. USDA descriptions are comma-INVERTED. Pure."""
    parts = [p.strip() for p in description.split(',') if p.strip()]
    forms = [('full description', description)]
    if len(parts) >= 2:
        forms.append(('all segments reversed', ' '.join(reversed(parts))))
        forms.append(('first two un-inverted', parts[1] + ' ' + parts[0]))
    if parts:
        forms.append(('head noun alone', parts[0]))
    return [(name, norm(f)) for name, f in forms if norm(f)]


hits, by_form = {}, Counter()
for fdc_id, description in unmapped.items():
    for form_name, form in candidates(description):
        if form in lookup:
            hits[fdc_id] = (form_name, sorted(lookup[form])[0])
            by_form[form_name] += 1
            break

SAFE = {'full description', 'all segments reversed', 'first two un-inverted'}
safe = {k: v for k, v in hits.items() if v[0] in SAFE}
print(f'\nSR Legacy foods             : {len(descriptions):>7}')
print(f'  USDA supplies a FoodOn term:{len(descriptions)-len(unmapped):>7}  ({(len(descriptions)-len(unmapped))/len(descriptions):.0%})')
print(f'  UNMAPPED by USDA           :{len(unmapped):>7}  ({len(unmapped)/len(descriptions):.0%})')
print(f'\nFoodOn itself names         : {len(hits):>7} of the unmapped ({len(hits)/len(unmapped):.0%})')
for name, n in by_form.most_common():
    print(f'    via {name:<24}: {n:>5}{"" if name in SAFE else "   <- NOT SAFE (truncation)"}')
print(f'\n  ⛔ SAFE forms only         : {len(safe):>7} ({len(safe)/len(unmapped):.0%} of unmapped)')
combined = len(descriptions) - len(unmapped) + len(safe)
print(f'  combined SAFE coverage    : {combined}/{len(descriptions)} = {combined/len(descriptions):.0%}'
      f'   (USDA alone: {(len(descriptions)-len(unmapped))/len(descriptions):.0%})')

# ⛔ OVER `safe`, NOT `hits`. Computing this over every hit counts roots reached by the BANNED
# head-noun form, which R57 excludes — so the list described roots the pipeline never creates.
# It also hid the real finding: the staples (`bread` n=50, `chicken` n=58, `salad dressing` n=57)
# reach FoodOn ONLY by head-noun, so under R57 they are NOT covered at all.
fan = Counter()
for fdc_id, (form_name, iri) in safe.items():
    fan[iri] += 1
coarse = [(n, label_of.get(i, '?')) for i, n in fan.items() if n >= 15]
print(f'\n  ⛔ over-coarse roots (>=15 USDA foods) : {len(coarse)}')
for n, name in sorted(coarse, reverse=True)[:8]:
    print(f'     n={n:<4} {name[:50]}')

print('\n=== the staples ===')
for probe in ['bread', 'cheddar cheese', 'soy sauce', 'soy sauce food product', 'mayonnaise',
              'mozzarella cheese', 'hamburger roll', 'butter', 'olive oil', 'whole milk',
              'lamb shoulder', 'octopus', 'chondrichthyes', 'restaurant']:
    key = norm(probe)
    print(f'  {"YES" if key in lookup else "no "}  {probe}')
