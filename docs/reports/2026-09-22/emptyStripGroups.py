"""When a source item's name equals its FoodOn root's name, is it alone or in a group?

The owner asked how a group can contain an item whose name matches the root. This splits the roots that
have one PLAIN member into two populations: the item is the root's ONLY member (no group, the item
simply is the root), or other items share the same FoodOn term (a group, where the plain item is
the root's default).

The rule (plan R55): an item is plain when every word of its name appears in the root's name, ignoring order,
spacing, punctuation and plural (WordNet noun lemmas, so `Raspberries, raw` is plain under `raspberry (raw)`). It
is a SUBSET test on purpose. FoodOn often adds a word the source takes for granted (`Egg, white, dried` under
`chicken egg white (dried)`, `Vanilla extract` under `vanilla bean extract`), and strict equality would lose those.
A subset can also hide a wrong PART (`Taro, raw`, the corm, under `taro leaf (raw)`), but that is a wrong MAPPING,
which the R54b check flags before grouping. So two plain items under one root means a mapping error, and is printed.

⚠️ Corrected 2026-09-23: the first version did not fold plurals, so it reported 168 roots (153 alone, 15 in a group)
and `Raspberries, raw` was not plain. Both readings, and strict equality, are printed so the choice is visible.
"""

import csv
import re
from collections import defaultdict

import nltk

SANDBOX = "/home/brandon/Development/KitchenSink/.local-sandbox/"
SR = SANDBOX + "fdc/FoodData_Central_sr_legacy_food_csv_2018-04/"
FULL = SANDBOX + "fdc/FoodData_Central_csv_2026-04-30/"
FOODON_ATTRS = {
    "FoodOn Ontology Name #1 For FDC Item",
    "FoodOn Ontology Name For FDC Item",
    "FoodOn Ontology Name #2 For FDC Item",
}

nltk.data.path.insert(0, SANDBOX + "nltk_data")
from nltk.stem import WordNetLemmatizer  # noqa: E402

LEMMATIZER = WordNetLemmatizer()


def words(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def lemmas(text):
    return {LEMMATIZER.lemmatize(w, "n") for w in words(text)}


def plain(item, root):
    """The R55 rule: every word of the item appears in the root, plural folded. Pure."""
    return lemmas(item) <= lemmas(root)


def first_version(item, root):
    """The first version: the same subset test without plural folding. Pure."""
    return set(words(item)) <= set(words(root))


def strict(item, root):
    """Strict equality of the word sets, plural folded; shown only to justify the subset test. Pure."""
    return lemmas(item) == lemmas(root)


desc = {}
for row in csv.DictReader(open(SR + "food.csv", encoding="utf-8", errors="replace")):
    if (row.get("description") or "").strip():
        desc[row["fdc_id"]] = row["description"].strip()
foodon = {}
for row in csv.DictReader(open(FULL + "food_attribute.csv", encoding="utf-8", errors="replace")):
    name, value = (row.get("name") or "").strip(), (row.get("value") or "").strip()
    if name in FOODON_ATTRS and value and (row["fdc_id"] not in foodon or name.endswith("#1 For FDC Item")):
        foodon[row["fdc_id"]] = value

roots = defaultdict(list)
for fdc_id, label in foodon.items():
    if fdc_id in desc:
        roots[label.strip().lower()].append(fdc_id)


def split(test):
    """(alone, grouped, roots with two or more plain members) under one test. Pure."""
    alone, grouped, several = [], [], []
    for label, members in roots.items():
        matched = [m for m in members if test(desc[m], label)]
        if matched:
            (alone if len(members) == 1 else grouped).append((label, members, matched[0]))
        if len(matched) > 1:
            several.append((label, matched))
    return alone, grouped, several


alone, grouped, several = split(plain)
print(f"roots: {len(roots)}")
print(f"roots with an item whose name matches the root : {len(alone) + len(grouped)}")
print(f"  ... that item is the ONLY member (no group)   : {len(alone)}")
print(f"  ... other items share the FoodOn term (group) : {len(grouped)}")
print(f"  ... roots with TWO OR MORE such items         : {len(several)}  (each is a mapping error for R54b)")
for label, matched in several:
    print(f'       "{label}" <- ' + " | ".join(desc[m] for m in matched))
for name, test in (("first version, no plural folding", first_version), ("strict equality", strict)):
    a, g, s = split(test)
    print(f"{name:<34}: {len(a) + len(g)} roots, {len(a)} alone, {len(g)} in a group, {len(s)} with two or more")
lost = sorted(label for label, _, match in grouped if not strict(desc[match], label))
print(f"group defaults strict equality would lose: {len(lost)}: {lost}")
print("\nexamples of the group case:")
for label, members, match in sorted(grouped, key=lambda g: -len(g[1]))[:5]:
    print(f'  root "{label}"  ({len(members)} items)')
    print(f"     matches the root : {desc[match]}")
    for other in [m for m in members if m != match][:2]:
        print(f"     another item     : {desc[other]}")
