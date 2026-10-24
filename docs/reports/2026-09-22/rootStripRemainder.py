"""The strip-to-remainder rule, measured — the script R55 quoted before it existed.

⛔ WHY THIS FILE EXISTS. The plan's own Evidence header says "Quote no figure here whose script is not
among them." R55 then asserted that the "two source rows both strip to empty" case "occurs 0 times in
2,036 roots" and concluded "It needs no rule" — deleting a requirement on the strength of a number
produced by an inline command that was never committed. An adversarial review caught it. This is that
measurement, re-runnable.

THE RULE (owner's design): a source food that maps to a FoodOn root becomes a `food_variant` named by
what remains of its description once the root's terms are removed, counting WORD CHARACTERS only.
An EMPTY remainder means that source row IS the root and its data merges into the `food` row.

It also re-derives the plain-food-label share from the OWL, because the plan quoted "88%" against
`foodOnStructure.txt`'s **89%**, and that script reads the SUPERSEDED `foodon-synonyms.tsv` (25,175 of
the OWL's 29,255 FoodOn classes). Two errors in one figure: wrong number, wrong source.
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
      'rdfs': 'http://www.w3.org/2000/01/rdf-schema#'}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
# The three pinned branches, identical to every sibling script. `FOODON_00001002` (food product) is a
# subclass of food material and adds no class, but `foodOnBranchAllowListGuard.py` pins all three so the day
# FoodOn detaches it, the guard says so. A script declaring two is drift the guard refuses.
EDIBLE_ROOTS = {'http://purl.obolibrary.org/obo/FOODON_00001002',
                'http://purl.obolibrary.org/obo/FOODON_00002403',
                'http://purl.obolibrary.org/obo/FOODON_03420116'}
FOODON_ATTRS = {'FoodOn Ontology Name #1 For FDC Item', 'FoodOn Ontology Name For FDC Item',
                'FoodOn Ontology Name #2 For FDC Item'}
ONTOLOGY_WORD = re.compile(r'\b(product|material|entity|by organism|by process|substance|component|analog|type)\b', re.I)


def words(text):
    """Word-character tokens only. Commas and whitespace do not count. Pure."""
    return [w for w in re.findall(r'[a-z0-9]+', text.lower())]


def remainder(source_description, root_label):
    """What is left of a source description once the root's terms are removed. Pure."""
    root_terms = set(words(root_label))
    return [w for w in words(source_description) if w not in root_terms]


def main(full_dir):
    label_of, parents, obsolete = {}, defaultdict(set), set()
    for cls in etree.parse(OWL).getroot().findall(f"{{{NS['owl']}}}Class"):
        iri = cls.get(ABOUT)
        if not iri:
            continue
        for child in cls:
            if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
                label_of[iri] = child.text.strip()
            elif child.tag == f"{{{NS['rdfs']}}}subClassOf" and child.get(RESOURCE):
                parents[iri].add(child.get(RESOURCE))
            elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or '').strip().lower() == 'true':
                obsolete.add(iri)

    sys.setrecursionlimit(60000)
    cache = {}

    def ancestors(iri, seen=frozenset()):
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
    plain = [i for i in edible if not ONTOLOGY_WORD.search(label_of[i])]
    print('=== PLAIN-LABEL SHARE, from the OWL (supersedes foodOnStructure.txt\'s TSV figure) ===')
    print(f'  live edible classes          : {len(edible):>7}')
    print(f'  ... label free of jargon     : {len(plain):>7}  ({len(plain)/len(edible):.0%})')

    descriptions = {}
    for row in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
        text = (row.get('description') or '').strip()
        if text:
            descriptions[row['fdc_id']] = text
    foodon = {}
    for row in csv.DictReader(open(full_dir + 'food_attribute.csv', encoding='utf-8', errors='replace')):
        name, value = (row.get('name') or '').strip(), (row.get('value') or '').strip()
        if name in FOODON_ATTRS and value and (row['fdc_id'] not in foodon or name.endswith('#1 For FDC Item')):
            foodon[row['fdc_id']] = value

    roots = defaultdict(list)
    for fdc_id, label in foodon.items():
        if fdc_id in descriptions:
            roots[label.strip().lower()].append(fdc_id)

    empties = Counter()
    for label, members in roots.items():
        empties[sum(1 for m in members if not remainder(descriptions[m], label))] += 1

    total = len(roots)
    print(f'\n=== THE STRIP RULE over {total} roots ===')
    print(f'  roots where EXACTLY ONE member strips empty : {empties[1]:>5}  ({empties[1]/total:.0%})')
    print(f'  roots where NO member strips empty          : {empties[0]:>5}  ({empties[0]/total:.0%})')
    two_plus = sum(v for k, v in empties.items() if k >= 2)
    print(f'  ⛔ roots where 2+ members strip empty        : {two_plus:>5}  ({two_plus/total:.0%})')
    print('\n  ⛔ THE FIGURE R55 QUOTED WITHOUT A SCRIPT is the last line above.')
    if two_plus == 0:
        print('     It reproduces: the ambiguous "which one is the root" case does not occur,')
        print('     so R55 needs no tie-break rule. The claim was right and unsourced; now sourced.')
    else:
        print(f'     ⛔ IT DOES NOT REPRODUCE. {two_plus} roots need a tie-break rule R55 says is unnecessary.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else FULL)
