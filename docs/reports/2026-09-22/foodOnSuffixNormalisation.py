"""Does stripping FoodOn's structural label suffixes recover safe USDA matches — and what does it cost?

`soy sauce` was reported ABSENT from FoodOn. FoodOn has it, under the label `soy sauce food product`.
Exact matching missed it because the label carries a STRUCTURAL SUFFIX: a word or phrase naming the
genus the class sits under, appended to the name of the thing. This script measures how common that
shape is, how many additional SAFE USDA matches stripping it recovers, and — the number that actually
decides whether the technique may be used — how much NEW AMBIGUITY it manufactures.

⚠️ The parse is a deliberate COPY of `docs/reports/2026-09-22/foodOnCoverageV2.py`, which is the
authority for it and documents the four traps it avoids (partial TSV dump; regexed `owl:Class`
truncating on nested restrictions; parentage hiding in `owl:equivalentClass`; and the EDIBLE set being
a UNION of THREE branches, because two silently drops every butchery cut). A dated report is
self-contained on purpose — `2026-09-22` is not an importable module path, and a figure whose script
did not survive has already rotted twice in this work.

## The suffix list is DERIVED, not guessed — and the obvious derivations are all wrong

Three derivations were tried against the data before this one:

1. **Raw trailing-word frequency.** The top trailing 1-gram over the 27,651 edible labels is `foodex2`
   (4,524) and the second is `raw` (2,997). `raw` is SEMANTIC — `beef (raw)` is not `beef` — so
   frequency alone would strip the meaning out of three thousand labels.
2. **"Strip the trailing parenthetical."** 14,515 edible labels carry one, and they are two different
   things wearing one syntax: provenance tags (`(EFSA FoodEx2)` 4,524, `(GS1 GPC)` 872, `(US CFR)`
   180) sit beside qualifiers that change the substance (`(raw)` 2,492, `(canned)` 307, `(frozen)`
   235, `(dried)` 233). A rule keyed on the bracket cannot tell them apart.
3. **"The trailing n-gram is the label of an ANCESTOR of the class bearing it."** Semantically the
   right idea and still too wide: it admits `leaf` (151), `lobster` (52), `crab` (47), `apple` (14),
   `tomato` (13) — genuine parent FOODS — so `American lobster` would be stripped to `American`. That
   is the truncation failure that got head-noun-alone matching rejected at 801 matches.

What survives is the ancestor rule CONFINED TO THE UPPER STRUCTURE: a suffix qualifies only if it is
the label of a class at or ABOVE the three edible roots, or the HEAD NOUN of such a label. Exactly
four classes sit at or above those roots (`material entity`, `food product`, `food material`,
`organism material`), so the vocabulary is read out of the OWL and the allow-list already in force,
and nothing is written by hand. That yields the four suffixes this report was asked to cover at
minimum — ` food product`, ` food material`, ` product`, ` material` — plus ` organism material` and
` entity`, neither of which any label bears.

## Layering, and why the collision count is a DELTA

The exact lookup ALREADY has multi-class keys: 33,936 distinct names over 27,651 edible classes. An
absolute count of ambiguous keys after normalisation is not a safety verdict — only the increase is.
Three kinds are counted separately, because conflating them inverts the answer:

* **SHADOW** — a residue equals a name some OTHER class already holds exactly. This is the dangerous
  one, and it is invisible to a "did the key count drop?" check: it silently REDIRECTS a match that
  already worked. It is neutralised structurally rather than by counting — the exact layer stays
  PRIMARY and normalisation is a FALLBACK consulted only when exact matching finds nothing — but it
  is reported anyway, because the day someone flattens the two layers into one map is the day it bites.
* **NEW AMBIGUITY** — two different classes whose residues collide with each other and with nothing
  in the exact layer. Genuinely new, and unresolvable by layering.
* **DEGENERATE** — a residue that is empty, or is nothing but structural vocabulary (`food product`
  stripped of ` product` is `food`). Refused before it can become a key at all.

@sideEffect Reads the FoodOn OWL and two USDA CSVs; writes a report to stdout.
"""

import csv
import hashlib
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from lxml import etree

SANDBOX = "/home/brandon/Development/KitchenSink/.local-sandbox/"
OWL = SANDBOX + "foodon/foodon.owl"
SR = SANDBOX + "fdc/FoodData_Central_sr_legacy_food_csv_2018-04/"
FULL = SANDBOX + "fdc/FoodData_Central_csv_2026-04-30/"

# The measured digest of the OWL every figure below was derived from. FoodOn ships releases; a figure
# quoted against a different release is a different measurement wearing this one's numbers.
OWL_SHA256 = "b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf"

NS = {
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "obo": "http://www.geneontology.org/formats/oboInOwl#",
}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
SYN_TAGS = {f"{{{NS['obo']}}}{t}" for t in ("hasExactSynonym", "hasRelatedSynonym", "hasNarrowSynonym")}

# ⛔ THREE BRANCHES. See `foodOnCoverageV2.py` and `foodOnBranchAllowListGuard.py` — two is not enough, and
# the failure is silent in both directions.
FOOD_PRODUCT = "http://purl.obolibrary.org/obo/FOODON_00001002"
FOOD_MATERIAL = "http://purl.obolibrary.org/obo/FOODON_00002403"
ORGANISM_MATERIAL = "http://purl.obolibrary.org/obo/FOODON_03420116"
EDIBLE_ROOTS = {FOOD_PRODUCT, FOOD_MATERIAL, ORGANISM_MATERIAL}

FOODON_ATTRS = {
    "FoodOn Ontology Name #1 For FDC Item",
    "FoodOn Ontology Name For FDC Item",
    "FoodOn Ontology Name #2 For FDC Item",
}
SAFE_FORMS = {"full description", "all segments reversed", "first two un-inverted"}
COARSE_THRESHOLD = 15


def norm(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace. Pure."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", text.lower())).strip()


def digest(path: str) -> str:
    """SHA-256 of a file, streamed. Pure over the filesystem."""
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


# ---------------------------------------------------------------- parse the OWL

label_of, parents, synonyms, obsolete = {}, defaultdict(set), defaultdict(list), set()
for cls in etree.parse(OWL).getroot().findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    for child in cls:
        if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
            label_of[iri] = child.text.strip()
        elif child.tag == f"{{{NS['rdfs']}}}subClassOf":
            target = child.get(RESOURCE)
            if target:
                parents[iri].add(target)
            else:
                for nested in child.iter():
                    if nested.tag == f"{{{NS['owl']}}}Class" and nested.get(ABOUT):
                        parents[iri].add(nested.get(ABOUT))
        elif child.tag == f"{{{NS['owl']}}}equivalentClass":
            for nested in child.iter():
                if nested.tag in (f"{{{NS['owl']}}}Class", f"{{{NS['rdf']}}}Description"):
                    target = nested.get(ABOUT) or nested.get(RESOURCE)
                    if target and target != iri:
                        parents[iri].add(target)
        elif child.tag in SYN_TAGS and child.text:
            synonyms[iri].append(child.text.strip())
        elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or "").strip().lower() == "true":
            obsolete.add(iri)

sys.setrecursionlimit(60000)
_ancestor_cache = {}


def ancestors(iri: str, seen: frozenset[str] = frozenset()) -> set[str]:
    """Transitive parents, cycle-safe. Pure over the parsed graph."""
    if iri in _ancestor_cache:
        return _ancestor_cache[iri]
    if iri in seen:
        return set()
    guard, out = seen | {iri}, set()
    for parent in parents.get(iri, ()):
        out.add(parent)
        out |= ancestors(parent, guard)
    if not seen:
        _ancestor_cache[iri] = out
    return out


edible = {i for i in label_of if i not in obsolete and EDIBLE_ROOTS & ancestors(i)}

actual = digest(OWL)
print("FoodOn OWL")
print(f"  sha256                    : {actual}")
print(f"  matches the pinned digest : {'YES' if actual == OWL_SHA256 else 'NO  <- FIGURES BELOW ARE NOT COMPARABLE'}")
print(f"  classes / EDIBLE union    : {len(label_of)} / {len(edible)}")

# ------------------------------------------- derive the structural suffix vocabulary

upper = set(EDIBLE_ROOTS)
for root in EDIBLE_ROOTS:
    upper |= ancestors(root)
upper_labels = {norm(label_of[i]) for i in upper if i in label_of}
# The HEAD NOUN of a structural label is itself structural: `food product` -> `product`. This is what
# admits the bare ` product` / ` material` suffixes without anybody typing them.
head_nouns = {label.split()[-1] for label in upper_labels if label}
STRUCTURAL_SUFFIXES = sorted(upper_labels | head_nouns, key=lambda s: (-len(s.split()), s))
# Structural vocabulary = every word appearing in a structural label. A residue made only of these
# words names a genus, not a food, and must never become a lookup key.
STRUCTURAL_WORDS = {word for label in upper_labels for word in label.split()}

print("\nStructural suffix vocabulary (DERIVED — labels at/above the three edible roots, and their heads)")
for i in sorted(upper):
    print(f"    at/above root : {label_of.get(i, '(unlabelled)'):<22} {i.rsplit('/', 1)[-1]}")
print(f"    candidates    : {', '.join(repr(s) for s in STRUCTURAL_SUFFIXES)}")


def strip_suffix(name: str) -> tuple[str, str] | None:
    """Longest structural suffix, removed ONCE. Returns (residue, suffix) or None. Pure.

    Applied once rather than to a fixed point on purpose: iterating turns `food product` into `food`
    into nothing, and eats real words on the way.
    """
    for suffix in STRUCTURAL_SUFFIXES:
        if name.endswith(" " + suffix):
            residue = name[: -(len(suffix) + 1)].strip()
            if residue and not set(residue.split()) <= STRUCTURAL_WORDS:
                return residue, suffix
            return None
    return None


# ---------------------------------------------------- census: how common is the shape?

bearing = Counter()
for iri in edible:
    hit = strip_suffix(norm(label_of[iri]))
    if hit:
        bearing[hit[1]] += 1
refused = sum(
    1
    for iri in edible
    for name in [norm(label_of[iri])]
    if strip_suffix(name) is None and any(name.endswith(" " + s) for s in STRUCTURAL_SUFFIXES)
)
print(f"\nEdible LABELS carrying a structural suffix : {sum(bearing.values())} of {len(edible)}"
      f" ({sum(bearing.values()) / len(edible):.1%})")
# Ties are broken by NAME, not by insertion order: `Counter.most_common` is stable over a dict
# whose build order follows set iteration, so an unbroken tie makes this report's text change
# between runs on the same input — a committed figure that moves is a figure nobody can diff.
for suffix, count in sorted(bearing.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f"    {suffix:<18} : {count:>5}")
print(f"    {'(degenerate)':<18} : {refused:>5}   <- residue is structural vocabulary only; refused")

# -------------------------------------------- build the two layers and count collisions

exact = defaultdict(set)
for iri in edible:
    exact[norm(label_of[iri])].add(iri)
    for syn in synonyms.get(iri, ()):
        exact[norm(syn)].add(iri)

fallback, residue_suffix = defaultdict(set), defaultdict(set)
for iri in edible:
    for name in [label_of[iri], *synonyms.get(iri, ())]:
        hit = strip_suffix(norm(name))
        if hit:
            fallback[hit[0]].add(iri)
            residue_suffix[hit[0]].add(hit[1])

baseline_ambiguous = {key for key, iris in exact.items() if len(iris) > 1}
shadow = {key: iris for key, iris in fallback.items() if key in exact and not iris <= exact[key]}
harmless_shadow = {key for key, iris in fallback.items() if key in exact and iris <= exact[key]}
new_ambiguous = {key: iris for key, iris in fallback.items() if key not in exact and len(iris) > 1}
clean_new_keys = {key for key, iris in fallback.items() if key not in exact and len(iris) == 1}

print(f"\nLookup keys  exact layer                : {len(exact)}"
      f"   ({len(baseline_ambiguous)} already map to >1 class — the BASELINE ambiguity)")
print(f"             normalised fallback layer  : {len(fallback)} residues")
print(f"    new unambiguous keys               : {len(clean_new_keys)}")
print(f"    ⛔ SHADOW (residue == an existing exact name of ANOTHER class) : {len(shadow)}")
print(f"       (+ {len(harmless_shadow)} residues that land on the SAME class — a no-op, not a collision)")
print(f"    ⛔ NEW AMBIGUITY (residues colliding with each other, >1 class) : {len(new_ambiguous)}")
for key, iris in sorted(new_ambiguous.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:8]:
    names = ", ".join(sorted(label_of[i] for i in iris)[:3])
    print(f"       {len(iris)}x  {key!r:<28} <- {names}")
print("    shadow examples (exact layer stays PRIMARY, so these do NOT displace a working match):")
for key, iris in sorted(shadow.items())[:6]:
    held = sorted(label_of[i] for i in exact[key])[0]
    came = sorted(label_of[i] for i in iris)[0]
    print(f"       {key!r:<26} exact={held!r:<34} fallback={came!r}")

# ------------------------------------------------------------ re-run the coverage measurement

descriptions = {}
with Path(SR + "food.csv").open(encoding="utf-8", errors="replace") as handle:
    for row in csv.DictReader(handle):
        text = (row.get("description") or "").strip()
        if text:
            descriptions[row["fdc_id"]] = text

usda_mapped = set()
with Path(FULL + "food_attribute.csv").open(encoding="utf-8", errors="replace") as handle:
    for row in csv.DictReader(handle):
        if (row.get("name") or "").strip() in FOODON_ATTRS and (row.get("value") or "").strip():
            usda_mapped.add(row["fdc_id"])
unmapped = {i: d for i, d in descriptions.items() if i not in usda_mapped}


def candidates(description: str) -> list[tuple[str, str]]:
    """Name forms to try, best first. USDA descriptions are comma-INVERTED. Pure.

    ⛔ `head noun alone` is present so the census can keep reporting it, and is NOT in `SAFE_FORMS`:
    it truncates (`Beef, ground, raw` -> `beef`) and bought 801 matches that name the wrong thing.
    """
    parts = [p.strip() for p in description.split(",") if p.strip()]
    forms = [("full description", description)]
    if len(parts) >= 2:
        forms.append(("all segments reversed", " ".join(reversed(parts))))
        forms.append(("first two un-inverted", parts[1] + " " + parts[0]))
    if parts:
        forms.append(("head noun alone", parts[0]))
    return [(name, norm(f)) for name, f in forms if norm(f)]


def resolve(description: str, *, use_fallback: bool) -> tuple[str, str, str, str] | None:
    """First (form, layer, key, iri) this description resolves to, or None. Pure over the two layers.

    Forms are tried BEST-FIRST, and within each form the exact layer is consulted before the
    normalised one. That ordering is the whole safety argument: a name FoodOn already holds verbatim
    can never be displaced by a residue, and a residue is only ever reached for a form that exact
    matching could not answer at all.
    """
    for form_name, form in candidates(description):
        if form in exact:
            return (form_name, "exact", form, sorted(exact[form])[0])
        if use_fallback and form in fallback:
            return (form_name, "fallback", form, sorted(fallback[form])[0])
    return None


baseline_safe, recovered, recovered_by_suffix = {}, {}, Counter()
for fdc_id, description in unmapped.items():
    hit = resolve(description, use_fallback=True)
    if hit is None or hit[0] not in SAFE_FORMS:
        continue
    if hit[1] == "exact":
        baseline_safe[fdc_id] = (hit[0], hit[3])
    else:
        recovered[fdc_id] = (hit[0], hit[3], hit[2])
        recovered_by_suffix[" / ".join(sorted(residue_suffix[hit[2]]))] += 1

# ⛔ The claim "no working exact match is displaced" is MEASURED, not asserted. Re-resolve every
# description with the fallback layer switched OFF and compare: a description that resolved
# exact-and-safe without normalisation must still do so with it, to the SAME class.
exact_only = {}
for fdc_id, description in unmapped.items():
    hit = resolve(description, use_fallback=False)
    if hit is not None and hit[0] in SAFE_FORMS:
        exact_only[fdc_id] = (hit[0], hit[3])
displaced = {k: v for k, v in exact_only.items() if baseline_safe.get(k) != v}

usda_covered = len(descriptions) - len(unmapped)
before = usda_covered + len(baseline_safe)
after = before + len(recovered)
print(f"\nSR Legacy foods                          : {len(descriptions)}")
print(f"  USDA supplies a FoodOn term            : {usda_covered} ({usda_covered / len(descriptions):.0%})")
print(f"  FoodOn names, SAFE forms, exact only   : {len(baseline_safe)}   <- the 341 baseline")
print(f"  ⛔ exact-safe matches DISPLACED by it   : {len(displaced)}"
      f"   (exact-only run: {len(exact_only)}; must be 0)")
print(f"  ⛔ ADDITIONAL from suffix normalisation : {len(recovered)}")
for suffix, count in sorted(recovered_by_suffix.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f"       via {suffix:<18} : {count:>4}")
print(f"\n  combined coverage BEFORE               : {before}/{len(descriptions)} = {before / len(descriptions):.1%}")
print(f"  combined coverage AFTER                : {after}/{len(descriptions)} = {after / len(descriptions):.1%}"
      f"   (+{after / len(descriptions) - before / len(descriptions):.2%})")

coarse = Counter(iri for _, iri, _ in recovered.values())
over = [(n, label_of[i]) for i, n in coarse.items() if n >= COARSE_THRESHOLD]
print(f"\n  ⛔ over-coarse residues among the RECOVERED matches (>={COARSE_THRESHOLD} USDA foods) : {len(over)}")
for count, name in sorted(over, key=lambda pair: (-pair[0], pair[1]))[:8]:
    print(f"       n={count:<4} {name}")
print("  recovered examples:")
for fdc_id, (form_name, iri, key) in sorted(recovered.items())[:10]:
    print(f"       {descriptions[fdc_id][:44]:<46} -{form_name[:5]}-> {key!r} = {label_of[iri]!r}")

print("\n=== the staples: exact vs suffix-normalised ===")
for probe in [
    "soy sauce", "hamburger roll", "bread", "cheddar cheese", "mayonnaise", "olive oil",
    "whole milk", "lamb shoulder", "octopus", "tomato sauce", "peanut butter", "chondrichthyes",
    "restaurant",
]:
    key = norm(probe)
    verdict = "exact" if key in exact else ("SUFFIX" if key in fallback else "no")
    print(f"  {verdict:<7} {probe}")
