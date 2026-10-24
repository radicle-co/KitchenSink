"""FoodOn's structure, read from the OWL — SUPERSEDES the TSV-based `foodOnStructure.py`.

⛔ WHY THIS FILE EXISTS. `foodon-synonyms.tsv` is a PARTIAL dump. Measured: the OWL declares 29,255
`FOODON_*` classes and the TSV carries 25,175 subjects — **4,083 missing**, of which ~85% are live
(sampled 400: 58 obsolete). Every figure in `foodOnStructure.py` is therefore understated by ~12%,
and any ingestion built on the TSV would carry a silent coverage hole.

Cross-check that the OWL parse is complete: this file counts **40,107** `owl:Class` declarations,
which equals EMBL-EBI OLS4's own `numberOfTerms` for the same release exactly. That agreement is the
evidence the parse is not missing anything.

⛔ TWO PARSING TRAPS, both of which produce a confidently wrong answer:

1. **Do not regex `<owl:Class>…</owl:Class>`.** FoodOn nests `owl:Class` inside restrictions and
   intersections, so a non-greedy match truncates at the inner class. This file walks only the
   DIRECT `owl:Class` children of `rdf:RDF`, which cannot mis-nest.
2. **`rdfs:subClassOf` alone under-builds the hierarchy.** FoodOn expresses substantial parentage
   through `owl:equivalentClass` + `owl:intersectionOf`. OLS4's `directParent` for `apple` includes
   `PO_0030110`, reachable ONLY that way. Both routes are read below.
"""

import sys
from collections import Counter, defaultdict

from lxml import etree

OWL = sys.argv[1] if len(sys.argv) > 1 else '/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodon.owl'

NS = {
    'owl': 'http://www.w3.org/2002/07/owl#',
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
    'obo': 'http://www.geneontology.org/formats/oboInOwl#',
}
ABOUT = f"{{{NS['rdf']}}}about"
RESOURCE = f"{{{NS['rdf']}}}resource"
SYNONYM_TAGS = {f"{{{NS['obo']}}}{t}" for t in
                ('hasExactSynonym', 'hasRelatedSynonym', 'hasNarrowSynonym', 'hasBroadSynonym')}

label_of, parents, synonyms, obsolete = {}, defaultdict(set), defaultdict(list), set()
tree = etree.parse(OWL)
root = tree.getroot()

for cls in root.findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    for child in cls:
        tag = child.tag
        if tag == f"{{{NS['rdfs']}}}label" and child.text:
            label_of[iri] = child.text.strip()
        elif tag == f"{{{NS['rdfs']}}}subClassOf":
            target = child.get(RESOURCE)
            if target:
                parents[iri].add(target)
        elif tag == f"{{{NS['owl']}}}equivalentClass":
            # Named members of an intersection ARE asserted parents — this is OLS4's `directParent`.
            for named in child.iter():
                if named.tag in (f"{{{NS['owl']}}}Class", f"{{{NS['rdf']}}}Description"):
                    target = named.get(ABOUT) or named.get(RESOURCE)
                    if target and target != iri:
                        parents[iri].add(target)
        elif tag in SYNONYM_TAGS and child.text:
            synonyms[iri].append(child.text.strip())
        elif tag == f"{{{NS['owl']}}}deprecated" and (child.text or '').strip().lower() == 'true':
            obsolete.add(iri)

declared = {c.get(ABOUT) for c in root.findall(f"{{{NS['owl']}}}Class") if c.get(ABOUT)}
print(f'owl:Class declarations       : {len(declared):>7}   (OLS4 numberOfTerms = 40107)')
print(f'  ... with a label           : {len(label_of):>7}')
print(f'  ... deprecated             : {len(obsolete):>7}')
print(f'  FOODON_ native             : {sum(1 for i in declared if "FOODON_" in i):>7}')
print(f'parent edges (both routes)   : {sum(len(v) for v in parents.values()):>7}')
print(f'synonym strings              : {sum(len(v) for v in synonyms.values()):>7}'
      f'   on {len(synonyms)} classes')

sys.setrecursionlimit(60000)
cache = {}


def ancestors(iri, seen=frozenset()):
    """Transitive parents, cycle-safe. Pure over the parsed graph."""
    if iri in cache:
        return cache[iri]
    if iri in seen:
        return set()
    guard = seen | {iri}
    out = set()
    for parent in parents.get(iri, ()):
        out.add(parent)
        out |= ancestors(parent, guard)
    if not seen:
        cache[iri] = out
    return out


# ⛔ TWO PARALLEL TOP BRANCHES, and picking one is a silent coverage hole.
# `bread` climbs bread food product -> food (baked) -> food (cooked) -> food material by process
# -> `food material`, and NEVER reaches `food product`. A class NAMED "... food product" can sit
# outside the `food product` branch. Restrict to the UNION.
FOOD_PRODUCT = 'http://purl.obolibrary.org/obo/FOODON_00001002'
FOOD_MATERIAL = 'http://purl.obolibrary.org/obo/FOODON_00002403'
EDIBLE = {FOOD_PRODUCT, FOOD_MATERIAL}
live = {i for i in label_of if i not in obsolete}
branch = {i for i in live if EDIBLE & ancestors(i)}
by_label = {v.strip().lower(): k for k, v in label_of.items()}

print(f'\n=== the EDIBLE union (food product + food material) — the naming backbone ===')
print(f'  live labelled classes in branch : {len(branch):>7}')
print(f'  ... carrying >=1 synonym        : {sum(1 for i in branch if synonyms.get(i)):>7}')
print(f'  ... synonym strings in branch   : {sum(len(synonyms.get(i, [])) for i in branch):>7}')

print('\n  contamination check:')
for probe in ['chondrichthyes', 'restaurant', 'bread', 'cheddar cheese', 'soy sauce',
              'ham (cured)', 'beef (ground)', 'olive oil', 'mayonnaise']:
    iri = by_label.get(probe)
    if iri is None:
        print(f'    {probe:<20} (no label)')
        continue
    a = ancestors(iri)
    print(f'    {probe:<20} union={"IN " if EDIBLE & a else "OUT"}   product={FOOD_PRODUCT in a!s:<5} material={FOOD_MATERIAL in a}')

within = lambda i: [p for p in parents.get(i, ()) if p in branch]
multi = [i for i in branch if len(within(i)) > 1]
print(f'\n  parents-within-branch : ', ' '.join(f'{k}:{v}' for k, v in sorted(Counter(len(within(i)) for i in branch).items())[:6]))
print(f'  ⛔ multi-parent        : {len(multi)} of {len(branch)} ({len(multi)/max(len(branch),1):.0%}) — a DAG, not a tree')
