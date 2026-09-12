"""What the kind picker has to hold, measured at the owner's grain (bare FoodOn roots, R55 + §16).

⛔ WHY THIS FILE EXISTS. `docs/design/ingredientSpecialization.md` was specified for n=29 at a grain the
owner then rejected (plan §16 item 2). At bare roots the worst root has 90 kinds, and R59 makes every line
point at a KIND. The re-specification turns on facts no committed script prints:

  1. how long a kind's label is once rendered (R55's remainder, kept in its comma segments),
  2. whether two kinds of one root can render the SAME label (then the label alone cannot tell them apart),
  3. how well a one-word filter narrows a large group,
  4. how wrong the elected default is for a cook who actually eats a different kind — the cost of silence,
  5. what happens to a root with ONE source item whose remainder is NOT empty (R55 makes it a one-kind root).

⛔ NOTHING IS RE-DERIVED. The corpus loaders, the protected-token rule and the spread helper come from
`displayLabelComposition.py`; the strip rule (`words`, `remainder`) from `rootStripRemainder.py`; the
consumption join from `specializationDisclosurePopulation.py`. The election rule is the owner's (§16 item 3,
R55): the plain member if one exists, else most eaten, else median energy with ties to the lowest id — the
same order `electionRule.py` implements, restated here only because that file runs at import time.

Run: python3 kindPickerPopulation.py  (reads the same local bundles as the scripts it imports)
"""

import re
import sys
from collections import Counter, defaultdict
from statistics import median

sys.path.insert(0, '/home/brandon/Development/KitchenSink/docs/reports/2026-09-21')
sys.path.insert(0, '/home/brandon/Development/KitchenSink/docs/reports/2026-09-22')
import displayLabelComposition as dlc  # noqa: E402  -- loaders, protected tokens, spread
from rootStripRemainder import words, remainder  # noqa: E402  -- R55's strip rule
from specializationDisclosurePopulation import load_weights  # noqa: E402  -- one consumption join

SPREAD = dlc.PROTECTED_MEDIAN_THRESHOLD  # 10%, the gate every committed figure uses
PUNCT_ONLY = re.compile(r'^[^a-z0-9]+$')


def kind_label(description, root_label, drop=frozenset()):
    """R55's remainder, rendered for a person: comma segments kept, root words removed. Pure.

    `drop` adds words to remove beyond the root's own; it is empty for R55 as ruled and is used only by
    section 9, which measures two candidate refinements.

    A whitespace token is dropped only when EVERY word inside it is a root word, so `1/4"` and `bone-in`
    survive intact. Punctuation left at a segment's edge (`ham -- water added` -> `-- water added`) is
    trimmed. An empty segment is dropped.
    """
    root = set(words(root_label)) | set(drop)
    kept_segments = []
    for segment in dlc.segments(description):
        tokens = []
        for token in segment.split():
            pieces = words(token)
            if pieces and all(p in root for p in pieces):
                continue
            tokens.append(token)
        while tokens and PUNCT_ONLY.match(tokens[0]):
            tokens.pop(0)
        while tokens and PUNCT_ONLY.match(tokens[-1]):
            tokens.pop()
        if tokens:
            kept_segments.append(' '.join(tokens))
    return ', '.join(kept_segments)


def elect(members, label, descriptions, energy, weight):
    """The owner's default: plain member, else most eaten, else median energy (lowest id on ties). Pure."""
    plain = [m for m in members if not remainder(descriptions[m], label)]
    if plain:
        return plain[0], 'plain member'
    eaten = [m for m in members if weight.get(m, 0.0) > 0]
    if eaten:
        return max(eaten, key=lambda m: (weight[m], -int(m))), 'most eaten'
    measured = sorted((m for m in members if m in energy), key=lambda m: (energy[m], int(m)))
    if measured:
        return measured[len(measured) // 2], 'median energy'
    return min(members, key=int), 'lowest id (no energy)'


def weighted_quantile(pairs, q):
    """pairs = [(value, weight)]; the q-quantile by weight. Pure."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    running = 0.0
    for value, w in pairs:
        running += w
        if running >= q * total:
            return value
    return pairs[-1][0] if pairs else 0.0


def main():
    descriptions, energy = dlc.load_sr_legacy()
    foodon = dlc.load_foodon_names()
    protected, _ = dlc.derive_protected_tokens(descriptions, energy)
    weight = load_weights()
    total = sum(weight.values())
    pct = lambda w: f'{100 * w / total:5.1f}%'

    roots = defaultdict(list)
    for fdc_id, name in foodon.items():
        if fdc_id in descriptions:
            roots[name.strip().lower()].append(fdc_id)

    print('=' * 88)
    print('1. WHAT A LINE POINTS AT (R59), share of SR-attributable eating occasions')
    print('=' * 88)
    no_name = sum(weight.get(i, 0.0) for i in descriptions if i not in foodon)
    single_empty, single_kind, grouped = [], [], []
    for label, members in roots.items():
        if len(members) == 1:
            (single_kind if remainder(descriptions[members[0]], label) else single_empty).append(label)
        else:
            grouped.append(label)
    w_of = lambda labels: sum(weight.get(m, 0.0) for lab in labels for m in roots[lab])
    print(f'  no FoodOn name -> root, NO kinds              : {pct(no_name)}')
    print(f'  one source item, remainder EMPTY -> NO kinds  : {pct(w_of(single_empty))}  ({len(single_empty)} roots)')
    print(f'  ⛔ one source item, remainder NOT empty       : {pct(w_of(single_kind))}  ({len(single_kind)} roots)')
    print('     -> by R55 as written this is a root with ONE kind: nothing to choose, but a label to show')
    carries = [lab for lab in single_kind
               if set(s for s in dlc.segments(descriptions[roots[lab][0]])) & protected]
    print(f'     ... whose source carries a PROTECTED segment : {len(carries)} roots, {pct(w_of(carries))}')
    label_carries = [lab for lab in single_kind
                     if set(s.strip() for s in kind_label(descriptions[roots[lab][0]], lab).split(',')) & protected]
    print(f'     ⛔ ... whose KIND LABEL carries one (the root name does not already say it) : '
          f'{len(label_carries)} roots, {pct(w_of(label_carries))}')
    for lab in sorted(label_carries, key=lambda lab: -w_of([lab]))[:5]:
        print(f'       {pct(w_of([lab]))}  {lab[:34]:<34} | kind: {kind_label(descriptions[roots[lab][0]], lab)[:50]}')
    heavy = sorted(single_kind, key=lambda lab: -w_of([lab]))[:8]
    for lab in heavy:
        m = roots[lab][0]
        print(f'       {pct(w_of([lab]))}  {lab[:34]:<34} | kind: {kind_label(descriptions[m], lab)[:44]}')
    print(f'  grouped root (2+ kinds)                        : {pct(w_of(grouped))}  ({len(grouped)} roots)')

    print('\n' + '=' * 88)
    print('2. KIND LABELS in grouped roots — what an option row must hold')
    print('=' * 88)
    labels, weighted, mismatched, mismatch_examples = [], [], 0, []
    for lab in grouped:
        for m in roots[lab]:
            text = kind_label(descriptions[m], lab)
            labels.append(len(text))
            weighted.append((len(text), weight.get(m, 0.0)))
            extra = set(words(text)) - set(remainder(descriptions[m], lab))
            missing = set(remainder(descriptions[m], lab)) - set(words(text))
            if extra or missing:
                mismatched += 1
                if len(mismatch_examples) < 4:
                    mismatch_examples.append((lab, text, sorted(extra), sorted(missing)))
    labels.sort()
    print(f'  kinds                          : {len(labels)}')
    print(f'  rendered label length          : median {median(labels):.0f}   p90 {labels[int(.9 * len(labels)) - 1]}'
          f'   max {labels[-1]}   (characters)')
    print(f'  ... longer than 40 characters  : {sum(1 for x in labels if x > 40)} ({sum(1 for x in labels if x > 40) / len(labels):.0%})')
    print(f'  ... consumption-weighted median: {weighted_quantile(weighted, .5)} characters')
    print(f'  ⛔ rendering vs R55 word set disagree on : {mismatched} kinds (0 means the rendering drops nothing R55 keeps)')
    for lab, text, extra, missing in mismatch_examples:
        print(f'     [{lab}] "{text}"  rendering keeps {extra}  rendering drops {missing}')
    longest = max(((kind_label(descriptions[m], lab), lab) for lab in grouped for m in roots[lab]), key=lambda t: len(t[0]))
    print(f'  longest: [{longest[1]}] "{longest[0]}"')

    print('\n' + '=' * 88)
    print('3. ⛔ DUPLICATE LABELS — two kinds of one root that render identically')
    print('=' * 88)
    dup_groups, dup_kinds, dup_same_kcal = 0, 0, 0
    examples = []
    for lab in grouped:
        by_text = defaultdict(list)
        for m in roots[lab]:
            by_text[kind_label(descriptions[m], lab)].append(m)
        clashes = {t: ms for t, ms in by_text.items() if len(ms) > 1}
        if clashes:
            dup_groups += 1
            for t, ms in clashes.items():
                dup_kinds += len(ms)
                kc = [energy.get(m) for m in ms]
                if len(set(kc)) < len(kc):
                    dup_same_kcal += 1
                if len(examples) < 6:
                    examples.append((lab, t, [descriptions[m] for m in ms], kc))
    print(f'  grouped roots with a clash     : {dup_groups} of {len(grouped)}')
    print(f'  kinds inside a clash           : {dup_kinds}')
    print(f'  ⛔ clashes where energy ALSO ties : {dup_same_kcal}  (calories cannot tell these apart either)')
    for lab, t, descs, kc in examples:
        print(f'    [{lab}] label "{t or "(empty)"}" <- ' + ' | '.join(f'{d} ({k})' for d, k in zip(descs, kc)))

    print('\n' + '=' * 88)
    print('4. GROUP SIZE — where a list needs a filter')
    print('=' * 88)
    for floor in (2, 5, 8, 13, 20, 36, 90):
        labs = [lab for lab in grouped if len(roots[lab]) >= floor]
        print(f'  roots with >= {floor:>2} kinds : {len(labs):>4}   occasions {pct(w_of(labs))}')

    print('\n' + '=' * 88)
    print('5. ⛔ THE COST OF SILENCE — the default against the kind actually eaten (WWEIA-weighted)')
    print('=' * 88)
    reasons = Counter()
    errs_all, errs_disclose, errs_no_plain, errs_disclose_no_plain = [], [], [], []
    by_root, why_of = defaultdict(float), {}
    for lab in grouped:
        members = roots[lab]
        default, why = elect(members, lab, descriptions, energy, weight)
        reasons[why] += 1
        why_of[lab] = why
        values = [energy[m] for m in members if m in energy]
        spread = dlc.relative_delta(min(values), max(values)) if len(values) > 1 and max(values) > 0 else None
        if default not in energy:
            continue
        for m in members:
            w = weight.get(m, 0.0)
            if w <= 0 or m not in energy or energy[m] <= 0:
                continue
            err = abs(energy[default] - energy[m]) / energy[m]
            errs_all.append((err, w))
            by_root[lab] += err * w
            if why != 'plain member':
                errs_no_plain.append((err, w))
            if spread is not None and spread >= SPREAD:
                errs_disclose.append((err, w))
                if why != 'plain member':
                    errs_disclose_no_plain.append((err, w))
    print('  how each grouped root elects its default : ' + ', '.join(f'{k} {v}' for k, v in reasons.most_common()))
    for name, errs in (('all grouped roots', errs_all), ('⛔ roots whose kinds span >= 10%', errs_disclose),
                       ('... excluding plain-member roots', errs_no_plain),
                       ('⛔ span >= 10%, excluding plain-member', errs_disclose_no_plain)):
        tw = sum(w for _, w in errs)
        off = sum(w for e, w in errs if e >= SPREAD)
        print(f'  {name:<34}: eaten-weighted mean error {sum(e * w for e, w in errs) / tw:6.1%}'
              f'   p90 {weighted_quantile(errs, .9):6.1%}   occasions where the default is off by >= 10%: {off / tw:5.1%}')
    print('  ⚠️ The first line reconciles with electionRule.txt (1.9%) only on the third: that script EXCLUDES')
    print('     plain-member roots, and one of them carries most of this error. Largest contributors:')
    share_total = sum(by_root.values())
    for lab, s in sorted(by_root.items(), key=lambda kv: -kv[1])[:4]:
        print(f'     {100 * s / share_total:5.1f}% of the weighted error  {lab}  (default by: {why_of[lab]})')

    print('\n' + '=' * 88)
    print('5b. ⛔ THE "ENERGY UNKNOWN" BUCKET the committed disclosure figures quote (8.0%)')
    print('=' * 88)
    zero, unknown, zero_labels = 0.0, 0.0, []
    for lab in grouped:
        members = roots[lab]
        values = [energy[m] for m in members if m in energy]
        if len(values) > 1 and max(values) > 0:
            continue
        w = w_of([lab])
        if len(values) == len(members) and values and max(values) == 0:
            zero += w
            zero_labels.append(lab)
        else:
            unknown += w
    print(f'  every kind measured at 0 kcal (spread is ZERO, not unknown) : {pct(zero)}  {sorted(zero_labels)[:6]}')
    print(f'  ⛔ genuinely unknown energy                                  : {pct(unknown)}')

    print('\n' + '=' * 88)
    print('6. THE WORST ROOT, whole — ham (cured)')
    print('=' * 88)
    ham = roots['ham (cured)']
    default, why = elect(ham, 'ham (cured)', descriptions, energy, weight)
    have_kcal = sum(1 for m in ham if m in energy)
    have_w = sum(1 for m in ham if weight.get(m, 0.0) > 0)
    print(f'  kinds {len(ham)} · with energy {have_kcal} · with consumption weight {have_w} · default by: {why}')
    ordered = sorted(ham, key=lambda m: (energy.get(m, 1e9), int(m)))
    rank = ordered.index(default) + 1
    print(f'  default sits at position {rank} of {len(ham)} in calorie order')
    for i, m in enumerate(ordered, 1):
        mark = ' ◀ default' if m == default else ''
        print(f'   {i:>2}. {energy.get(m, float("nan")):>5.0f} kcal  w={weight.get(m, 0.0):>9.0f}  '
              f'{kind_label(descriptions[m], "ham (cured)")}{mark}')

    print('\n' + '=' * 88)
    print('6b. A ROOT WHOSE KINDS A COOK READS AS DIFFERENT INGREDIENTS — tomato (canned)')
    print('=' * 88)
    tomato = roots['tomato (canned)']
    t_default, t_why = elect(tomato, 'tomato (canned)', descriptions, energy, weight)
    print(f'  kinds {len(tomato)} · default by: {t_why}')
    for m in sorted(tomato, key=lambda m: (energy.get(m, 1e9), int(m))):
        mark = ' ◀ default' if m == t_default else ''
        print(f'   {energy.get(m, float("nan")):>5.0f} kcal  w={weight.get(m, 0.0):>10.0f}  '
              f'{kind_label(descriptions[m], "tomato (canned)")}{mark}')

    print('\n' + '=' * 88)
    print('7. WORDS COMMON TO EVERY KIND of a root — carried by every option, so they tell no option apart')
    print('=' * 88)
    common_groups, saved = 0, []
    for lab in grouped:
        sets = [set(words(kind_label(descriptions[m], lab))) for m in roots[lab]]
        shared = set.intersection(*sets) if sets else set()
        if shared:
            common_groups += 1
            saved.append(len(' '.join(sorted(shared))) + 1)
    print(f'  grouped roots with >= 1 word in every kind label : {common_groups} of {len(grouped)}')
    print(f'  ham (cured) shared words : {sorted(set.intersection(*[set(words(kind_label(descriptions[m], "ham (cured)"))) for m in ham]))}')

    print('\n' + '=' * 88)
    print('8. A ONE-WORD FILTER over roots with >= 8 kinds')
    print('=' * 88)
    fractions, vocab = [], []
    for lab in grouped:
        members = roots[lab]
        if len(members) < 8:
            continue
        texts = [set(words(kind_label(descriptions[m], lab))) for m in members]
        vocabulary = set().union(*texts)
        vocab.append(len(vocabulary))
        for word in vocabulary:
            fractions.append(sum(1 for t in texts if word in t) / len(members))
    fractions.sort()
    print(f'  distinct words per root         : median {median(vocab):.0f}  max {max(vocab)}')
    print(f'  share of kinds one word keeps   : median {median(fractions):.0%}  p90 {fractions[int(.9 * len(fractions)) - 1]:.0%}')
    for word in ('lean', 'boneless', 'canned', 'spiral', 'unheated', 'roasted', 'water'):
        hits = sum(1 for m in ham if word in words(kind_label(descriptions[m], 'ham (cured)')))
        print(f'  ham (cured) — "{word}" keeps {hits} of {len(ham)}')

    print('\n' + '=' * 88)
    print('10. ⛔ AS BOUGHT vs AS EATEN — a recipe line is weighed raw; a cooked kind\'s numbers are for cooked weight')
    print('=' * 88)
    print('  (MEASUREMENT ONLY: a word list over USDA segments sizes the question. Production needs a CURATED')
    print('   state per kind, never this regex — see plan §6.6 failure 1.)')
    eaten_words = {'cooked', 'roasted', 'braised', 'grilled', 'broiled', 'fried', 'baked', 'boiled', 'simmered',
                   'stewed', 'steamed', 'microwaved', 'heated', 'toasted', 'scrambled', 'poached'}
    is_eaten = lambda m: bool(set(words(descriptions[m])) & eaten_words)
    eaten_kinds = [m for lab in grouped for m in roots[lab] if is_eaten(m)]
    print(f'  kinds in grouped roots with an as-eaten word : {len(eaten_kinds)} of {sum(len(roots[lab]) for lab in grouped)}')
    mixed = [lab for lab in grouped if any(is_eaten(m) for m in roots[lab]) and not all(is_eaten(m) for m in roots[lab])]
    print(f'  roots mixing as-bought and as-eaten kinds    : {len(mixed)} of {len(grouped)}, {pct(w_of(mixed))} of occasions')
    bad_default, bad_w = [], 0.0
    for lab in mixed:
        default, _ = elect(roots[lab], lab, descriptions, energy, weight)
        if is_eaten(default):
            bad_default.append(lab)
    print(f'  ⛔ ... whose elected default is AS EATEN        : {len(bad_default)} roots, {pct(w_of(bad_default))} of occasions')
    for lab in sorted(bad_default, key=lambda lab: -w_of([lab]))[:6]:
        default, _ = elect(roots[lab], lab, descriptions, energy, weight)
        print(f'     {pct(w_of([lab]))}  {lab[:28]:<28} default: {descriptions[default][:52]} ({energy.get(default, 0):.0f})')
    print('  ⚠️ An UPPER BOUND: the word list also flags items SOLD that way (dry roasted almonds, cooked ham).')
    print('     No "as bought" pairing is printed: pairing by energy matches the wrong item (fresh pasta, imported beef).')
    for lab in ('ham (cured)', 'beef (ground)'):
        if lab in roots:
            kept = [m for m in roots[lab] if not is_eaten(m)]
            print(f'  {lab}: {len(roots[lab])} kinds -> {len(kept)} as bought')
    sizes_after = sorted((sum(1 for m in roots[lab] if not is_eaten(m)) for lab in grouped), reverse=True)
    print(f'  largest groups, as bought only               : {sizes_after[:6]}')

    print('  --- 10b. the same split one level UP: a root and its "(raw)" twin both answer "ground beef" ---')
    by_label = set(roots)
    twins = []
    for lab in roots:
        if 'raw' not in words(lab):
            continue
        plain = re.sub(r'\s+', ' ', re.sub(r',?\s*\braw\b\s*,?', ' ', lab)).replace('( ', '(').replace(' )', ')')
        plain = re.sub(r'\(\s*\)', '', plain).strip().rstrip(',').strip()
        plain = plain.replace('(,', '(').replace(',)', ')')
        if plain != lab and plain in by_label:
            twins.append((plain, lab))
    cooked_side = [plain for plain, _ in twins]
    print(f'  root pairs "X" and "X (raw)"                 : {len(twins)}')
    print(f'  occasions on the NON-raw twin               : {pct(w_of(cooked_side))}')
    for plain, raw_lab in sorted(twins, key=lambda t: -w_of([t[0]]))[:5]:
        print(f'     "{plain}" ({len(roots[plain])} kinds) beside "{raw_lab}" ({len(roots[raw_lab])} kinds)')
    if 'pasta' in roots:
        print('  pasta — every kind, energy and state:')
        for m in sorted(roots['pasta'], key=lambda m: energy.get(m, 0)):
            print(f'     {energy.get(m, float("nan")):>5.0f} kcal  {"as eaten " if is_eaten(m) else "as bought"}  '
                  f'w={weight.get(m, 0.0):>10.0f}  {descriptions[m][:60]}')

    print('\n' + '=' * 88)
    print('11. THE CURATION BUDGET — how few roots carry most of the grouped occasions')
    print('=' * 88)
    ranked = sorted(grouped, key=lambda lab: -w_of([lab]))
    grouped_total = w_of(grouped)
    running, count, kinds = 0.0, 0, 0
    marks = [0.5, 0.8, 0.9, 0.95]
    for lab in ranked:
        running += w_of([lab])
        count += 1
        kinds += len(roots[lab])
        while marks and running >= marks[0] * grouped_total:
            print(f'  {int(marks[0] * 100)}% of grouped occasions : {count:>4} roots, {kinds:>5} kinds to label')
            marks.pop(0)
    not_for_recipes = {'babyfood': 0, 'distribution program': 0, 'industrial': 0, 'restaurant': 0}
    for lab in grouped:
        for m in roots[lab]:
            text = descriptions[m].lower()
            for marker in not_for_recipes:
                if marker in text:
                    not_for_recipes[marker] += 1
    print('  kinds whose source names something a home recipe does not buy: '
          + ', '.join(f'{k} {v}' for k, v in not_for_recipes.items()))

    print('\n' + '=' * 88)
    print('9. TWO CANDIDATE REFINEMENTS to R55\'s label (catalog rule, KTD-12 — measured, not ruled)')
    print('=' * 88)

    def inflections(label):
        """The root's words plus their simple plural/singular forms. Pure."""
        out = set()
        for w in words(label):
            out |= {w + 's', w + 'es'}
            if w.endswith('y'):
                out.add(w[:-1] + 'ies')
            if w.endswith('s'):
                out.add(w[:-1])
        return frozenset(out)

    became_empty = [lab for lab in single_kind
                    if not kind_label(descriptions[roots[lab][0]], lab, inflections(lab))]
    print(f'  (a) plural-aware strip: one-kind roots whose label becomes EMPTY (they would have no kinds)')
    print(f'      {len(became_empty)} of {len(single_kind)} roots, {pct(w_of(became_empty))} of occasions, e.g. '
          f'{sorted(became_empty, key=lambda lab: -w_of([lab]))[:5]}')
    lengths_a, lengths_b, weighted_b, emptied_b = [], [], [], 0
    for lab in grouped:
        extra = inflections(lab)
        texts = {m: kind_label(descriptions[m], lab, extra) for m in roots[lab]}
        lengths_a += [len(t) for t in texts.values()]
        shared = set.intersection(*[set(words(t)) for t in texts.values()])
        for m in roots[lab]:
            t = kind_label(descriptions[m], lab, extra | frozenset(shared))
            lengths_b.append(len(t))
            weighted_b.append((len(t), weight.get(m, 0.0)))
            if not t and texts[m]:
                emptied_b += 1
    for name, xs in (('as ruled (R55)', labels), ('(a) plural-aware', sorted(lengths_a)),
                     ('(a)+(b) also drop words every kind shares', sorted(lengths_b))):
        xs = sorted(xs)
        print(f'  {name:<44} median {median(xs):4.0f}   p90 {xs[int(.9 * len(xs)) - 1]:4}   '
              f'> 40 ch {sum(1 for x in xs if x > 40) / len(xs):4.0%}')
    print(f'  (a)+(b) consumption-weighted median : {weighted_quantile(weighted_b, .5)} characters')
    print(f'  ⛔ (a)+(b) labels that become EMPTY : {emptied_b}  (each would need the root name to stand alone)')

    print('  --- (b) ALONE, as a PICKER presentation (no catalog change): shared words move to the header ---')
    picker, picker_w, emptied, carried = [], [], 0, 0
    for lab in grouped:
        texts = {m: kind_label(descriptions[m], lab) for m in roots[lab]}
        shared = frozenset(set.intersection(*[set(words(t)) for t in texts.values()]))
        if shared & set(w for p in protected for w in words(p)):
            carried += 1
        for m in roots[lab]:
            t = kind_label(descriptions[m], lab, shared)
            picker.append(len(t))
            picker_w.append((len(t), weight.get(m, 0.0)))
            if not t and texts[m]:
                emptied += 1
    picker.sort()
    print(f'  option label                                 median {median(picker):4.0f}   p90 {picker[int(.9 * len(picker)) - 1]:4}   '
          f'> 40 ch {sum(1 for x in picker if x > 40) / len(picker):4.0%}   weighted median {weighted_quantile(picker_w, .5)}')
    print(f'  options that become EMPTY (only shared words) : {emptied}')
    print(f'  ⛔ roots whose shared words include a word of a protected segment : {carried} of {len(grouped)}')
    print('     -> why the ROW keeps the full label and only the picker moves shared words to its header')


if __name__ == '__main__':
    main()
