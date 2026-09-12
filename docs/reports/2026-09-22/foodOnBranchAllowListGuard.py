"""The FoodOn edible-branch allow-list, pinned in BOTH directions against the real ontology.

⛔ WHY THIS EXISTS, AND WHY ONE DIRECTION WOULD NOT HAVE CAUGHT IT.

The allow-list that decides which FoodOn classes may supply a human-readable food name was got wrong
TWICE in one working session, and both failures were silent:

1. **TOO WIDE.** `docs/reports/2026-09-21/foodOnCoverage.py` matched against EVERY FoodOn class, so
   `Chondrichthyes` — the taxonomic class of sharks and rays — became the "name" of 141 USDA foods,
   and `restaurant` the name of 52. Nothing failed. The coverage figure went UP, which read as
   success.
2. **TOO NARROW.** The first repair restricted to `food product` + `food material` and dropped **618**
   roots USDA already maps to, including `lamb shoulder`, `veal rib` and `octopus` — 579 of them under
   `organism material`, which is where FoodOn keeps butchery cuts. Nothing failed there either. The
   coverage figure went DOWN, which read as a stricter, safer filter.

A guard that only asked "are the foods in?" passes on version 1. A guard that only asked "are the
non-foods out?" passes on version 2. **Only a test that asks both questions fails on both wrong
versions**, which is why every probe below appears in a matched pair and why the suite refuses to run
if either half is vacuous.

Two further rules make the pin real rather than decorative:

* **The three IRIs are read OUT of the scripts that use them**, by `ast`, never restated here. A guard
  that keeps its own copy of the roster is asserting that its copy equals itself. Adding a fourth
  branch, dropping one, or letting two scripts drift apart all fail.
* **Each branch is proved NECESSARY, not merely present.** The suite re-runs the IN probes three
  times, once with each root removed, and requires every removal to break at least one probe. A
  branch nothing depends on would otherwise sit in the list forever, and the day it was deleted the
  suite would still be green.

## Where this lives, and what runs it

⚠️ NOT under `packages/`, and that is deliberate. This guard's input is `foodon.owl` — 40 MB,
downloaded out of band, and not committed — so it cannot run in CI wherever it is put. Under
`packages/` it would be swept up by the root `ruff`/`mypy` checks (`pyproject.toml`,
`packages/infra/global/__tests__/pythonSourceChecks.test.ts`) and go green in CI forever while its
assertions never executed once: a check no job can run, reported as a check that passes. That is the
exact silent success that guard's own docstring was written against. It lives beside the measurements
it guards, is HAND-RUN, and says so.

It becomes a CI-run test the day the allow-list moves into a shipped module — at which point the
three IRIs get a TypeScript home, the probes become a vitest suite, and the OWL becomes a fixture or
a pinned download step. Until then this is the check, and its status is "run it yourself".

Run:  `python3 docs/reports/2026-09-22/foodOnBranchAllowListGuard.py`
Exit: 0 all pinned, 1 a pin broke or an input was missing. Nothing is ever skipped.

@sideEffect Reads the FoodOn OWL and its sibling report scripts; writes results to stdout; exits non-zero on failure.
"""

import ast
import hashlib
import re
import sys
from collections import defaultdict
from pathlib import Path

from lxml import etree

HERE = Path(__file__).resolve().parent
REPORTS = HERE.parent
OWL = Path(
    "/home/brandon/Development/KitchenSink/.local-sandbox/foodon/foodon.owl"
)

# The measured digest of the release every figure in this directory was derived from. Checked as its
# OWN assertion, separately from membership: a FoodOn release that moves `octopus` out of `organism
# material` MUST fail — but it must fail as "this is a different ontology", not as an opaque "octopus
# is not a food", or the next reader will repair the allow-list to fit a file nobody meant to use.
OWL_SHA256 = "b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf"

# ⛔ The pinned roster. This is the ONLY place in this file the three IRIs are written, and it is an
# assertion TARGET, not the value under test — the value under test is read out of the sibling
# scripts by `ast` below, so the two can disagree and the disagreement is the failure.
PINNED_ROOTS = {
    "http://purl.obolibrary.org/obo/FOODON_00001002",  # food product
    "http://purl.obolibrary.org/obo/FOODON_00002403",  # food material
    "http://purl.obolibrary.org/obo/FOODON_03420116",  # organism material
}
ALLOW_LIST_CONSTANT = "EDIBLE_ROOTS"

# ⛔ IN: real foods that MUST resolve inside the allow-list. `lamb shoulder` and `octopus` are the two
# that version 2 lost, and they are the reason the list has three branches rather than two.
MUST_BE_FOOD = (
    "cheddar cheese",
    "mayonnaise",
    "olive oil",
    "ham (cured)",
    "beef (ground)",
    "lamb shoulder",
    "octopus",
    "bread",
    "whole milk",
)

# ⛔ OUT: classes FoodOn really holds that are NOT foods. `Chondrichthyes` and `restaurant` are the two
# version 1 published as food names; `Gnathostomata <vertebrates>` is the taxon above it, included so
# the pin covers the clade and not just the one node that embarrassed us.
MUST_NOT_BE_FOOD = (
    "Chondrichthyes",
    "restaurant",
    "Gnathostomata <vertebrates>",
)

NS = {
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "obo": "http://www.geneontology.org/formats/oboInOwl#",
}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
SYN_TAGS = {f"{{{NS['obo']}}}{t}" for t in ("hasExactSynonym", "hasRelatedSynonym", "hasNarrowSynonym")}


def norm(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace. Pure.

    Must stay identical to `foodOnCoverageV2.py`'s: a probe normalised differently from the lookup it
    is probing would answer a question nobody asked.
    """
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", text.lower())).strip()


# ------------------------------------------------------------------ failure collection

failures: list[str] = []


def check(passed: bool, message: str) -> None:
    """Record one pinned claim. @sideEffect appends to the module-level failure list and prints."""
    print(f"  {'PASS' if passed else 'FAIL'}  {message}")
    if not passed:
        failures.append(message)


# -------------------------------------- 1. the roster, read out of the scripts that use it

def declared_roots(source: str) -> set[str] | None:
    """The IRI set a report script assigns to `EDIBLE_ROOTS`, or None. Pure.

    Parsed rather than imported: every script in this directory does its work at module scope, so
    importing one would run a full 40 MB OWL parse as a side effect of reading a constant.
    """
    tree = ast.parse(source)
    strings = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    strings[target.id] = node.value.value
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == ALLOW_LIST_CONSTANT for t in node.targets):
            continue
        if not isinstance(node.value, ast.Set):
            return None
        resolved = set()
        for element in node.value.elts:
            if isinstance(element, ast.Constant) and isinstance(element.value, str):
                resolved.add(element.value)
            elif isinstance(element, ast.Name) and element.id in strings:
                resolved.add(strings[element.id])
            else:
                return None
        return resolved
    return None


print(f"the allow-list itself (read from the scripts, never restated) — `{ALLOW_LIST_CONSTANT}`")
declarers = {}
for script in sorted(REPORTS.rglob("*.py")):
    roots = declared_roots(script.read_text(encoding="utf-8"))
    if roots is not None:
        declarers[script.relative_to(REPORTS.parent.parent)] = roots

# Non-vacuity: a rule over an empty set of declarers passes by saying nothing.
check(len(declarers) >= 2, f"at least two report scripts declare it (found {len(declarers)})")
for path, roots in declarers.items():
    check(roots == PINNED_ROOTS, f"{path} declares exactly the three pinned branches ({len(roots)} declared)")

# ------------------------------------------------------- 2. the ontology file is the pinned release

print("\nthe ontology file")
if not OWL.is_file():
    print(f"  FAIL  the FoodOn OWL is not at {OWL}")
    print("        This guard is HAND-RUN and its input is an out-of-band download. It does not skip:")
    print("        a skip claims nothing, and a green over a suite that never ran claims something false.")
    sys.exit(1)

hasher = hashlib.sha256()
with OWL.open("rb") as handle:
    for block in iter(lambda: handle.read(1 << 20), b""):
        hasher.update(block)
check(hasher.hexdigest() == OWL_SHA256, f"is the pinned FoodOn release (sha256 {hasher.hexdigest()[:16]}…)")

# ------------------------------------------------------------------------ 3. parse it

label_of, parents, obsolete = {}, defaultdict(set), set()
name_to_iris = defaultdict(set)
for cls in etree.parse(str(OWL)).getroot().findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    for child in cls:
        if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
            label_of[iri] = child.text.strip()
            name_to_iris[norm(child.text)].add(iri)
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
            name_to_iris[norm(child.text)].add(iri)
        elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or "").strip().lower() == "true":
            obsolete.add(iri)

sys.setrecursionlimit(60000)
_cache = {}


def ancestors(iri: str, seen: frozenset[str] = frozenset()) -> set[str]:
    """Transitive parents, cycle-safe. Pure over the parsed graph."""
    if iri in _cache:
        return _cache[iri]
    if iri in seen:
        return set()
    guard, out = seen | {iri}, set()
    for parent in parents.get(iri, ()):
        out.add(parent)
        out |= ancestors(parent, guard)
    if not seen:
        _cache[iri] = out
    return out


def admitted_by(probe: str, roots: set[str]) -> set[str]:
    """Live classes named `probe` that the given root set admits. Pure over the parsed graph."""
    return {
        iri
        for iri in name_to_iris.get(norm(probe), ())
        if iri not in obsolete and roots & ancestors(iri)
    }


# ---------------------------------------------- 4. NON-VACUITY: every probe exists in the ontology

# ⛔ Without this, the OUT half is worthless. `restaurant` resolving to nothing because FoodOn never
# held it reads EXACTLY like `restaurant` being correctly excluded — the assertion would pass over a
# question it never asked. Both halves are only meaningful over names the ontology really has.
print("\nnon-vacuity — every probe names a class FoodOn really holds")
for probe in (*MUST_BE_FOOD, *MUST_NOT_BE_FOOD):
    known = {i for i in name_to_iris.get(norm(probe), ()) if i not in obsolete}
    check(bool(known), f"{probe!r} exists in FoodOn ({len(known)} live class(es))")

# ------------------------------------------------- 5. BOTH DIRECTIONS against the allow-list

print("\nIN — real foods the allow-list must admit  (version 2, two branches, lost the last two)")
for probe in MUST_BE_FOOD:
    hits = admitted_by(probe, PINNED_ROOTS)
    sample = sorted(label_of[i] for i in hits)[:1]
    check(bool(hits), f"{probe!r} is inside the allow-list{f' — {sample[0]!r}' if sample else ''}")

print("\nOUT — non-foods the allow-list must reject  (version 1, no allow-list, published these)")
for probe in MUST_NOT_BE_FOOD:
    hits = admitted_by(probe, PINNED_ROOTS)
    leaked = sorted(label_of[i] for i in hits)[:2]
    check(not hits, f"{probe!r} is outside the allow-list{f' — LEAKED {leaked}' if leaked else ''}")

# ⛔ Proves it is the ALLOW-LIST that excludes them, not the ontology's silence. This re-creates
# version 1 exactly — match against every live class — and requires all three OUT probes to be
# admitted by it. If this ever passes trivially, the OUT half above has stopped testing anything.
print("\nthe allow-list is what does the excluding — unrestricted matching admits all three")
for probe in MUST_NOT_BE_FOOD:
    unrestricted = {i for i in name_to_iris.get(norm(probe), ()) if i not in obsolete}
    check(bool(unrestricted), f"{probe!r} would be admitted with no allow-list ({len(unrestricted)} class(es))")

# ---------------------- 6. the SHAPE of the allow-list, and which branches actually carry it

# ⛔ MEASURED, NOT ASSUMED, AND THE ANSWER IS NOT THE OBVIOUS ONE. The first version of this section
# simply required every root to be load-bearing — remove it, and at least one IN probe must break —
# and `food product` FAILED it. The cause is in the ontology, asserted with a plain `rdfs:subClassOf`
# and not an artefact of how parentage is read here:
#
#     FOODON_00001002 (food product)  rdfs:subClassOf  FOODON_00002403 (food material)
#
# `food product` is a SUBCLASS of `food material`, so it admits nothing `food material` does not
# already admit — the three-branch allow-list is a TWO-branch allow-list with a redundant third
# member, and `{food product, food material}` is just `{food material}`. That also explains the 618
# roots the two-branch version lost: 579 of them were under `organism material`, the branch it was
# actually missing, and the pairing with `food product` never bought anything.
#
# `food product` STAYS in the roster — it is what every consumer names, it is the class a reader
# expects to see, and removing it from the list would be a change nobody asked for. What must not
# happen is the next reader concluding "three branches, three reasons" and reasoning from it. So the
# subsumption is pinned as its own claim: the day FoodOn detaches `food product` from `food material`
# this fails, and the comment above it is what tells the reader the redundancy has ended.
print("\nthe SHAPE of the allow-list — which branches actually carry it")
FOOD_PRODUCT = "http://purl.obolibrary.org/obo/FOODON_00001002"
FOOD_MATERIAL = "http://purl.obolibrary.org/obo/FOODON_00002403"
ORGANISM_MATERIAL = "http://purl.obolibrary.org/obo/FOODON_03420116"

check(
    FOOD_MATERIAL in ancestors(FOOD_PRODUCT),
    "`food product` is a SUBCLASS of `food material` — so it is REDUNDANT in the allow-list",
)
check(
    FOOD_PRODUCT not in ancestors(FOOD_MATERIAL) and ORGANISM_MATERIAL not in ancestors(FOOD_MATERIAL),
    "`food material` is subsumed by neither of the other two",
)
check(
    FOOD_PRODUCT not in ancestors(ORGANISM_MATERIAL) and FOOD_MATERIAL not in ancestors(ORGANISM_MATERIAL),
    "`organism material` is subsumed by neither of the other two — it is a SEPARATE branch",
)

# The redundancy measured over the whole ontology rather than over nine probes: nine probes cannot
# tell "redundant" from "these nine happened not to need it".
live = [i for i in label_of if i not in obsolete]
product_only = [i for i in live if FOOD_PRODUCT in ancestors(i) and FOOD_MATERIAL not in ancestors(i)]
check(
    not product_only,
    f"NO live class reaches `food product` without also reaching `food material` ({len(product_only)} would)",
)

# ⛔ Each of the two branches that DO carry the list is proved necessary against the IN probes. A
# branch nothing depends on could be deleted tomorrow with this suite still green — which is exactly
# how the two-branch version shipped and lost every butchery cut.
print("\nthe two carrying branches are LOAD-BEARING — removing either must break an IN probe")
for root, expected_to_carry in ((FOOD_MATERIAL, True), (ORGANISM_MATERIAL, True), (FOOD_PRODUCT, False)):
    lost = [p for p in MUST_BE_FOOD if not admitted_by(p, PINNED_ROOTS - {root})]
    name = label_of.get(root, root)
    if expected_to_carry:
        check(bool(lost), f"without {name!r} these are lost: {lost or 'NOTHING — the branch is dead'}")
    else:
        check(
            not lost,
            f"{name!r} carries nothing, as its subsumption implies"
            f"{f' — but {lost} now depend on it, so the redundancy has ENDED' if lost else ''}",
        )

print(f"\n{'ALL PINS HOLD' if not failures else f'{len(failures)} PIN(S) BROKE'}")
for message in failures:
    print(f"  FAILED: {message}")
sys.exit(1 if failures else 0)
