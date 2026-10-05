"""Which source item should be a grouped root's default kind? Measured three ways.

A grouped root reads its numbers from its default kind (plan §16 item 1). A cook who picks the root and
does not choose a kind gets the default's calories while eating some real member. This measures, for each
candidate rule, the calorie error a cook actually suffers:

    error = |kcal(default) - kcal(eaten member)| / kcal(eaten member)

weighted by how often each member is really eaten (WWEIA day-1 weights through FNDDS `input_food`, the
same join `specializationDisclosurePopulation.py` uses). Groups with a plain member that matches the root
are excluded, because the owner ruled that member is the default (R55).
"""

import csv
import re
import sys
from collections import defaultdict
from statistics import median

sys.path.insert(0, "/home/brandon/Development/KitchenSink/docs/reports/2026-09-22")
from specializationDisclosurePopulation import load_weights  # noqa: E402  -- one consumption join

SR = "/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_sr_legacy_food_csv_2018-04/"
FULL = "/home/brandon/Development/KitchenSink/.local-sandbox/fdc/FoodData_Central_csv_2026-04-30/"
FOODON_ATTRS = {
    "FoodOn Ontology Name #1 For FDC Item",
    "FoodOn Ontology Name For FDC Item",
    "FoodOn Ontology Name #2 For FDC Item",
}


def words(text):
    return re.findall(r"[a-z0-9]+", text.lower())


desc, kcal, foodon = {}, {}, {}
with open(SR + "food.csv", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        if (row.get("description") or "").strip():
            desc[row["fdc_id"]] = row["description"].strip()
with open(SR + "food_nutrient.csv", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        if row["nutrient_id"] == "1008":
            try:
                kcal[row["fdc_id"]] = float(row["amount"])
            except ValueError:
                pass
with open(FULL + "food_attribute.csv", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        name, value = (row.get("name") or "").strip(), (row.get("value") or "").strip()
        if name in FOODON_ATTRS and value and (row["fdc_id"] not in foodon or name.endswith("#1 For FDC Item")):
            foodon[row["fdc_id"]] = value

groups = defaultdict(list)
for fdc_id, label in foodon.items():
    if fdc_id in desc and fdc_id in kcal and kcal[fdc_id] > 0:
        groups[label.strip().lower()].append(fdc_id)

weight = load_weights()
elect = {}
for label, members in groups.items():
    if len(members) < 2:
        continue
    root_words = set(words(label))
    if any(not [w for w in words(desc[m]) if w not in root_words] for m in members):
        continue  # R55: the plain member is the default
    elect[label] = members


def lowest_id(members):
    return min(members, key=int)


def median_energy(members):
    return sorted(members, key=lambda m: (kcal[m], int(m)))[len(members) // 2]


def most_eaten(members):
    eaten = [m for m in members if weight.get(m, 0.0) > 0]
    if not eaten:
        return median_energy(members)  # fallback: no consumption data for this group
    return max(eaten, key=lambda m: (weight[m], -int(m)))


with_data = sum(1 for ms in elect.values() if any(weight.get(m, 0) > 0 for m in ms))
print(f"grouped roots that need an election : {len(elect)}")
print(f"  ... with consumption data on any member : {with_data}  ({with_data / len(elect):.0%})")
print()
print(f"{'rule':<34}{'eaten-weighted mean error':>26}{'unweighted median':>20}")
for name, rule in [
    ("lowest source id", lowest_id),
    ("median energy", median_energy),
    ("most eaten (else median energy)", most_eaten),
]:
    num = den = 0.0
    per_group = []
    for members in elect.values():
        d = rule(members)
        errs = [abs(kcal[d] - kcal[m]) / kcal[m] for m in members]
        per_group.append(median(errs))
        for m, e in zip(members, errs):
            w = weight.get(m, 0.0)
            num += w * e
            den += w
    weighted = num / den if den else float("nan")
    print(f"{name:<34}{weighted:>25.1%}{median(per_group):>20.1%}")


# ---------------------------------------------------------------------------------------------------------
# The 15 groups with a plain member (R55): does "most eaten" agree with "plain member is the default"?
# Added after the UX engineer found that vanilla's plain member (the real extract) is not what people eat.
print("\ngroups with a plain member: plain member vs most eaten")
for label, members in sorted(groups.items()):
    if len(members) < 2:
        continue
    root_words = set(words(label))
    plain = [m for m in members if not [w for w in words(desc[m]) if w not in root_words]]
    if not plain:
        continue
    eaten = [m for m in members if weight.get(m, 0.0) > 0]
    top = max(eaten, key=lambda m: (weight[m], -int(m))) if eaten else None
    verdict = "no consumption data" if top is None else ("AGREE" if top == plain[0] else "DIFFER")
    print(
        f"  {verdict:<20} {label[:34]:<36} plain={kcal[plain[0]]:>5.0f} kcal"
        + ("" if top is None or top == plain[0] else f"   most eaten={kcal[top]:>5.0f} kcal  {desc[top][:40]}")
    )
