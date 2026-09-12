"""Can FoodOn ITSELF name the foods USDA's cross-reference leaves unnamed?

⛔ THE QUESTION THIS SETTLES. USDA annotates only 53% of SR Legacy with a FoodOn term, and the
coverage runs BACKWARDS to consumption — the uncovered half is bread, cheddar, soy sauce, mayonnaise,
mozzarella. Making FoodOn the ROOT of the catalog is only viable if FoodOn's own vocabulary can name
those. USDA holds the cross-reference; FoodOn holds the vocabulary. This reads the vocabulary.

Source: http://purl.obolibrary.org/obo/foodon.owl (CC-BY-4.0), RDF/XML.
⚠️ Pin the checksum of any bundle used for a published figure.

Matching is against a CLOSED vocabulary, which is a fundamentally easier problem than the four
FAILED derivations in the plan's §6.6 — those had to GENERATE a name from a string. Here we only
have to RECOGNISE one. USDA descriptions are comma-inverted (`Cheese, cheddar`), so the candidate
forms below un-invert them before looking them up.
"""

import csv
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

FOODON = sys.argv[1] if len(sys.argv) > 1 else '/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodon.owl'
SR = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'

RDF = '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}'
RDFS = '{http://www.w3.org/2000/01/rdf-schema#}'
OBO_IN_OWL = '{http://www.geneontology.org/formats/oboInOwl#}'
SYNONYM_TAGS = {OBO_IN_OWL + t for t in
                ('hasExactSynonym', 'hasRelatedSynonym', 'hasNarrowSynonym', 'hasBroadSynonym')}

FOODON_ATTRIBUTE_NAMES = {
    'FoodOn Ontology Name #1 For FDC Item',
    'FoodOn Ontology Name For FDC Item',
    'FoodOn Ontology Name #2 For FDC Item',
}


def norm(text):
    """Lowercase, strip punctuation and collapse whitespace. Pure."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', text.lower())).strip()


def load_foodon():
    """IRI -> primary label, plus a lookup from every normalised label/synonym. @sideEffect reads 40 MB."""
    labels, lookup = {}, defaultdict(set)
    # ⛔ CLEAR ONLY ON A CLASS END, NEVER ON EVERY ELEMENT. `Element.clear()` drops the node's TEXT,
    # and `rdfs:label` ends BEFORE its parent `owl:Class` does — so clearing indiscriminately wipes
    # every label before it can be read, and the run reports 0 classes with a straight face.
    for _event, element in ET.iterparse(FOODON, events=('end',)):
        if element.tag != '{http://www.w3.org/2002/07/owl#}Class':
            continue
        iri = element.get(RDF + 'about')
        if iri:
            label_node = element.find(RDFS + 'label')
            if label_node is not None and label_node.text:
                labels[iri] = label_node.text.strip()
                lookup[norm(label_node.text)].add(iri)
            for child in element:
                if child.tag in SYNONYM_TAGS and child.text:
                    lookup[norm(child.text)].add(iri)
        element.clear()
    return labels, lookup


def candidates(description):
    """Name forms to try for a USDA description, best first. Pure."""
    parts = [p.strip() for p in description.split(',') if p.strip()]
    forms = [description]
    if len(parts) >= 2:
        forms.append(' '.join(reversed(parts)))          # Cheese, cheddar -> cheddar Cheese
        forms.append(parts[1] + ' ' + parts[0])          # first two, un-inverted
    if parts:
        forms.append(parts[0])                           # the head noun alone
    return [norm(f) for f in forms if norm(f)]


def main():
    descriptions = {}
    for row in csv.DictReader(open(SR + 'food.csv', encoding='utf-8', errors='replace')):
        text = (row.get('description') or '').strip()
        if text:
            descriptions[row['fdc_id']] = text

    usda_mapped = set()
    for row in csv.DictReader(open(FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
        if (row.get('name') or '').strip() in FOODON_ATTRIBUTE_NAMES and (row.get('value') or '').strip():
            usda_mapped.add(row['fdc_id'])

    labels, lookup = load_foodon()
    print(f'FoodOn classes with a label : {len(labels):>7}')
    print(f'distinct normalised names   : {len(lookup):>7}  (labels + exact/related/narrow/broad synonyms)')

    unmapped = {i: d for i, d in descriptions.items() if i not in usda_mapped}
    print(f'\nSR Legacy foods            : {len(descriptions):>7}')
    print(f'  USDA supplies a FoodOn term: {len(descriptions) - len(unmapped):>7}'
          f'  ({(len(descriptions) - len(unmapped)) / len(descriptions):.0%})')
    print(f'  UNMAPPED by USDA           : {len(unmapped):>7}'
          f'  ({len(unmapped) / len(descriptions):.0%})  <- the question')

    hits, by_form = {}, defaultdict(int)
    form_names = ['full description', 'all segments reversed', 'first two un-inverted', 'head noun alone']
    for fdc_id, description in unmapped.items():
        for index, form in enumerate(candidates(description)):
            if form in lookup:
                hits[fdc_id] = (form, sorted(lookup[form])[0])
                by_form[form_names[index] if index < len(form_names) else 'other'] += 1
                break

    print(f'\n⛔ FoodOn ITSELF names {len(hits)} of the {len(unmapped)} USDA left unmapped'
          f'  ({len(hits) / max(len(unmapped), 1):.0%})')
    for name in form_names:
        if by_form[name]:
            print(f'     via {name:<24}: {by_form[name]:>5}')

    total = len(descriptions) - len(unmapped) + len(hits)
    print(f'\n  combined coverage: {total}/{len(descriptions)} = {total / len(descriptions):.0%}'
          f'   (was {(len(descriptions) - len(unmapped)) / len(descriptions):.0%} on USDA alone)')

    print('\n=== THE STAPLES -- the foods that motivated all of this ===')
    for probe in ['bread', 'cheddar cheese', 'soy sauce', 'mayonnaise', 'mozzarella cheese',
                  'hamburger roll', 'cheese', 'butter', 'olive oil', 'whole milk']:
        key = norm(probe)
        mark = 'YES' if key in lookup else 'no '
        iri = sorted(lookup[key])[0].rsplit('/', 1)[-1] if key in lookup else ''
        print(f'  {mark}  {probe:<20} {iri}')

    print('\n=== ⛔ ROOT FAN-OUT -- is a root usable, or too coarse to pick from? ===')
    print('   A root naming 100 foods is not a name a cook picks; it is a category.')
    fan = defaultdict(list)
    for fdc_id in usda_mapped:
        if fdc_id in descriptions:
            fan[('usda', fdc_id)] = None
    roots = defaultdict(list)
    for fdc_id, (form, iri) in hits.items():
        roots[labels.get(iri, form)].append(fdc_id)
    sizes = defaultdict(int)
    for members in roots.values():
        sizes[len(members)] += 1
    singles = sizes[1]
    print(f'   roots created from FoodOn-own matching : {len(roots):>5}')
    print(f'     naming exactly ONE food              : {singles:>5}  ({singles / max(len(roots),1):.0%})')
    print(f'     naming 20+ foods (too coarse)        : '
          f'{sum(c for n, c in sizes.items() if n >= 20):>5}')
    print('   10 coarsest roots:')
    for name, members in sorted(roots.items(), key=lambda kv: -len(kv[1]))[:10]:
        print(f'     n={len(members):<4} {name[:40]}')

    print('\n=== sample of newly-nameable foods ===')
    for fdc_id, (form, iri) in list(hits.items())[:12]:
        print(f'  {descriptions[fdc_id][:52]:<54} -> {labels.get(iri, form)[:34]}')


if __name__ == '__main__':
    main()
