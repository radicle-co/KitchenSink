"""Build the candidate FoodOn mapping patch for every SR Legacy row, for human review.

One row per SR Legacy food, plus one per Foundation food (`foundation_food.csv`, 2026-04-30) whose description
matches no SR Legacy description (owner, 2026-09-27). A Foundation food that does match one takes over that SR
item's numbers and joins its root (R48), so it needs no mapping of its own. The patch is the reviewed source of truth that grouping reads (plan R54b). Status:
  accepted    USDA supplies a FoodOn term and it passes every check below
  flagged     USDA supplies a FoodOn term that a check doubts: a person must review it before it groups
  added       USDA supplies no term, and FoodOn names the food through a safe un-inverted form (R57): review
  none        no FoodOn term; the food stays its own root under its USDA name
Only terms inside the edible branches (R54) are proposed. Output: foodOnMappingPatch.csv beside this script.

Checks, each of which only flags (R54b is fail safe: a flagged mapping does not group until a person approves it):
  outside     the USDA term is outside the edible branches
  no-overlap  the USDA term shares no content word with the USDA name (`crossReferenceSanity.py`)
  head        the FoodOn name and its ancestors lack the USDA food's main word (`Wheat flour` -> `white bread`)
  part        the FoodOn name names a plant or animal part the USDA name does not (`Beets` -> `beet leaf`)
  contradicts the FoodOn name states the opposite of the USDA name (`(raw)` for a cooked food)
  process     the FoodOn name adds a process the USDA name does not state (`self-rising` for plain cornmeal)
  label       the FoodOn name is a whole animal, a plant or a catalog code (`chicken carcass` for giblets); the
              review refuses such a label as a proposal, so it is `foodOnMappingReview.UNUSABLE_LABEL`, imported
The last five are the ACCEPTED-SET check (added 2026-09-23). The first version passed any USDA term that shared ONE
content word with the USDA name, so `Mothbeans, mature seeds, raw` -> `chickpea (raw, mature)` passed on `mature`.
The four word lists below (PART, CONTRADICTIONS, PROCESS, SUPPORT) are domain vocabulary, not rows: no entry names a
food. Every figure the check produces is re-derived from the files; the two fixture tables pin the known cases.

@sideEffect Reads the FoodOn OWL and the USDA files, writes the patch CSV, prints a summary, exits 1 on a fixture miss.
"""

import csv
import functools
import io
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

import nltk
from foodOnMappingReview import UNUSABLE_LABEL
from lxml import etree

SANDBOX = "/home/brandon/Development/KitchenSink/.local-sandbox/"
OWL = SANDBOX + "foodon/foodon.owl"
SR = SANDBOX + "fdc/FoodData_Central_sr_legacy_food_csv_2018-04/"
FULL = SANDBOX + "fdc/FoodData_Central_csv_2026-04-30/"
FOUNDATION = SANDBOX + "fdc/FoodData_Central_foundation_food_csv_2026-04-30.zip"
OUT ="/home/brandon/Development/KitchenSink/docs/reports/2026-09-22/foodOnMappingPatch.csv"
# The review verdicts (handoff step A5): {"decisions": {fdc_id: {verdict, iri, label, note?, source, at}}}.
DECISIONS = "/home/brandon/Development/KitchenSink/docs/reports/2026-09-22/foodOnMappingDecisions.json"
NS = {
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "obo": "http://www.geneontology.org/formats/oboInOwl#",
}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
SYN = {f"{{{NS['obo']}}}{t}" for t in ("hasExactSynonym", "hasRelatedSynonym", "hasNarrowSynonym")}
EXACT = f"{{{NS['obo']}}}hasExactSynonym"
EDIBLE_ROOTS = {
    "http://purl.obolibrary.org/obo/FOODON_00001002",
    "http://purl.obolibrary.org/obo/FOODON_00002403",
    "http://purl.obolibrary.org/obo/FOODON_03420116",
}
GENERIC = {
    "raw",
    "cooked",
    "canned",
    "frozen",
    "dried",
    "fresh",
    "food",
    "product",
    "products",
    "meat",
    "piece",
    "of",
    "and",
    "or",
    "with",
    "without",
    "the",
    "a",
    "in",
    "whole",
    "plain",
    "dish",
    "beverage",
    "beverages",
    "sauce",
    "juice",
    "oil",
    "cured",
    "ground",
    "boneless",
    "skinless",
    "sliced",
}

# ------------------------------------------------------------------------------ the accepted-set check
STOP = {
    "of",
    "and",
    "or",
    "with",
    "the",
    "a",
    "in",
    "food",
    "product",
    "products",
    "piece",
    "pieces",
    "for",
    "from",
    "to",
    "by",
    "as",
    "type",
    "style",
    "made",
    "ns",
    "nfs",
}
JOINED = [
    (r"\blow[- ]?fat\b", "lowfat"),
    (r"\bnon[- ]?fat\b", "fatfree"),
    (r"\bfat[- ]free\b", "fatfree"),
    (r"\bpart[- ]skim\b", "partskim"),
    (r"\blow[- ]moisture\b", "lowmoisture"),
    (r"\breduced[- ]fat\b", "reducedfat"),
    (r"\blow[- ]sodium\b", "lowsodium"),
    (r"\breduced[- ]sodium\b", "reducedsodium"),
    (r"\bwhole[- ]wheat\b", "wholewheat"),
    (r"\bself[- ]rising\b", "selfrising"),
    (r"\bwhole[- ]grain\b", "wholegrain"),
    (r"\bbone[- ]in\b", "bonein"),
]
# USDA provenance notes in brackets name who reported the food, not what it is.
PROVENANCE = re.compile(
    r"\([^)]*(?:alaska native|navajo|shoshone bannock|northern plains indians|apache|hopi"
    r"|includes foods for usda)[^)]*\)",
    re.IGNORECASE,
)
COOKING = {
    "cooked",
    "boiled",
    "roasted",
    "baked",
    "fried",
    "braised",
    "stewed",
    "broiled",
    "grilled",
    "steamed",
    "simmered",
    "microwaved",
    "heated",
    "poached",
    "sauteed",
    "toasted",
    "scrambled",
    "panfried",
    "smoked",
}
# A FoodOn word the USDA name supports through a different word for the same thing.
SUPPORT = {
    "cooked": COOKING,
    "degerminated": {"degermed"},
    "uncooked": {"raw", "unprepared", "dry"},
    "raw": {"unprepared", "uncooked"},
    "steeped": {"brewed"},
    "puree": {"pureed"},
    "reconstituted": {"diluted", "concentrate"},
    "dried": {"dry", "dehydrated"},
    "fortified": {"added", "enriched"},
}
PART = {
    "leaf",
    "peel",
    "root",
    "stem",
    "pod",
    "sprout",
    "seed",
    "kernel",
    "flower",
    "bud",
    "shoot",
    "tuber",
    "corm",
    "bulb",
    "rind",
    "zest",
    "shell",
    "bran",
    "germ",
    "hull",
    "stalk",
    "skin",
    "juice",
    "oil",
    "flour",
}
# (FoodOn word, USDA words that contradict it)
CONTRADICTIONS = [
    ("raw", COOKING | {"canned"}),
    ("cooked", {"raw", "uncooked"}),
    ("skinless", {"skin"}),
    ("boneless", {"bonein"}),
    ("bonein", {"boneless"}),
    ("unsweetened", {"sweetened"}),
    ("sweetened", {"unsweetened"}),
    ("reconstituted", {"undiluted"}),
    ("dried", {"raw", "fresh"}),
    ("frozen", {"fresh"}),
    ("canned", {"fresh", "raw"}),
]
SKIN_REMOVED = re.compile(r"skin[^,]*removed|without skin|meat only", re.IGNORECASE)
PROCESS = {
    "selfrising",
    "reconstituted",
    "sprouted",
    "pickled",
    "candied",
    "fermented",
    "cured",
    "sweetened",
    "concentrate",
    "concentrated",
    "instant",
    "dehydrated",
    "evaporated",
    "condensed",
    "fortified",
    "powdered",
    "powder",
}
# A USDA first segment that heads at least this many different second segments is a category (`Beverages`, `Fish`,
# `Babyfood`), so the food's own name is in a later segment.
CATEGORY_MIN_SECOND_SEGMENTS = 8

# Known wrong mappings from the review of the 461 rows, and their correct siblings. The check must flag every
# MUST_FLAG row with the named signal and pass every MUST_PASS row.
MUST_FLAG = {
    "168896": "head",  # Wheat flour, white, bread, enriched -> white bread (enriched)
    "172425": "head",  # Mothbeans, mature seeds, raw -> chickpea (raw, mature)
    "169923": "head",  # Orange juice, frozen concentrate, undiluted -> orange peel (raw)
    "169146": "part",  # Beets, cooked, boiled, drained -> beet leaf
    "173802": "head",  # Lima beans, large, mature seeds, cooked -> lentil (mature)
    "168922": "process",  # Cornmeal, degermed, enriched, white -> white cornmeal (self-rising)
    "169922": "contradicts",  # Orange juice, frozen concentrate, undiluted -> reconstituted orange juice
}
MUST_PASS = {
    "172426",  # Mothbeans, mature seeds, cooked -> moth bean (mature)
    "174253",  # Lima beans, large, mature seeds, cooked -> lima bean (mature)
    "174254",  # Lima beans, large, mature seeds, canned -> lima bean (canned)
    "168867",  # Cornmeal, degermed, enriched, yellow -> cornmeal (degerminated, enriched)
    "169102",  # Orange juice, frozen concentrate, diluted -> reconstituted orange juice (from frozen concentrate)
    "168923",  # Cornmeal, white, self-rising, bolted, plain, enriched -> white cornmeal (self-rising)
    "169697",  # Cornmeal, whole-grain, yellow -> whole grain yellow cornmeal
}
# Wrong mappings a person found, which no signal above catches. They are flagged so they cannot group; the check does
# not claim them. Four classes: a species swap inside a category (`Beans, pinto`), a cut swap (leg -> rack), a part
# word hidden by a bare-name exact synonym (`borage flower` has the synonym `borage`), and a source word the FoodOn
# name drops (`undiluted` concentrate under juice, `sprouted` under the bean). The species check and the
# nutrient-range check (R54b checks 2 and 3) are the planned detectors for the first two.
HAND_FLAGGED = {
    "175201": "pinto beans are not adzuki beans",
    "174895": "a leg of lamb is not a rack of lamb",
    "174896": "a leg of lamb is not a rack of lamb",
    "173121": "a top round steak is not an eye of round roast",
    "173122": "a bottom round roast is not an eye of round roast",
    "172545": "a composite of retail cuts is not the shoulder",
    "169658": "maple sugar is not maple syrup",
    "167750": "the prickly pear fruit is not the pad",
    "169816": "the prickly pear fruit is not the pad",
    "168920": "field corn grain is not sweet corn",
    "167653": "dried field corn is not sweet corn",
    "168509": "cooked borage is the leaves, not the flower",
    "170482": "cooked borage is the leaves, not the flower",
    "173739": "mature french bean seeds are a dry bean, not a green bean pod",
    "175241": "mature french bean seeds are a dry bean, not a green bean pod",
    "170204": "pastrami is not a raw chuck steak",
    "174384": "a composite of retail cuts is not the shoulder",
    "168188": "undiluted apple juice concentrate is not apple juice",
    "173934": "undiluted apple juice concentrate is not a juice drink",
    "169369": "soybean sprouts are not soybeans",
    "169370": "soybean sprouts are not soybeans",
    "170418": "snow peas are the whole pod, not shelled peas",
}

nltk.data.path.insert(0, SANDBOX + "nltk_data")
from nltk.stem import WordNetLemmatizer  # noqa: E402

LEMMATIZER = WordNetLemmatizer()


def norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", text.lower())).strip()


def singular(w):
    if len(w) <= 3:
        return w
    for suffix, repl in (("ies", "y"), ("oes", "o"), ("ches", "ch"), ("shes", "sh"), ("xes", "x"), ("sses", "ss")):
        if w.endswith(suffix):
            return w[: -len(suffix)] + repl
    return w[:-1] if w.endswith("s") and not w.endswith("ss") else w


def content(text):
    return {singular(w) for w in re.findall(r"[a-z]+", text.lower()) if w not in GENERIC}


@functools.cache
def lemma(word):
    """WordNet noun lemma (`leaves` -> `leaf`); the small rule only for a word WordNet does not know. Pure."""
    found = LEMMATIZER.lemmatize(word, "n")
    if found != word or len(word) <= 3 or word.endswith(("us", "ss")):
        return found
    return singular(word)


def tokens(text):
    """Content words of a name, lemmatised, with hyphenated wordings joined. Pure."""
    text = text.lower()
    for pattern, joined in JOINED:
        text = re.sub(pattern, joined, text)
    return [lemma(w) for w in re.findall(r"[a-z0-9]+", text) if w not in STOP]


def without_brands(text):
    """The USDA name without provenance notes and brand words (USDA writes brands in capitals). Pure."""
    text = PROVENANCE.sub(" ", text)
    return " ".join(
        w for w in text.split() if not (len(re.sub("[^A-Za-z]", "", w)) >= 2 and re.sub("[^A-Za-z]", "", w).isupper())
    )


def unsupported(form, described):
    """Words of a FoodOn name that the USDA name's word list `described` does not support. Pure."""
    present = set(described)
    joined = {a + b for a, b in zip(described, described[1:])}
    words = tokens(form)
    supported = {i for i, w in enumerate(words) if w in present or w in joined or present & SUPPORT.get(w, set())}
    for i in range(len(words) - 1):
        if words[i] + words[i + 1] in present:
            supported |= {i, i + 1}
    return [w for i, w in enumerate(words) if i not in supported]


def doubts(description, iri, onto, ancestors, categories):
    """(signal, words) pairs the accepted-set check raises for one USDA row and its FoodOn term. Pure."""
    label_of, exact = onto
    names = [n for n in [label_of.get(iri, ""), *exact.get(iri, [])] if n]
    text = without_brands(description)
    described = tokens(text)
    extra = min((unsupported(n, described) for n in names), key=len)
    near = {w for n in names for w in tokens(n)}
    near |= {a + b for n in names for a, b in zip(tokens(n), tokens(n)[1:])}
    far = {w for a in ancestors(iri) for n in [label_of.get(a, ""), *exact.get(a, [])] if n for w in tokens(n)}

    def missing(segment):
        return [w for w in tokens(segment) if w not in near and w not in far]

    found = []
    segments = [s.strip() for s in text.split(",") if s.strip()]
    head = missing(segments[0]) if segments else []
    if head and segments[0].lower() in categories and any(not missing(s) for s in segments[1:]):
        head = []
    if head:
        found.append(("head", head))
    parts = [w for w in extra if w in PART]
    if parts:
        found.append(("part", parts))
    named = set(tokens(label_of.get(iri, "")))
    removed = bool(SKIN_REMOVED.search(text))
    against = [
        w
        for w, opposite in CONTRADICTIONS
        if w in named and set(described) & opposite and not (w == "skinless" and removed)
    ]
    if against:
        found.append(("contradicts", against))
    process = [w for w in extra if w in PROCESS]
    if process:
        found.append(("process", process))
    if UNUSABLE_LABEL.search(label_of.get(iri, "")):
        found.append(("label", [label_of[iri]]))
    return found


REASON = {
    "head": "The FoodOn name lacks the USDA food's main word ({}).",
    "part": "The FoodOn name names a part the USDA name does not ({}).",
    "contradicts": "The FoodOn name says the opposite of the USDA name ({}).",
    "process": "The FoodOn name adds a process the USDA name does not state ({}).",
    "label": "The FoodOn name is a whole animal, a plant or a catalog code, not a food ({}).",
}
SHOWN = {"selfrising": "self-rising", "bonein": "bone-in"}


def reason_text(found):
    """One owner-facing sentence per signal. Pure."""
    return " ".join(REASON[k].format(", ".join(SHOWN.get(w, w) for w in dict.fromkeys(ws))) for k, ws in found)


# --------------------------------------------------------------------------------------------- inputs
label_of, parents, syns, exact, obsolete = {}, defaultdict(set), defaultdict(list), defaultdict(list), set()
for cls in etree.parse(OWL).getroot().findall(f"{{{NS['owl']}}}Class"):
    iri = cls.get(ABOUT)
    if not iri:
        continue
    for child in cls:
        if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
            label_of[iri] = child.text.strip()
        elif child.tag == f"{{{NS['rdfs']}}}subClassOf":
            if child.get(RESOURCE):
                parents[iri].add(child.get(RESOURCE))
            for n in child.iter():
                if n.tag == f"{{{NS['owl']}}}Class" and n.get(ABOUT):
                    parents[iri].add(n.get(ABOUT))
        elif child.tag == f"{{{NS['owl']}}}equivalentClass":
            for n in child.iter():
                if n.tag in (f"{{{NS['owl']}}}Class", f"{{{NS['rdf']}}}Description"):
                    t = n.get(ABOUT) or n.get(RESOURCE)
                    if t and t != iri:
                        parents[iri].add(t)
        elif child.tag in SYN and child.text:
            syns[iri].append(child.text.strip())
            if child.tag == EXACT:
                exact[iri].append(child.text.strip())
        elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or "").strip().lower() == "true":
            obsolete.add(iri)

sys.setrecursionlimit(60000)
memo = {}


def ancestors(iri, seen=frozenset()):
    if iri in memo:
        return memo[iri]
    if iri in seen:
        return set()
    out = set()
    for p in parents.get(iri, ()):
        out.add(p)
        out |= ancestors(p, seen | {iri})
    if not seen:
        memo[iri] = out
    return out


edible = {i for i in label_of if i not in obsolete and EDIBLE_ROOTS & ancestors(i)}
lookup = defaultdict(set)
for iri in edible:
    lookup[norm(label_of[iri])].add(iri)
    for s in syns.get(iri, ()):
        lookup[norm(s)].add(iri)

desc = {
    r["fdc_id"]: r["description"].strip()
    for r in csv.DictReader(open(SR + "food.csv", encoding="utf-8", errors="replace"))
    if (r.get("description") or "").strip()
}


def same_description(description):
    """The curated seed's one-root-per-description key: lowercase, split on commas, drop spaces and punctuation
    inside each segment, sort the segments (never the words). U1's `baselineSeed` owns this rule. Pure."""
    segments = (re.sub(r"[^a-z0-9]", "", s) for s in description.lower().split(","))
    return tuple(sorted(s for s in segments if s))


def foundation_rows(sr_descriptions):
    """@sideEffect Reads the Foundation zip. Its foundation_food.csv items whose description matches no SR one."""
    archive = zipfile.ZipFile(FOUNDATION)

    def table(suffix):
        member = next(n for n in archive.namelist() if n.endswith("/" + suffix))
        return csv.DictReader(io.TextIOWrapper(archive.open(member), encoding="utf-8"))

    listed = {r["fdc_id"] for r in table("foundation_food.csv")}
    taken = {same_description(d) for d in sr_descriptions}
    return {
        r["fdc_id"]: r["description"].strip()
        for r in table("food.csv")
        if r["fdc_id"] in listed and same_description(r["description"]) not in taken
    }


foundation = foundation_rows(desc.values())
usda = {}
for r in csv.DictReader(open(FULL + "food_attribute.csv", encoding="utf-8", errors="replace")):
    name, value = (r.get("name") or "").strip(), (r.get("value") or "").strip()
    if (r["fdc_id"] in desc or r["fdc_id"] in foundation) and value and name.startswith("FoodOn Ontology ID"):
        if r["fdc_id"] not in usda or "#1" in name:
            usda[r["fdc_id"]] = value

second_segments = defaultdict(set)
for d in desc.values():
    segs = [s.strip() for s in d.split(",")]
    if len(segs) > 1:
        second_segments[segs[0].lower()].add(segs[1].lower())
categories = {k for k, v in second_segments.items() if len(v) >= CATEGORY_MIN_SECOND_SEGMENTS}


def safe_match(description):
    parts = [p.strip() for p in description.split(",") if p.strip()]
    forms = [description]
    if len(parts) >= 2:
        forms += [" ".join(reversed(parts)), parts[1] + " " + parts[0]]
    for form in forms:
        hits = lookup.get(norm(form))
        if hits and len(hits) == 1:
            return next(iter(hits))
    return None


# ----------------------------------------------------------------------------------------------- build
rows, status, signals, found_for, hand_flagged, broken = [], Counter(), Counter(), {}, 0, Counter()
every = {**desc, **foundation}
for fdc_id in sorted(every, key=int):
    d = every[fdc_id]
    iri = usda.get(fdc_id)
    if iri:
        label = label_of.get(iri, "")
        if iri not in edible:
            s, reason = "flagged", "USDA term is outside the edible branches"
            # Defects of the USDA ID itself, which the builder does not yet repair (R54b): the review fixes them.
            if not iri.startswith("http"):
                broken["short-form ID (e.g. CHEBI:17309), never expanded"] += 1
            elif iri in obsolete:
                broken["obsolete term, replacement not followed"] += 1
            elif iri not in label_of:
                broken["ID this FoodOn release does not hold"] += 1
        elif not (content(label) & content(d)):
            s, reason = "flagged", "USDA term shares no content word with the USDA name"
        else:
            found = doubts(d, iri, (label_of, exact), ancestors, categories)
            found_for[fdc_id] = found
            signals.update(k for k, _ in found)
            s, reason = ("flagged", reason_text(found)) if found else ("accepted", "")
            if fdc_id in HAND_FLAGGED:
                hand_flagged += 1
                s, reason = "flagged", (reason + " " if reason else "") + f"Found by hand: {HAND_FLAGGED[fdc_id]}."
    else:
        iri = safe_match(d)
        label = label_of.get(iri, "") if iri else ""
        s, reason = ("added", "FoodOn names it through a safe un-inverted form") if iri else ("none", "")
    status[s] += 1
    rows.append(
        {
            "fdc_id": fdc_id,
            "usda_description": d,
            "foodon_iri": iri or "",
            "foodon_label": label,
            "status": s,
            "reason": reason,
            "reviewed_by": "",
        }
    )

failures = []
# Apply the review verdicts. `confirm` keeps the term, `replace` sets it, `no_match` clears it. The status stays
# flagged or added, because foodOnMappingReview.py checks that its table covers exactly those rows. A `replace` with
# no IRI is a free-text request, not a verdict, so it changes nothing and goes back to the owner.
decisions = json.load(open(DECISIONS, encoding="utf-8"))["decisions"] if os.path.exists(DECISIONS) else {}
by_id = {row["fdc_id"]: row for row in rows}
requests = []
for fdc_id, decision in decisions.items():
    row = by_id.get(fdc_id)
    if row is None or row["status"] not in ("flagged", "added"):
        failures.append(f"{fdc_id} has a review decision but is not a flagged or added row")
        continue
    verdict = decision["verdict"]
    if verdict == "replace" and not decision.get("iri"):
        requests.append(fdc_id)
        continue
    if verdict == "replace":
        row["foodon_iri"], row["foodon_label"] = decision["iri"], decision["label"]
    elif verdict == "no_match":
        row["foodon_iri"], row["foodon_label"] = "", ""
    elif verdict != "confirm":
        failures.append(f"{fdc_id} has an unknown verdict {verdict!r}")
        continue
    source = decision["source"]
    row["reviewed_by"] = f"owner:{decision['at']}" if source == "owner" else f"{source} {decision['at']}"
for fdc_id, signal in MUST_FLAG.items():
    if signal not in {k for k, _ in found_for.get(fdc_id, [])}:
        failures.append(f"{fdc_id} must be flagged by {signal!r}; got {found_for.get(fdc_id)}")
for fdc_id in MUST_PASS:
    if found_for.get(fdc_id, ["not checked"]):
        failures.append(f"{fdc_id} must pass the accepted-set check; got {found_for.get(fdc_id, 'not checked')}")
if hand_flagged != len(HAND_FLAGGED):
    failures.append(f"{len(HAND_FLAGGED) - hand_flagged} HAND_FLAGGED rows no longer reach the accepted-set check")
if failures:
    for failure in failures:
        print(f"FAIL  {failure}")
    sys.exit(1)

with open(OUT, "w", newline="", encoding="utf-8") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)

doubted = sum(1 for found in found_for.values() if found)
print(f"rows : {len(rows)} ({len(desc)} SR Legacy, {len(foundation)} Foundation with no SR Legacy match)")
for k in ("accepted", "flagged", "added", "none"):
    in_foundation = sum(1 for r in rows if r["status"] == k and r["fdc_id"] in foundation)
    print(f"  {k:<9}: {status[k]:>5}  ({in_foundation} Foundation)")
print(f"\naccepted-set check: {doubted} of {len(found_for)} word-overlap passes doubted, now flagged")
print(f"  plus {hand_flagged} rows a person found by hand (HAND_FLAGGED)")
for k in ("head", "part", "contradicts", "process", "label"):
    print(f"  {k:<12}: {signals[k]:>4} rows")
print(f"  fixtures     : {len(MUST_FLAG)} must-flag and {len(MUST_PASS)} must-pass rows behave")
print("\nUSDA IDs the builder does not yet repair (flagged as outside the edible branches):")
for kind, n in sorted(broken.items()):
    print(f"  {n:>3}  {kind}")
print(f"\nneeds a person : {status['flagged'] + status['added']} rows (flagged + added)")
print(f"review decisions applied: {sum(1 for r in rows if r['reviewed_by'])}; free-text requests for the owner: {requests}")
print(f"orange juice 169099 : {next(r['status'] for r in rows if r['fdc_id'] == '169099')}")
