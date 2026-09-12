"""R55b: the interim clean-up of detail labels, measured over EVERY detail label before it is adopted.

WHY THIS FILE EXISTS. R55b ruled that detail labels ship as cleaned-up source text, and required the clean-up to
be measured over every detail label, with before-and-after examples, before anyone adopts it. §6.6 records four
name-rewriting rules that looked right on good examples and failed when measured. Its root cause is that whether a
word is identity or noise depends on the FOOD, not the string. So this script reports the bad outputs as well as the
good ones: labels that become identical to a sibling, labels that become empty, dropped words that distinguish
siblings, and labels that get longer.

THE BASELINE ("before") is `kindExamples.kind_label`, imported and not copied, so it cannot drift from what the owner
saw. The script checks this: the import's own printed report must equal the committed `kindExamples.txt` byte for byte,
or the script stops.

THE RULE ("after"), in order. Each phrase is kept whole or dropped whole; words are never removed from inside a
phrase, because that is what produced "regular and", "or bottled" and a trailing "with".
  1. Boilerplate: remove three fixed notes. USDA's program note, "(includes boiling and microwaving)", and "(N x 6.25)".
  2. Split on top-level commas only, so "all (gin, rum, vodka, whiskey) 80 proof" stays one segment. Inside a
     segment, USDA's `--` and a TRAILING bracket mark separate phrases, so "canned (jumbo-super colossal)" under
     `olives (canned)` can drop "canned" and keep the size. A first draft kept these whole and put the root word back
     ("canned jumbo-super colossal", "ham water added").
  3. Match each word by its WordNet noun lemma, so "onions" matches the root word "onion".
  4. Drop a phrase when every content word in it is a root word, singular or plural.
  5. Drop a phrase when every content word in it is a root word or a CATEGORY word, but only where it is safe (see
     below). A category word is a word from the unbracketed label of one of the root's edible FoodOn ancestors, e.g.
     "pork" for ham (`pork food product`), "nuts" for almond, "beverages" for coffee. The ancestors come from the
     food's own FoodOn IRI, so which words count as category depends on the food, not on a fixed list.
     ⛔ A category phrase is dropped ONLY when it is in the description's FIRST segment, or when EVERY member of the
     root carries it. USDA descriptions are inverted, so the food-group head sits first. A word that every sibling
     shares cannot tell siblings apart. Dropping a category word ANYWHERE was measured first and removed real
     distinctions that no collision count sees, because the strings stay different. For example, FoodOn's
     `plant stem or spear food product` made "spears" a category word for frozen broccoli, and `potato prepared food`
     made "prepared" one for hash browns. The script prints all four scopes it tried.
     Function words (and, or, with, of, ...) do not count as content. A phrase made only of function words is
     dropped. A phrase holding a negation ("without", "no", "not", "non") that is not itself a root word is kept.
  6. Keep every other phrase whole. A segment none of whose phrases was dropped is rendered exactly as the baseline
     renders it, with the baseline's own tokeniser, so any difference comes from the rule and not from punctuation.
The default kind is still chosen on the RAW strip (R55, §16 item 3). Clean-up is display only, so a label that
becomes empty here is a display defect, not a new plain member.

A GUARDED variant is measured beside the raw rule. It gives a member its baseline label back when the clean-up would
make that label empty, or identical to a sibling's. The number of members it touches measures how much of the rule
is unsafe.

POPULATIONS.
  K: the `kindExamples` grouping, with the root as USDA's FoodOn name. This is what the owner reviewed.
  P: the `foodOnMappingPatch.csv` grouping, `accepted` + `added` only, with the root as the current FoodOn label.
     This is what `seed:usda-bulk` will group from (R54b).
In population K, a member the patch FLAGS is tagged [R54b-flagged]. Its odd label is a mapping error, not a clean-up
error (for example orange juice under olives).

INPUTS. Everything listed in README.md, plus the WordNet 3.0 corpus. Download it with
    python3 -m nltk.downloader -d .local-sandbox/nltk_data wordnet
sha256 of `.local-sandbox/nltk_data/corpora/wordnet.zip` when measured:
    cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59
WordNet is used instead of a suffix rule because a suffix rule turns "molasses", "hummus", "asparagus" and "citrus"
into non-words. It has one known miss ("cookies" -> "cooky"), so the leftover root words are counted by an
INDEPENDENT suffix oracle, not by WordNet.
"""

import contextlib
import csv
import functools
import io
import random
import re
import statistics
import sys
from collections import Counter, defaultdict

REPO = '/home/brandon/Development/KitchenSink/'
REPORTS = REPO + 'docs/reports/2026-09-22/'
SANDBOX = REPO + '.local-sandbox/'
sys.path.insert(0, REPORTS)

_kind_out, _foodon_out = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(_kind_out):
    import kindExamples as ke  # noqa: E402  -- the committed authority for roots, labels and defaults
with contextlib.redirect_stdout(_foodon_out):
    import foodOnCoverageV2 as fo  # noqa: E402  -- the committed OWL parse (lxml, three edible branches)

if _kind_out.getvalue() != open(REPORTS + 'kindExamples.txt', encoding='utf-8').read():
    sys.exit('DRIFT: kindExamples.py no longer reproduces kindExamples.txt; the baseline is not what the owner saw')

import nltk  # noqa: E402

nltk.data.path.insert(0, SANDBOX + 'nltk_data')
from nltk.stem import WordNetLemmatizer  # noqa: E402

LEMMATIZER = WordNetLemmatizer()
FUNCTION = {'and', 'or', 'with', 'of', 'in', 'for', 'the', 'a', 'an', 'to', 'from', 'by', 'as', 'on', 'at'}
NEGATION = {'without', 'no', 'not', 'non'}
BOILERPLATE = (
    ('USDA program note', re.compile(r"\(?\s*includes foods for usda.s food distribution program\s*\)?", re.I)),
    ('cooking-method note', re.compile(r'\(\s*includes boiling and microwaving\s*\)', re.I)),
    ('nitrogen factor', re.compile(r'\(\s*n\s*x\s*6\.25\s*\)', re.I)),
)
TOP_LEVEL_COMMA = re.compile(r',(?![^()]*\))')
BASELINE_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9%/'-]*")  # kindExamples.kind_label's own token rule
RULE_SCOPE = 'first-or-all'
CATEGORY_SCOPES = {
    'first-or-all': lambda first, everyone: first or everyone,
    'anywhere': lambda first, everyone: True,
    'first only': lambda first, everyone: first,
    'every member only': lambda first, everyone: everyone,
}
LONG = 40
EXAMPLE_SEED = 20260922
PATCH = REPORTS + 'foodOnMappingPatch.csv'


@functools.lru_cache(maxsize=None)
def lemma(word):
    """WordNet noun lemma. Pure (the corpus is read-only)."""
    return LEMMATIZER.lemmatize(word, 'n')


def words(text):
    return re.findall(r'[a-z0-9]+', text.lower())


def forms(text):
    """Surface words and their lemmas. Pure."""
    out = set()
    for w in words(text):
        out |= {w, lemma(w)}
    return out


def render(segment):
    """A kept segment in the baseline's surface form; commas inside brackets survive as commas. Pure."""
    parts = [' '.join(BASELINE_TOKEN.findall(p)).lower() for p in segment.split(',')]
    return ', '.join(p for p in parts if re.search(r'[a-z0-9]', p))


@functools.lru_cache(maxsize=None)
def category_forms(iris):
    """Words of the unbracketed labels of the root's edible FoodOn ancestors, with lemmas. Pure over the parse."""
    out = set()
    for iri in iris:
        for ancestor in fo.ancestors(iri):
            if ancestor in fo.edible or ancestor in fo.EDIBLE_ROOTS:
                out |= forms(re.sub(r'\([^)]*\)', ' ', fo.label_of.get(ancestor, '')))
    return frozenset(out - FUNCTION)


def classify(segment, root_forms, cat_forms):
    """One of: kept, negation-kept, root, category, function-only. Pure."""
    tokens = words(segment)
    content = [t for t in tokens if t not in FUNCTION]
    if not content:
        return 'function-only'
    is_root = [t in root_forms or lemma(t) in root_forms for t in content]
    is_cat = [t in cat_forms or lemma(t) in cat_forms for t in content]
    if not all(r or c for r, c in zip(is_root, is_cat, strict=True)):
        return 'kept'
    if any(t in NEGATION and t not in root_forms for t in tokens):
        return 'negation-kept'
    return 'root' if all(is_root) else 'category'


def phrases(segment):
    """A segment's phrases: USDA's `--` separates two, and a TRAILING bracket is its own phrase, so
    `canned (jumbo-super colossal)` can lose `canned` and keep the size. A bracket in mid-phrase is left alone
    (`all (gin, rum, vodka, whiskey) 80 proof`). Pure."""
    out = []
    for piece in re.split(r'\s*--\s*', segment):
        match = re.match(r'^(.*\S)\s*\(([^()]*)\)\s*$', piece)
        out.extend([match.group(1), match.group(2)] if match else [piece])
    return [p for p in out if render(p)]


def clean_root(root, members, cat_forms, scope=RULE_SCOPE):
    """{fdc_id: (label, trace)} for every member of one root. The trace says what was removed or protected, and why.
    Needs the whole root because a category phrase's fate depends on whether every sibling carries it. Pure."""
    root_forms = forms(root)
    parsed = {}
    for m in members:
        text, trace = ke.desc[m], []
        for name, pattern in BOILERPLATE:
            if pattern.search(text):
                trace.append(('boilerplate', name))
                text = pattern.sub(' ', text)
        segments = [s for s in TOP_LEVEL_COMMA.split(text) if render(s)]
        parsed[m] = (trace, [(s, [(i == 0, render(p), classify(p, root_forms, cat_forms)) for p in phrases(s)])
                             for i, s in enumerate(segments)])
    holders = Counter()
    for _, segments in parsed.values():
        holders.update({text for _, ps in segments for _, text, kind in ps if kind == 'category'})
    out = {}
    for m, (trace, segments) in parsed.items():
        kept = []
        for segment, ps in segments:
            kept_phrases = []
            for first, text, kind in ps:
                if kind == 'category' and not CATEGORY_SCOPES[scope](first, holders[text] == len(members)):
                    kind = 'category-protected'
                if kind in ('kept', 'negation-kept', 'category-protected'):
                    kept_phrases.append(text)
                if kind != 'kept':
                    trace.append((kind, text))
            if len(kept_phrases) == len(ps):
                kept.append(render(segment))
            elif kept_phrases:
                kept.append(' '.join(kept_phrases))
        out[m] = (', '.join(kept), trace)
    return out


def regular_plurals(word):
    """INDEPENDENT oracle for leftover root words; a crude suffix rule on purpose, so it cannot share WordNet's
    misses. Detection only; never used to decide anything. Pure."""
    out = {word, word + 's', word + 'es'}
    if word.endswith('y'):
        out.add(word[:-1] + 'ies')
    if word.endswith('f'):
        out.add(word[:-1] + 'ves')
    if word.endswith('fe'):
        out.add(word[:-2] + 'ves')
    return out


def leftover_root_words(label, root):
    oracle = set()
    for w in words(root):
        if len(w) >= 3 and w not in FUNCTION:
            oracle |= regular_plurals(w)
    return [w for w in words(label) if w in oracle]


def restates_root(label, root):
    """A whole segment made only of the root's words, in any regular plural (`onions` under `onion`). Pure."""
    return any([w for w in words(seg) if w not in FUNCTION]
               and set(w for w in words(seg) if w not in FUNCTION) <= set(leftover_root_words(seg, root))
               for seg in label.split(', '))


DEFECT_DETECTORS = (
    ('1 a segment that only restates the root (e.g. "onions")', restates_root),
    ('2 USDA boilerplate ("includes foods for usda\'s ...", "n x 6.25")',
     lambda label, root: bool(re.search(r"food distribution program|includes boiling|n x 6", label))),
    ('3 the owner\'s category words as a whole segment (beverages, ...)',
     lambda label, root: bool({'beverages', 'cereals', 'nuts', 'products'} & set(label.split(', ')))),
    # Whitespace, not \b, so `bone-in` is not "ending in `in`". It still counts USDA's own serial comma
    # (`calcium, and potassium`), equally before and after.
    ('4 a dangling word: segment ends in a function word or starts "and"/"or"',
     lambda label, root: any(re.search(r'^(and|or)\s|(^|\s)(and|or|with|of|in|for)$', seg)
                             for seg in label.split(', ') if seg)),
)


def pct(n, d):
    return f'{n / d:.1%}' if d else 'n/a'


def length_stats(labels):
    lengths = sorted(len(x) for x in labels if x)
    p90 = lengths[min(len(lengths) - 1, int(0.9 * len(lengths)))]
    over = sum(1 for n in lengths if n > LONG)
    return (f'non-empty n={len(lengths):>5}  median={statistics.median(lengths):>5.1f}  p90={p90:>4}  '
            f'over {LONG} ch={over:>5} ({pct(over, len(lengths))})')


def usda_foodon_ids():
    """fdc_id -> FoodOn IRI, with the '#1 wins' preference kindExamples applies to the name. @sideEffect reads CSV."""
    ids = {}
    id_attrs = {n.replace('Name', 'ID') for n in ke.FOODON_ATTRS}
    for row in csv.DictReader(open(ke.FULL + 'food_attribute.csv', encoding='utf-8', errors='replace')):
        name, value = (row.get('name') or '').strip(), (row.get('value') or '').strip()
        if name in id_attrs and value and (row['fdc_id'] not in ids or name.endswith('#1 For FDC Item')):
            ids[row['fdc_id']] = value
    return ids


def population_k(patch_status):
    ids = usda_foodon_ids()
    groups = {root: members for root, members in ke.groups.items() if len(members) > 1}
    iris = {root: frozenset(ids[m] for m in members if m in ids) for root, members in groups.items()}
    return groups, iris, {m: patch_status.get(m) == 'flagged' for ms in groups.values() for m in ms}


def population_p(patch_rows):
    groups, iris = defaultdict(list), defaultdict(set)
    for row in patch_rows:
        if row['status'] in ('accepted', 'added') and row['fdc_id'] in ke.desc and row['fdc_id'] in ke.kcal:
            groups[row['foodon_label']].append(row['fdc_id'])
            iris[row['foodon_label']].add(row['foodon_iri'])
    groups = {root: members for root, members in groups.items() if len(members) > 1}
    return groups, {root: frozenset(iris[root]) for root in groups}, {}


def normal(label):
    return ' '.join(words(label))


def bag(label):
    return tuple(sorted(lemma(w) for w in words(label) if w not in FUNCTION))


def collisions(members, key, field):
    """Groups of >= 2 members whose `field` is identical under `key`, non-empty labels only. Pure."""
    buckets = defaultdict(list)
    for row in members:
        if row[field]:
            buckets[key(row[field])].append(row)
    return [b for b in buckets.values() if len(b) > 1]


def guard(members):
    """Give a member its baseline label back when clean-up would empty it or merge it with a sibling. Sets `guarded`
    on the rows. Repeats until stable, since a restored label could itself collide."""
    for row in members:
        if row['before'] and not row['after']:
            row['guarded'], row['guard_reason'] = row['before'], 'would be empty'
        else:
            row['guarded'], row['guard_reason'] = row['after'], ''
    changed = True
    while changed:
        changed = False
        for bucket in collisions(members, normal, 'guarded'):
            if len({normal(r['before']) for r in bucket}) > 1:
                for row in bucket:
                    if row['guarded'] != row['before']:
                        row['guarded'], row['guard_reason'], changed = row['before'], 'would merge with a sibling', True


def measure(groups, iris, scope=RULE_SCOPE):
    """Every member's before, after, trace and guarded label, grouped by root. Pure over the loaded data."""
    by_root = {}
    for root, members in groups.items():
        cleaned = clean_root(root, members, category_forms(iris[root]), scope)
        by_root[root] = [{'root': root, 'fdc': m, 'before': ke.kind_label(ke.desc[m], root), 'after': cleaned[m][0],
                          'trace': cleaned[m][1], 'kcal': ke.kcal[m]} for m in members]
        guard(by_root[root])
    return [r for ms in by_root.values() for r in ms], by_root


def new_collision_groups(by_root):
    return [b for ms in by_root.values() for b in collisions(ms, normal, 'after')
            if len({normal(r['before']) for r in b}) > 1]


def category_split(by_root):
    """(shared, some): category drops held by every member of the root vs by only some. Pure."""
    shared, some = [], []
    for root, ms in by_root.items():
        seen = defaultdict(set)
        for r in ms:
            for kind, text in r['trace']:
                if kind == 'category':
                    seen[text].add(r['fdc'])
        for text, holders in seen.items():
            (shared if len(holders) == len(ms) else some).append((root, text, len(holders), len(ms)))
    return shared, some


def cause_of(bucket):
    """What removed the material that told these members apart. Pure."""
    removed = [Counter(row['trace']) for row in bucket]
    differing = set()
    for a in removed:
        for b in removed:
            differing |= set((a - b).elements())
    return sorted({kind if kind != 'boilerplate' else f'boilerplate: {text}' for kind, text in differing}) or ['?']


def report(title, groups, iris, flagged):
    rows, by_root = measure(groups, iris)
    n = len(rows)
    print('=' * 110)
    print(title)
    print('=' * 110)
    print(f'grouped roots: {len(groups)}   detail labels (members): {n}')
    changed = [r for r in rows if r['after'] != r['before']]
    print(f'\nlabels CHANGED by the clean-up : {len(changed):>5} of {n} ({pct(len(changed), n)})')
    print(f'  before : {length_stats([r["before"] for r in rows])}')
    print(f'  after  : {length_stats([r["after"] for r in rows])}')
    print(f'  guarded: {length_stats([r["guarded"] for r in rows])}')
    longer = [r for r in rows if len(r['after']) > len(r['before'])]
    longer_root = sum(1 for r in longer if leftover_root_words(r['after'], r['root']))
    print(f'  labels LONGER after than before: {len(longer)}; {longer_root} of them because a mixed segment was kept'
          f' whole and so keeps a root word the baseline cut out of the phrase')

    print('\nTHE OWNER\'S FOUR DEFECT CLASSES, counted by detectors that do NOT use the rule\'s own classifier'
          ' (labels holding one):')
    for name, detect in DEFECT_DETECTORS:
        print(f'  {name:<62} before {sum(1 for r in rows if detect(r["before"], r["root"])):>5}'
              f'   after {sum(1 for r in rows if detect(r["after"], r["root"])):>5}'
              f'   guarded {sum(1 for r in rows if detect(r["guarded"], r["root"])):>5}')
    for name, detect in DEFECT_DETECTORS[2:]:
        left = sorted({(r['root'], r['after']) for r in rows if detect(r['after'], r['root'])})
        print(f'  residual after clean-up, class {name[0]} ({len(left)} labels):')
        for root, after in left:
            print(f'      {root}: "{after}"')

    empty_before = sum(1 for r in rows if not r['before'])
    new_empty = [r for r in rows if r['before'] and not r['after']]
    print(f'\nEMPTY labels before: {empty_before}   after: {sum(1 for r in rows if not r["after"])}   '
          f'NEWLY empty: {len(new_empty)}')
    multi_before = [k for k, ms in by_root.items() if sum(1 for r in ms if not r['before']) >= 2]
    multi_after = [k for k, ms in by_root.items() if sum(1 for r in ms if not r['after']) >= 2]
    print(f'  roots with >= 2 EMPTY labels: before {len(multi_before)}, after {len(multi_after)}: {multi_after}')

    print('\nIDENTICAL labels within one root (two details a cook cannot tell apart), non-empty labels:')
    for name, key in (('exact text', normal), ('same words, any order', bag)):
        b = sum(len(c) for ms in by_root.values() for c in collisions(ms, key, 'before'))
        a_groups = [c for ms in by_root.values() for c in collisions(ms, key, 'after')]
        g = sum(len(c) for ms in by_root.values() for c in collisions(ms, key, 'guarded'))
        print(f'  {name:<22}: labels in a collision  before {b:>4}   after {sum(len(c) for c in a_groups):>4}'
              f'   guarded {g:>4}')
    for bucket in (b for ms in by_root.values() for b in collisions(ms, normal, 'before')):
        print(f'  already identical BEFORE (USDA rows the baseline cannot tell apart): "{bucket[0]["root"]}": '
              + ' | '.join(ke.desc[r['fdc']] for r in bucket))
    new_groups = new_collision_groups(by_root)
    causes = Counter(c for bucket in new_groups for c in cause_of(bucket))
    print(f'  NEW collisions caused by the clean-up: {len(new_groups)} groups,'
          f' {sum(len(b) for b in new_groups)} labels; cause: '
          + ', '.join(f'{c} {k}' for c, k in causes.most_common()))

    touched = [r for r in rows if r['guarded'] != r['after']]
    reasons = Counter(r['guard_reason'] for r in touched)
    print(f'\nGUARD touches {len(touched)} of {n} members ({pct(len(touched), n)}): '
          + ', '.join(f'{k} {v}' for k, v in reasons.most_common()))

    steps, labels_by_step = Counter(), defaultdict(set)
    for r in rows:
        for kind, text in r['trace']:
            key = f'boilerplate: {text}' if kind == 'boilerplate' else kind
            steps[key] += 1
            labels_by_step[key].add(r['fdc'])
    print('\nWHAT THE RULE DID (phrases; labels touched). "protected" = a category phrase the scope kept:')
    for key, k in steps.most_common():
        print(f'  {key:<40} {k:>5} phrases  {len(labels_by_step[key]):>5} labels')

    leftover = sum(1 for r in rows if leftover_root_words(r['after'], r['root']))
    whole = [(r, seg) for r in rows for seg in r['after'].split(', ')
             if [w for w in words(seg) if w not in FUNCTION]
             and set(w for w in words(seg) if w not in FUNCTION) <= set(leftover_root_words(seg, r['root']))]
    print(f'\nLEFTOVER root words (independent suffix oracle): {leftover} labels still hold one inside a phrase kept'
          f' whole (by design); {len(whole)} kept segments are made ONLY of root words (a lemmatiser miss).')
    for r, seg in whole[:15]:
        print(f'      root "{r["root"]}"  kept "{seg}"  in  "{r["after"]}"')

    shared, some = category_split(by_root)
    print(f'\nCATEGORY drops: {len(shared) + len(some)} (root, phrase) pairs. Held by EVERY member (restates the'
          f' root): {len(shared)}. Held by only SOME (a first segment; may tell siblings apart, review each):'
          f' {len(some)}')
    for root, text, h, t in sorted(some, key=lambda x: (x[1], x[0])):
        print(f'      "{text}" under "{root}"   in {h} of {t} members')
    distinct = Counter(text for r in rows for kind, text in r['trace'] if kind == 'category')
    print(f'  distinct category segments dropped: {len(distinct)} (one example each)')
    for text, k in distinct.most_common():
        ex = next(r for r in rows if ('category', text) in r['trace'])
        print(f'      {k:>4}  "{text}"   e.g. {ex["root"]}: "{ex["before"]}" -> "{ex["after"] or "(empty)"}"')

    print(f'\nCATEGORY SCOPE, every variant measured (the rule uses "{RULE_SCOPE}"):')
    for scope in CATEGORY_SCOPES:
        s_rows, s_by_root = measure(groups, iris, scope)
        _, s_some = category_split(s_by_root)
        dropped = sum(1 for r in s_rows if any(k == 'category' for k, _ in r['trace']))
        emptied = sum(1 for r in s_rows if r['before'] and not r['after'])
        print(f'  {scope:<18} labels with a category drop {dropped:>4}'
              f'   held by only some {len(s_some):>3}   newly empty {emptied:>3}'
              f'   new collision groups {len(new_collision_groups(s_by_root)):>2}'
              f'   guard touches {sum(1 for r in s_rows if r["guarded"] != r["after"]):>3}')
    return rows, by_root, new_groups, new_empty, flagged


def r55_recheck():
    """R55 defines a plain member by an EXACT-word strip. Re-count it with plural-aware matching, over every root.
    Pure over the loaded data."""
    print('\n' + '=' * 110)
    print('R55 RE-CHECK: the plain-member strip, exact words (R55 as written) vs plural-aware (this clean-up\'s'
          ' matching)')
    print('=' * 110)
    matchers = (('exact words', lambda w, rf: w in rf), ('plural-aware', lambda w, rf: w in rf or lemma(w) in rf))
    for name, same in matchers:
        alone = grouped = 0
        multi, subset = [], []
        for root, members in ke.groups.items():
            rf = set(words(root)) if name == 'exact words' else forms(root)
            empty = [m for m in members if not [w for w in words(ke.desc[m]) if not same(w, rf)]]
            alone += bool(empty) and len(members) == 1
            grouped += bool(empty) and len(members) > 1
            if len(empty) >= 2:
                multi.append(f'{root}: ' + ' | '.join(ke.desc[m] for m in empty))
            root_content = {lemma(w) for w in words(root)}
            subset += [f'"{ke.desc[m]}" under "{root}"' for m in empty
                       if len(members) > 1 and {lemma(w) for w in words(ke.desc[m])} < root_content]
        print(f'  {name:<13}: roots whose item matches the root: alone {alone:>4}, in a group {grouped:>3};'
              f'  roots with >= 2 such items: {len(multi)}')
        for line in multi:
            print(f'      {line}')
        print(f'      ⚠️ in a group, an "empty" item that names LESS than the root (a strict subset of its words): '
              f'{len(subset)}')
        for line in subset:
            print(f'         {line}')


def show(row, flagged, note=''):
    after = row['after'] or '(empty)'
    guarded = '' if row['guarded'] == row['after'] else f'   GUARDED -> "{row["guarded"] or "(empty)"}"'
    tag = '  [R54b-flagged]' if flagged.get(row['fdc']) else ''
    print(f'    {row["kcal"]:>4.0f}  "{row["before"] or "(same as the root)"}"\n'
          f'       -> "{after}"{guarded}{tag}{note}')


def examples(rows, by_root, new_groups, new_empty, flagged):
    print('\n' + '=' * 110)
    print('EXAMPLES, population K. kcal/100 g  "before" -> "after"; GUARDED shows the guarded label where it differs')
    print('=' * 110)
    print('\n[1] Every kind of the 36 roots the owner reviewed in kindExamples.txt, in calories order:')
    for _, root, _ in ke.grouped[:ke.ROOTS_SHOWN]:
        print(f'  {root}')
        for row in sorted(by_root[root], key=lambda r: (r['kcal'], int(r['fdc']))):
            show(row, flagged)
    print(f'\n[2] EVERY new collision ({len(new_groups)} groups): the worst output this rule produces')
    for bucket in sorted(new_groups, key=lambda b: b[0]['root']):
        print(f'  {bucket[0]["root"]}   cause: {", ".join(cause_of(bucket))}')
        for row in bucket:
            show(row, flagged)
    print(f'\n[3] EVERY newly empty label ({len(new_empty)}):')
    for row in sorted(new_empty, key=lambda r: r['root']):
        print(f'  {row["root"]}')
        show(row, flagged)
    print('\n[4] The 15 longest labels after clean-up:')
    for row in sorted(rows, key=lambda r: -len(r['after']))[:15]:
        print(f'  {row["root"]}  ({len(row["after"])} ch)')
        show(row, flagged)
    print('\n[5] The 15 labels that GREW most:')
    for row in sorted(rows, key=lambda r: len(r['before']) - len(r['after']))[:15]:
        print(f'  {row["root"]}  (+{len(row["after"]) - len(row["before"])} ch)')
        show(row, flagged)
    print(f'\n[6] A seeded random sample of 40 changed labels (seed {EXAMPLE_SEED}):')
    changed = sorted((r for r in rows if r['after'] != r['before']), key=lambda r: (r['root'], int(r['fdc'])))
    for row in random.Random(EXAMPLE_SEED).sample(changed, min(40, len(changed))):
        print(f'  {row["root"]}')
        show(row, flagged)


def main():
    patch_rows = list(csv.DictReader(open(PATCH, encoding='utf-8')))
    patch_status = {row['fdc_id']: row['status'] for row in patch_rows}
    print('R55b DETAIL-LABEL CLEAN-UP, measured. Baseline = kindExamples.kind_label (drift-checked against'
          ' kindExamples.txt).\n')
    k = report('POPULATION K: kindExamples grouping (USDA FoodOn name as root; what the owner reviewed)',
               *population_k(patch_status))
    report('POPULATION P: foodOnMappingPatch.csv accepted + added (what seed:usda-bulk will group from)',
           *population_p(patch_rows))
    r55_recheck()
    examples(*k)


if __name__ == '__main__':
    main()
