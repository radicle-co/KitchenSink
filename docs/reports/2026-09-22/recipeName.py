"""R53b: the recipe form of a FoodOn root name, measured over EVERY root name before it is adopted.

WHY THIS FILE EXISTS. R53b ruled that inside a recipe a food's name reads the way cooks write it: drop the state words
a recipe implies, reorder a bracketed form into natural order (`beef (ground, raw)` -> `ground beef`), and keep the
words that identify the food. It is a rule that rewrites names, like the four §6.6 records as failures, so R53b
requires it to be measured on every FoodOn root name with before-and-after examples first. The defect that matters is
a COLLISION: two DIFFERENT roots that end up with the same recipe name, so a cook reading the recipe cannot tell which
food the line is bound to. The script counts collisions, says what caused each one, and scores how much they matter
by the calorie gap between the collided roots and the share of eating they carry.

THE RULE, as the owner approved it:
  1. Parse `head (q1, q2, ...)`. In FoodOn labels a bracket is always a single TRAILING one. The only other
     brackets are in FoodOn's own `piece(s) of`, which is not a qualifier, so the parser requires a space before `(`.
     A label with an unclosed bracket is left unchanged and counted.
  2. Drop the state words a recipe implies. Two sets are measured separately, because they are different claims.
     `raw`, `uncooked` and `unprepared` are what "as bought" means, and a recipe lists ingredients as bought (§16
     item 3). `cooked` is NOT implied by a recipe: cooks write "cooked rice" and "cooked chicken". Dropping it merges
     cooked twins with uncooked ones, the error §16 item 3 was written to prevent. This script's own output shows it
     on `long-grain white rice (cooked)` and `(uncooked)`.
  ⛔ THE FINDING THAT DECIDES R53b. FoodOn models the raw form of a food as a SEPARATE term beside the unmarked one
     (`onion` and `onion (raw)`), and USDA files raw items under the raw term. So dropping "raw" hands two roots the
     same name. The script counts these STATE TWINS directly, then measures a GUARD and what it costs.
  3. Reorder what is left. A qualifier that starts with a preposition goes AFTER the head (`turkey breast with skin`).
     A qualifier of at most two words and no digit goes BEFORE it, in FoodOn's order (`ground beef`). Anything longer
     stays in its bracket (`lowfat cow milk (1% fat, vitamin a and d added)`), because prepending it produces
     nonsense.
  4. Number: FoodOn's own form is KEPT, which is singular, so `tomato (canned)` becomes `canned tomato`, not the
     owner's "canned tomatoes". A recipe line needs "1 onion" but "2 onions", and a mass noun never changes (`rice`,
     `flour`), so number depends on the QUANTITY and on each locale's plural rules. It belongs to the line renderer
     with ICU plural selection, not to the stored name, and a name-level pluralizer would write "rices". FoodOn
     itself is not uniformly singular (`refried beans`, `quick oats`), which the script counts.

MEASURED SEPARATELY, NOT APPROVED. Each needs its own owner ruling:
  S1  drop FoodOn's `piece of` / `piece(s) of` prefix. Without it, `piece of chicken breast (skinless)` becomes
      `skinless piece of chicken breast`.
  S2  drop FoodOn's `(dish)` qualifier. Without it, `refried beans (dish)` becomes `dish refried beans`.
  GUARD  drop a state word only where the result collides with no other root. Otherwise keep it, in natural order
      (`raw ground beef`).

COLLISIONS are compared after folding case, hyphens, punctuation and plurals (WordNet lemma), so `all-purpose` and
`all purpose` collide, and so do `canned tomato` and `canned tomatoes`. Word order still counts. Word-set equality is
reported as a second, stricter count.

POPULATIONS, as in `labelCleanup.py`. K is every root in `kindExamples` (USDA's FoodOn name). P is every
`accepted`/`added` label in `foodOnMappingPatch.csv` (the current FoodOn label). Each root's calories are those of the
kind `kindExamples.default_of` elects. ⚠️ That is the SUPERSEDED most-eaten rule; §16 item 3 now elects among
as-bought kinds. So the gaps are indicative, not the figures the shipped election would give. Eating weight is the
WWEIA day-1 weight that `kindExamples` already loads.

INPUTS: README.md's inputs plus the WordNet corpus, exactly as `labelCleanup.py`'s docstring states (the lemmatiser
is imported from it, so the two scripts cannot fold words differently).
"""

import contextlib
import csv
import io
import random
import re
import statistics
import sys
from collections import Counter, defaultdict

REPORTS = '/home/brandon/Development/KitchenSink/docs/reports/2026-09-22/'
sys.path.insert(0, REPORTS)
with contextlib.redirect_stdout(io.StringIO()):
    import labelCleanup as lc  # noqa: E402  -- one lemmatiser, one IRI loader, one drift-checked kindExamples

ke, fo = lc.ke, lc.fo
AS_BOUGHT = {'raw', 'uncooked', 'unprepared'}
COOKED = {'cooked'}
PREPOSITIONS = ('with ', 'without ', 'in ', 'from ', 'for ', 'on ')
BRACKET = re.compile(r'^(.*?\S)\s+\(([^()]*)\)\s*$')
PIECE_OF = re.compile(r'^piece(\(s\))? of\s+', re.I)
EXAMPLE_SEED = 20260922
GAP_THRESHOLD = 0.10  # the 10% spread the sibling reports gate on (displayLabelComposition.PROTECTED_MEDIAN_THRESHOLD)
# ⚠️ JUDGEMENT, not measurement: qualifiers that read wrong in front of the head ("mature kidney bean", "shell on
# chicken egg", "dish refried beans"). Read off section [2b], which lists every qualifier the rule moves in front.
READS_WRONG_IN_FRONT = {'mature', 'immature', 'shell on', 'shell off', 'cap off', 'shank off', 'dish', 'infant food',
                        'solids', 'cut fresh', 'frozen concentrate'}
VARIANTS = {
    'A  owner literal: drop raw/uncooked/unprepared/cooked': dict(drop=AS_BOUGHT | COOKED),
    'B  as-bought only: drop raw/uncooked/unprepared, KEEP cooked': dict(drop=AS_BOUGHT),
    'C  = A + S1 (drop "piece of") + S2 (drop "(dish)")': dict(drop=AS_BOUGHT | COOKED, piece=True, dish=True),
    'D  = B + S1 + S2': dict(drop=AS_BOUGHT, piece=True, dish=True),
}


def parse(name):
    """(head, qualifiers, well_formed). Pure."""
    if name.count('(') != name.count(')'):
        return name, [], False
    match = BRACKET.match(name)
    if not match:
        return name.strip(), [], True
    return match.group(1).strip(), [q.strip() for q in match.group(2).split(',') if q.strip()], True


def qualifier_class(q):
    """after / before / bracket. Pure."""
    if q.lower().startswith(PREPOSITIONS):
        return 'after'
    if len(q.split()) <= 2 and not re.search(r'\d', q):
        return 'before'
    return 'bracket'


def recipe_name(name, drop, piece=False, dish=False, keep=frozenset()):
    """The recipe form of a FoodOn name. `keep` holds state words the guard puts back. Pure."""
    head, quals, well_formed = parse(name)
    if not well_formed:
        return name
    if piece:
        head = PIECE_OF.sub('', head)
    quals = [q for q in quals if not (q.lower() in drop and q.lower() not in keep)]
    if dish:
        quals = [q for q in quals if q.lower() != 'dish']
    before = [q for q in quals if qualifier_class(q) == 'before']
    after = [q for q in quals if qualifier_class(q) == 'after']
    bracket = [q for q in quals if qualifier_class(q) == 'bracket']
    out = ' '.join(before + [head] + after)
    return f'{out} ({", ".join(bracket)})' if bracket else out


def key(name):
    """Collision key: case, hyphens, punctuation and plurals folded; word order kept. Pure."""
    return ' '.join(lc.lemma(w) for w in lc.words(name))


def plural_head(name):
    """True when the head's last word is already plural in WordNet (`refried beans`). Pure."""
    head_words = lc.words(parse(name)[0])
    return bool(head_words) and lc.lemma(head_words[-1]) != head_words[-1]


def bag(name):
    return tuple(sorted(lc.lemma(w) for w in lc.words(name)))


def roots_k():
    """root -> (members, iris). @sideEffect reads CSV."""
    ids = lc.usda_foodon_ids()
    return {root: (ms, frozenset(ids[m] for m in ms if m in ids)) for root, ms in ke.groups.items()}


def roots_p():
    groups, iris = defaultdict(list), defaultdict(set)
    for row in csv.DictReader(open(lc.PATCH, encoding='utf-8')):
        if row['status'] in ('accepted', 'added') and row['fdc_id'] in ke.desc and row['fdc_id'] in ke.kcal:
            groups[row['foodon_label']].append(row['fdc_id'])
            iris[row['foodon_label']].add(row['foodon_iri'])
    return {root: (ms, frozenset(iris[root])) for root, ms in groups.items()}


def profile(roots):
    """Per root: elected kcal and eating weight. Pure over the loaded data."""
    out = {}
    for root, (members, _) in roots.items():
        elected = ke.default_of(root, members) if len(members) > 1 else members[0]
        out[root] = (ke.kcal[elected], sum(ke.weight.get(m, 0.0) for m in members))
    return out


def collision_groups(names, keyer=key):
    buckets = defaultdict(list)
    for root, name in names.items():
        buckets[keyer(name)].append(root)
    return [sorted(b) for b in buckets.values() if len(b) > 1]


def cause(group):
    """Why these DIFFERENT roots meet. Pure."""
    def without(name, words):
        return tuple(sorted(lc.lemma(w) for w in lc.words(name) if w not in words))
    bags = {bag(r) for r in group}
    if len(bags) == 1:
        return 'same words already (case, order or plural only)'
    if len({without(r, AS_BOUGHT | COOKED) for r in group}) == 1:
        return 'state word dropped (raw/cooked twin)'
    if len({without(r, AS_BOUGHT | COOKED | {'piece', 's', 'of', 'dish'}) for r in group}) == 1:
        return 'FoodOn-ism dropped (S1 "piece of" / S2 "dish")'
    return 'other'


def guarded_names(roots, variant):
    """Variant names, with the state words put back on every root whose drop causes a collision. Iterates to a fixed
    point. Pure."""
    keep = {root: frozenset() for root in roots}
    while True:
        names = {root: recipe_name(root, keep=keep[root], **variant) for root in roots}
        touched = False
        for group in collision_groups(names):
            for root in group:
                _, quals, _ = parse(root)
                state = frozenset(q.lower() for q in quals if q.lower() in variant['drop'])
                if state - keep[root]:
                    keep[root] |= state
                    touched = True
        if not touched:
            return names, sum(1 for k in keep.values() if k)


def gap(group, prof):
    kcals = [prof[r][0] for r in group]
    return (max(kcals) - min(kcals)) / max(kcals) if max(kcals) else 0.0


def state_twins(roots):
    """Groups of roots whose names are equal once their state qualifiers are removed: FoodOn's `X` beside `X (raw)`.
    Pure."""
    buckets = defaultdict(list)
    for root in roots:
        head, quals, _ = parse(root)
        rest = [q for q in quals if q.lower() not in AS_BOUGHT | COOKED]
        buckets[(key(head), tuple(sorted(key(q) for q in rest)))].append(root)
    return [sorted(b) for b in buckets.values() if len(b) > 1]


PROCESS_WORDS = {'cooked', 'boiled', 'roasted', 'baked', 'braised', 'broiled', 'fried', 'grilled', 'stewed',
                 'steamed', 'microwaved', 'canned', 'frozen', 'dried', 'dehydrated', 'heated', 'simmered', 'poached',
                 'blanched', 'toasted', 'smoked', 'prepared'}


def unmarked_twin_contents(roots, twins):
    """For each twin group's UNMARKED root: are its members all processed (cooked, canned, frozen, ...), all raw,
    a mix, or neither? Read from the members' own USDA descriptions. Pure over the loaded data."""
    out = Counter()
    for group in twins:
        for root in group:
            if any(q.lower() in AS_BOUGHT | COOKED for q in parse(root)[1]):
                continue
            members = roots[root][0]
            processed = sum(1 for m in members if PROCESS_WORDS & set(lc.words(ke.desc[m])))
            raw = sum(1 for m in members if 'raw' in lc.words(ke.desc[m]))
            out['all members processed (cooked/canned/frozen/...)' if processed == len(members) and not raw else
                'all members raw' if raw == len(members) and not processed else
                'a mix of raw and processed members' if raw and processed else
                'some members say neither raw nor a process word'] += 1
    return out


def summarize(label, roots, names, prof, guard_count=None):
    groups = [g for g in collision_groups(names) if len({key(r) for r in g}) > 1]
    bag_groups = [g for g in collision_groups(names, bag) if len({key(r) for r in g}) > 1]
    in_collision = {r for g in groups for r in g}
    total_weight = sum(w for _, w in prof.values()) or 1.0
    gaps = [gap(g, prof) for g in groups]
    changed = sum(1 for r in roots if names[r] != r)
    causes = Counter(cause(g) for g in groups)
    print(f'\n  {label}')
    print(f'    names changed: {changed} of {len(roots)} ({lc.pct(changed, len(roots))})'
          + (f'   state words kept by the guard on {guard_count} roots' if guard_count is not None else ''))
    print(f'    ⛔ NEW collisions (two DIFFERENT roots, one recipe name): {len(groups)} groups, {len(in_collision)}'
          f' roots ({lc.pct(len(in_collision), len(roots))});  same words in any order: {len(bag_groups)} groups')
    if groups:
        eaten = lc.pct(sum(prof[r][1] for r in in_collision), total_weight)
        print(f'       share of eating weight in collided roots: {eaten}'
              f';  elected-kcal gap: median {statistics.median(gaps):.0%},'
              f' groups over {GAP_THRESHOLD:.0%}: {sum(1 for g in gaps if g > GAP_THRESHOLD)}')
        for c, n in causes.most_common():
            print(f'       cause: {c:<48} {n:>4} groups')
    if guard_count is not None:
        for group in groups:
            print(f'       residual: "{names[group[0]]}" <- ' + ' | '.join(group))
        kept = [r for r in roots if names[r] != r and any(w in AS_BOUGHT | COOKED for w in lc.words(names[r]))]
        print(f'       ⚠️ cost: {len(kept)} recipe names keep a state word, carrying'
              f' {lc.pct(sum(prof[r][1] for r in kept), total_weight)} of eating weight; the most eaten: '
              + ', '.join(f'"{names[r]}"' for r in sorted(kept, key=lambda r: -prof[r][1])[:10]))
    return groups


def report(title, roots):
    prof = profile(roots)
    print('=' * 110)
    print(title)
    print('=' * 110)
    shapes = Counter()
    for root in roots:
        head, quals, well_formed = parse(root)
        shapes['malformed bracket (left unchanged)' if not well_formed else
               'no bracket' if not quals else f'bracket with {len(quals)} qualifier(s)'] += 1
    print(f'root names with a FoodOn term: {len(roots)}   ' + ', '.join(f'{k}: {v}' for k, v in sorted(shapes.items())))
    print(f'  piece-of prefix: {sum(1 for r in roots if PIECE_OF.match(r))}   "(dish)": '
          f'{sum(1 for r in roots if "dish" in [q.lower() for q in parse(r)[1]])}   '
          f'already plural head word (WordNet): {sum(1 for r in roots if plural_head(r))}')
    quals = Counter(q.lower() for r in roots for q in parse(r)[1])
    by_class = Counter()
    for q, n in quals.items():
        by_class['state (as-bought)' if q in AS_BOUGHT else 'state (cooked)' if q in COOKED else
                 f'reorder {qualifier_class(q)}'] += n
    print('  qualifier occurrences by treatment: ' + ', '.join(f'{k} {v}' for k, v in sorted(by_class.items())))
    print('  distinct qualifiers kept in brackets (too long or numeric to prepend): '
          + '; '.join(sorted({q for q in quals if q not in AS_BOUGHT | COOKED and qualifier_class(q) == 'bracket'})))
    print(f'  "unprepared" as a qualifier: {quals["unprepared"]} occurrences (the owner\'s "possibly" is moot for'
          ' names);'
          f'  "uncooked": {quals["uncooked"]};  "cooked": {quals["cooked"]};  "raw": {quals["raw"]}')
    before = collision_groups({r: r for r in roots})
    print(f'  collisions BEFORE any rewrite (same key already): {len(before)} groups {before[:5]}')
    twins = state_twins(roots)
    print(f'  ⛔ STATE TWINS: {len(twins)} groups ({sum(len(t) for t in twins)} roots) are the same FoodOn name apart'
          f' from raw/cooked/uncooked, e.g. {twins[:3]}.  FoodOn models the raw form as a SEPARATE term, and USDA files'
          f' raw items under it, so any rule that drops "raw" must say which twin keeps the plain name.')
    print('  what the UNMARKED twin holds (its members\' USDA descriptions), which decides whether the plain name'
          ' should go to it:')
    for kind, n in unmarked_twin_contents(roots, twins).most_common():
        print(f'      {n:>4}  {kind}')
    wrong = [r for r in roots if any(q.lower() in READS_WRONG_IN_FRONT for q in parse(r)[1])]
    print(f'  reorder puts a qualifier in front that reads wrong there (JUDGEMENT, list below; overrule it by editing'
          f' READS_WRONG_IN_FRONT): {len(wrong)} roots;  plus "piece of" roots without S1: '
          f'{sum(1 for r in roots if PIECE_OF.match(r))}')
    results = {}
    for label, variant in VARIANTS.items():
        names = {root: recipe_name(root, **variant) for root in roots}
        results[label] = (names, summarize(label, roots, names, prof))
    a_groups, b_groups = (results[label][1] for label in list(VARIANTS)[:2])
    shared_iri = [g for g in a_groups if len(set().union(*(roots[r][1] for r in g))) < len(g)]
    print(f'\n  artefact check: collision groups under A whose roots share a FoodOn IRI (one term split by a drifted'
          f' name, not a real collision): {len(shared_iri)} {shared_iri[:3]}')
    b_keys = {tuple(g) for g in b_groups}
    only_a = [g for g in a_groups if tuple(g) not in b_keys]
    print(f'\n  collision groups that dropping "cooked" ADDS on top of the as-bought drop (A but not B): {len(only_a)}')
    for group in only_a:
        print(f'      "{results[list(VARIANTS)[0]][0][group[0]]}" <- '
              + ' | '.join(f'{r} [{prof[r][0]:.0f} kcal]' for r in group))
    for label in (list(VARIANTS)[0], list(VARIANTS)[2]):
        names, count = guarded_names(roots, VARIANTS[label])
        results[f'{label[:1]}+GUARD'] = (names, summarize(
            f'{label[:1]}+GUARD  = {label[3:]}, state word kept wherever dropping it collides', roots, names, prof,
            count))
    latent = latent_collisions(roots, results['A+GUARD'][0])
    print(f'\n  ⚠️ A+GUARD is stable only while the catalog does not change: {len(latent)} guarded names dropped a state'
          f' word and now EQUAL the label of an edible FoodOn term that is NOT in this catalog. A data update that'
          f' brings that term in turns each into a collision, and the guard then renames the food on reseed'
          f' (e.g. {", ".join(f"{r!r} -> {n!r}" for r, n, _ in latent[:4])}).')
    return prof, results


def latent_collisions(roots, names):
    """Names that dropped a state word and equal the label of an edible FoodOn term that is NOT a root in this
    catalog, so one data update away from a collision. Pure over the parse."""
    catalog_iris = set().union(*(iris for _, iris in roots.values()))
    catalog_keys = {key(r) for r in roots}
    by_label = defaultdict(set)
    for iri in fo.edible:
        by_label[key(fo.label_of[iri])].add(iri)
    out = []
    for root, (_, iris) in sorted(roots.items()):
        dropped = any(q.lower() in AS_BOUGHT | COOKED for q in parse(root)[1])
        others = by_label.get(key(names[root]), set()) - iris - catalog_iris
        if dropped and others and key(names[root]) not in catalog_keys and \
                not any(w in AS_BOUGHT | COOKED for w in lc.words(names[root])):
            out.append((root, names[root], sorted(fo.label_of[i] for i in others)[:2]))
    return out


def show(root, names_by_variant, prof, marks=''):
    a, b, c = (names_by_variant[v][root] for v in ('A', 'B', 'C'))
    extra = ''.join([f'   | B: "{b}"' if b != a else '', f'   | C: "{c}"' if c != a else ''])
    print(f'    "{root}"  ->  A: "{a}"{extra}   [{prof[root][0]:.0f} kcal]{marks}')


def examples(roots, prof, results):
    short = {label[:1]: results[label][0] for label in VARIANTS}
    groups_a = results[list(VARIANTS)[0]][1]
    print('\n' + '=' * 110)
    print('EXAMPLES, population K.  "FoodOn root" -> A: owner literal  | B: keeps "cooked" | C: A + S1 + S2  (B/C shown'
          ' only where they differ from A)')
    print('=' * 110)
    print('\n[1] The 40 most-eaten roots:')
    for root in sorted(roots, key=lambda r: -prof[r][1])[:40]:
        show(root, short, prof)
    print('\n[2] Every qualifier treatment, the worst first:')
    probes = ['refried beans (dish)', 'lowfat cow milk (1% fat, vitamin a and d added)',
              'piece of chicken breast (skinless)', 'piece of chicken meat (skinless)', 'kidney bean (mature)',
              'lima bean (immature)',
              'white wheat flour (all purpose)', 'tomato (canned)', 'beef (ground, raw)', 'beef (ground)',
              'long-grain white rice (cooked)', 'black tea (steeped)', 'potato (baked)', 'ham (cured)']
    probes += sorted(r for r in roots if any(q.lower() in ('shell on', 'shell off', 'cap off', 'shank off', 'solids',
                                                           'nonfat milk solids added', 'with giblets and neck',
                                                           'canned with tomato juice', 'whole cut or pieces',
                                                           'infant food', 'granulated and powdered')
                                             for q in parse(r)[1]))
    probes += sorted(r for r in roots if len(parse(r)[1]) >= 3)
    probes += sorted(r for r in roots if not parse(r)[2])
    for root in dict.fromkeys(p for p in probes if p in roots):
        show(root, short, prof)
    before_quals = Counter(q.lower() for r in roots for q in parse(r)[1]
                           if q.lower() not in AS_BOUGHT | COOKED and qualifier_class(q) == 'before')
    print(f'\n[2b] Every distinct qualifier the rule moves IN FRONT of the head ({len(before_quals)}), with its count'
          f' and one output, so the reorder can be judged qualifier by qualifier:')
    for q, n in sorted(before_quals.items(), key=lambda x: (-x[1], x[0])):
        example = next(r for r in sorted(roots) if q in [x.lower() for x in parse(r)[1]])
        print(f'    {n:>4}  {q:<24} "{example}" -> "{short["A"][example]}"')
    print(f'\n[3] The 30 worst NEW collisions under A, by eating weight ({len(groups_a)} groups in all; appendix'
          f' lists every one):')
    for group in sorted(groups_a, key=lambda g: -sum(prof[r][1] for r in g))[:30]:
        print(f'  "{short["A"][group[0]]}"  <- {cause(group)}; elected-kcal gap {gap(group, prof):.0%}')
        for root in group:
            print(f'      {root:<55} {prof[root][0]:>5.0f} kcal   eaten weight {prof[root][1]:>12,.0f}')
    print('\n[4] A seeded random sample of 30 changed names (seed %d):' % EXAMPLE_SEED)
    changed = sorted(r for r in roots if short['A'][r] != r)
    for root in random.Random(EXAMPLE_SEED).sample(changed, 30):
        show(root, short, prof)
    latent = latent_collisions(roots, results['A+GUARD'][0])
    print(f'\n[5] A+GUARD names one data update away from a collision ({len(latent)}): the name equals an edible FoodOn'
          f' term that no catalog food maps to yet:')
    for root, name, other in latent[:25]:
        print(f'    "{root}" -> "{name}"  is also FoodOn\'s  {other}')
    print(f'\nAPPENDIX: every NEW collision under A ({len(groups_a)} groups), recipe name <- roots [elected kcal]:')
    for group in sorted(groups_a, key=lambda g: short['A'][g[0]]):
        print(f'  "{short["A"][group[0]]}"  <- ' + ' | '.join(f'{r} [{prof[r][0]:.0f}]' for r in group))


def main():
    print('R53b RECIPE FORM OF A ROOT NAME, measured over every root name that has a FoodOn term.\n')
    k = roots_k()
    prof, results = report('POPULATION K: every kindExamples root (USDA\'s FoodOn name)', k)
    stale = sorted(r for r in k if key(r) not in {key(fo.label_of[i]) for i in k[r][1] if i in fo.label_of})
    print(f'\n  ⚠️ K root names that are NOT the current FoodOn label of their own IRI: {len(stale)}'
          f' (USDA\'s snapshot of the name has drifted), e.g. {stale[:6]}')
    report('POPULATION P: foodOnMappingPatch.csv accepted + added (current FoodOn label)', roots_p())
    examples(k, prof, results)


if __name__ == '__main__':
    main()
