"""Proposed review verdicts for every FoodOn mapping-patch row that needs a person (plan §4.7 R54b).

`foodOnMappingPatch.csv` marks rows `flagged` or `added` (our own un-inverted matches, R57); the run prints how many.
A row is flagged by the first two checks (USDA's FoodOn term shares no content word with the USDA name, or sits
outside the edible branches), by the accepted-set check (the FoodOn name lacks the USDA food's main word, names a part
or a process the USDA name does not state, says the opposite, or is a whole animal, a plant or a catalog code), or by
hand (`HAND_FLAGGED` in `foodOnMappingPatch.py`). A person must approve each row before `seed:usda-bulk` groups from it.
This script carries a PROPOSED verdict per row, for the owner to confirm or edit on a web page:

  confirm   the current FoodOn term names this food; it joins that root
  replace   the current term is wrong or unusable, but another EDIBLE term names the food (IRI + label given)
  no_match  no FoodOn term safely names the food; it stays its own root under its USDA name (always safe)

The verdicts are human judgement, written below as data. The script does the two automated parts:

1. `--candidates` prints lookup leads per row: narrower edible terms whose every word appears in the USDA
   description, the full-IRI form of a short-form ID, and FoodOn's own `term replaced by` for an obsolete term.
   These are LEADS, not answers — the finder proposed `butter pound cake` for "other than all butter".
2. The default run reads every label from the OWL (never from this file), refuses any verdict that breaks the rules
   below, and writes `foodOnMappingReview.csv`.

The rules the validator enforces, and why each exists:
* The verdict table covers EXACTLY the flagged + added rows of the patch: no gaps, no extras.
* `confirm` needs the current IRI to be live, labelled and inside the edible branches.
* `replace` needs the new IRI to be live, labelled, edible and different from the current one.
* A proposed term may not be a catalogue code (`gs1 gpc`, `efsa foodex2`) or organism-shaped (a plant, tree,
  cultivar, carcass, family or `material` term). ⚠️ The allow-list alone does not keep those out: it admits
  `companion animal`, `squab` and `beluga whale`, all of which USDA or R57 proposed here.
* fdc 169099 (orange juice) must never end under `olives (canned)` — R54b's regression fixture.

Specificity rule (one rule, applied to every row): propose the most specific edible term whose extra words all appear
in the USDA description, unless a correct accepted sibling of the same food already sits under the broader term, in
which case match the sibling so the two group together. A term that names a different food than the description
(a mix vs the prepared soup, `butter pound cake` for "other than all butter") is not "more specific", it is wrong.

Run:  python3 docs/reports/2026-09-22/foodOnMappingReview.py               (writes the CSV, prints counts)
      python3 docs/reports/2026-09-22/foodOnMappingReview.py --candidates  (prints the automated lookup leads)
Exit: 0 written; 1 a verdict broke a rule or an input is missing. Nothing is skipped.

@sideEffect Reads the FoodOn OWL, the mapping patch and the USDA attribute file; writes the review CSV; prints.
"""

import csv
import re
import sys
from collections import Counter, defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from lxml import etree

HERE = Path(__file__).resolve().parent
SANDBOX = Path("/home/brandon/Development/KitchenSink/.local-sandbox")
OWL = SANDBOX / "foodon/foodon.owl"
FULL = SANDBOX / "fdc/FoodData_Central_csv_2026-04-30/food_attribute.csv"
PATCH = HERE / "foodOnMappingPatch.csv"
OUT = HERE / "foodOnMappingReview.csv"

OBO = "http://purl.obolibrary.org/obo/"
NS = {
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "obo": "http://www.geneontology.org/formats/oboInOwl#",
}
ABOUT, RESOURCE = f"{{{NS['rdf']}}}about", f"{{{NS['rdf']}}}resource"
SYN = {f"{{{NS['obo']}}}{t}" for t in ("hasExactSynonym", "hasRelatedSynonym", "hasNarrowSynonym")}
REPLACED_BY = f"{{{OBO}}}IAO_0100001"
# Pinned by foodOnBranchAllowListGuard.py, which reads this set out of every report script with `ast`.
EDIBLE_ROOTS = {
    "http://purl.obolibrary.org/obo/FOODON_00001002",
    "http://purl.obolibrary.org/obo/FOODON_00002403",
    "http://purl.obolibrary.org/obo/FOODON_03420116",
}
REVIEW_STATUSES = ("flagged", "added")
HEADER = [
    "fdc_id",
    "usda_description",
    "status",
    "current_iri",
    "current_label",
    "proposed_verdict",
    "proposed_iri",
    "proposed_label",
    "reason",
    "confidence",
]
UNUSABLE_LABEL = re.compile(
    r"gs1 gpc|efsa foodex2|foodex2|eurofir|langual| plant$| tree$|cultivar|carcass"
    r"| family$|material$|^companion animal$",
    re.IGNORECASE,
)
REGRESSION_FIXTURE = ("169099", OBO + "FOODON_03307142")  # orange juice must never sit under `olives (canned)`


class Verdict(NamedTuple):
    """One proposed verdict for one review row.

    `narrows` marks a replace made ONLY by the specificity rule (the current term was right but broader), so the
    owner can review that group in bulk.
    """

    verdict: str
    iri: str | None
    reason: str
    confidence: str
    narrows: bool = False


def confirm(reason: str, confidence: str = "sure") -> Verdict:
    """A `confirm` verdict. Pure."""
    return Verdict("confirm", None, reason, confidence)


def replace(term: str, reason: str, confidence: str = "sure") -> Verdict:
    """A `replace` verdict; `term` is a local OBO id such as `FOODON_03305747`. Pure."""
    return Verdict("replace", OBO + term, reason, confidence)


def narrow(term: str, broader: str, reason: str | None = None) -> Verdict:
    """A `replace` made by the specificity rule: the current term `broader` is right, `term` is narrower. Pure."""
    reason = reason or f"FoodOn has a narrower term that matches the description; '{broader}' is the broader one."
    return Verdict("replace", OBO + term, reason, "sure", narrows=True)


def no_match(reason: str, confidence: str = "sure") -> Verdict:
    """A `no_match` verdict. Pure."""
    return Verdict("no_match", None, reason, confidence)


def short_id(curie: str, label: str) -> str:
    """Reason for a USDA ID written in short form, which the patch never expands. Pure."""
    return f"Same FoodOn term '{label}'; USDA wrote its ID in short form ({curie}), which does not match the ontology."


def not_in_release() -> str:
    """Reason for a USDA IRI that no class in this FoodOn release carries. Pure."""
    return "USDA's ID does not exist in this FoodOn release; this term names the same food."


OUTSIDE = (
    "FoodOn's term for it sits outside the food branches, and the only edible terms are the plant or catalogue codes."
)
TINDA = "FoodOn's 'tinda' sits outside the food branches, and the only edible match is the tinda plant."
ANIMAL_NOT_PART = "The current term names the whole animal, not this part, and FoodOn has no term for the part."
BLEND = "This is a blend; the current term names only one of its parts, and no FoodOn term names the blend."
MIXED_MEAT = "The current term names only the first of several meats; this term names the product without picking one."
SOUP = "It names this soup; FoodOn has no narrower term for this version."
CHEESE = "It names this cheese; FoodOn has no narrower term for this version."
BREAD = "It names this bread; FoodOn has no narrower term for this version."
PIE = "It names this pie; FoodOn has no narrower term for this version."
CAKE = "It names this cake; FoodOn has no narrower term for this version."
SAUCE = "It names this sauce or gravy; FoodOn has no narrower term for this version."
SAME = "It names this food; FoodOn has no narrower term for this version."
CARIBOU = "FoodOn has a caribou-specific term; 'piece of reindeer meat (raw)' is the broader one."
PORK_AND_BEANS = "Canned baked beans with pork are pork and beans; 'baked beans (dish)' is the broader one."
SCALLOPED = (
    "FoodOn lists scalloped potatoes as a synonym of this gratin, but many US cooks make scalloped potatoes "
    "without cheese."
)

LEAF = "The leaves are the part eaten, so the leaf term names this food."
KERNEL = "The grain is the kernel, so the kernel term names this food."
HERB_DRIED = "A dried herb is its dried leaves, so the dried leaf term names this food."
HERB_FRESH = "A fresh herb is sold as its leaves, so the leaf term names this food."
TOFU = "The extra words are the brand, and the term names this tofu."
CARIBOU_SAME = "Caribou and reindeer are the same species, and FoodOn has no caribou term for this cut."
YARDLONG = "Yardlong bean and asparagus bean are two names for the same bean."
BLACKEYE_COOKED = "Blackeyes are blackeyed peas, and the fresh cooked blackeye rows use 'blackeyed pea (cooked)'."
PEA_POD = "Edible-podded peas are eaten pod and all."
SPROUT = "Sprouted soybeans are soybean sprouts."
GIBLET_RAW = "Giblets are not a whole carcass, and FoodOn names raw chicken giblets."
GIBLET_COOKED = "Giblets are not a whole carcass, and FoodOn has no term for cooked giblets."
WHOLE_BIRD = "It is the whole bird, and FoodOn's only whole-bird term is a carcass, so this broader term is used."
CARCASS = "FoodOn names the whole carcass, which is not a food name, and has no term for its lean and fat."

VERDICTS = {
    # ------------------------------------------------ flagged: USDA term outside the edible branches (66)
    "167632": no_match(TINDA),
    "167682": replace("FOODON_03316189", "USDA points at the chemical pectin; 'pectin (liquid)' names this product."),
    "168017": no_match("FoodOn has only cottongrass plant parts, outside the food branches."),
    "168018": no_match("FoodOn has only cottongrass plant parts, outside the food branches."),
    "168040": no_match(TINDA),
    "168150": no_match("FoodOn's jambolan fruit sits outside the food branches; the only edible term is the plant."),
    "168372": replace("FOODON_02021719", "USDA's ID is missing a digit; the intended term is raw ground pork."),
    "168414": no_match(OUTSIDE),
    "168415": no_match(OUTSIDE),
    "168430": no_match(OUTSIDE),
    "168459": no_match(OUTSIDE),
    "168493": no_match(OUTSIDE),
    "168530": no_match(OUTSIDE),
    "168536": no_match(OUTSIDE),
    "168583": replace(
        "FOODON_03305495",
        "USDA's root term sits outside the food branches; this is the edible "
        "wasabi term, though its label reads clumsily.",
        "unsure",
    ),
    "168587": no_match("FoodOn has only hedge mustard seed and plant, neither in the food branches."),
    "168820": replace("CHEBI_83163", short_id("CHEBI:83163", "molasses")),
    "168918": no_match(
        "The only edible teff term is 'teff kernel (raw)', which is the uncooked grain, not cooked teff.", "unsure"
    ),
    "168987": no_match(
        "In Alaska 'devilfish' usually means octopus, but USDA's scientific name says devil ray, so "
        "the food is unclear.",
        "unsure",
    ),
    "168996": no_match("FoodOn's prairie turnip sits outside the food branches; the only edible term is the plant."),
    "169005": no_match("FoodOn's wocas tuber sits outside the food branches, and no edible term names it."),
    "169190": replace("FOODON_02021719", "USDA's ID is missing a digit; the intended term is raw ground pork."),
    "169203": no_match(OUTSIDE),
    "169204": no_match(OUTSIDE),
    "169250": no_match(OUTSIDE),
    "169270": replace(
        "FOODON_00002571", "Pumpkin flowers are squash blossoms, and 'squash flower' is the edible term."
    ),
    "169271": replace(
        "FOODON_00002571", "Pumpkin flowers are squash blossoms, and 'squash flower' is the edible term."
    ),
    "169277": no_match("FoodOn's salsify root sits outside the food branches; the only edible term is the plant."),
    "169278": no_match("FoodOn's salsify root sits outside the food branches; the only edible term is the plant."),
    "169281": no_match(OUTSIDE),
    "169368": no_match(OUTSIDE),
    "169401": no_match(
        "The only edible look-alike is 'taro root', a different plant that shares trade names with yautia.", "unsure"
    ),
    "169407": no_match("FoodOn's watermelon seed sits outside the food branches, and no edible term names it."),
    "169640": replace("UBERON_0036016", short_id("UBERON:0036016", "honey")),
    "169657": replace(
        "FOODON_00003948",
        "USDA points at the chemical aspartame; this term, with Equal as a synonym, names the tabletop sweetener.",
    ),
    "169747": replace(
        "FOODON_03000256", "USDA's 'teff kernel' sits outside the food branches; its edible child names uncooked teff."
    ),
    "169809": replace("FOODON_03309162", not_in_release()),
    "169818": no_match("FoodOn's prairie turnip sits outside the food branches; the only edible term is the plant."),
    "170030": replace(
        "FOODON_00004971",
        "USDA points at the potato variety, outside the food branches; 'Russet potato' is the edible term.",
    ),
    "170067": replace(
        "FOODON_03304635", "USDA's term sits outside the food branches; 'water chestnut (canned)' names this product."
    ),
    "170119": replace(
        "FOODON_00002571", "Pumpkin flowers are squash blossoms, and 'squash flower' is the edible term."
    ),
    "170167": replace(
        "FOODON_03301873",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170168": replace(
        "FOODON_00003563",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170190": replace(
        "FOODON_00003563",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170475": no_match(
        "FoodOn's cooked wax gourd sits outside the food branches; the only edible term, 'winter "
        "melon (raw)', names it raw.",
        "unsure",
    ),
    "170529": no_match("FoodOn's salsify root sits outside the food branches; the only edible term is the plant."),
    "170549": no_match(
        "FoodOn's cooked wax gourd sits outside the food branches; the only edible term, 'winter "
        "melon (raw)', names it raw.",
        "unsure",
    ),
    "170565": no_match("The only edible acorn term is 'acorn (raw)', and no edible term names dried acorns.", "unsure"),
    "170574": replace(
        "FOODON_03310978",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170575": replace(
        "FOODON_03310978",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170576": replace(
        "FOODON_03301873",
        "FoodOn's European chestnut terms sit outside the food branches; a cook calls these simply chestnuts.",
    ),
    "170922": replace(
        "FOODON_03000224",
        "USDA's seed term sits outside the food branches; this edible term lists 'coriander seed' as a synonym.",
    ),
    "171330": no_match(
        "The only edible term is 'opium poppy seed food product', a name a cook would not use for the spice.", "unsure"
    ),
    "171505": replace("FOODON_02020578", "USDA's term is obsolete; FoodOn names this one as its replacement."),
    "171831": no_match(
        "This is prepared wasabi paste (292 kcal per 100 g), not the root, and no FoodOn term names the paste.",
        "unsure",
    ),
    "172847": replace("FOODON_02020578", "USDA's term is obsolete; FoodOn names this one as its replacement."),
    "173032": replace(
        "FOODON_00004359",
        "USDA's dried goji term sits outside the food branches; this is the only edible goji term.",
        "unsure",
    ),
    "173095": replace(
        "FOODON_03315155", "USDA's 'tripe' sits outside the food branches; this is the edible tripe term."
    ),
    "173647": no_match(
        "FoodOn's 'tap water' sits outside the food branches; the only edible alternative is the "
        "generic 'water food product'.",
        "unsure",
    ),
    "174215": replace(
        "FOODON_02022288",
        "USDA's ID does not exist in this FoodOn release; this is the raw form of the term its cooked sibling uses.",
    ),
    "174218": replace(
        "FOODON_02022054", "USDA's ID does not exist in this FoodOn release; 'common octopus' names this species."
    ),
    "174302": replace(
        "FOODON_03310553", "USDA's term is rose apple, a fruit; 'soy protein isolate' is the term its sibling uses."
    ),
    "174493": replace("FOODON_02020578", "USDA's term is obsolete; FoodOn names this one as its replacement."),
    "174769": replace(
        "FOODON_03315155", "USDA's 'tripe' sits outside the food branches; this is the edible tripe term."
    ),
    "175096": no_match(
        "FoodOn's 'tap water' sits outside the food branches; the only edible alternative is the "
        "generic 'water food product'.",
        "unsure",
    ),
    "175103": no_match(
        "FoodOn's 'tap water' sits outside the food branches; the only edible alternative is the "
        "generic 'water food product'.",
        "unsure",
    ),
    # ------------------------------------------- flagged: USDA term shares no content word with the name (89)
    "167748": replace(
        "FOODON_03305747", "USDA's term is lime juice; the lemon-from-concentrate siblings use this term."
    ),
    "167754": confirm("Pomelo is another spelling of pummelo."),
    "167782": confirm("Sacred pear is another name for abiyuch (Crateva religiosa)."),
    "167859": confirm("Raw pork feet are pig's feet."),
    "167870": confirm("Pickled pig's feet are a kind of pig foot."),
    "167950": confirm("Corn nuts is the product this brand is named for."),
    "168050": narrow("FOODON_03306460", "piece of reindeer meat (raw)", CARIBOU),
    "168106": confirm("Poppadum is another name for papad."),
    "168156": replace(
        "FOODON_00005465", "USDA's term is lemon juice; this is the matching lime term, as raw lemon juice uses."
    ),
    "168175": replace(
        "FOODON_00005626",
        "USDA's term is bullock's heart, a different species; this term lists sugar "
        "apple and sweetsop as synonyms, but its label may read as bullock's heart.",
        "unsure",
    ),
    "168176": confirm("Pineapple guava is another name for feijoa."),
    "168267": replace("FOODON_02021676", "USDA's term is 'companion animal'."),
    "168270": replace("FOODON_02021678", "USDA's term is 'squab'."),
    "168290": confirm("Pork feet are pig's feet."),
    "168402": confirm("Blackeyes are blackeyed peas."),
    "168403": confirm("Blackeyes are blackeyed peas."),
    "168416": confirm("Drumstick leaves are moringa leaves."),
    "168417": confirm("Drumstick leaves are moringa leaves."),
    "168418": confirm("Pepeao is a wood-ear fungus; jelly ear is a close relative sold under the same name.", "unsure"),
    "168451": confirm("Oriental radish is daikon."),
    "168452": confirm("Oriental radish is daikon."),
    "168453": confirm("Oriental radish is daikon."),
    "168456": confirm("Irishmoss is Irish moss."),
    "168506": confirm("Beetroot is the beet root."),
    "168526": replace("FOODON_03306820", "Same food as its without-salt twin, which uses 'blackeyed pea (cooked)'."),
    "168531": confirm("Drumstick leaves are moringa leaves."),
    "168534": confirm("Lambsquarters are lambs quarters leaves."),
    "168559": replace("FOODON_03306922", "USDA's term is portobello mushroom."),
    "168571": confirm("Nopales are prickly pear pads."),
    "168573": confirm("Lemon grass is lemongrass."),
    "168908": confirm("Somen is sōmen."),
    "168909": confirm("Somen is sōmen."),
    "168995": confirm("Lambsquarters are lambs quarters leaves."),
    "169086": confirm("Litchi is lychee."),
    "169087": confirm("Litchi is lychee."),
    "169099": replace("FOODON_03305981", "USDA's term is canned olives, a known USDA error."),
    "169232": confirm("FoodOn lists calabash and bottle gourd as synonyms of zucca melon."),
    "169233": confirm("FoodOn lists calabash and bottle gourd as synonyms of zucca melon."),
    "169244": replace(
        "FOODON_00005190", "FoodOn has two duplicate terms; this one matches the other raw lambsquarters row."
    ),
    "169245": confirm("Lambsquarters are lambs quarters leaves."),
    "169282": replace(
        "FOODON_00002809",
        "USDA's term is the pod, but the data is for the beans; 'edamame' is what the cooked rows use.",
    ),
    "169283": confirm("Green soybeans are edamame."),
    "169353": confirm("FoodOn lists calabash and bottle gourd as synonyms of zucca melon."),
    "169388": confirm("Nopales are prickly pear pads."),
    "169392": confirm("Chinese broccoli is gai lan."),
    "169398": confirm("Mexican tea is another name for epazote."),
    "169404": confirm("Chinese broccoli is gai lan."),
    "169698": replace("FOODON_00005791", "USDA's term is corn flour, a different product in US kitchens."),
    "169700": replace("FOODON_00005532", "USDA's term is cowpeas."),
    "169805": confirm("Low bush cranberry is lingonberry."),
    "169815": confirm("Lambsquarters are lambs quarters leaves."),
    "169905": confirm("Dove and squab are pigeons, but the label 'piece of pigeon' reads oddly.", "unsure"),
    "170006": confirm("Young green onion tops are scallions, as the whole-scallion sibling uses."),
    "170066": confirm(
        "The term lists Chinese water chestnut as a synonym, although FoodOn files it under water caltrop."
    ),
    "170122": confirm("Oriental radish is daikon."),
    "170381": confirm("Broccoli raab is rapini."),
    "170382": confirm("Broccoli raab is rapini."),
    "170390": confirm("Pak-choi is bok choy; the rosette is the whole head."),
    "170391": confirm("Pak-choi is bok choy."),
    "170474": confirm("Vinespinach is Malabar spinach."),
    "170530": confirm("Green soybeans are edamame."),
    "170556": replace(
        "FOODON_00004886", "USDA's term is a frozen blueberry; 'pumpkin seed' is what the roasted kernel siblings use."
    ),
    "171028": confirm("Grapeseed oil is grape seed oil."),
    "171424": confirm("Tomatoseed oil is tomato seed oil."),
    "171425": confirm("Teaseed oil is tea seed oil."),
    "171657": replace(
        "FOODON_00005563",
        "Its with-salt twin and the other cooked Cream of Wheat rows use 'cream of wheat', not dry 'farina'.",
    ),
    "171715": confirm("Carambola is star fruit."),
    "171959": confirm("Mahimahi is mahi mahi."),
    "172238": replace("FOODON_03303373", "USDA's term is canned olives."),
    "172424": confirm("Lupins are lupine beans."),
    "172443": confirm("Natto is nattō."),
    "172523": replace(
        "FOODON_02021625", "USDA's term is sheep; the cooked squirrel row uses 'piece of squirrel meat'."
    ),
    "172931": replace(
        "FOODON_00005588",
        "Leberkäse is a different, much fattier loaf; luxury loaf is a pressed pork luncheon loaf, which "
        "'pork loaf' describes.",
        "unsure",
    ),
    "173043": confirm("Groundcherries are ground cherries."),
    "173563": confirm("Cupu assu is cupuaçu."),
    "173598": confirm("It is soybean oil; FoodOn has no term for the industrial grade."),
    "173788": replace("FOODON_00005540", "USDA's term is a kidney bean; the brand's soft tofu uses 'soft tofu'."),
    "173804": confirm("Lupins are lupine beans."),
    "173805": narrow(
        "FOODON_00005286",
        "moth bean",
        "Its without-salt twin uses 'moth bean (mature)'; 'moth bean' is the broader one.",
    ),
    "173845": replace("FOODON_02021772", "USDA's term is antelope; the cooked bear row uses 'piece of bear meat'."),
    "173853": narrow("FOODON_03306460", "piece of reindeer meat (raw)", CARIBOU),
    "173854": confirm("Caribou and reindeer are the same species, and FoodOn's caribou term exists only raw."),
    "174252": replace("FOODON_03000210", "USDA's term is sprouted lentils."),
    "174301": replace(
        "FOODON_00005578", "USDA's term is rose apple; 'soy protein concentrate' is the term its sibling uses."
    ),
    "174577": confirm("FoodOn lists polish sausage as a synonym of kielbasa."),
    "175041": confirm("Same substance, but the label is the chemical name, not 'cream of tartar'.", "unsure"),
    "175210": replace("FOODON_03000199", "USDA's term is blackeyed pea."),
    "175233": replace("FOODON_00005540", "USDA's term is a kidney bean."),
    "175234": replace("FOODON_00005544", "USDA's term is a great northern bean."),
    # ------------------------------------------------------------- added: our own un-inverted matches (306)
    "167623": no_match("'bowhead whale' names the animal, and FoodOn has only a generic 'animal blubber'.", "unsure"),
    "167624": no_match(ANIMAL_NOT_PART),
    "167703": narrow("FOODON_03303720", "cottage cheese"),
    "167716": narrow("FOODON_03303720", "cottage cheese"),
    "167735": confirm(CHEESE),
    "167737": no_match(BLEND),
    "167937": confirm("Panque casero is a pound cake, and FoodOn has no term for the brand."),
    "167939": confirm(SAME),
    "167943": confirm(BREAD),
    "167944": confirm(BREAD),
    "167953": confirm(SAME),
    "167957": confirm(SAME),
    "168026": no_match(ANIMAL_NOT_PART),
    "168027": confirm(SOUP),
    "168092": confirm(SAME),
    "168101": confirm(SAME),
    "168114": narrow("FOODON_03303720", "cottage cheese"),
    "168121": confirm("The description names two cheeses, so the general process-cheese term is right."),
    "168124": confirm(CHEESE),
    "168128": confirm(SAME),
    "168141": confirm(CHEESE),
    "168198": no_match(BLEND),
    "168771": confirm(SAME),
    "168819": confirm(SAME),
    "168869": narrow("FOODON_03316846", "yellow cornmeal"),
    "168924": narrow("FOODON_03316845", "white cornmeal"),
    "168979": no_match(ANIMAL_NOT_PART),
    "168980": no_match(ANIMAL_NOT_PART),
    "169000": replace("FOODON_02022123", "'steller sea lion' names the animal; FoodOn has a term for its liver."),
    "169001": replace("FOODON_02022122", "'steller sea lion' names the animal; FoodOn has a term for its kidney."),
    "169002": replace("FOODON_02022121", "'steller sea lion' names the animal; FoodOn has a term for its heart."),
    "169003": replace("FOODON_02022114", "'steller sea lion' names the animal; FoodOn has a term for its meat."),
    "169050": confirm(CHEESE),
    "169051": confirm(CHEESE),
    "169078": confirm(CHEESE),
    "169079": confirm(CHEESE),
    "169080": narrow("FOODON_03000482", "pasteurized process cheese"),
    "169724": no_match("This is a tortilla mix with added fat (10.6 g per 100 g), not plain white flour.", "unsure"),
    "169795": no_match("'beluga whale' names the animal; FoodOn has only generic whale-meat terms.", "unsure"),
    "169796": no_match(ANIMAL_NOT_PART),
    "169797": no_match("'beluga whale' names the animal; FoodOn has only generic whale-meat terms.", "unsure"),
    "169824": replace("FOODON_02022114", "'steller sea lion' names the animal; FoodOn has a term for its meat."),
    "169825": replace("FOODON_02022119", "'steller sea lion' names the animal; FoodOn has a term for its fat."),
    "169882": confirm(SAME),
    "170038": confirm(SCALLOPED, "unsure"),
    "170064": narrow("FOODON_03303882", "mixed vegetables"),
    "170065": narrow("FOODON_03303882", "mixed vegetables"),
    "170142": confirm("Cooked from frozen, so 'mixed vegetables' fits better than 'mixed vegetables (frozen)'."),
    "170271": confirm("It is dark chocolate; FoodOn has no term for the cacao share."),
    "170272": confirm("It is dark chocolate; FoodOn has no term for the cacao share."),
    "170273": confirm("It is dark chocolate; FoodOn has no term for the cacao share."),
    "170276": confirm(SAME),
    "170442": confirm("FoodOn lists potatoes au gratin as a synonym of this dish."),
    "170447": confirm("The dry mix is not the finished dish, but no FoodOn term names the mix.", "unsure"),
    "170448": confirm("FoodOn lists potatoes au gratin as a synonym of this dish."),
    "170449": confirm(SCALLOPED, "unsure"),
    "170450": confirm(SCALLOPED, "unsure"),
    "170471": narrow("FOODON_03310847", "mixed vegetables"),
    "170472": confirm("Cooked from frozen, so 'mixed vegetables' fits better than 'mixed vegetables (frozen)'."),
    "170524": confirm("FoodOn lists potatoes au gratin as a synonym of this dish."),
    "170525": confirm(SCALLOPED, "unsure"),
    "170843": confirm(CHEESE),
    "170845": confirm(CHEESE),
    "170846": narrow("FOODON_03316862", "mozzarella cheese"),
    "170847": narrow("FOODON_03303877", "mozzarella cheese"),
    "170850": confirm(CHEESE),
    "170851": confirm(CHEESE),
    "170853": narrow("FOODON_03000483", "pasteurized process cheese"),
    "170854": narrow("FOODON_03316867", "pasteurized process cheese"),
    "170855": narrow("FOODON_03302991", "pasteurized process cheese"),
    "170856": confirm(CHEESE),
    "170860": confirm("Pressurized whipped cream topping is whipped cream."),
    "170863": narrow("FOODON_03000481", "american cheese"),
    "170869": confirm(SAME),
    "170879": confirm(SAME),
    "170880": narrow("FOODON_03000289", "chocolate milk"),
    "170881": narrow("FOODON_03304793", "chocolate milk"),
    "170897": confirm(CHEESE),
    "170899": narrow("FOODON_03304590", "cheddar cheese"),
    "170900": narrow("FOODON_03303579", "mozzarella cheese"),
    "170908": confirm(SAME),
    "170910": narrow("FOODON_03304793", "chocolate milk"),
    "171145": confirm(SOUP),
    "171146": narrow("FOODON_03304199", "cream of chicken soup"),
    "171147": confirm(SOUP),
    "171149": confirm(SOUP),
    "171153": confirm(SOUP),
    "171155": confirm(SOUP),
    "171157": confirm("Split pea with ham is a pea soup; FoodOn has no narrower term for this version."),
    "171158": confirm(SOUP),
    "171163": confirm(SOUP),
    "171165": narrow("FOODON_03309457", "onion soup"),
    "171167": confirm(SAUCE),
    "171170": confirm(SAUCE),
    "171171": confirm(
        "Dry gravy powder, not ready gravy; FoodOn's only dry term, 'gravy mix (dry)', does not say mushroom.", "unsure"
    ),
    "171176": confirm(SOUP),
    "171185": confirm(SAUCE),
    "171189": confirm(SOUP),
    "171191": confirm(SAUCE),
    "171240": confirm(CHEESE),
    "171241": confirm(CHEESE),
    "171242": confirm(CHEESE),
    "171243": confirm(CHEESE),
    "171244": narrow("FOODON_03303579", "mozzarella cheese"),
    "171245": confirm(CHEESE),
    "171248": narrow("FOODON_03000486", "ricotta cheese"),
    "171249": confirm(CHEESE),
    "171250": confirm(CHEESE),
    "171251": confirm(CHEESE),
    "171252": narrow("FOODON_03000490", "pasteurized process cheese food"),
    "171253": confirm("It is a swiss process cheese FOOD; FoodOn's swiss term is process cheese, a different product."),
    "171254": narrow("FOODON_03000485", "pasteurized process cheese spread"),
    "171256": narrow(
        "FOODON_03000477",
        "sour cream",
        "FoodOn lists 'sour cream (reduced fat)' as a synonym of 'light sour cream'; 'sour cream' is the broader one.",
    ),
    "171257": confirm(SAME),
    "171258": confirm(SAME),
    "171290": narrow("FOODON_03000482", "pasteurized process cheese"),
    "171291": narrow("FOODON_03000484", "pasteurized process cheese food"),
    "171292": narrow("FOODON_03311360", "cheddar cheese"),
    "171295": confirm(CHEESE),
    "171303": confirm(SAME),
    "171372": confirm(BREAD),
    "171537": confirm(SOUP),
    "171539": confirm(SOUP),
    "171540": narrow("FOODON_03311117", "cream of celery soup"),
    "171541": confirm(SOUP),
    "171543": narrow("FOODON_03304209", "chicken noodle soup"),
    "171550": confirm(SOUP),
    "171551": confirm(SOUP),
    "171554": confirm(SOUP),
    "171555": confirm("Split pea with ham is a pea soup; FoodOn has no narrower term for this version."),
    "171564": confirm(SAUCE),
    "171565": narrow("FOODON_03305336", "brown gravy"),
    "171566": confirm(SAUCE),
    "171567": narrow("FOODON_03305360", "chicken gravy"),
    "171571": narrow("FOODON_03304938", "chicken noodle soup"),
    "171575": confirm(SAUCE),
    "171579": confirm(SAUCE),
    "171580": confirm(SAUCE),
    "171581": confirm(SAUCE),
    "171582": confirm(SAUCE),
    "171587": confirm(SOUP),
    "171591": confirm(SOUP),
    "171592": confirm(SOUP),
    "171593": confirm(SOUP),
    "171602": narrow("FOODON_03304199", "cream of chicken soup"),
    "171605": no_match(
        "FoodOn's 'chili sauce' is the tomato condiment; this is a canned hot green chili sauce.", "unsure"
    ),
    "171606": confirm(SOUP),
    "171607": confirm(SOUP),
    "171610": confirm(SAUCE),
    "171622": replace("FOODON_00002911", MIXED_MEAT),
    "171826": confirm(SAUCE),
    "171850": confirm("It is wheat bread; FoodOn has no term for sprouted-grain bread."),
    "171851": confirm("It is wheat bread; FoodOn has no term for sprouted-grain bread."),
    "171962": narrow("FOODON_03308027", "grouper"),
    "171963": confirm(SAME),
    "171990": confirm(SAME),
    "172026": confirm("It is gluten-free pasta; FoodOn has no term for this flour blend."),
    "172027": confirm("It is gluten-free pasta; FoodOn has no term for this flour blend."),
    "172176": confirm(CHEESE),
    "172177": confirm(CHEESE),
    "172178": confirm(CHEESE),
    "172179": narrow("FOODON_03302973", "cottage cheese"),
    "172180": narrow("FOODON_03302973", "cottage cheese"),
    "172181": narrow(
        "FOODON_03301783",
        "cottage cheese",
        "FoodOn has a narrower term for dry-curd cottage cheese; 'cottage cheese (uncreamed)' would also fit.",
    ),
    "172182": narrow("FOODON_03303720", "cottage cheese"),
    "172207": confirm(CHEESE),
    "172215": confirm(CHEESE),
    "172223": narrow(
        "FOODON_00004528", "fresh cheese", "FoodOn has an exact 'queso fresco' term; 'fresh cheese' is the broad class."
    ),
    "172226": confirm(SAME),
    "172442": confirm(SAME),
    "172452": confirm(SAME),
    "172672": confirm(BREAD),
    "172678": confirm(BREAD),
    "172679": confirm(BREAD),
    "172680": narrow("FOODON_03302693", "raisin bread"),
    "172681": narrow("FOODON_03302693", "raisin bread"),
    "172686": replace("FOODON_03302200", "Our match read 'bread wheat', the grain; the food is wheat bread."),
    "172687": confirm(BREAD),
    "172688": confirm(BREAD),
    "172689": confirm(BREAD),
    "172690": confirm(BREAD),
    "172691": confirm(BREAD),
    "172697": confirm(CAKE),
    "172704": narrow("FOODON_03302768", "pound cake"),
    "172777": confirm(PIE),
    "172780": confirm(PIE),
    "172781": confirm(PIE),
    "172786": confirm(PIE),
    "172791": confirm("Filo is another spelling of phyllo."),
    "172809": confirm(BREAD),
    "172816": confirm(BREAD),
    "172817": confirm(BREAD),
    "172818": confirm(BREAD),
    "172826": confirm(BREAD),
    "172880": confirm(SAUCE),
    "172882": confirm(SOUP),
    "172886": confirm(SAUCE),
    "172887": confirm(SOUP),
    "172890": confirm(SAUCE),
    "172891": confirm(SOUP),
    "172893": confirm(SOUP),
    "172894": confirm(SOUP),
    "172896": confirm(SOUP),
    "172897": confirm(SOUP),
    "172906": confirm(SOUP),
    "172907": confirm(SOUP),
    "172908": confirm(SOUP),
    "172909": confirm(SOUP),
    "172913": confirm(SOUP),
    "172915": confirm(SOUP),
    "172916": confirm("Split pea with ham is a pea soup; FoodOn has no narrower term for this version."),
    "172917": confirm(SOUP),
    "172925": confirm("Prepared from the mix, so it is the soup, not 'chicken noodle soup mix'."),
    "172942": confirm(
        "FoodOn lists Vienna sausage as a synonym, though US cooks treat canned Vienna sausages as their own thing.",
        "unsure",
    ),
    "172948": no_match(
        "A mix of three meats; turkey sausage names only one, and no FoodOn term names the mix.", "unsure"
    ),
    "172949": replace("FOODON_03302012", MIXED_MEAT),
    "172952": confirm(SAME),
    "172953": confirm("Polish sausage is kielbasa; FoodOn has no term for this meat mix."),
    "172954": confirm("Polish sausage is kielbasa; FoodOn has no term for this meat mix."),
    "172958": replace("FOODON_00002911", MIXED_MEAT),
    "172964": confirm(SAME),
    "172970": replace("FOODON_03306503", MIXED_MEAT),
    "173239": confirm(PIE),
    "173243": confirm(CAKE),
    "173264": confirm("It is gluten-free pasta; FoodOn has no term for this flour blend."),
    "173265": confirm("It is gluten-free pasta; FoodOn has no term for this flour blend."),
    "173343": confirm(SAME),
    "173413": confirm(CHEESE),
    "173415": confirm(CHEESE),
    "173416": confirm(CHEESE),
    "173417": narrow("FOODON_03303720", "cottage cheese"),
    "173418": confirm(CHEESE),
    "173419": confirm(CHEESE),
    "173420": confirm(CHEESE),
    "173442": confirm("FoodOn lists 'sour cream (reduced fat)' as a synonym of light sour cream."),
    "173443": confirm(SAME),
    "173450": narrow("FOODON_03000289", "chocolate milk"),
    "173461": confirm(SAME),
    "173464": confirm(SAME),
    "173565": no_match(BLEND),
    "173584": confirm(SAME),
    "173723": confirm(SAME),
    "173731": confirm(SAME),
    "173732": narrow("FOODON_03301466", "baked beans (dish)", PORK_AND_BEANS),
    "173733": narrow(
        "FOODON_03307027",
        "baked beans (dish)",
        "FoodOn names this exact product; 'baked beans (dish)' is the broader one.",
    ),
    "173858": confirm(SAME),
    "173859": narrow(
        "FOODON_03316070", "pork sausage", "FoodOn has a 'chorizo' term; 'pork sausage' is the broader one."
    ),
    "173872": replace("FOODON_03306503", MIXED_MEAT),
    "173883": no_match(
        "A mix of three meats; pork sausage names only one, and no FoodOn term names the mix.", "unsure"
    ),
    "174064": confirm(SOUP),
    "174067": confirm(SAUCE),
    "174070": confirm(SAUCE),
    "174073": confirm(SOUP),
    "174074": confirm(SAUCE),
    "174080": confirm(SAME),
    "174189": replace(
        "FOODON_02021812", "Our match said Pacific cod, but this is Atlantic cod, named as its cooked siblings name it."
    ),
    "174272": confirm(SAME),
    "174529": confirm(SAUCE),
    "174530": confirm(SOUP),
    "174531": confirm(SAUCE),
    "174537": confirm(SOUP),
    "174538": narrow("FOODON_03303897", "vegetable soup"),
    "174540": confirm(SOUP),
    "174546": confirm(SOUP),
    "174549": confirm(SOUP),
    "174550": confirm(SOUP),
    "174553": confirm(SOUP),
    "174561": confirm(SOUP),
    "174565": confirm(SOUP),
    "174567": confirm("Prepared from the mix, so it is the soup, not 'cream of chicken soup mix'."),
    "174568": confirm("Prepared from the mix, so it is the soup, not 'onion soup mix'."),
    "174569": confirm("Prepared from the mix, so it is the soup, not 'tomato soup mix'."),
    "174586": confirm(SAME),
    "174592": confirm(SAME),
    "174598": replace("FOODON_03312067", MIXED_MEAT),
    "174600": confirm("The accepted raw turkey sausage row uses this term, so the two group together."),
    "174604": confirm(
        "Turkey Italian sausage is a kind of Italian sausage, though a cook might file it under turkey sausage.",
        "unsure",
    ),
    "174610": replace("FOODON_03306503", MIXED_MEAT),
    "174614": confirm(SAME),
    "174807": confirm("It is egg drop soup; FoodOn has no narrower term for this version."),
    "174912": confirm(BREAD),
    "174913": confirm(BREAD),
    "174915": confirm(BREAD),
    "174916": confirm(BREAD),
    "174918": confirm(BREAD),
    "174924": confirm(BREAD),
    "174925": confirm(BREAD),
    "174926": confirm(BREAD),
    "174927": confirm(BREAD),
    "174934": confirm(CAKE),
    "174940": confirm("It is pound cake; 'butter pound cake' is wrong here because it is not all butter."),
    "175011": confirm(PIE),
    "175012": confirm(PIE),
    "175013": confirm(PIE),
    "175017": confirm(PIE),
    "175019": confirm(PIE),
    "175020": confirm(PIE),
    "175021": confirm(PIE),
    "175053": confirm("It is pound cake; 'butter pound cake' is wrong here because it is not all butter."),
    "175174": confirm(SAME),
    "175178": confirm(SAME),
    "175182": confirm(SAME),
    "175183": confirm(SAME),
    "175184": confirm(
        "Beans with franks is a kind of baked beans, though some cooks treat franks and beans as its own dish.",
        "unsure",
    ),
    "175185": narrow("FOODON_03301466", "baked beans (dish)", PORK_AND_BEANS),
    "175207": confirm(SAME),
    # ---------------------------- flagged by the accepted-set check (2026-09-23), head: main word missing (107)
    "167612": confirm("Oopah is an Alaska Native name for a tunicate, eaten whole."),
    "167622": replace(
        "FOODON_02022164",
        "Venison is deer meat, and USDA's carcass term is not usable, so this names raw sitka deer meat.",
    ),
    "167630": confirm("Chilchen is the Navajo red berry drink this term names."),
    "167644": confirm(CARIBOU_SAME),
    "167666": confirm("Restaurant is a category word, and these are refried beans."),
    "167670": confirm("A restaurant sirloin steak is a top sirloin steak, as the Denny's row uses."),
    "167672": confirm("French fries are french-fried potatoes."),
    "167715": replace(
        "FOODON_03303943", "Shredded Wheat 'n Bran is a shredded wheat cereal, as the other Shredded Wheat rows use."
    ),
    "167732": confirm("Strained baby banana is a banana puree, and babyfood is a category word."),
    "167790": confirm("Lulo is another name for naranjilla."),
    "167791": confirm("Kiwano is another name for horned melon."),
    "167801": confirm("Lemon juice from concentrate is reconstituted lemon juice."),
    "167802": confirm("Lemon juice from concentrate is reconstituted lemon juice."),
    "167909": confirm("Cure 81 is a Hormel brand of cured ham."),
    "168016": no_match(
        "Sweet potato puffs are a formed side dish (161 kcal per 100 g), not plain sweet potato, and FoodOn has no "
        "term for them."
    ),
    "168049": confirm(CARIBOU_SAME),
    "168147": confirm("Vital wheat gluten is the wheat gluten sold for baking."),
    "168217": no_match(
        "This is a concentrate (221 kcal per 100 g), and FoodOn has no raspberry juice concentrate term."
    ),
    "168320": confirm("It is fresh boneless pork loin, and the other words are the brand."),
    "168383": replace(
        "FOODON_00003149",
        "Canadian bacon is cured lean loin, not streaky bacon, and its unprepared twin uses 'Canadian bacon'.",
    ),
    "168384": confirm("Sprouted alfalfa seeds are alfalfa sprouts."),
    "168404": replace("FOODON_03306820", BLACKEYE_COOKED),
    "168457": confirm("Seaweed is a category word, and kelp is the food."),
    "168508": confirm("Beet greens are beet leaves."),
    "168527": replace("FOODON_03306820", BLACKEYE_COOKED),
    "168532": confirm("Drumstick is another name for moringa."),
    "168581": confirm("Fungi is a category word, and cloud ear is the food."),
    "168896": replace("FOODON_03304043", "This is bread flour, not bread, and 'white bread flour' names it."),
    "168913": replace("FOODON_03304043", "This is bread flour, not bread, and 'white bread flour' names it."),
    "168978": confirm("Tunughnak is an Alaska Native name for ascidians, a kind of tunicate."),
    "169220": confirm("Blackeyes are blackeyed peas."),
    "169222": confirm(YARDLONG),
    "169223": confirm(YARDLONG),
    "169227": confirm("Dandelion greens are dandelion leaves."),
    "169237": confirm(
        "Jew's ear is another name for jelly ear (Auricularia auricula-judae), as USDA's scientific name says."
    ),
    "169351": confirm("Dandelion greens are dandelion leaves."),
    "169359": confirm(YARDLONG),
    "169694": confirm("FoodOn lists masa harina, the dry corn flour, as a synonym of 'masa'."),
    "169696": confirm("FoodOn lists masa harina, the dry corn flour, as a synonym of 'masa'."),
    "169739": confirm("Barley flour or meal is barley flour."),
    "169749": confirm("FoodOn lists masa harina, the dry corn flour, as a synonym of 'masa'."),
    "169821": confirm("Pinon nuts are pine nuts."),
    "169831": confirm("A restaurant house sirloin is a top sirloin steak, as the Denny's row uses."),
    "169848": confirm("Restaurant is a category word, and these are hash browns."),
    "169909": confirm("Mammy-apple is another spelling of mamey apple."),
    "169923": replace(
        "FOODON_03301829", "USDA's term is raw orange peel, and the food is undiluted frozen orange juice concentrate."
    ),
    "169940": replace(
        "FOODON_03301289", "USDA's term is peach nectar, and its with-ascorbic-acid twin uses 'pear nectar'."
    ),
    "169992": replace(
        "FOODON_03000038",
        "Chicory greens are the raw leaves, which 'chicory leaf (raw)' names more closely than a bunch.",
    ),
    "169997": confirm("Cilantro is coriander leaf."),
    "170069": confirm("Waxgourd is winter melon."),
    "170139": confirm("Turnip greens are turnip leaves."),
    "170376": confirm("Beet greens are beet leaves."),
    "170466": confirm("Turnip greens are turnip leaves."),
    "170483": confirm("Drumstick is another name for moringa."),
    "170484": confirm("Drumstick is another name for moringa."),
    "170496": confirm("Seaweed is a category word, and wakame is the food."),
    "170682": confirm("Amaranth grain is amaranth seed."),
    "170683": confirm("Amaranth grain is amaranth seed."),
    "171100": replace(
        "FOODON_03306998",
        "USDA also calls it goose liver pate, and this term groups it with the goose pate row that has the same "
        "nutrients.",
        "unsure",
    ),
    "171422": confirm("Vegetable oil is a category word, and palm kernel oil is the food."),
    "171621": confirm("Braunschweiger is a pork liver sausage."),
    "172276": confirm("Strained baby sweet potatoes are a sweet potato puree, as the junior row uses."),
    "172331": replace("FOODON_03304167", "It is a hydrogenated palm shortening, and 'palm oil' names the plain oil."),
    "172333": confirm("It is hydrogenated soybean oil sold as a shortening, which this term names."),
    "172334": replace(
        "FOODON_03316585",
        "FoodOn has a confectioner's shortening term, which names this product better than plain palm oil.",
    ),
    "172416": confirm("Guinea hen is guinea fowl."),
    "172425": replace("FOODON_03000196", "USDA's term is chickpea, and FoodOn has a raw mature moth bean term."),
    "172436": confirm("Red gram is pigeon pea, and raw mature pigeon peas are the dried peas."),
    "172437": confirm("Red gram is another name for pigeon pea."),
    "172445": confirm("Soy meal is soybean meal."),
    "172468": confirm("Nasoya Lite Firm is a reduced-fat firm tofu, and FoodOn has no reduced-fat tofu term."),
    "172472": confirm("Red gram is another name for pigeon pea."),
    "172928": replace(
        "FOODON_03303695",
        "It is a canned liver pate, not pieces of chicken liver, and 'liver paste (canned)' names it.",
    ),
    "172929": replace(
        "FOODON_03306998", "It is a goose liver pate, not pieces of goose liver, and 'goose liver paste' names it."
    ),
    "172932": confirm("Mother's loaf is a pork luncheon loaf, which 'pork loaf' describes.", "unsure"),
    "172986": confirm("Toasted Oat Bran is an oat bran cereal, and the other words are the brand."),
    "173177": confirm("Beverages is a category word, and whey protein isolate is the food."),
    "173569": replace(
        "FOODON_03304167", "It blends two oils, and 'shortening (hydrogenated)' names the product without picking one."
    ),
    "173597": confirm("It is partly hydrogenated soybean oil sold as a shortening, which this term names."),
    "173607": confirm("It is partly hydrogenated soybean oil sold as a shortening, which this term names."),
    "173762": confirm(TOFU),
    "173763": confirm(TOFU),
    "173764": confirm(TOFU),
    "173783": confirm(TOFU),
    "173784": confirm("Lite Silken is a reduced-fat silken tofu, and the other extra words are the brand."),
    "173785": confirm(TOFU),
    "173786": confirm(TOFU),
    "173787": confirm(TOFU),
    "173802": replace("FOODON_00005284", "USDA's term is lentil, and its without-salt twin uses 'lima bean (mature)'."),
    "173865": no_match("Minced ham is a cured luncheon meat, not ground pork, and FoodOn has no minced ham term."),
    "173952": confirm("Carissa is the natal plum."),
    "174013": confirm("A composite of retail cuts is what the other beef composite rows file as 'beef retail cut'."),
    "174255": replace(
        "FOODON_03000211", "USDA's term is lupine bean, and FoodOn has a raw mature baby lima bean term."
    ),
    "174256": replace("FOODON_03000197", "USDA's term is soybean, and FoodOn has a raw mature mung bean term."),
    "174281": confirm(YARDLONG),
    "174282": confirm(YARDLONG),
    "174288": narrow(
        "FOODON_03601071",
        "chickpea flour",
        "FoodOn's 'gram flour' lists besan as a synonym, and 'chickpea flour' is the broader one.",
    ),
    "174297": confirm("Cubed is only the cut, and the other extra words are the brand."),
    "174306": confirm(YARDLONG),
    "174471": confirm("Guinea hen is guinea fowl."),
    "174635": replace(
        "FOODON_03304608",
        "It is plain toasted wheat bran (41 g fiber per 100 g, like crude bran), not a mixed bran cereal.",
    ),
    "175040": confirm("Leavening agents is a category word, and baking soda is the food."),
    "175042": narrow(
        "FOODON_03311884",
        "bakers yeast",
        "Compressed yeast is a moist cake (105 kcal per 100 g), and 'bakers yeast' is the broader one.",
    ),
    "175043": confirm("Active dry yeast is baker's yeast, and leavening agents is a category word."),
    "175235": confirm(TOFU),
    "175236": confirm(TOFU),
    "175256": replace(
        "FOODON_00005287",
        "Mungo beans are black gram (urad), not mung beans, and the without-salt twin uses 'black gram bean (mature)'.",
    ),
    # ----------------------- flagged by the accepted-set check (2026-09-23), part: names an unstated part (142)
    "167631": confirm("Navajo dried corn is the dried corn kernel."),
    "167724": no_match("Puffed millet is a puffed cereal like puffed rice, and FoodOn has no puffed millet term."),
    "168391": confirm("Leafy tips are the young leaves, and balsam-pear is bitter gourd."),
    "168392": confirm("Leafy tips are the young leaves, and balsam-pear is bitter gourd."),
    "168406": confirm("Leafy tips are the young cowpea leaves."),
    "168407": confirm(LEAF),
    "168410": replace("FOODON_00002809", "Its green soybean siblings use 'edamame', which names the same food."),
    "168411": replace("FOODON_00002809", "Its green soybean siblings use 'edamame', which names the same food."),
    "168412": confirm(LEAF),
    "168413": confirm(LEAF),
    "168419": confirm("Potherb jute is eaten as its leaves, which FoodOn calls nalta jute leaf."),
    "168420": replace("FOODON_03000111", "The jute is cooked, and its with-salt twin uses 'nalta jute leaf'."),
    "168425": confirm("Kohlrabi is eaten as its swollen stem."),
    "168438": confirm(LEAF),
    "168440": confirm(LEAF),
    "168441": confirm(LEAF),
    "168460": confirm(SPROUT),
    "168461": confirm(SPROUT),
    "168463": narrow(
        "FOODON_00003908",
        "spinach leaf",
        "Its with-salt twin uses 'spinach (cooked)', and 'spinach leaf' is the broader one.",
    ),
    "168486": replace(
        "FOODON_00003752", "Taro is eaten as its corm (142 kcal per 100 g), and its with-salt twin uses 'taro root'."
    ),
    "168495": confirm("Leafy tips are the young leaves, and balsam-pear is bitter gourd."),
    "168522": confirm("Garland chrysanthemum is eaten as its leaves."),
    "168523": confirm("Collards are eaten as their leaves."),
    "168524": narrow(
        "FOODON_03310954",
        "collard leaf",
        "Its without-salt twin uses 'collard greens (frozen)', and 'collard leaf' is the broader one.",
    ),
    "168529": confirm("Leafy tips are the young cowpea leaves."),
    "168553": no_match(
        "The nutrients (0.3 g protein, almost no vitamin A) fit the starchy trunk core, not the fronds, and FoodOn "
        "has no other tree fern term.",
        "unsure",
    ),
    "168572": replace(
        "FOODON_00005337", "Napa cabbage is pe-tsai, and the cooked pe-tsai row uses 'napa cabbage head'."
    ),
    "168584": confirm("Frozen, unprepared fiddleheads are uncooked, so the raw term groups them with the raw row."),
    "168871": replace("FOODON_00004438", "FoodOn has a cooked millet term, and 'millet seed' does not say cooked."),
    "168875": confirm(KERNEL),
    "168876": confirm("Dry parboiled rice is uncooked brown rice, which the raw kernel term names."),
    "168884": confirm(KERNEL),
    "168889": confirm(KERNEL),
    "168890": confirm(KERNEL),
    "168891": confirm(KERNEL),
    "168897": narrow(
        "FOODON_00005623",
        "wild rice kernel",
        "FoodOn has a cooked wild rice term, and 'wild rice kernel' is the broader one.",
    ),
    "168917": narrow(
        "FOODON_00004405",
        "quinoa seed",
        "FoodOn's 'quinoa seed (dried, cooked)' names cooked quinoa, and 'quinoa seed' is the broader one.",
    ),
    "169146": replace("FOODON_03317254", "Beets are the root, not the leaves, and the with-salt twin uses 'beetroot'."),
    "169224": confirm("Leafy tips are the young cowpea leaves."),
    "169238": confirm(LEAF),
    "169275": confirm(LEAF),
    "169301": confirm("Water convolvulus is water morning glory, eaten as its leaves."),
    "169308": replace("FOODON_03309801", "Taro is eaten as its corm (112 kcal per 100 g), not its leaves."),
    "169310": confirm(
        "Tahitian taro is grown for its leaves (44 kcal per 100 g), which FoodOn also calls tahitian spinach."
    ),
    "169334": confirm("Butterbur (fuki) is eaten as its stalks."),
    "169338": replace("FOODON_03000049", "Cardoon is eaten as its leaf stalks, and its twins use 'cardoon stalk'."),
    "169341": replace(
        "FOODON_00004120", "Celeriac is eaten as its root, and its without-salt twin uses 'celeriac root'."
    ),
    "169342": replace(
        "FOODON_00003411", "Cooked celery is the stalk, not the leaf, and the raw row uses 'celery stalk (raw)'."
    ),
    "169343": confirm(LEAF),
    "169354": confirm("Potherb jute is eaten as its leaves, which FoodOn calls nalta jute leaf."),
    "169355": confirm(LEAF),
    "169357": confirm("Kohlrabi is eaten as its swollen stem."),
    "169371": confirm(LEAF),
    "169387": confirm(LEAF),
    "169400": confirm(LEAF),
    "169405": narrow(
        "FOODON_03000170",
        "fiddlehead leaf",
        "FoodOn has a raw fiddlehead term, and 'fiddlehead leaf' is the broader one.",
    ),
    "169418": replace(
        "FOODON_00003581",
        "Its without-salt twin and the other roasted kernel rows use 'sunflower seed (whole kernel)'.",
    ),
    "169422": replace(
        "FOODON_00003615", "Its without-salt twin and the dry-roasted rows use 'cashew nut', so they group together."
    ),
    "169703": confirm(KERNEL),
    "169704": narrow(
        "FOODON_00004373",
        "long grain brown rice kernel",
        "FoodOn has a cooked long-grain brown rice term, and 'long grain brown rice kernel' is the broader one.",
    ),
    "169705": confirm(KERNEL),
    "169706": confirm(KERNEL),
    "169715": replace(
        "FOODON_03303411", "Its unenriched twin uses 'coarse semolina (durum wheat)', so the two group together."
    ),
    "169716": confirm(KERNEL),
    "169718": confirm(KERNEL),
    "169719": confirm(KERNEL),
    "169720": confirm(KERNEL),
    "169721": confirm(KERNEL),
    "169725": confirm("Sprouted wheat is wheat sprouts, eaten raw."),
    "169726": confirm(KERNEL),
    "169743": confirm("KAMUT is a brand of khorasan wheat, and the grain is the kernel."),
    "169744": confirm("KAMUT is a brand of khorasan wheat, and the grain is the kernel."),
    "169745": narrow(
        "FOODON_03000254",
        "spelt kernel",
        "FoodOn has a raw spelt term that matches 'uncooked', and 'spelt kernel' is the broader one.",
    ),
    "169746": confirm(KERNEL),
    "169803": replace(
        "FOODON_03301658", "USDA's data is for the edible meat, and 'cockle (raw)' names it without the shell."
    ),
    "169819": confirm(LEAF),
    "169960": confirm("Shellie beans are shell beans, and 'shell' names the bean type, not a part."),
    "169981": confirm("Cardoon is eaten as its leaf stalks."),
    "169982": confirm("Cardoon is eaten as its leaf stalks."),
    "169987": confirm("Celeriac is eaten as its root."),
    "169989": replace(
        "FOODON_00003411", "Cooked celery is the stalk, not the leaf, and the raw row uses 'celery stalk (raw)'."
    ),
    "169990": confirm("Celtuce is grown for its stem."),
    "169995": confirm("Garland chrysanthemum is eaten as its leaves."),
    "169998": confirm("Sweet corn is eaten as its kernels, as the raw white corn row uses."),
    "170010": confirm(PEA_POD),
    "170011": confirm(PEA_POD),
    "170012": confirm(PEA_POD),
    "170068": confirm(LEAF),
    "170075": replace(
        "FOODON_03304734",
        "Freeze-dried chives are ten times as dense as fresh (311 kcal per 100 g), and FoodOn has a freeze-dried "
        "chive term.",
    ),
    "170076": confirm(LEAF),
    "170077": confirm(LEAF),
    "170078": replace(
        "FOODON_00003122",
        "Eppaw is Oregon yampah, eaten as its starchy root (150 kcal per 100 g, no vitamin A), not its leaves.",
    ),
    "170079": confirm("Canned mung bean sprouts are what this term names."),
    "170098": replace("FOODON_00003681", "Its without-salt twin uses 'okra pod', so the two group together."),
    "170099": replace("FOODON_00003681", "Its frozen without-salt twin uses 'okra pod', so the two group together."),
    "170121": confirm(LEAF),
    "170136": confirm(
        "Tahitian taro is grown for its leaves (44 kcal per 100 g), which FoodOn also calls tahitian spinach."
    ),
    "170147": replace(
        "FOODON_03301766",
        "FoodOn has a cottonseed meal term that names it in the description's own words, though the near-identical "
        "flour rows use 'cottonseed flour'.",
        "unsure",
    ),
    "170148": replace("FOODON_00004400", "Hulled hemp seed has its hull removed, so 'with hull' says the opposite."),
    "170183": replace(
        "FOODON_00003699", "The pecans are dry roasted, not oil roasted, and the with-salt twin uses 'pecan'."
    ),
    "170286": confirm("Buckwheat is sold as the dried seed."),
    "170288": replace(
        "FOODON_00003781", "USDA notes this is dent or field corn, and FoodOn's sweet corn term names a different crop."
    ),
    "170385": confirm("Butterbur (fuki) is eaten as its stalks."),
    "170386": confirm("Butterbur (fuki) is eaten as its stalks."),
    "170387": confirm("Butterbur (fuki) is eaten as its stalks."),
    "170400": confirm("Celeriac is eaten as its root."),
    "170401": confirm(LEAF),
    "170405": confirm("Garland chrysanthemum is eaten as its leaves."),
    "170407": confirm("Collards are eaten as their leaves."),
    "170416": confirm(HERB_FRESH),
    "170455": confirm(
        "Tahitian taro is grown for its leaves (44 kcal per 100 g), which FoodOn also calls tahitian spinach."
    ),
    "170464": no_match(
        "The nutrients (0.3 g protein, almost no vitamin A) fit the starchy trunk core, not the fronds, and FoodOn "
        "has no other tree fern term.",
        "unsure",
    ),
    "170481": replace("FOODON_03000064", "The nutrients (high vitamin A and iron) fit the leaves, not the flowers."),
    "170486": confirm("FoodOn names the freeze-dried leaf, which is this food."),
    "170506": confirm(LEAF),
    "170509": confirm(PEA_POD),
    "170510": confirm(PEA_POD),
    "170569": confirm("Dried brazil nuts are sold shelled, which is what 'shell off' says."),
    "170591": confirm("Dried pine nuts are the shelled kernels."),
    "170592": confirm("Pinyon nuts are pine nuts, sold as the shelled kernels."),
    "170893": confirm("Frozen whole egg is sold out of the shell, which is what 'shell off' says."),
    "170930": confirm(HERB_DRIED),
    "170936": confirm(HERB_DRIED),
    "171074": replace(
        "FOODON_02020271", "The back is meat only, and its stewed sibling uses 'piece of chicken back (skinless)'."
    ),
    "171287": replace(
        "FOODON_02020152", "A fresh raw egg is 'chicken egg (raw)', as the duck, goose and quail egg rows use."
    ),
    "171317": confirm(HERB_DRIED),
    "171318": confirm(HERB_DRIED),
    "171322": confirm(HERB_DRIED),
    "171328": confirm(HERB_DRIED),
    "171333": confirm(HERB_DRIED),
    "171472": replace(
        "FOODON_02020271", "The back is meat only, and its stewed sibling uses 'piece of chicken back (skinless)'."
    ),
    "172188": confirm("Dried whole egg is egg solids out of the shell, which this term names."),
    "172202": confirm("Frozen whole egg is sold out of the shell, which is what 'shell off' says."),
    "172232": confirm(HERB_FRESH),
    "172239": confirm(HERB_DRIED),
    "173263": confirm(KERNEL),
    "173424": confirm("A hard-boiled egg is cooked in its shell."),
    "173425": confirm("Dried whole egg is egg solids out of the shell, which this term names."),
    "173470": confirm(HERB_FRESH),
    "173473": confirm(HERB_FRESH),
    "173475": confirm(HERB_FRESH),
    "173738": no_match(
        "These are dry mature bean seeds (343 kcal per 100 g), not green bean pods, and FoodOn has no dry french bean "
        "term."
    ),
    # ---------------------- flagged by the accepted-set check (2026-09-23), contradicts: says the opposite (20)
    "167850": replace(
        "FOODON_02000330", "The steak is cooked, and 'pork butt steak' names the cut without the raw state."
    ),
    "167851": replace(
        "FOODON_02000330", "The steak is cooked, and 'pork butt steak' names the cut without the raw state."
    ),
    "167887": replace(
        "FOODON_02000307", "The chop is cooked, and its braised and broiled siblings use 'New York chop (boneless)'."
    ),
    "168152": confirm("USDA's 'fresh, dried' is dried jujube (281 kcal per 100 g), so the dried term is right."),
    "168261": replace(
        "FOODON_02000330", "The steak is cooked, and 'pork butt steak' names the cut without the raw state."
    ),
    "168262": replace(
        "FOODON_02000330", "The steak is cooked, and 'pork butt steak' names the cut without the raw state."
    ),
    "168294": replace(
        "FOODON_02000307", "The chop is cooked, and its braised and broiled siblings use 'New York chop (boneless)'."
    ),
    "168591": replace(
        "FOODON_00003796",
        "These are fresh lotus seeds (89 kcal per 100 g), and 'dried' would group them with the 332 kcal dried seeds.",
    ),
    "169235": replace(
        "FOODON_00005292", "The beans are cooked, and the with-salt twin uses 'hyacinth bean (immature)'."
    ),
    "169702": confirm("Raw millet is the dry grain, so the dried term is right."),
    "169922": replace(
        "FOODON_03301829", "It is undiluted concentrate (147 kcal per 100 g), not the reconstituted juice."
    ),
    "170126": replace("FOODON_03000079", "The squash is cooked, and its without-salt twin uses 'straightneck squash'."),
    "170607": no_match(
        "It is a chopped, cured and smoked luncheon beef, not a raw chuck steak, and no FoodOn term safely names it."
    ),
    "170806": replace("FOODON_02000048", "The steak is cooked, and its cooked siblings use 'beef chuck tender steak'."),
    "171051": replace(
        "FOODON_02020209",
        "The food is meat and skin, and its roasted sibling uses 'piece of chicken meat (with skin)'.",
    ),
    "171139": replace(
        "FOODON_02020537", "The back is roasted, and 'piece of turkey back (with skin)' names it without the raw state."
    ),
    "172428": confirm("Raw split peas are the dried peas, so the dried term is right."),
    "173727": confirm("Raw mature adzuki beans are the dried beans, so the dried term is right."),
    "173928": replace(
        "FOODON_00004473", "The apples are cooked, and 'apple (peeled)' names them without the raw state."
    ),
    "173929": replace(
        "FOODON_00004473", "The apples are cooked, and 'apple (peeled)' names them without the raw state."
    ),
    # -------------------- flagged by the accepted-set check (2026-09-23), process: adds an unstated process (6)
    "167771": replace(
        "FOODON_03310588",
        "Its without-ascorbic-acid twin uses 'apple juice (canned)', and the description does not say reconstituted.",
    ),
    "168922": replace(
        "FOODON_03317234",
        "This is plain degermed cornmeal, not self-rising, and its unenriched twin uses 'white cornmeal "
        "(degerminated)'.",
    ),
    "170039": confirm("Potato granules are the granulated form this term names."),
    "170931": confirm("USDA's black pepper is the ground spice, which this term names."),
    "170985": confirm("Juice with added calcium is calcium-fortified."),
    "173041": replace(
        "FOODON_03301127", "Its siblings use 'grape juice', and the description does not say reconstituted."
    ),
    # ---------------------------------- flagged by the accepted-set check (2026-09-23), hand: found by hand (6)
    "172545": replace(
        "FOODON_02021242",
        "A composite of retail cuts is not the shoulder, and most raw lamb composites use 'lamb retail cut (raw)'.",
    ),
    "173121": replace(
        "FOODON_02000015",
        "A top round steak is not an eye of round roast, and its siblings use 'beef top round steak (raw)'.",
    ),
    "173122": replace(
        "FOODON_02000009",
        "A bottom round roast is not an eye of round roast, and its siblings use 'beef bottom round roast (raw)'.",
    ),
    "174895": replace(
        "FOODON_02000253", "A leg of lamb is not a rack of lamb, and its cooked lean-only sibling uses 'lamb leg'."
    ),
    "174896": replace(
        "FOODON_02000254", "A leg of lamb is not a rack of lamb, and the raw whole-leg rows use 'lamb leg (raw)'."
    ),
    "175201": replace(
        "FOODON_03315783",
        "These are canned pinto beans, not adzuki beans, though the low-sodium twin sits under 'pinto bean (mature)'.",
    ),
    # ------------------- flagged by the accepted-set check (2026-09-23), label: animal or code (23), and hand (16)
    "168219": no_match(CARCASS),
    "169430": no_match(CARCASS),
    "169431": no_match(CARCASS),
    "171057": replace("FOODON_03305358", GIBLET_RAW),
    "172396": replace("FOODON_03305358", GIBLET_RAW),
    "173641": replace("FOODON_03305358", GIBLET_RAW),
    "174465": replace("FOODON_03305358", GIBLET_RAW),
    "171058": no_match(GIBLET_COOKED),
    "171455": no_match(GIBLET_COOKED),
    "172397": no_match(GIBLET_COOKED),
    "173642": no_match(GIBLET_COOKED),
    "174466": no_match(GIBLET_COOKED),
    "171083": no_match("Giblets are not a whole carcass, and FoodOn has no term for turkey giblets."),
    "171084": no_match("Giblets are not a whole carcass, and FoodOn has no term for turkey giblets."),
    "171047": replace("FOODON_03301121", WHOLE_BIRD, "unsure"),
    "172394": replace("FOODON_03301121", WHOLE_BIRD, "unsure"),
    "172406": replace("FOODON_03301121", WHOLE_BIRD, "unsure"),
    "173640": replace("FOODON_03301121", WHOLE_BIRD, "unsure"),
    "171050": replace("FOODON_00004237", WHOLE_BIRD, "unsure"),
    "171446": replace("FOODON_00004237", WHOLE_BIRD, "unsure"),
    "172399": replace("FOODON_00004237", WHOLE_BIRD, "unsure"),
    "172407": replace("FOODON_00004237", WHOLE_BIRD, "unsure"),
    "173633": replace("FOODON_00004237", WHOLE_BIRD, "unsure"),
    "167653": replace(
        "FOODON_03310640", "Dried field corn is not sweet corn, and the Navajo dried corn uses 'corn kernel (dried)'."
    ),
    "168920": replace(
        "FOODON_00003562", "Corn grain is field corn, not sweet corn, and FoodOn has no white dent corn term."
    ),
    "167750": no_match("The prickly pear fruit is not the pad, and FoodOn has no term for the fruit."),
    "169816": no_match("The prickly pear fruit is not the pad, and FoodOn has no term for the fruit."),
    "168188": no_match("Undiluted concentrate is not ready-to-drink juice, and FoodOn has no apple juice concentrate."),
    "173934": no_match("Undiluted concentrate is not a juice drink, and FoodOn has no apple juice concentrate."),
    "168509": replace(
        "FOODON_03000063", "Cooked borage is the leaves, and the raw borage row uses 'borage leaf (raw)'."
    ),
    "170482": replace(
        "FOODON_03000063", "Cooked borage is the leaves, and the raw borage row uses 'borage leaf (raw)'."
    ),
    "169369": replace("FOODON_00003837", SPROUT),
    "169370": replace("FOODON_00003837", SPROUT),
    "169658": no_match("Maple sugar is not maple syrup, and FoodOn has no maple sugar term."),
    "170204": replace(
        "FOODON_00003884", "Pastrami is not a raw chuck steak, and 'Pastrami, beef, 98% fat-free' uses 'pastrami'."
    ),
    "170418": replace("FOODON_03000117", "Snow peas are eaten pod and all, and their siblings use 'edible pea pod'."),
    "173739": no_match("These are dry mature bean seeds, not green bean pods, and the raw row is no match too."),
    "175241": no_match("These are dry mature bean seeds, not green bean pods, and the raw row is no match too."),
    "174384": replace(
        "FOODON_02021242",
        "A composite of retail cuts is not the shoulder, and its raw siblings use 'lamb retail cut (raw)'.",
    ),
    # ------------------------------------------------ Foundation rows with no SR Legacy match (owner, 2026-09-27) (28)
    # Eggs, Grade A, Large, egg white
    "747997": replace(
        "FOODON_02020156",
        "USDA's term is obsolete; FoodOn names this one as its replacement, and the raw fresh egg white row uses it.",
    ),
    # Flour, almond
    "2261420": confirm(
        "Almond flour is finely ground almonds, which FoodOn calls almond meal; 'blanched almond meal' is closer, "
        "but the name does not say blanched.",
        "unsure",
    ),
    # Buckwheat, whole grain
    "2512378": narrow(
        "FOODON_00004234",
        "buckwheat seed",
        "The SR 'Buckwheat' row uses 'buckwheat seed (dried)'; 'buckwheat seed' is the broader one.",
    ),
    # Rice, brown, long grain, unenriched, raw
    "2512380": confirm("The grain is the kernel, and the raw long-grain brown rice row uses the same term."),
    # Seeds, pumpkin seeds (pepitas), raw
    "2515380": replace(
        "FOODON_00004886",
        "Pepitas are hulled pumpkin seeds, and the dried and roasted kernel rows use 'pumpkin seed'.",
    ),
    # Blackeye pea, dry
    "2644284": narrow(
        "FOODON_03000202",
        "blackeyed pea (raw)",
        "Dry blackeyes are raw mature seeds, and the SR raw mature blackeye row uses 'blackeyed pea (raw, mature)'.",
    ),
    # Blackeye pea, canned, sodium added, drained and rinsed
    "2644293": replace(
        "FOODON_00003414",
        "The SR canned mature blackeye row uses 'cowpea', so the two group together; 'blackeyed pea (canned)' is "
        "the closer name.",
        "unsure",
    ),
    # Chicken, breast, boneless, skinless, raw
    "2646170": replace(
        "FOODON_02020280",
        "USDA's term is obsolete; the raw skinless boneless SR rows use this term, and FoodOn's own replacement is "
        "'chicken breast (skinless, boneless)'.",
    ),
    # Wild rice, dry, raw
    "2710821": confirm("The grain is the kernel, and the raw wild rice row uses the same term."),
    # Arugula, baby, raw
    "2710822": replace(
        "FOODON_00005223",
        "Baby arugula is young arugula leaves, and the raw arugula row uses this term; 'baby arugula greens' is "
        "the closer name.",
        "unsure",
    ),
    # Rice, black, unenriched, raw
    "2710825": confirm("The grain is the kernel, so the kernel term names this food."),
    # Einkorn, grain, dry, raw
    "2710827": no_match("FoodOn's only einkorn terms are the plant and a catalogue code."),
    # Farro, pearled, dry, raw
    "2710828": narrow("FOODON_00005281", "farro kernel"),
    # Khorasan, grain, dry, raw
    "2710830": confirm("The grain is the kernel, and the uncooked KAMUT khorasan row uses the same term."),
    # Corn flour, masa harina, white or yellow, dry, raw
    "2710835": confirm("FoodOn lists masa harina, the dry corn flour, as a synonym of 'masa'."),
    # Rice, red, unenriched, dry, raw
    "2710838": confirm("The grain is the kernel, and FoodOn has no raw term for red rice."),
    # Sorghum bran, white, unenriched, dry, raw
    "2710839": no_match("FoodOn has no sorghum bran term, and 'sorghum food product' is a category, not this food."),
    # Sorghum grain, white, pearled, unenriched, dry, raw
    "2710841": confirm(
        "Raw sorghum is the dry grain, and FoodOn has no pearled sorghum term; the SR sorghum grain row uses this one."
    ),
    # Sorghum, whole grain, white, dry, raw
    "2710842": confirm("Raw sorghum is the dry grain, and the SR sorghum grain row uses the same term."),
    # Peppers, poblano, seeded, raw
    "2747662": no_match(
        "FoodOn has no term for the fresh poblano; 'ancho pepper' lists poblano as a synonym, but it names the "
        "dried pepper.",
        "unsure",
    ),
    # Squid (calamari), frozen, tubes only
    "2747671": confirm("Frozen squid tubes are raw squid; FoodOn's 'calamari' is a prepared seafood dish."),
    # Rhubarb, stalk, raw
    "2758975": confirm("It names this food, and the raw rhubarb row uses the same term."),
    # Grapefruit, raw
    "2758977": confirm("It names this food, and the raw all-areas grapefruit row uses the same term."),
    # Beans, baked, canned, vegetarian
    "2758983": confirm("It names this dish, and the canned plain or vegetarian baked beans row uses the same term."),
    # Peanut butter, Creamy
    "2758989": confirm("Creamy is smooth peanut butter, and the smooth-style rows use the same term."),
    # Sweetened condensed milk
    "2758990": confirm("It names this food, and the canned sweetened condensed milk row uses the same term."),
    # Bread, white, commercial
    "2758993": confirm("It names this bread, and the commercially prepared white bread row uses the same term."),
    # Alaska Pollock, raw
    "2768188": confirm(
        "It names this fish, as the SR raw Alaska pollock row with additives does; 'pollock (raw)' sits under "
        "saithe, a different fish."
    ),
}


# --------------------------------------------------------------------------------------------- inputs


class Ontology(NamedTuple):
    """The parts of the FoodOn OWL this review reads."""

    label_of: dict[str, str]
    parents: dict[str, set[str]]
    syns: dict[str, list[str]]
    obsolete: set[str]
    replaced_by: dict[str, str]


def parse_owl(path: Path) -> Ontology:
    """Labels, parents, synonyms, obsolete flags and replacements for every OWL class. Pure over the file.

    Parsed over the direct `owl:Class` children of `rdf:RDF`, exactly as `foodOnMappingPatch.py` does, so the edible
    set here is the edible set the patch was built against.
    """
    label_of: dict[str, str] = {}
    parents: dict[str, set[str]] = defaultdict(set)
    syns: dict[str, list[str]] = defaultdict(list)
    obsolete: set[str] = set()
    replaced_by: dict[str, str] = {}
    for cls in etree.parse(str(path)).getroot().findall(f"{{{NS['owl']}}}Class"):
        iri = cls.get(ABOUT)
        if not iri:
            continue
        for child in cls:
            resource = child.get(RESOURCE)
            if child.tag == f"{{{NS['rdfs']}}}label" and child.text:
                label_of[iri] = child.text.strip()
            elif child.tag == f"{{{NS['rdfs']}}}subClassOf":
                if resource:
                    parents[iri].add(resource)
                for node in child.iter():
                    about = node.get(ABOUT)
                    if node.tag == f"{{{NS['owl']}}}Class" and about:
                        parents[iri].add(about)
            elif child.tag == f"{{{NS['owl']}}}equivalentClass":
                for node in child.iter():
                    if node.tag in (f"{{{NS['owl']}}}Class", f"{{{NS['rdf']}}}Description"):
                        target = node.get(ABOUT) or node.get(RESOURCE)
                        if target and target != iri:
                            parents[iri].add(target)
            elif child.tag in SYN and child.text:
                syns[iri].append(child.text.strip())
            elif child.tag == REPLACED_BY and resource:
                replaced_by[iri] = resource
            elif child.tag == f"{{{NS['owl']}}}deprecated" and (child.text or "").strip().lower() == "true":
                obsolete.add(iri)
    return Ontology(label_of, parents, syns, obsolete, replaced_by)


def ancestors_of(parents: dict[str, set[str]]) -> Callable[[str], set[str]]:
    """A memoised transitive-ancestor function over `parents`, tolerant of cycles. Pure."""
    memo: dict[str, set[str]] = {}

    def ancestors(iri: str) -> set[str]:
        if iri in memo:
            return memo[iri]
        seen: set[str] = set()
        stack = list(parents.get(iri, ()))
        while stack:
            node = stack.pop()
            if node not in seen:
                seen.add(node)
                stack.extend(parents.get(node, ()))
        memo[iri] = seen
        return seen

    return ancestors


def scientific_names(path: Path, wanted: set[str]) -> dict[str, str]:
    """USDA's `Scientific Name` attribute for each wanted fdc_id, when it states one. Pure over the file.

    It is the taxon check R54b names as check (2): `Orange juice` carrying `Citrus sinensis` is what exposed the
    `olives (canned)` mapping. Only USDA-mapped rows carry it; our own `added` matches have none.
    """
    names = {}
    with path.open(encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            value = (row.get("value") or "").strip()
            if row["fdc_id"] in wanted and row.get("name") == "Scientific Name" and value and value != "NA":
                names[row["fdc_id"]] = value
    return names


def expand_curie(value: str) -> str:
    """`CHEBI:17309` -> the full OBO IRI; anything already an IRI is returned unchanged. Pure."""
    match = re.fullmatch(r"([A-Za-z]+):(\d+)", value)
    return f"{OBO}{match.group(1)}_{match.group(2)}" if match else value


# ------------------------------------------------------------------------------- automated lookup leads

STOP = {"of", "and", "or", "with", "the", "a", "in", "food", "product", "piece", "pieces", "s"}
EQUIVALENT = [
    (r"\blow[- ]?fat\b", "lowfat"),
    (r"\bnon[- ]?fat\b", "fatfree"),
    (r"\bfat[- ]free\b", "fatfree"),
    (r"\bpart[- ]skim\b", "partskim"),
    (r"\blow[- ]moisture\b", "lowmoisture"),
    (r"\breduced[- ]fat\b", "reducedfat"),
    (r"\blow[- ]sodium\b", "lowsodium"),
    (r"\breduced[- ]sodium\b", "reducedsodium"),
    (r"\bwhole[- ]wheat\b", "wholewheat"),
]


def singular(word: str) -> str:
    """A small English singular rule, the one the sibling scripts use. Pure."""
    if len(word) <= 3:
        return word
    for suffix, repl in (("ies", "y"), ("oes", "o"), ("ches", "ch"), ("shes", "sh"), ("xes", "x"), ("sses", "ss")):
        if word.endswith(suffix):
            return word[: -len(suffix)] + repl
    return word[:-1] if word.endswith("s") and not word.endswith("ss") else word


def tokens(text: str) -> set[str]:
    """Content tokens of a name, with fat/skim/sodium wordings folded together. Pure."""
    text = text.lower()
    for pattern, folded in EQUIVALENT:
        text = re.sub(pattern, folded, text)
    return {singular(w) for w in re.findall(r"[a-z0-9]+", text) if w not in STOP}


def print_candidates(rows: list[dict[str, str]], onto: Ontology, edible: set[str], scientific: dict[str, str]) -> None:
    """@sideEffect Prints, per review row, the automated lookup leads a reviewer starts from."""
    label_of, syns, obsolete, replaced_by = onto.label_of, onto.syns, onto.obsolete, onto.replaced_by
    index: list[tuple[str, str, frozenset[str]]] = []
    for iri in edible:
        if UNUSABLE_LABEL.search(label_of[iri]):
            continue
        for text in [label_of[iri], *syns.get(iri, [])]:
            words = tokens(text)
            if words:
                index.append((iri, text, frozenset(words)))
    for row in rows:
        described, current = tokens(row["usda_description"]), row["foodon_iri"]
        # Only a current term the description supports is a floor to narrow from; a wrong one (olives for orange
        # juice) must not hide the right term behind a words-in-common requirement.
        current_words = tokens(row["foodon_label"]) if row["foodon_label"] else set()
        if not current_words <= described:
            current_words = set()
        leads: list[str] = []
        if expand_curie(current) != current:
            leads.append(
                f"short-form ID; full IRI {expand_curie(current)} '{label_of.get(expand_curie(current), 'NO CLASS')}'"
            )
        if current in replaced_by:
            leads.append(f"obsolete; replaced by '{label_of.get(replaced_by[current], replaced_by[current])}'")
        if current and current not in label_of and expand_curie(current) == current:
            leads.append("no class with this IRI in this release")
        found: dict[str, tuple[int, str]] = {}
        for term, text, term_words in index:
            if term == current or term in obsolete or not term_words <= described:
                continue
            if current_words and not (current_words <= term_words and len(term_words) > len(current_words)):
                continue
            found.setdefault(term, (len(term_words), text))
        for iri, (_, text) in sorted(found.items(), key=lambda kv: -kv[1][0])[:6]:
            via = "" if text == label_of[iri] else f" via '{text}'"
            leads.append(f"'{label_of[iri]}'{via}")
        if scientific.get(row["fdc_id"]):
            leads.insert(0, f"USDA scientific name: {scientific[row['fdc_id']]}")
        if leads:
            print(f"{row['fdc_id']} [{row['status']}] {row['usda_description'][:70]}  (now '{row['foodon_label']}')")
            for lead in leads:
                print(f"    - {lead}")


# ----------------------------------------------------------------------------------------- validation


def validate(rows: list[dict[str, str]], onto: Ontology, edible: set[str]) -> list[str]:
    """Every rule in the module docstring, all failures collected. Pure; returns the list of failures."""
    label_of, obsolete = onto.label_of, onto.obsolete
    failures: list[str] = []
    review_ids = {r["fdc_id"] for r in rows}
    missing, extra = review_ids - set(VERDICTS), set(VERDICTS) - review_ids
    if missing:
        failures.append(f"{len(missing)} review rows have no verdict: {sorted(missing)[:10]}")
    if extra:
        failures.append(f"{len(extra)} verdicts name no review row: {sorted(extra)[:10]}")

    def usable(iri: str | None) -> bool:
        if iri is None or iri not in edible or iri in obsolete or not label_of.get(iri):
            return False
        return not UNUSABLE_LABEL.search(label_of[iri])

    for row in rows:
        fdc_id = row["fdc_id"]
        if fdc_id not in VERDICTS:
            continue
        verdict, iri, reason, confidence, _ = VERDICTS[fdc_id]
        current = row["foodon_iri"]
        if confidence not in ("sure", "unsure"):
            failures.append(f"{fdc_id}: confidence {confidence!r}")
        if not reason or "\n" in reason or len(reason) > 200 or not reason.endswith("."):
            failures.append(f"{fdc_id}: reason must be one short sentence ending in a full stop")
        if verdict == "confirm":
            if not usable(current):
                failures.append(f"{fdc_id}: confirm of an unusable term {current!r}")
            elif label_of[current] != row["foodon_label"]:
                failures.append(f"{fdc_id}: patch label {row['foodon_label']!r} is not the OWL label")
        elif verdict == "replace":
            if iri == current:
                failures.append(f"{fdc_id}: replace with the current term")
            if not usable(iri):
                failures.append(f"{fdc_id}: replace with an unusable term {iri!r} ({label_of.get(iri or '')!r})")
        elif verdict == "no_match":
            if iri is not None:
                failures.append(f"{fdc_id}: no_match carries an IRI")
        else:
            failures.append(f"{fdc_id}: unknown verdict {verdict!r}")

    fixture_id, olives = REGRESSION_FIXTURE
    if fixture_id in VERDICTS:
        verdict, iri = VERDICTS[fixture_id][:2]
        lands_on = iri if verdict == "replace" else (olives if verdict == "confirm" else None)
        if lands_on == olives:
            failures.append(f"{fixture_id}: orange juice would sit under olives (canned)")
    return failures


# --------------------------------------------------------------------------------------------- main


def main() -> None:
    """@sideEffect Reads the inputs, validates every verdict, writes the review CSV or the candidate leads."""
    for path in (OWL, PATCH, FULL):
        if not path.is_file():
            print(f"FAIL  input missing: {path}  (see README.md in this directory for where to get it)")
            sys.exit(1)
    onto = parse_owl(OWL)
    ancestors = ancestors_of(onto.parents)
    edible = {i for i in onto.label_of if i not in onto.obsolete and EDIBLE_ROOTS & ancestors(i)}
    with PATCH.open(encoding="utf-8") as handle:
        rows = [r for r in csv.DictReader(handle) if r["status"] in REVIEW_STATUSES]

    if "--candidates" in sys.argv[1:]:
        scientific = scientific_names(FULL, {r["fdc_id"] for r in rows})
        print_candidates(rows, onto, edible, scientific)
        return

    failures = validate(rows, onto, edible)
    if failures:
        for failure in failures:
            print(f"FAIL  {failure}")
        sys.exit(1)

    out: list[dict[str, str]] = []
    counts: Counter[tuple[str, str, str]] = Counter()
    narrowed = 0
    for row in rows:
        verdict, iri, reason, confidence, narrows = VERDICTS[row["fdc_id"]]
        proposed_iri = row["foodon_iri"] if verdict == "confirm" else (iri or "")
        proposed_label = onto.label_of.get(proposed_iri, "") if proposed_iri else ""
        narrowed += narrows
        counts[(row["status"], verdict, confidence)] += 1
        out.append(
            {
                "fdc_id": row["fdc_id"],
                "usda_description": row["usda_description"],
                "status": row["status"],
                "current_iri": row["foodon_iri"],
                "current_label": row["foodon_label"],
                "proposed_verdict": verdict,
                "proposed_iri": proposed_iri,
                "proposed_label": proposed_label,
                "reason": reason,
                "confidence": confidence,
            }
        )
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADER)
        writer.writeheader()
        writer.writerows(out)

    print(f"review rows : {len(out)}  -> {OUT.name}")
    for verdict in ("confirm", "replace", "no_match"):
        total = sum(n for (_, v, _), n in counts.items() if v == verdict)
        unsure = sum(n for (_, v, c), n in counts.items() if v == verdict and c == "unsure")
        print(f"  {verdict:<9}: {total:>3}  ({unsure} unsure)")
    for status in REVIEW_STATUSES:
        parts = ", ".join(
            f"{v} {sum(n for (s, vv, _), n in counts.items() if s == status and vv == v)}"
            for v in ("confirm", "replace", "no_match")
        )
        print(f"  {status:<9}: {parts}")
    print(f"  of the replaces, made only by the specificity rule (current term right but broader): {narrowed}")


if __name__ == "__main__":
    main()
