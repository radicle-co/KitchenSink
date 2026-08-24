# Figma Make prompt 2 — replace dry/wet with ingredient groups

A revision against the recipe-creation screen Figma Make produced from prompt 1
(`recipe-ingredient-entry-figma-make-prompt.md`, as sent — see git history for the version with the
dry/wet control still in it).

Why, for you and not for Figma. **Size** goes because `large` is an adjective, and the 2026-08-23 ruling
already says an adjective is identity — it belongs in the food's name. Carving out an exception for it
would reopen `sweet`, `brown` and `Italian` too; it was only ever there because the CRF parser happens to
emit it as a separate field, which is letting a third-party parser shape our schema. **Dry/wet** goes
because it is a property of the **food**, not of a recipe's use of it — flour
is dry every time anyone uses it — so a per-line toggle is a column that never gets filled. Where it
genuinely matters to a cook it means **mixing order**, which is the same axis as "For the sauce". One
field serves both. Grouping is also the only one of the two with code evidence: `parseIngredientLine`
detects `group_header` today and the recipe schema discards it.

---

## Prompt

Two changes to the recipe creation screen's Ingredients step. Everything else stays as it is.

**1. Remove two controls from the ingredient row** — the **dry/wet attribution** field and the **size**
field ("large"/"small"/"medium"). Delete each entirely: the control, its label, and any space reserved for
it. Nothing replaces either. A size like "large" now belongs in the food's name, which comes from the
picker — so "3 large onions" is a quantity of 3 and a food named "large onions", with no separate control
for the word "large".

**2. Add ingredient groups.**

A row may belong to a named group, and the ingredient list renders **sectioned** when any row has one:
"For the marinade", "For the topping", or "Dry" and "Wet" for a baking recipe. A group is a label the cook
types or picks, not a fixed set — it autocompletes over labels already used in this recipe plus a few
common ones, and accepts anything new.

An **ungrouped recipe stays a plain flat list with no section chrome at all.** Grouping has to feel like
something a cook reaches for when a recipe needs it, never a step every recipe has to satisfy. Most
recipes will never use it, and those must not look unfinished.

Since every row in a section shares its label, **per-row typing is the wrong primary interaction** — a
cook would type "For the marinade" eight times. Design the way that avoids that: naming a section and
having rows land in it, dragging a row from one section to another, or assigning a selection at once.
Pick whichever reads best and keep any per-row control quiet and secondary.

Add these frames:

- **Grouped list** — the same ingredients as your populated state, organised into two or three named
  sections, on both desktop and mobile.
- **Creating a group** — the moment a cook names a new section and rows move into it.
- **Moving a row between groups.**

Keep the flat, empty and mid-edit states you already have, and keep the food picker, the preparation
field, the unit autocomplete and the nutrition summary exactly as they are.
