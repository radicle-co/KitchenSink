# Figma Make prompt — Recipe creation, ingredient entry

Paste everything below the line into Figma Make. It describes one step of an existing product, so it is
written as content + behaviour + states rather than as a visual direction; Figma Make supplies the visual
treatment.

Three notes for you, not for Figma:

- The **attribution (dry/wet)** control is included and marked optional. USDA carries nothing that can
  derive it, so it is a per-line declaration or it does not exist. If you drop it, the mockup simply loses
  one control and nothing else changes.
- The **preparation** control is genuinely new. Today `notes` reaches the wire but no UI writes it, and it
  is documented as a display override rather than a preparation. Its description below encodes your
  2026-08-23 ruling — participle and temperature are preparation, adjective is identity — because the
  mockup is where that distinction either reads naturally to a cook or does not.
- The **size** control is also new, and it exists because the CRF parser emits `large`/`small` and our
  schema has nowhere to put it. Folding it into the name makes `large onion` a different food from
  `onion`; folding it into preparation claims the cook did something. It is a third thing.

---

## Prompt

Design the **ingredient entry step** of a recipe creation flow for a cooking app called Commise. Produce
both a **desktop web** layout and a **mobile** layout. This is step 2 of a 4-step wizard (Basics →
Ingredients → Instructions → Photos), so include the step indicator, and a back/next pair at the bottom.

The core idea: a cook never types a free-form ingredient line like "2 cups all-purpose flour, sifted".
Every ingredient is assembled from separate, structured fields, and the food itself is always chosen from
a searchable list rather than typed. The design's job is to make that feel faster than typing a sentence,
not slower.

### The ingredient list

The step's main area is an ordered list of ingredient rows plus a primary "Add ingredient" action. Rows
can be reordered by drag on desktop and by a handle on mobile, and each row can be removed.

Show the list in three states across your frames:

1. **Empty** — no ingredients yet. This is the first thing a cook sees, so it should invite the first
   action rather than showing an empty table. A single prominent "Add your first ingredient" affordance.
2. **Populated** — seven or eight rows, deliberately varied: a plain one, one with a quantity range, one
   with no quantity at all ("salt, to taste"), one with a long multi-word food name that must not truncate
   awkwardly, one with a preparation, one with a size, and one using an informal unit like "handful".
3. **A row mid-edit** — one row expanded or focused while the others stay compact.

### An ingredient row

Each row carries these fields. On desktop they sit on one line; on mobile they stack or wrap, and the
design should make clear which fields belong to which row.

- **Food** — the ingredient's identity. This is **not** a free text field. It is filled by choosing from
  the picker (below). Once chosen it displays as a settled value with the catalog's own name, and shows a
  small badge when the food came from the USDA food database rather than the cook's own history. It can be
  cleared or re-picked, but not typed over.
- **Quantity** — a numeric field. Next to it, an optional **second numeric field** for the upper bound of
  a range, revealed by a small "range" toggle rather than always visible, since most lines are a single
  amount. When both are present they read as "2 – 3".
- **Unit** — a text field with autocomplete over a known list of measurement units (cup, tablespoon,
  teaspoon, gram, ounce, pound, millilitre, clove, pinch, and so on). The cook may also type a unit that is
  not on the list — "handful", "splash", "to taste" — and the design must accept that without looking like
  an error. Show the difference visually: a recognised unit reads as settled, an unrecognised one reads as
  accepted-but-informal. Never block or warn on an unrecognised unit.
- **Preparation** — a short optional text field for what was done to the ingredient: "chopped", "finely
  diced", "melted", "boiling", "at room temperature", "divided". It is deliberately separate from the
  food's name, and the design should make that separation feel natural rather than pedantic.

    The split matters and the mockup should demonstrate it, because it is easy to get backwards. Words like
    "chopped", "grated", "melted", "sifted" describe something done to the food and belong here. Words like
    "sweet", "brown", "Italian", "pastry" say _which_ food it is and belong in the food's name — they come
    from the picker, not from this field. Temperature words ("hot", "cold", "boiling") belong here.

    Include one row showing this clearly — a food whose name carries an identifying adjective _and_ a
    preparation in its own field — plus several rows where preparation is empty.

- **Size** — an optional short field for a size the recipe states about the item itself: "large", "small",
  "medium". This is separate from both the food and the preparation: "3 large onions" is three of a
  larger-than-usual onion, which is neither a different food nor something done to it. Keep it compact —
  a small select or a short text input beside the quantity reads better than a full-width field. Show at
  least one row using it.

- **Attribution** _(optional — include unless told otherwise)_ — a compact two-value selector marking the
  ingredient as dry or wet, defaulting to neither. Keep it visually quiet; it is a refinement, not a
  required decision.

A row where the food has not yet been chosen is **not** submittable. Design that state: the row exists,
shows what is missing, and the wizard's "Next" is unavailable with a clear reason. Do not design a row
that looks complete but is silently discarded.

### The food picker

Choosing a food opens a search surface — an inline panel on desktop, a full-screen sheet on mobile.
This is the most important part of the design.

The search field is labelled for searching ingredients. Results appear as the cook types, grouped into
**two labelled sections that never interleave**:

- **Your ingredients** — foods this cook has used before. These appear first and fastest.
- **Food catalog** — the shared catalog, seeded from the USDA food database. Each result carries a small
  "USDA" badge.

Below the results, two persistent fallback actions:

- **Search USDA for "{query}"** — reaches an external database on demand. This one is slow: design an
  explicit loading state for it that can run for several seconds, and design what happens when it returns
  nothing and when it fails. It must be obviously a deliberate, occasional action rather than something
  that fires as the cook types.
- **Add "{query}" as a custom ingredient** — accepts the cook's own text as a one-off food with no
  nutrition data attached. Show what that costs: a row created this way should later read as
  "no nutrition data" somewhere non-alarming.

Design these picker states:

- Empty query — before typing, showing recent or frequently used foods.
- Typing, results still loading.
- Results found, both sections populated.
- Results found in only one section.
- No local results, with the two fallback actions carrying the weight.
- The on-demand USDA search running.
- The on-demand USDA search failing.
- **Disambiguation** — the cook picked a name that matches several distinct foods (three or four variants
  of "flour", say). Present the choice clearly, with whatever distinguishes them, and include a
  "remember this choice for '{query}'" option so the same decision is not asked twice.

### Overall

Include a running per-serving nutrition summary somewhere in the step, updating as ingredients change,
with a visibly degraded state when some lines have no nutrition data.

Prioritise speed of repeated entry — a cook adding twelve ingredients does this loop twelve times, so
every extra click compounds. Keyboard flow on desktop matters: it should be possible to add an ingredient,
pick it, set quantity and unit, and start the next one without reaching for the mouse.
