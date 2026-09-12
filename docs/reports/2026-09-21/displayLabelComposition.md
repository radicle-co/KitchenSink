# Does a composed display label survive rev 4's gates?

**Date:** 2026-09-21 · **Script:** [`displayLabelComposition.py`](displayLabelComposition.py) · **Full output:** [`displayLabelComposition.txt`](displayLabelComposition.txt)

⛔ **The script is committed, and that is the point.** Rev 4's header records that rev 3's headline
figure could not be reproduced because no uniqueness predicate survived in any script. The FoodOn
figures in `docs/plans/2026-09-20-002-…-plan.md` §6.6 failure 4 were produced by an inline heredoc
and were one `/tmp` sweep from the same fate. Re-run with:

```bash
python3 docs/reports/2026-09-21/displayLabelComposition.py [path/to/full/2026/csv/dir]
```

⚠️ It needs USDA's **full** 2026 bundle for `food_attribute.csv` (the frozen 2018-04 SR Legacy zip
carries ZERO FoodOn rows — plan R56) and the local 2018-04 SR Legacy zip for energy.

## 1. ⛔ §6.6 failure 4's figures DO NOT REPRODUCE, and the plan quotes the un-reproduced ones

| quantity                                          |   plan §6.6 |     this script | verdict           |
| ------------------------------------------------- | ----------: | --------------: | ----------------- |
| SR Legacy foods with a FoodOn name                |       4,126 |       **4,126** | ✅ exact          |
| FoodOn name unique in the catalog                 | 1,317 (32%) | **1,315 (32%)** | ≈ (normalisation) |
| foods whose USDA name carries a protected segment |       1,786 |       **3,645** | ⛔ **2× apart**   |
| … the FoodOn name drops it                        | 1,701 (95%) | **3,061 (84%)** | ⛔ **differs**    |

The divergence is the **protected-token set**, not the FoodOn join. This script re-derives it from
rev 4's stated rule — median relative |Δ kcal/100 g| ≥ 10% over ≥ 8 sibling pairs — and gets **877
tokens**, which is broader than whatever the inline run used.

⛔ **The qualitative conclusion is unchanged** (FoodOn drops protected qualifiers at a high rate, so
it is not a safe display name unaided). **The exact numbers need ONE authoritative derivation**, and
this script is now where it lives. Until reconciled, do not quote either pair as settled.

## 2. The flip condition: grouping is REAL, and it lands on exactly the intended use case

Composed label = FoodOn name (head) + the protected segments of USDA's `description` the head does
not already state (tail). Over the 4,126 covered SR Legacy foods:

|                                     | count |   share |
| ----------------------------------- | ----: | ------: |
| distinct composed labels            | 2,872 |         |
| labels naming exactly ONE food      | 2,223 | **77%** |
| labels naming MORE THAN ONE food    |   649 |     23% |
| foods sitting inside a shared label | 1,903 |         |

Group sizes run 2 (363 labels), 3 (182), 4 (34), 5 (14), 6 (35), 7 (7), 8 (6), 9 (3), 10, 12 (2),
**28**, **29** — a genuine fat tail, not a singleton table.

**And the tail is the beef/ham/flour cross-product the ruling was about:**

```
n=29  ham (cured), pork, separable lean and fat
n=28  ham (cured), pork, separable lean only
n=12  white wheat flour                      <- 10% vs 11.5% protein, bleached/unbleached, enriched/not
n=12  beef small end rib roast, small end (ribs 10-12), separable lean …
n=10  beef ribeye steak (raw), separable lean only
n= 9  beef ribeye steak, separable lean and fat, cooked
```

✅ **So the concept table is not dead.** 23% of covered foods group, and they group on precisely the
dimension the owner named: cut, trim and grade of the same substance.

## 3. ⛔ But the proposed guard DOES NOT HOLD — this is the finding that changes the design

The proposed rule was "a group may never contain members differing by a **protected qualifier**."
The composed label already carries every protected segment, so that rule is satisfied by
construction — and yet:

|                                                    |         count |
| -------------------------------------------------- | ------------: |
| shared labels with measurable energy on 2+ members |           647 |
| ⛔ … whose min-to-max energy spread is **≥ 10%**   | **244 (38%)** |

Worst offenders:

```
200.0%  n=3   coffee beverage
200.0%  n=3   black tea (decaffeinated)
142.2%  n=2   taro leaf, cooked
121.2%  n=8   ham (cured), pork      <- groups `separable fat (from ham and arm picnic)` with lean ham
119.6%  n=3   reconstituted orange juice (from frozen concentrate), unsweetened
```

⛔ **Token-level protection is a PROXY; the spread is the thing that matters.** 38% of groups span
≥ 10% energy after protection, so whichever member is chosen as the default silently decides whether
a cook's nutrition is right — the exact defect class rev 4 was authored to fix, arriving by a
different door.

**Revised guard, and it is directly measurable:** gate a group on its **members' measured energy
spread**, not on which tokens they share. A label may name N foods only while
`(max − min) / mean` across its members stays under a stated threshold; otherwise it splits. That
needs no token vocabulary, cannot be defeated by a qualifier nobody protected, and is computable in
the same batch pass that writes the label.

## 4. What this does not touch

FoodOn covers **53%** of SR Legacy and its coverage runs backwards to consumption: of foods actually
eaten, 758 have a FoodOn name and **916 do not** — bread, cheddar, soy sauce, mayonnaise, mozzarella.
Composition improves the beef/ham cross-product. It does nothing for the staples, which remain a
curation list with no owner named.

---

# Addendum 2026-09-22 — FoodOn's OWN vocabulary, measured

**Script:** [`foodOnCoverage.py`](foodOnCoverage.py) · **Output:** [`foodOnCoverage.txt`](foodOnCoverage.txt)
**Source:** `http://purl.obolibrary.org/obo/foodon.owl` (CC-BY-4.0), 40,779,019 bytes,
`sha256 b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf`.

FoodOn ships **39,707** labelled classes and **50,904** distinct normalised names once exact,
related, narrow and broad synonyms are included — roughly 11,000 strings beyond the labels. That
synonym surplus is a genuine alias win independent of everything below.

## ✅ The staples ARE in FoodOn — this is the answer to "can FoodOn be the root"

USDA's cross-reference does not name them; FoodOn's own vocabulary does.

```
YES  bread              FOODON_03000288      YES  butter        FOODON_03310351
YES  cheddar cheese     FOODON_03302458      YES  olive oil     FOODON_03301826
YES  mayonnaise         FOODON_03301440      YES  whole milk    FOODON_03310780
YES  mozzarella cheese  FOODON_03303578      no   soy sauce
YES  cheese             FOODON_00001013      no   hamburger roll
```

## ⛔ But naive matching is UNSAFE, and the headline number is inflated

Matching the 3,667 USDA-unmapped foods against FoodOn names hits **1,382 (38%)**, taking combined
coverage 53% → 71%. **Do not quote that.** Broken down by how each matched:

| form                                                         |      hits | safe?     |
| ------------------------------------------------------------ | --------: | --------- |
| full description                                             |        18 | ✅        |
| all segments reversed                                        |        32 | ✅        |
| first two un-inverted (`Cheese, cheddar` → `cheddar cheese`) |       291 | ✅        |
| **head noun alone**                                          | **1,041** | ⛔ **no** |

Head-noun matching is truncation to the first word — §6.6 failures 1 and 3 in a new coat. It maps
`Bread, salvadoran sweet cheese` and `Bread, white wheat` both to `bread`, and it drags in FoodOn
classes that are not consumer food names at all:

```
n=141  Chondrichthyes       <- the taxonomic class of cartilaginous fish
n=100  infant formula
n= 58  chicken
n= 52  restaurant           <- not a food
n= 50  bread
```

**Honest coverage from the SAFE forms only: 341 of 3,667 (9%), taking combined coverage 53% → 62%.**

## Consequences

1. ✅ FoodOn as the catalog ROOT is viable — its vocabulary genuinely contains the staples USDA's
   cross-reference omits.
2. ⛔ The USDA→FoodOn match must be restricted to the un-inverted forms, and must **exclude
   non-food branches** (taxonomic classes like `Chondrichthyes`, and abstractions like `restaurant`).
   A root that names 141 foods is a category, not a name a cook picks.
3. ⚠️ ~38% of SR Legacy still has no safe FoodOn root and remains a curation list. Smaller than
   before, not gone.
