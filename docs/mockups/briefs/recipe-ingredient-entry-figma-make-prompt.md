# Figma Make prompt — Recipe creation, ingredient entry

Paste everything below the horizontal rule into the **existing Commise Figma Make project**. It is written
as a revision request against the screens already there, not as a fresh brief.

Three notes for you, not for Figma:

- **Dry/wet is gone, replaced by a group label.** Dry/wet is a property of the _food_ (flour is dry every
  time anyone uses it), so asking a cook to restate it per line, per recipe, forever is a column that never
  gets filled. Where it genuinely matters — "combine the dry, then add the wet" — it is a **mixing-order**
  fact, which is the same axis as "For the sauce". One field serves both. If dry/wet later earns a place as
  a food-level property, it comes from the catalog and needs no control on this screen.
- **Grouping is the one addition with code evidence.** `parseIngredientLine` already detects `group_header`
  ("For the sauce:") and flags it — and the recipe schema has nowhere to put it, so it is discarded today.
- **Preparation** is genuinely new. `notes` reaches the wire but no UI writes it, and it is documented as a
  display override rather than a preparation. Its description encodes your 2026-08-23 ruling — participle
  and temperature are preparation, adjective is identity — because the mockup is where that distinction
  either reads naturally to a cook or does not. **Size** is new for the same reason: the parser emits
  `large`/`small` and the schema has nowhere to put it.

---

## Prompt

You already have the Commise app in this project — Home, Recipes, Recipe-detail, Meal Plan, Grocery,
Nutrition, Profile, Cooking and Auth. **This adds one screen that is missing: recipe creation.** Match the
existing screens exactly; do not invent a new visual direction.

### Where it sits

The Recipes screen offers four ways to add a recipe — **Create from Scratch**, Scan Recipe, Import from
URL, Generate with AI. This is the destination of **Create from Scratch**, and it ends at the
Recipe-detail screen you already have. Design it as a **4-step wizard**: Basics → **Ingredients** →
Instructions → Photos. The ingredients step is what this brief is about; give the other three enough shape
to show the wizard frame, but spend the detail here.

Keep everything the other screens already establish: the left sidebar with the Commise mark and the same
nav items, the sand gradient background, the white cards, Playfair Display for headings and JetBrains Mono
where the existing screens use it, the seafoam primary and coral accent, and the same corner radii,
spacing rhythm and elevation. Recipe-detail's chip treatment (Mediterranean / Main Course / Gluten-Free)
and its stat row (Prep / Cook / Serves / Level) are the closest reference points — the creation screen
should look like the same product filling in what Recipe-detail later displays.

Produce both the **desktop** layout and the **mobile** layout, as the other screens have.

### The core idea

A cook never types a free-form ingredient line like "2 cups all-purpose flour, sifted". Every ingredient
is assembled from separate, structured fields, and the food itself is always chosen from a searchable list
rather than typed. The design's job is to make that feel faster than typing a sentence, not slower.

### The ingredient list, and its groups

An ordered list of ingredient rows plus a primary "Add ingredient" action. Rows reorder by drag on desktop
and by a handle on mobile, and each row can be removed.

**Rows can belong to a named group**, and the list renders sectioned when they do — "For the marinade",
"For the topping", or "Dry" and "Wet" for a baking recipe. A group is a label a cook types or picks, not a
fixed set: the field autocompletes over labels already used in this recipe and a few common ones, and
accepts anything new. An ungrouped recipe shows a plain flat list with no section chrome at all — grouping
must feel like something a cook reaches for, never a step they have to satisfy.

Show these states:

1. **Empty** — no ingredients yet, inviting the first action rather than showing an empty table.
2. **Flat** — seven or eight ungrouped rows, deliberately varied: a plain one, one with a quantity range,
   one with no quantity at all ("salt, to taste"), one with a long multi-word food name that must not
   truncate awkwardly, one with a preparation, one with a size, and one using an informal unit like
   "handful". Use foods consistent with the recipes already in the project — the Mediterranean Grilled
   Lamb and Herb Risotto on the Recipes screen are good sources.
3. **Grouped** — the same list organised into two or three named sections, showing how a cook moves a row
   between groups and how a new group gets created.
4. **A row mid-edit** — one row focused or expanded while the others stay compact.

### An ingredient row

On desktop the fields sit on one line; on mobile they stack or wrap, and it must stay clear which fields
belong to which row.

- **Food** — the ingredient's identity, and **not** a free text field. It is filled from the picker below.
  Once chosen it reads as a settled value carrying the catalog's own name, with a small "USDA" badge when
  it came from the food database rather than the cook's own history. It can be cleared or re-picked, never
  typed over.

- **Quantity** — numeric. Beside it an optional second numeric field for the upper bound of a range,
  revealed by a small "range" toggle rather than always visible, since most lines are a single amount.
  Together they read as "2 – 3".

- **Unit** — a text field with autocomplete over known measurement units (cup, tablespoon, teaspoon, gram,
  ounce, pound, millilitre, clove, pinch). The cook may also type one that is not on the list — "handful",
  "splash", "to taste" — and that must be accepted without looking like an error. Show the difference:
  a recognised unit reads as settled, an unrecognised one as accepted-but-informal. Never block or warn.

- **Preparation** — short, optional, for what was done to the ingredient: "chopped", "finely diced",
  "melted", "boiling", "at room temperature", "divided". Deliberately separate from the food's name, and
  the separation should feel natural rather than pedantic.

    The split matters and the mockup should demonstrate it, because it is easy to get backwards. "chopped",
    "grated", "melted", "sifted" describe something done to the food and belong here. "sweet", "brown",
    "Italian", "pastry" say _which_ food it is and belong in the food's name — they arrive from the picker,
    not from this field. Temperature words ("hot", "cold", "boiling") belong here.

    Include one row showing both at once — a food whose name carries an identifying adjective _and_ a
    preparation beside it — plus several rows where preparation is empty.

- **Size** — optional and short, for a size the recipe states about the item itself: "large", "small",
  "medium". Separate from both the food and the preparation: "3 large onions" is three of a
  larger-than-usual onion, which is neither a different food nor something done to it. Keep it compact —
  a small select beside the quantity reads better than a full-width field. Show at least one row using it.

- **Group** — optional, the section this row belongs to. Since most rows in a grouped recipe share a
  label, per-row entry should not be the main way to set it: assigning a whole section at once, or
  dragging a row into one, should feel more natural than typing the same words eight times. Show whichever
  reads best, and keep the per-row control quiet.

A row whose food has not been chosen is **not** submittable. Design that state: the row exists, shows what
is missing, and the wizard's "Next" is unavailable with a clear reason. Do not design a row that looks
complete but is silently discarded.

### The food picker

Choosing a food opens a search surface — an inline panel on desktop, a full-screen sheet on mobile. This
is the most important part of the design.

Results appear as the cook types, in **two labelled sections that never interleave**:

- **Your ingredients** — foods this cook has used before. First, and fastest.
- **Food catalog** — the shared catalog seeded from the USDA food database, each result carrying a small
  "USDA" badge.

Below them, two persistent fallback actions:

- **Search USDA for "{query}"** — reaches an external database on demand, and it is slow. Design an
  explicit loading state that can run for several seconds, plus what happens when it returns nothing and
  when it fails. It must read as a deliberate, occasional action rather than something that fires as the
  cook types.
- **Add "{query}" as a custom ingredient** — accepts the cook's own text as a one-off food with no
  nutrition data. Show what that costs: such a row should later read as "no nutrition data" somewhere
  non-alarming.

Picker states to design: empty query (showing recent or frequent foods) · typing, still loading · results
in both sections · results in only one · no local results, with the two fallbacks carrying the weight ·
the on-demand USDA search running · the on-demand USDA search failing · **disambiguation**, where the
query matches several distinct foods (three or four variants of "flour"), presented with whatever
distinguishes them and a "remember this choice for '{query}'" option so the decision is not asked twice.

### Overall

Include a running per-serving nutrition summary in the step, updating as ingredients change, with a
visibly degraded state when some lines have no nutrition data. It should look like the source of the
numbers Recipe-detail already shows.

Prioritise speed of repeated entry — a cook adding twelve ingredients runs this loop twelve times, so
every extra click compounds. Keyboard flow on desktop matters: add an ingredient, pick it, set quantity
and unit, and start the next one without reaching for the mouse.
