"""Does a COMPOSED display label (FoodOn head + protected USDA tail) survive rev 4's gates?

⛔ COMMITTED DELIBERATELY. Rev 4's own header records that rev 3's headline figure could not be
reproduced because "no uniqueness predicate exists in any surviving script". The FoodOn-vs-gates
figures quoted in `docs/plans/2026-09-20-002-…-plan.md` §6.6 failure 4 were produced by an inline
heredoc in an agent session and were one `/tmp` sweep away from the same fate. This file is that
measurement, re-derivable.

## What it answers

1. REPRODUCTION of §6.6 failure 4 — FoodOn's name used ALONE as the display name:
   how many are unique in the catalog, and how many drop a protected qualifier.
2. THE NEW QUESTION (candidate #5, never measured): compose the label as the FoodOn name for the
   HEAD plus the PROTECTED segments of USDA's `description` for the TAIL. Then histogram how many
   foods share each composed label.

   The histogram is the FLIP CONDITION for the whole design:
     - overwhelmingly N=1  -> grouping is dead, the composition IS the deliverable, and a
                              `food_concept` identity table would be a singleton table whose name
                              lies about it.
     - a fat tail at N>1   -> grouping is real, and R33's uniqueness gate must be re-scoped from
                              per-FOOD to per-CONCEPT, with row-level disclosure of which member
                              was used.

## The protected class

Re-derived here rather than hardcoded, by the rule `docs/design/ingredientRowRev4.html` states: a
segment token is PROTECTED iff the median relative |Δ kcal/100 g| between sibling foods differing by
that ONE segment is >= 10%, over >= 8 measurable pairs. "Sibling" = identical comma-segment lists
except for one substitution, or the presence/absence of one segment.

⚠️ Two bundles, joined on `fdc_id`. Energy and descriptions come from the FROZEN 2018-04 SR Legacy
per-dataset zip (it ships `food_nutrient.csv`); FoodOn names come from the regenerated 2026-04-30
FULL bundle (the 2018 zip carries ZERO FoodOn rows — plan R56). The join overlap is REPORTED, not
assumed, because a silent key mismatch would read as "low coverage".
"""

import csv
import statistics
import sys
from collections import defaultdict

SR_2018 = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/'
FULL_2026 = sys.argv[1] if len(sys.argv) > 1 else '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/'

ENERGY_NUTRIENT_ID = '1008'
PROTECTED_MEDIAN_THRESHOLD = 0.10
PROTECTED_MIN_PAIRS = 8

# The three `name` values USDA uses for a FoodOn cross-reference. The rows carry an EMPTY
# `food_attribute_type_id`, so they are identified by this column and not by a type id (plan R54).
FOODON_NAMES = {
    'FoodOn Ontology Name #1 For FDC Item',
    'FoodOn Ontology Name For FDC Item',
    'FoodOn Ontology Name #2 For FDC Item',
}


def segments(description):
    """USDA's description split into its comma segments, lowercased and trimmed. Pure."""
    return tuple(s.strip().lower() for s in description.split(',') if s.strip())


def relative_delta(a, b):
    """Relative |difference| between two energy values, against their mean. Pure."""
    mean = (a + b) / 2
    return abs(a - b) / mean if mean else 0.0


def load_sr_legacy():
    """Descriptions and energy for the frozen SR Legacy bundle. @sideEffect reads two CSVs."""
    descriptions = {}
    for row in csv.DictReader(open(SR_2018 + 'food.csv', encoding='utf-8', errors='replace')):
        text = (row.get('description') or '').strip()
        if text:
            descriptions[row['fdc_id']] = text

    energy = {}
    for row in csv.DictReader(open(SR_2018 + 'food_nutrient.csv', encoding='utf-8', errors='replace')):
        if row['nutrient_id'] == ENERGY_NUTRIENT_ID:
            try:
                energy[row['fdc_id']] = float(row['amount'])
            except ValueError:
                pass
    return descriptions, energy


def load_foodon_names():
    """fdc_id -> FoodOn ontology name, from the 2026 full bundle. @sideEffect reads a 137 MB CSV."""
    names = {}
    for row in csv.DictReader(open(FULL_2026 + 'food_attribute.csv', encoding='utf-8', errors='replace')):
        if (row.get('name') or '').strip() in FOODON_NAMES:
            value = (row.get('value') or '').strip()
            # A food may carry #1 and #2; #1 is the primary, so it wins and #2 never overwrites it.
            if value and (row['fdc_id'] not in names or row['name'].endswith('#1 For FDC Item')):
                names[row['fdc_id']] = value
    return names


def derive_protected_tokens(descriptions, energy):
    """The measured protected class. Pure over its inputs."""
    segs = {i: segments(d) for i, d in descriptions.items()}
    by_length = defaultdict(list)
    for fdc_id, parts in segs.items():
        if fdc_id in energy:
            by_length[len(parts)].append(fdc_id)

    deltas = defaultdict(list)

    # Substitution at one position, within the same segment count.
    for length, ids in by_length.items():
        if length == 0:
            continue
        for position in range(length):
            buckets = defaultdict(list)
            for fdc_id in ids:
                parts = segs[fdc_id]
                buckets[parts[:position] + parts[position + 1:]].append(fdc_id)
            for members in buckets.values():
                for x in range(len(members)):
                    for y in range(x + 1, len(members)):
                        a, b = members[x], members[y]
                        delta = relative_delta(energy[a], energy[b])
                        deltas[segs[a][position]].append(delta)
                        deltas[segs[b][position]].append(delta)

    # Presence/absence of one trailing-or-interior segment.
    for length, ids in by_length.items():
        shorter = by_length.get(length - 1, [])
        if not shorter:
            continue
        index = {segs[i]: i for i in shorter}
        for fdc_id in ids:
            parts = segs[fdc_id]
            for position in range(length):
                without = parts[:position] + parts[position + 1:]
                peer = index.get(without)
                if peer:
                    deltas[parts[position]].append(relative_delta(energy[fdc_id], energy[peer]))

    protected = set()
    for token, values in deltas.items():
        if len(values) >= PROTECTED_MIN_PAIRS and statistics.median(values) >= PROTECTED_MEDIAN_THRESHOLD:
            protected.add(token)
    return protected, deltas


def main():
    descriptions, energy = load_sr_legacy()
    foodon = load_foodon_names()
    protected, deltas = derive_protected_tokens(descriptions, energy)

    covered = {i: foodon[i] for i in descriptions if i in foodon}

    print('=' * 78)
    print('JOIN INTEGRITY (reported, never assumed)')
    print('=' * 78)
    print(f'  SR Legacy foods (2018-04 frozen bundle)   : {len(descriptions):>6}')
    print(f'  with energy (kcal/100 g)                  : {len(energy & descriptions.keys()) if isinstance(energy, set) else sum(1 for i in descriptions if i in energy):>6}')
    print(f'  fdc_ids carrying a FoodOn name (2026 full) : {len(foodon):>6}  (all datasets)')
    print(f'  ... that join to an SR Legacy food         : {len(covered):>6}')
    print(f'  protected tokens measured                  : {len(protected):>6}'
          f'   (>= {PROTECTED_MEDIAN_THRESHOLD:.0%} median, >= {PROTECTED_MIN_PAIRS} pairs)')

    print()
    print('=' * 78)
    print('1. REPRODUCTION -- FoodOn name used ALONE as the display name (plan §6.6 failure 4)')
    print('=' * 78)
    by_name = defaultdict(list)
    for fdc_id, name in covered.items():
        by_name[name.strip().lower()].append(fdc_id)
    unique_alone = sum(len(v) for v in by_name.values() if len(v) == 1)

    carries_protected, drops_it = 0, 0
    for fdc_id, name in covered.items():
        present = [s for s in segments(descriptions[fdc_id]) if s in protected]
        if not present:
            continue
        carries_protected += 1
        lowered = name.lower()
        if any(s not in lowered for s in present):
            drops_it += 1

    print(f'  SR Legacy foods with a FoodOn name        : {len(covered):>6}')
    print(f'    gate 1 -- name unique in the catalog    : {unique_alone:>6}  ({unique_alone / max(len(covered), 1):.0%})')
    print(f'  foods whose USDA name carries a PROTECTED segment: {carries_protected:>6}')
    print(f'    the FoodOn name DROPS it                : {drops_it:>6}  ({drops_it / max(carries_protected, 1):.0%})')

    print()
    print('=' * 78)
    print('2. THE NEW QUESTION -- COMPOSED label = FoodOn head + PROTECTED USDA tail')
    print('=' * 78)
    composed = {}
    for fdc_id, name in covered.items():
        tail = [s for s in segments(descriptions[fdc_id]) if s in protected]
        head = name.strip().lower()
        # Only append a protected segment the head does not already state.
        extra = [s for s in tail if s not in head]
        composed[fdc_id] = head + (', ' + ', '.join(extra) if extra else '')

    groups = defaultdict(list)
    for fdc_id, label in composed.items():
        groups[label].append(fdc_id)

    histogram = defaultdict(int)
    for members in groups.values():
        histogram[len(members)] += 1

    singletons = histogram[1]
    grouped_labels = sum(c for n, c in histogram.items() if n > 1)
    grouped_foods = sum(n * c for n, c in histogram.items() if n > 1)

    print(f'  distinct composed labels                  : {len(groups):>6}')
    print(f'    labels naming exactly ONE food          : {singletons:>6}  ({singletons / max(len(groups), 1):.0%})')
    print(f'    labels naming MORE THAN ONE food        : {grouped_labels:>6}')
    print(f'    foods inside a shared label             : {grouped_foods:>6}')
    print()
    print('  group-size histogram (members per composed label):')
    for size in sorted(histogram):
        print(f'    {size:>3} member(s) : {histogram[size]:>5} label(s)')

    print()
    print('  ⛔ ENERGY SPREAD INSIDE A SHARED LABEL -- the safety question.')
    print('     A label grouping members whose energy differs widely means the default member')
    print('     silently decides whether a cook is right. Protected segments are in the label,')
    print('     so any remaining spread is from qualifiers measurement did NOT protect.')
    spreads = []
    for label, members in groups.items():
        values = [energy[i] for i in members if i in energy]
        if len(values) > 1 and max(values) > 0:
            spreads.append((relative_delta(min(values), max(values)), label, len(members)))
    spreads.sort(reverse=True)
    over_10 = sum(1 for s, _, _ in spreads if s >= 0.10)
    print(f'     shared labels with measurable energy on 2+ members : {len(spreads):>5}')
    print(f'     ... whose min-to-max spread is >= 10%              : {over_10:>5}')
    print('     worst 10:')
    for spread, label, count in spreads[:10]:
        print(f'       {spread:6.1%}  n={count:<3} {label[:58]}')

    print()
    print('  10 widest groups, for inspection:')
    for label, members in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:10]:
        print(f'    n={len(members):<3} {label[:62]}')
        for fdc_id in members[:3]:
            print(f'           <- {descriptions[fdc_id][:66]}')


if __name__ == '__main__':
    main()
