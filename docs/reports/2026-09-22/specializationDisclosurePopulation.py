"""How many ingredient rows A COOK ACTUALLY SEES would carry a specialization disclosure?

⛔ THE UX QUESTION THIS SETTLES. `displayLabelComposition.md` §3 measured that 244 of 647 composed-
label groups (38%) span >= 10% kcal/100 g between members, which makes a silently-chosen default a
CORRECTNESS problem. But that is a count of GROUPS, unweighted. A row design needs the share of
OCCURRENCES, because 38% of groups and 38% of rows are not the same number and the design cost is
paid per row. Weighting reuses the plan's own consumption join, the same one rev 4 weighted by:
`input_food.sr_code` -> `sr_legacy_food.NDB_number`, each input carrying the WWEIA day-1 weight of
the dish it is an input to.

⛔ THE PROTECTED-TOKEN DERIVATION IS **IMPORTED**, NOT COPIED. A first draft of this script
re-derived rev 4's rule by a different (frozenset symmetric-difference) route and got **6** tokens
where the committed script gets 877 -- which would have silently corrupted every composed-label
figure below. That is the §6.6 divergence repeating a third time, so the committed module is now
the only derivation and this file cannot disagree with it.

Two grain hypotheses, because the report's grouping key and the owner's stated example disagree
about what the ROOT is:
  A. COMPOSED LABEL   -- FoodOn head + protected USDA tail (the committed report's key).
  B. BARE FoodOn NAME -- the owner's "let them just pick ham". Coarser, so it MUST collide more.
"""

import sys
from collections import defaultdict
from statistics import median

REPORTS = '/home/brandon/Development/KitchenSink/docs/reports/2026-09-21'
sys.path.insert(0, REPORTS)
import displayLabelComposition as dlc  # noqa: E402  -- the committed authority

import csv  # noqa: E402

SURVEY = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_survey_food_csv_2024-10-31/'
WWEIA = '/home/brandon/Development/KitchenSink/.local-sandbox/fdc/wweia_day1_frequencies.csv'
SR_LEGACY_MAP = dlc.SR_2018 + 'sr_legacy_food.csv'
SPREAD_THRESHOLD = dlc.PROTECTED_MEDIAN_THRESHOLD  # 10%, the same figure the report gates on
csv.field_size_limit(10_000_000)


def load_weights():
    """SR fdc_id -> WWEIA day-1 consumption weight. @sideEffect reads four CSVs."""
    ndb_to_fdc = {}
    for row in csv.DictReader(open(SR_LEGACY_MAP, encoding='utf-8', errors='replace')):
        ndb_to_fdc[row['NDB_number'].lstrip('0')] = row['fdc_id']
    food_code = {}
    for row in csv.DictReader(open(SURVEY + 'survey_fndds_food.csv', encoding='utf-8', errors='replace')):
        food_code[row['fdc_id']] = row['food_code']
    wweia = {}
    for row in csv.DictReader(open(WWEIA, encoding='utf-8', errors='replace')):
        wweia[str(int(float(row['DR1IFDCD'])))] = float(row['weighted'])
    weight = defaultdict(float)
    for row in csv.DictReader(open(SURVEY + 'input_food.csv', encoding='utf-8', errors='replace')):
        sr_code = (row.get('sr_code') or '').strip().lstrip('0')
        target = ndb_to_fdc.get(sr_code)
        if target:
            weight[target] += wweia.get(food_code.get(row['fdc_id'], ''), 0.0)
    return weight


def report(title, key_of, covered, energy, weight, total):
    groups = defaultdict(list)
    for fdc_id in covered:
        groups[key_of(fdc_id)].append(fdc_id)

    buckets = {'alone': 0.0, 'disclose': 0.0, 'silent': 0.0, 'unmeasurable': 0.0}
    sizes, measurable, over = defaultdict(int), 0, 0
    rows = []
    for label, members in groups.items():
        w = sum(weight.get(m, 0.0) for m in members)
        sizes[len(members)] += 1
        if len(members) == 1:
            buckets['alone'] += w
            continue
        values = [energy[m] for m in members if m in energy]
        if len(values) > 1 and max(values) > 0:
            measurable += 1
            spread = dlc.relative_delta(min(values), max(values))
            rows.append((w, spread, len(members), label))
            if spread >= SPREAD_THRESHOLD:
                over += 1
                buckets['disclose'] += w
            else:
                buckets['silent'] += w
        else:
            buckets['unmeasurable'] += w

    pct = lambda x: f'{100 * x / total:5.1f}%'
    print(f'\n{"=" * 78}\n{title}\n{"=" * 78}')
    print(f'  roots (labels)                       : {len(groups)}')
    print(f'  ... naming exactly ONE food          : {sizes[1]}')
    print(f'  ... naming 2+ foods                  : {sum(v for k, v in sizes.items() if k > 1)}')
    print(f'  ... of those, energy measurable      : {measurable}')
    print(f'  ⛔ ... spread >= 10%                 : {over}  ({100 * over / max(measurable,1):.0f}% of measurable)')
    print(f'  group-size histogram (2+)            : '
          + ', '.join(f'n={k}:{v}' for k, v in sorted(sizes.items()) if k > 1))
    print('  --- CONSUMPTION-WEIGHTED share of SR-attributable eating occasions ---')
    print(f'  root has NO specialization          : {pct(buckets["alone"])}  <- affordance inert, must not look broken')
    print(f'  ⛔ default in force, spread >= 10%   : {pct(buckets["disclose"])}  <- THE DISCLOSURE POPULATION')
    print(f'  default in force, spread <  10%     : {pct(buckets["silent"])}  <- safe to default silently')
    print(f'  default in force, energy unknown    : {pct(buckets["unmeasurable"])}  <- no figures, so no wrong number')
    print('  the eight roots carrying the most consumption weight:')
    for w, spread, n, label in sorted(rows, reverse=True)[:8]:
        print(f'    {pct(w)} of occasions  spread {spread:6.1%}  n={n:<3} '
              f'{"DISCLOSE" if spread >= SPREAD_THRESHOLD else "silent  "}  {label[:44]}')
    return buckets


def main():
    descriptions, energy = dlc.load_sr_legacy()
    foodon = dlc.load_foodon_names()
    protected, _ = dlc.derive_protected_tokens(descriptions, energy)
    covered = {i: foodon[i] for i in descriptions if i in foodon}
    weight = load_weights()
    total = sum(weight.values())

    print('=' * 78)
    print('JOIN INTEGRITY (reported, never assumed) -- must agree with displayLabelComposition.py')
    print('=' * 78)
    print(f'  SR Legacy foods                      : {len(descriptions)}')
    print(f'  ... carrying a FoodOn name           : {len(covered)}  ({100*len(covered)/len(descriptions):.0f}%)')
    print(f'  protected tokens (IMPORTED)          : {len(protected)}')
    print(f'  SR foods with any consumption weight : {sum(1 for f in weight if weight[f] > 0)}')
    w_cov = sum(weight.get(f, 0.0) for f in covered)
    print(f'  ⛔ eating occasions whose food HAS a root : {100*w_cov/total:.1f}%')
    print(f'  ⛔ ... NO root -> keeps today\'s long name : {100*(1-w_cov/total):.1f}%')

    print('\nNAME LENGTH IN CHARACTERS -- what the re-grain actually buys the row')
    composed = {i: dlc_composed(descriptions[i], foodon[i], protected) for i in covered}
    pools = [
        ('today: USDA description, covered foods', [len(descriptions[i]) for i in covered]),
        ('after: bare FoodOn root', [len(foodon[i]) for i in covered]),
        ('after: composed label', [len(composed[i]) for i in covered]),
        ('⛔ EATEN but NO root (unchanged)', [len(descriptions[i]) for i in descriptions
                                              if i not in foodon and weight.get(i, 0) > 0]),
    ]
    for name, xs in pools:
        xs = sorted(xs)
        print(f'  {name:<40} median {median(xs):5.0f}   p90 {xs[int(.9*len(xs))-1]:5.0f}   max {xs[-1]:5.0f}')

    # Consumption-weighted median name length, the figure comparable to rev 4's weighting.
    def weighted_median(length_of):
        pairs = sorted((length_of(i), weight.get(i, 0.0)) for i in descriptions if weight.get(i, 0) > 0)
        running, half = 0.0, sum(w for _, w in pairs) / 2
        for length, w in pairs:
            running += w
            if running >= half:
                return length
        return 0
    print(f'  ⛔ CONSUMPTION-WEIGHTED median, whole eaten catalog:')
    print(f'      today  (USDA description)          : {weighted_median(lambda i: len(descriptions[i])):>3} ch')
    print(f'      after  (root where one exists)     : '
          f'{weighted_median(lambda i: len(foodon[i]) if i in foodon else len(descriptions[i])):>3} ch')

    a = report('A. grain = COMPOSED LABEL (committed report key)',
               lambda f: composed[f], covered, energy, weight, total)
    b = report('B. grain = BARE FoodOn NAME (the owner\'s "just pick ham")',
               lambda f: foodon[f].strip().lower(), covered, energy, weight, total)
    print(f'\n⚠️ Grain B discloses on {100*(b["disclose"]-a["disclose"])/total:+.1f} points more occasions '
          f'than grain A. Coarser root = more collisions = more disclosure. Stated, not hidden.')


def dlc_composed(description, name, protected):
    """The committed script's composition step, §2, re-expressed as a function. Pure."""
    head = name.strip().lower()
    extra = [s for s in dlc.segments(description) if s in protected and s not in head]
    return head + (', ' + ', '.join(extra) if extra else '')


if __name__ == '__main__':
    main()


def grain_c(descriptions, foodon, protected, energy, weight, total):
    """⛔ THE HYBRID the measurement argues for: SHORT root by default, SPLIT where it is unsafe.

    `displayLabelComposition.md` §3's own recommendation -- "a label may name N foods only while
    (max-min)/mean across its members stays under a stated threshold; otherwise it splits". Applied
    to the owner's preferred BARE root: keep `ham` where the siblings agree on energy; fall back to
    the composed label (root + protected tail) only for the roots that do not. Disclosure is then
    reserved for what survives BOTH.
    """
    covered = {i: foodon[i] for i in descriptions if i in foodon}
    by_root = defaultdict(list)
    for i in covered:
        by_root[foodon[i].strip().lower()].append(i)

    label_of, split_roots = {}, 0
    for root, members in by_root.items():
        values = [energy[m] for m in members if m in energy]
        unsafe = len(values) > 1 and max(values) > 0 and dlc.relative_delta(min(values), max(values)) >= SPREAD_THRESHOLD
        if unsafe:
            split_roots += 1
        for m in members:
            label_of[m] = dlc_composed(descriptions[m], foodon[m], protected) if unsafe else root

    print(f'\n{"=" * 78}\nC. grain = BARE ROOT, SPLIT ONLY WHERE ENERGY SPREAD >= 10% (the recommendation)\n{"=" * 78}')
    print(f'  bare roots                           : {len(by_root)}')
    print(f'  ⛔ ... that had to split             : {split_roots}  '
          f'({100*split_roots/len(by_root):.0f}% -- the rest keep the SHORT name)')
    buckets = report('   resulting grain', lambda f: label_of[f], covered, energy, weight, total)

    lens = sorted(len(label_of[i]) for i in covered)
    print(f'  name length over covered foods       : median {median(lens):.0f}   '
          f'p90 {lens[int(.9*len(lens))-1]}   max {lens[-1]}')
    pairs = sorted(((len(label_of[i]) if i in label_of else len(descriptions[i])), weight.get(i, 0.0))
                   for i in descriptions if weight.get(i, 0) > 0)
    running, half = 0.0, sum(w for _, w in pairs) / 2
    for length, w in pairs:
        running += w
        if running >= half:
            print(f'  ⛔ CONSUMPTION-WEIGHTED median name   : {length} ch  '
                  f'(today 33, bare root 20, composed 37)')
            break
    return buckets


def run_all():
    """All three grains in one pass. @sideEffect reads the corpora and prints."""
    d, e = dlc.load_sr_legacy()
    fo = dlc.load_foodon_names()
    p, _ = dlc.derive_protected_tokens(d, e)
    w = load_weights()
    grain_c(d, fo, p, e, w, sum(w.values()))


if __name__ == '__main__' and '--c' in sys.argv:
    d, e = dlc.load_sr_legacy()
    fo = dlc.load_foodon_names()
    p, _ = dlc.derive_protected_tokens(d, e)
    w = load_weights()
    grain_c(d, fo, p, e, w, sum(w.values()))
