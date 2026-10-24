"""⛔ INCOMPLETE — ITS MISMATCH COUNT IS NOT A MEASUREMENT OF USDA ERRORS. The FoodOn side of the comparison
is under-extracted: correct mappings such as `apple (dried)` <- `Apples, dried` [Malus domestica] come out as
mismatches, so most of the ~770 flagged rows are gaps in this parser, not in USDA. It does catch fdc 169099
(orange juice mapped to olives). Kept so the approach is not repeated blind; fix the taxon extraction (named
members of `owl:intersectionOf` appear as `rdf:Description`, and taxa hang off restrictions on ancestors) before
quoting any figure.

Can a species check catch USDA's wrong FoodOn mappings, and how much of the catalog can it judge?

USDA's `food_attribute.csv` gives each SR Legacy row an `NCBI Taxon` (and `NCBI Taxon Parent`) beside its FoodOn
term. FoodOn links a food class to the organism it comes from through NCBITaxon IRIs inside its axioms, usually on
an ancestor (`olive food product` rather than `olives (canned)`). The check: collect every NCBITaxon IRI on the
FoodOn term and its ancestors; the comparison is at GENUS level (the first word of each scientific name), because an exact taxon-id match
failed on 24% of rows over subspecies and id differences. CONSISTENT if the USDA genus is among the FoodOn genera,
MISMATCH if the FoodOn side names genera and none match, UNJUDGED if either side names none.
"""

import csv
import sys
from collections import Counter, defaultdict

from lxml import etree

SANDBOX = '/home/brandon/Development/KitchenSink/.local-sandbox/'
OWL = SANDBOX + 'foodon/foodon.owl'
SR = SANDBOX + 'fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = SANDBOX + 'fdc/FoodData_Central_csv_2026-04-30/'
NS = {'owl': 'http://www.w3.org/2002/07/owl#', 'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'rdfs': 'http://www.w3.org/2000/01/rdf-schema#'}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
TAXON = 'http://purl.obolibrary.org/obo/NCBITaxon_'

parents, taxa, taxon_label = defaultdict(set), defaultdict(set), {}
for cls in etree.parse(OWL).getroot().findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    if iri.startswith(TAXON):
        lab = cls.find(f"{{{NS['rdfs']}}}label")
        if lab is not None and lab.text:
            taxon_label[iri] = lab.text.strip()
    for child in cls:
        if child.tag == f"{{{NS['rdfs']}}}subClassOf" and child.get(RESOURCE):
            parents[iri].add(child.get(RESOURCE))
        for node in child.iter():
            ref = node.get(RESOURCE) or node.get(ABOUT)
            if ref and ref.startswith(TAXON):
                taxa[iri].add(ref)
            elif ref and node.tag == f"{{{NS['owl']}}}Class" and ref != iri and child.tag == f"{{{NS['owl']}}}equivalentClass":
                parents[iri].add(ref)

sys.setrecursionlimit(60000)
memo = {}


def lineage_taxa(iri, seen=frozenset()):
    if iri in memo:
        return memo[iri]
    if iri in seen:
        return set()
    out = set(taxa.get(iri, ()))
    for p in parents.get(iri, ()):
        out |= lineage_taxa(p, seen | {iri})
    if not seen:
        memo[iri] = out
    return out


desc = {r['fdc_id']: r['description'] for r in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace'))}
row = defaultdict(dict)
for r in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
    if r['fdc_id'] in desc and (r.get('value') or '').strip():
        row[r['fdc_id']].setdefault((r.get('name') or '').strip(), r['value'].strip())

verdicts, mismatches = Counter(), []
for fdc_id, attrs in row.items():
    term = attrs.get('FoodOn Ontology ID #1 For FDC Item') or attrs.get('FoodOn Ontology ID For FDC Item')
    if not term:
        continue
    usda_genus = (attrs.get('Scientific Name') or '').split(' ')[0].lower()
    foodon_genera = {taxon_label[t].split(' ')[0].lower() for t in lineage_taxa(term) if t in taxon_label}
    if usda_genus in ('', 'na') or not foodon_genera:
        verdicts['unjudged'] += 1
    elif usda_genus in foodon_genera:
        verdicts['consistent'] += 1
    else:
        verdicts['MISMATCH'] += 1
        mismatches.append((attrs.get('FoodOn Ontology Name #1 For FDC Item') or attrs.get('FoodOn Ontology Name For FDC Item'),
                           desc[fdc_id], attrs.get('Scientific Name', '')))

total = sum(verdicts.values())
print('⛔ INCOMPLETE: the FoodOn-side taxon extraction misses real links; the MISMATCH count is mostly parser gaps.')
print(f'mapped SR Legacy rows : {total}')
for k in ('consistent', 'MISMATCH', 'unjudged'):
    print(f'  {k:<11}: {verdicts[k]:>5}  ({verdicts[k] / total:.1%})')
print(f'\norange juice -> olives caught: {any("Orange juice, canned" in d for _, d, _ in mismatches)}')
print('\nevery mismatch (FoodOn term <- USDA description [USDA scientific name]):')
for term, d, sci in sorted(mismatches):
    print(f'  {str(term)[:34]:<36} <- {d[:56]:<58} [{sci}]')
