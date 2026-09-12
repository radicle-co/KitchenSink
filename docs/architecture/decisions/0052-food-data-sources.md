# 0052 — Food numbers come from a register of licensed sources, each cited under its own definition

- **Status:** Proposed
- **Date:** 2026-09-30
- **Owner ruling (2026-09-30):** "Amend R50. Use all data sources that we can legally use." The owner made two more
  rulings that day. If a source gives no by-difference carbohydrate, a food's total carbohydrate is its available
  carbohydrate plus its fibre. 016 FR-030's anti-extraction clause carves out values held under an attribution
  licence.
- **Amends:** the curated catalog plan's R50 and naming rule 36, which admitted only a USDA Branded product or a
  manufacturer's label for a root with no USDA item.
- **Relates to:** [ADR-0029](0029-authored-foods-substances-only.md): an authored food's own numbers stay uncited.
  016 FR-033: the corpus is never published under an open content licence.
- **Plan:** `docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (R50, R52 to R55, KTD-20, KTD-22 to
  KTD-24, U22 to U25)

## Context

389 of the catalog's 2,641 root foods stand for no USDA SR Legacy or Foundation item. Before this record, 302 of them
cited a USDA Branded product's label and 87 had no numbers. Labels round small values: a label prints 0 kcal for a
serving under 5 kcal, so a small serving turns into a false zero per 100 g. Government composition tables analyse
foods per 100 g, and several of them publish under licences that allow commercial reuse.

A review on 2026-09-30 read each candidate source's licence in its primary document and measured its coverage of the
389 roots. Two facts shape the decision. A licence that adds a share-alike term forces the derived catalog open,
which 016 FR-033 forbids. And the tables do not share definitions: USDA reports carbohydrate by difference,
which includes fibre, while CIQUAL, CoFID and BLS report available carbohydrate, which excludes it.

## Decision

1. **One register lists every admitted source.** `packages/services/food-service/src/sources/sourceRegister.ts` is
   the only list. It declares each source's licence, attribution, edition, basis, energy method and access, and, for
   an API, its rate limit. A source that is not in the register can be neither cited by the seed nor called at run
   time. Its `LICENCES` table records what each licence allows, including the refused ones.
2. **Admission needs commercial reuse and no share-alike term.** The admitted sources and their licences:

    | Source                                                        | Licence                                       |
    | ------------------------------------------------------------- | --------------------------------------------- |
    | USDA FoodData Central (SR Legacy, Foundation, FNDDS, Branded) | CC0 1.0                                       |
    | CIQUAL 2025 (Anses)                                           | Licence Ouverte / Etalab 2.0                  |
    | CoFID 2021, the Excel file                                    | Open Government Licence v3.0                  |
    | BLS 4.0 (Max Rubner-Institut)                                 | CC BY 4.0                                     |
    | Standard Tables of Food Composition in Japan                  | MEXT website terms, compatible with CC BY 4.0 |
    | Matvaretabellen 2026 (Mattilsynet)                            | NLOD 2.0, per the national data catalogue     |
    | Livsmedelsdatabasen (Livsmedelsverket)                        | CC BY 4.0                                     |
    | Swiss Food Composition Database (FSVO)                        | opendata.swiss "terms_by"                     |
    | Canadian Nutrient File 2015 (Health Canada), own rows         | Open Government Licence (Canada)              |

3. **A root with no USDA item cites one dataset, chosen by one policy.** Each candidate names its dataset, and the
   seed resolves it against that dataset only. USDA has three datasets that rank apart: an SR Legacy or Foundation
   item (as a same-substance stand-in only), FNDDS, and a Branded product. The datasets rank in the order of the
   table above, with a Branded product or a label last. `citationPrecedence` puts candidates in five pools, and an
   earlier pool always wins:
    1. an exact, same-substance or close table entry with energy
    2. a Branded product or a label with energy
    3. such a table entry without energy
    4. a Branded product or a label without energy
    5. a generic table entry

    Within a pool, match quality decides, then energy, then the dataset order. Two candidates that rank equally are
    refused as a tie, so file order never decides. The seed's format check refuses a committed citation that is not
    the policy's choice. At run time, every USDA dataset ranks above every mirror source (plan R58).

4. **A value is stored under its own definition.** Each value carries the INFOODS tag of its definition, so
   by-difference carbohydrate (`CHOCDF`) and available carbohydrate (`CHOAVL`) are different rows. A food's total
   carbohydrate is its by-difference value, else its available carbohydrate plus its fibre, else absent. A trace or
   below-limit mark of a carbohydrate or fibre value counts as 0, and the extract keeps the mark. Energy is stored in kcal as
   published, with the source's energy method recorded.
5. **A conversion is made in one place and recorded.** A value per 100 mL converts to per 100 g only with a density
   cited from the same source, and kJ converts to kcal at 4.184. The citation records each conversion, because
   CC BY 4.0 §3(a)(1)(B) requires saying that the material was changed.
6. **Attribution is shown, and the anti-extraction clause does not cover attributed values.** Both apps show a Data
   sources page with each source's licence, link, edition and conversions. 016 FR-030 carves out values held under
   an attribution licence. CC BY 4.0 §2(a)(5)(B) forbids adding terms that restrict what others can do with the
   licensed material.
7. **A data licence does not grant automated access.** A source is called through its API only after its API terms
   are read and allow it (plan U26). A source whose terms do not allow it stays a file source. U26 read them: only
   USDA can search by name. Matvaretabellen and Livsmedelsdatabasen can be mirrored through their APIs, each under
   its own declared limit. The Canadian Nutrient File and the Swiss database are file sources, because neither
   API has a live record of its terms.
8. **A source under an owner ruling is held.** Livsmedelsdatabasen's download page adds "får data inte förändras"
   (the data must not be changed) to the CC BY grant on its API page. Until the owner rules, it is neither cited,
   mirrored nor called.

### Excluded sources

| Source                                  | Reason                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| NEVO (RIVM)                             | Its conditions forbid charging end users for the use of its data.      |
| Open Food Facts                         | ODbL is share-alike.                                                   |
| Australian Food Composition Database    | Its licence is share-alike and adds further terms.                     |
| FAO/INFOODS regional tables             | Non-commercial.                                                        |
| CoFID's API (Quadram)                   | CC BY-NC-SA 4.0. The Excel file is used instead.                       |
| EFSA food composition database          | It holds vitamins and minerals only, with no energy or macronutrients. |
| Commercial nutrition APIs, cooking apps | Their terms bar automated copying and storage.                         |

### Rejected alternatives

- **One seed union arm per source.** The database's citation is already general, `(source, external_key)`. A
  per-source arm needs a verifier branch per source and a plan change for every new source.
- **Blending numbers from several sources into one food.** A blended food's numbers come from no single citation,
  and a reader cannot tell which definition each number follows.
- **Storing every carbohydrate under USDA's name.** The fibre difference between the definitions becomes an error
  that no reader can detect.

## Consequences

**Positive**

- Most of the roots with no numbers gain a cited source, and most of the Branded-cited roots move to an analysed
  value per 100 g. The plan's U24 records the counts.
- A refused source cannot return under its real licence, because the register's licence table refuses it.

**Negative, accepted**

- Each admitted source adds an extract, a pin and an extractor to maintain, and an edition change is a seed change.
- The app must show and maintain attribution for nine publishers.
- Some values are converted, and each conversion is a place where a wrong density gives a wrong number. The verifier
  recomputes every conversion.

**Guards**

- `packages/services/food-service/src/sources/__tests__/sourceRegister.test.ts`: every declaration parses, every
  excluded source is refused by its real licence, and the database enum equals the register, in order.
- `packages/services/food-service/src/foods/nutrition/__tests__/nutrientIdentity.test.ts`: the carbohydrate rule.
- `packages/services/food-service/src/foods/seed/__tests__/citationDatasets.test.ts` and
  `packages/services/food-service/src/foods/seed/catalog/__tests__/citationPrecedence.test.ts`: the dataset order,
  the five pools and the tie refusal.
