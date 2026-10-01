---
date: 2026-09-26
topic: curated-food-catalog
---

# Curated food catalog: roots and variants from the seed to the screen

## Summary

The food catalog becomes curated root foods with optional variants, loaded from one committed seed. Every
surface on web and mobile shows a root's name. A variant shows as its parts on one line, separated by a middle
dot, never as a comma-separated string. Every prod and preview deploy makes its database match the seed and
proves it.

---

## Problem Frame

USDA names read like a lab report: "Beef, brisket, flat half, separable lean and fat, trimmed to 1/8" fat,
select, cooked, braised". Plan 002 §4.7 set out to derive readable names with rules. The measured output of
those rules stayed long and awkward. The owner chose curated data instead. Each root's name and synonyms,
and each variant's labels, were written and then checked against how US grocery stores sell the food.

Nothing between that data and the screen exists yet:

- The food database has no roots or variants. Its migrations end at `0017_food_withdrawal.sql`.
- The food contract carries one `name` string per food (`packages/schemas/food/src/schemas/foods.schema.ts`).
- Every surface prints that string: the ingredient picker, its disambiguation list, the import review, the
  ambiguity review, the recipe form, the recipe view and the filter bar, on both platforms.
- The seed is an operator command that no workflow runs, and nothing seeds the sandbox base database that
  previews clone.

Plan 002 designed much of this for rule-derived names. Its UX spec (`docs/design/ingredientSpecialization.md`)
covers the details flow, but no plan unit builds the details dialog. An empty or stale catalog also passes
every check the pipeline runs today, which is the failure ADR-0010 exists to prevent.

---

## Key Decisions

- **Curated data replaces derived names.** The seed carries each root's name and search synonyms, and each
  variant's labels. Plan 002's name rules (R53b, R55, R55b, R55c) become data, and its word-based state
  marking is dropped.
- **A USDA food with no FoodOn root keeps its USDA name.** It becomes a root with no variants, named by its
  full USDA description (owner ruling, 2026-09-26). Plan 002's name shortener (R33) and ADR-0048 are retired.
  Curating those names is out of scope.
- **The root is the default, and variants are purely additive** (owner ruling, 2026-09-26). A root carries
  the numbers of one source item, which the seed names. That is the root's plain item where one exists.
  Otherwise naming rule 28 elects one item once, at curation. It prefers an uncooked item: one whose label and
  USDA text name no cooking step. That item is the root itself, not a variant. A variant is optional detail
  with its own numbers. This replaces plan 002's default-variant design (§16 item 1's `default_variant_id`),
  and nothing is elected at deploy time.
- **A variant is a list of tagged parts, never a string.** The seed states each variant's parts separately,
  and each part names its attribute. The database and the contract keep the parts separate, in one fixed
  attribute order. No layer joins or splits a comma string.
- **A variant reads as one dotted line, not as chips** (`staff-ux-engineer`, 2026-09-26). The line reads
  `flat half · select · braised`. In this app a pill already means "tap to filter". In 40% of labels, one
  part is wider than a pill in the 320 px edit row. Dropping any part makes 44% of variants read the same as
  a sibling. The dotted line is built once in `@commise/ui` for web and native, because six
  surfaces on two platforms need the same behavior.
- **The details dialog stays one list, and a long list is grouped.** The cook picks one row, and the dialog
  asks no question per attribute. Only 0.9% to 8.5% of attribute combinations exist for the largest roots, and a
  line binds to a root or to exactly one variant. This keeps plan 002 R55b's single list sorted by calories,
  and adds grouping by the first part that differs.
- **A variant has no state** (owner ruling, 2026-09-30). Whether its numbers describe the food after cooking
  is a fact of its label: a cooking-method part (boiled, roasted, brewed, prepared) or `homemade` (naming rule
  20). The details dialog does not split variants by state.
- **Search returns roots.** A variant is never its own search result. A synonym finds its root, and a query
  that names exactly one variant carries that variant.
- **The UX spec stands where curated data does not change it.** `docs/design/ingredientSpecialization.md`
  keeps its line types, its menu, its states, its accessibility contract and its cross-platform rules. Its
  §8 (the details dialog) is updated to match R26.
- **The deploy applies the seed, and nothing else writes seeded rows.** Seeding is a step of every food
  deploy, after migrations and before the service rollout. The hand tools `seed:usda-bulk`, `catalog:reseed`
  and `catalog:clear` are retired. Each can re-create ids and leave a database whose recorded digest hides
  it.
- **Review happens on the pull request, and prod counts the blast radius.** A seed change shows a row-level
  diff in CI. First, the prod deploy counts the recipe lines that each merge, split or withdrawal affects. If
  any line is affected, the deploy stops for approval. Then it applies the seed.
- **The source data is committed.** The seed reads the USDA SR Legacy and Foundation datasets (about 9.5 MB
  zipped, CC0). They are committed with checksums, so a deploy never downloads from USDA.
- **Proof is the content, not the exit code.** The seeder once reported success after it merged rows that
  shared a name (plan 002, the R56 banner). A check after every seed step compares the database with the
  seed.

---

## Key Flows

- F1. Add an ingredient by search
    - **Trigger:** a cook types in the ingredient picker.
    - **Steps:** results show root names, found by name or synonym. If the query's words name exactly one
      variant, the result carries it, and picking it binds that variant. Otherwise the cook picks a root, and
      the line takes the root's own numbers. The cook can then add details, pick a variant, and see its parts
      on a dotted line under the name.
    - **Covered by:** R15, R16, R18, R22, R24, R25, R26.
- F2. Import a recipe
    - **Trigger:** a cook pastes or imports recipe text.
    - **Steps:** each line binds a root. If the line's words name exactly one variant, it binds that
      variant instead. The import review and the ambiguity review show root names and variant parts.
    - **Covered by:** R23, R24, R25.
- F3. Read a recipe
    - **Trigger:** anyone opens a recipe.
    - **Steps:** each line shows its root name. A variant-bound line adds its dotted line. A root-bound line
      shows the name only.
    - **Covered by:** R24, R25, R28.
- F4. Change the seed
    - **Trigger:** a pull request edits the seed.
    - **Steps:** CI shows the row-level diff. The preview deploy applies the change. After merge, the prod
      deploy counts the recipe lines the change affects, then applies it.
    - **Covered by:** R31 to R42.

---

## Requirements

**The seed**

- R1. The curated seed, and the naming rules that produced it, are committed in food-service's seed folder
  under camelCase names.
- R2. The USDA source files the seed reads are committed with pinned checksums, which are verified before
  the files are read.
- R3. Each root has a fixed key in the seed that does not depend on its name.
- R4. The seed names the USDA item each root stands for, or states that it stands for none (naming rule 1c).
  That item is never also one of the root's variants. A root that stands for none has no variants, and no merge
  absorbs it.
- R5. Each part of a variant names its attribute. The attribute set covers every part in the seed: at least
  cut, form or variety, bone, skin, fat, trim, grade, pack, cooking method, salt, sugar, added nutrients,
  baby-food stage and origin. The seed check fails on a part with no attribute.
- R6. A variant's parts follow one fixed attribute order, with origin last. The seed check fails on a
  variant out of that order.
- R7. The seed declares each merge and each split of roots, so no change is inferred from a diff.
- R8. The seed's digest covers the seed, the committed USDA source files and the seeder's own build.

**The catalog**

- R9. Every variant has its own nutrition, from its own USDA item. If the curated plan's R50 finds a source
  for a root, the root has its own nutrition. Otherwise it has none. A root or variant carries the portions of
  every source row of its item, alias sources included (the curated plan's R48). When two sources give the
  same portion label, the source that supplies the numbers wins. Nothing is copied between a root and its
  variants.
- R10. A root with no variants is complete, and it offers no details.
- R11. A seed change never changes the id of an existing root or variant. A root's id keys on its seed key,
  and a variant's id keys on its source item id.
- R12. When a root merges into another, its own item becomes a variant of the survivor, and its id resolves
  to that variant. When a root splits, it keeps its id and its item, and the new root gets a new key.
- R13. A root or variant removed from the seed is withdrawn, not deleted.
- R14. Nothing at run time overwrites a seeded root's name, synonyms or numbers, or a variant's parts or
  numbers.

**The food contract**

- R15. Search returns roots only, matched by name or synonym.
- R16. If a query's words name exactly one variant, the root's result carries that variant.
- R17. A root's read carries its variants. Each carries its parts in contract order, each part with its
  attribute, plus its calories per 100 g.
- R18. A root's nutrition is its own nutrition row. A variant's nutrition is its own nutrition row. A root with
  no nutrition row reports its numbers as absent, never as zero.
- R19. The live search and add-by-name never show or create a food for a source item that the seed holds or
  cites. A live hit on an item the seed holds maps to that item's owner, its root or variant. A live hit on a
  cited key that no seed item holds maps to the root that cites it.

**Recipe lines**

- R20. A recipe line binds to a root or to one of its variants.
- R21. A seed change never moves a variant-bound line. A root-bound line follows its root. Only a seed change
  to the root's nutrition changes that line's numbers.
- R22. A cook can add, change or remove a line's variant.
- R23. If an imported line's words name exactly one variant, the line binds it. Otherwise the line binds a
  root.

**What the cook sees, on web and mobile**

- R24. Every surface that shows a food shows its root's name. This covers the picker results, the
  disambiguation list, the import review, the ambiguity review, the recipe form, the recipe view, the filter
  bar and the nutrition panel.
- R25. A variant shows as its parts, in contract order, on one line under the root's name, with a middle dot
  ( · ) between parts. Every surface shows every part. No surface shows a part as a chip or badge, or shows a
  comma-joined label. The one exception is a group header in the details dialog, which shows its group's
  shared part once (R26).
- R26. The details dialog is one list of a root's variants, and the cook picks one row. Each row shows its
  parts and its calories per 100 g. Withdrawn variants are not listed.
    - A root with fewer than 8 variants shows them all.
    - A root with 8 or more variants adds search above the list.
    - A list of 8 or more rows is grouped by the first attribute whose part differs between rows. Three
      conditions must hold: at least 2 groups, no more groups than half the rows, and at least half the rows
      carrying the part. Rows without the part come first, with no header. A group header shows its part once,
      and its rows show the rest.
    - Rows are in calorie order, lowest first. A grouped list orders each group, and a flat list orders the
      whole list.
- R27. Every accessible name that includes a variant includes all its parts, separated by commas for screen
  readers. In the dialog, a row's name starts with its visible text and ends with its group's part.
- R28. A root-bound line shows its root's name and no details line.
- R29. A line bound to a withdrawn variant keeps its name, parts and numbers.
- R30. Every state of the picker, the details dialog and the line is specified and built on both platforms:
  loading, empty, no variants, error and offline.

**Deploy**

- R31. Every prod food deploy applies the seed after migrations and before the new service version takes
  traffic.
- R32. The seed applies atomically. A failure leaves the previous seed in place, and every seed is readable
  by the service release already running.
- R33. Applying a seed depends only on the target seed and the database's current rows, so an older seed
  applies over a newer one.
- R34. A preview's database holds its own commit's seed before its service deploys.
- R35. Each preview's food database holds its own commit's seed from its first deploy. No shared base database
  exists to copy.
- R36. When a database already records the committed digest, the seed step writes nothing. The check (R39)
  still runs.
- R37. A seed failure fails the deploy, and the rollout does not run. A re-run after the fix completes.
- R38. The seed step calls no USDA API and no third-party host. It proves it holds the committed seed, as
  migrations prove their manifest (ADR-0035).
- R39. After every seed step, a check compares every row the seed owns with the seed and fails the deploy
  on any difference. It covers every table and column the seed writes, including portions and each root's
  item. It also covers each root's and each variant's nutrition and citations, and the absence of nutrition
  where the seed states none. User-authored and on-demand foods are outside it. It reads the seed independently
  of the seeder.
- R40. A database records the digest only after the check passes.

**Review**

- R41. A pull request that changes the seed shows, in CI, the roots added, renamed, merged, split and
  withdrawn, and the variants moved between roots.
- R42. The prod deploy counts the recipe lines that each merge, split or withdrawal affects, before it applies
  the seed. If any line is affected, the deploy stops for approval.

---

## Acceptance Examples

- AE1. A cook adds a detail.
    - **Covers:** R17, R22, R25, R26.
    - **Given:** a line bound to "beef brisket".
    - **When:** the cook opens the details dialog and picks a variant.
    - **Then:** the line shows "beef brisket" and, under it,
      `flat half · separable lean and fat · 1/8-inch trim · select · braised`. Its nutrition changes to that
      variant's.
- AE2. A synonym finds its root.
    - **Covers:** R15, R24.
    - **Given:** "first cut brisket" is a synonym of "beef brisket".
    - **When:** a cook searches "first cut brisket".
    - **Then:** one result, "beef brisket", appears.
- AE3. A query names one variant.
    - **Covers:** R16, R25.
    - **Given:** "grilled" is exactly one variant of "boneless skinless chicken breasts".
    - **When:** a cook searches "grilled boneless skinless chicken breasts" and picks the result.
    - **Then:** the line binds that variant and shows `grilled` under the root's name.
- AE4. A rename reaches prod.
    - **Covers:** R11, R21, R31, R34, R41.
    - **Given:** a pull request renames one root.
    - **When:** it is opened, deployed to its preview, merged and deployed to prod.
    - **Then:** CI lists the rename, the preview and then prod show the new name, and every recipe line keeps
      its id and nutrition.
- AE5. A deploy with no seed change.
    - **Covers:** R36, R39.
    - **Given:** the database records the committed digest.
    - **When:** food deploys.
    - **Then:** the seed step writes nothing, the check still runs and passes, and the rollout proceeds.
- AE6. A silent collapse.
    - **Covers:** R39.
    - **Given:** the seeder merges two variants into one and exits 0.
    - **When:** the check runs.
    - **Then:** it finds the missing variant and fails the deploy before the rollout.
- AE7. Two roots merged.
    - **Covers:** R7, R12, R21, R42.
    - **Given:** the seed declares that one root merges into another, and recipes use both.
    - **When:** the prod deploy applies it.
    - **Then:** the deploy first reports the affected lines and waits for approval. The absorbed root's item
      becomes a variant of the survivor, its id resolves to that variant, and every recipe line keeps its
      numbers.
- AE8. A long list, grouped.
    - **Covers:** R26.
    - **Given:** beef brisket, whose variants span five cuts.
    - **When:** the cook opens the details dialog.
    - **Then:** the rows show in the groups Flat half, Navel end, Point end, Point half and Whole. A Flat half
      row reads `lean only · 0-inch trim · select` with its calories.

---

## Success Criteria

- No surface on web or mobile shows a comma-joined variant label, or a USDA description for a root that has
  a curated name.
- After every food deploy, prod and each preview hold exactly their commit's seed, proven by R39's check,
  with no manual step.

---

## Scope Boundaries

- Producing the seed: the store lookups still owed, the FoodOn mapping review and the final combine. This
  brainstorm assumes they are done.
- Curated names for USDA foods with no FoodOn root.
- Branded foods as catalog entries. A root that stands for no USDA item can cite a Branded product for its
  nutrition (the curated plan's R50). A Branded item never becomes a root, a variant or a crosswalk row.
- Numbers from users or by hand for a root that stands for no USDA item. Such a root cites the best entry
  among every legally usable food table, or it has no numbers (the curated plan's R50 and R52). Such numbers
  arrive later through the authored path (ADR-0029), never through the seed.
- Live search and sync as seed inputs. The seed never reads them (the curated plan's R60). They change only as
  R19 and the curated plan's R56 to R60 say: they call every source with an API next to USDA, each within its
  own declared rate limit, and they never write a seeded number.
- Surfaces not built yet (meal plan, grocery list, nutrition log). Each adopts R24 and R25 as part of its own
  build.
- Catalog text in languages other than English (plan 002 R55e).
- Wiring the seed into local development and the LOCAL e2e suites. Local seeding uses the deploy seed path:
  the curated plan's U16 retires the hand seed tools, and `local:up` runs the same seed apply (its U7).

---

## Dependencies / Assumptions

- The seed is complete and reviewed. The owner set this assumption. R3 to R7 add to it: a root key, each
  root's item, an attribute on every part, the fixed part order with origin last, and declared merges and
  splits. The seed also writes `-inch` in place of `"` (`1/8-inch trim`), so a screen reader speaks the unit.
- Plan 002 U1 builds the recipe-side lookup that a line binds through. U1 writes that lookup's constraint to
  allow the variant arm from the start, so no live constraint changes later.
- Prod holds an unknown number of foods from on-demand fill. Planning counts them first.
- The prod deploy already requires the Production environment approval (`.github/workflows/prod-deploy.yml`).
- FDC data is CC0. FoodOn is CC BY 4.0 and needs attribution in the product (plan 002 §13).

---

## Outstanding Questions

### Deferred to Planning

- Plan 002 assumes prod has no live data, and this doc says prod holds on-demand foods. Which one governs the
  first prod apply, and how do the existing prod rows reconcile with the seed?
- How previews get the seed. One option keeps the clone of a base database that a job on push to main
  migrates and seeds. The other seeds each preview directly. Seeding the base while a preview clones it
  fails that clone (`template-in-use`), and the sandbox database is often stopped.
- Where the seed step runs. The food migration runner times out at 300 seconds, and the current seeder runs
  one transaction per food.
- Which parts of plan 002 this work replaces (§4.7, U10, V1, §16 item 1's default-variant design, R33 and
  ADR-0048) and which it depends on (U1).
- How the pull request diff and the prod count reach recipe lines, since recipe data lives in another
  database.
- How cached numbers catch up after a seed change. The edge cache on nutrition serves for up to an hour, and
  the recipe service caches nutrition in process.
- Whether a rename reaches recipe search text. That text is built from ingredient names at save time.
- What a USDA Foundation re-release does to curated rows. A re-release can assign new source ids.

---

## Sources

- `docs/design/ingredientSpecialization.md`: the details flow, line types, menu, states and hand-off.
- `packages/services/food-service/src/foods/seed/data/namingRules.md`, cited as "naming rule N": rule 20 (a
  variant has no state) and rule 28 (a root's own item).
- `docs/plans/2026-09-20-002-feat-ingredient-lookup-grain-and-food-search-decoupling-plan.md`: §4.7 (R53 to
  R61), U1, U10, V1, and §16 items 1, 3 and 4.
- `docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md`, cited as "the curated plan": the plan built
  from this brainstorm.
- `packages/schemas/food/src/schemas/foods.schema.ts`: the single `name` string on the wire.
- `packages/apps/commise/web/src/components/recipes/IngredientPicker.tsx` and
  `packages/apps/commise/mobile/src/components/IngredientPicker.tsx`: where search results print that name.
- `packages/services/food-service/src/foods/seed/README.md`: the seed runbook, the hand tools and the
  base-and-clone model.
- `packages/services/food-service/src/lambdas/migrate/handler.ts`: the preview clone, whose refusal is fatal.
- `packages/services/food-service/infra/lib/FoodSchemaStack.ts`: the migration runner and its timeout.
- `.github/workflows/prod-deploy.yml` and `.github/workflows/_ci.yml`: the food deploy order, and food's
  refusal to deploy at `sandbox`.
- ADR-0006 (per-preview databases), ADR-0010 (deploy gates that repair a missing service), ADR-0014 (the
  service owns its contract), ADR-0029 (user-authored foods), ADR-0035 (schema stacks and the migration
  manifest).
