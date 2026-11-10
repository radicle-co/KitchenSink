# Critique: Designer 1 on Designer 3, "Still Life" (Round 1)

Reviewed: `round1/d3/concept.md` and `round1/d3/mockup.html` (read as source). I measured contrast with the WCAG 2.x
relative-luminance formula. Glass ratios are estimates: I composited the glass over a flat ground. The real `saturate(1.4)`
and grain make them a little worse, not better.

## Verdict

This is the most original idea in the room. "The interface is the white plate, and the food brings the colour" answers
the brief at its root. Today's covers are six pale tints with a word on them. A library of small cut-paper prints of
the cook's own food makes people want to open the app. The chrome is calm. The layouts are kept. Home keeps its order.
The recipe page keeps hero, title, facts, strip, Edit recipe, description, Nutrition, Ingredients, Steps and rating.
Desktop keeps the four-card row and the sidebar.

But the mockup sells the best case. Every plate in it is hand-composed. The parts a cook sees most often are not
shown. And the chrome is so quiet that a screen without a plate risks being more "meh" than today. Below, the
problems come first, most important first.

## Must fix

### 1. Show the cases the idea depends on

All the excitement lives in the plates, and every plate shown is the best possible plate. The pancake stack and the
chicken in its tin are illustrations. A function that picks three to five motifs from a library will not draw them.
I need three more frames before I can judge whether the concept holds:

- **The fallback plate.** Your own open risk says "the cuisine-ground fallback must look good on its own". That
  fallback is what every new recipe gets on day one, before the motif library is drawn, and for any recipe whose
  ingredients map to nothing. Show a Home grid where two of four cards are fallbacks.
- **A grid that mixes a photo and plates.** "A real photo always wins" is right. But a photo next to a flat
  cut-paper print breaks the gallery wall. Discover will be mostly photos. Show Discover at 390 px with photos and
  plates mixed. Say how they live together. One way: a photo also sits on a ground colour, with the same radius and
  contact shadow. The frame stays the same and only the content changes.
- **A screen with no plate.** The editor at 390 px is oat, ink and hairlines. That is the screen cooks spend the most
  time on. Show it, and show what in the chrome itself is new and attractive.

### 2. The selected tab and the selected nav item are shown by hue alone

- Tab bar: the inactive label (`#5E6259`) against the active label (`#2A6342`) is **1.14:1** in light. In dark
  (`#ABA89F` against `#93D3AA`) it is **1.37:1**. Both use weight 600.
- The active pip (`action-tint`) against the bar is **1.21:1** in light (`#DDEBDF` on `#FFFDF8`) and **1.29:1** in
  dark (`#22362A` on `#1C1F1A`).
- The desktop sidebar has the same problem: the selected tint against canvas is **1.10:1**, and the label only
  changes hue.

A cook with red-green colour blindness sees green and grey at almost the same lightness, so the selected state
disappears. This fails SC 1.4.1 (use of colour), and the pip is under the 3:1 that SC 1.4.11 asks for a state
indicator. Fix: when a tab is active, use a filled or heavier glyph and fill the pip with `action` and an `on-action`
glyph (6.34:1 light). Or keep the tint pip, but switch the label to weight 700 and the glyph to a filled form. Do the
same on the sidebar row: a filled glyph, plus a 3 px `action` bar or dot at the start of the row.

### 3. Glass over plates fails for the 11 px tab labels

You said glass over a moving plate was checked only against its solid fallback. I checked two worst cases:

- Light: `ink-muted` on glass (`rgba(255,253,248,.72)`) over the tomato ground is about **4.46:1**. That is under 4.5
  for 11 px text, and the Draft tomato card scrolls right under the floating bar.
- Dark: `ink-muted` on glass (`rgba(28,31,26,.66)`) over the dimmed butter ground is about **4.27:1**.

D12 says each bar must stay readable with the blur off, and that holds. It must also stay readable with the blur on.
Fix: set inactive tab labels and glyphs in `ink`, not `ink-muted`, on glass (that clears 11:1 over every ground).
Or raise glass opacity to 0.82 in light and 0.78 in dark. Making the labels `ink` also helps point 2, because then
the active state needs a shape signal anyway.

### 4. Dark plates are dimmed twice, and dark mode is a filter, not a palette

Each dark ground is already darker than its light one. Then the art gets `brightness(.8) saturate(.92)`, and then a
multiply grain on top. The dark tomato `#B4442F` becomes about `#903626`, only **2.4:1** against canvas, and the
butter becomes a mustard brown (`#A1843D`). The food is the thing that needs to glow a little at night, and here it
goes muddy. Many fills inside the plates are raw hex values, for example `#E3A24E`, `#D9452F` and `#9CC25B`. They do
not change with the theme. Only the filter changes them. Pick one mechanism: real dark tokens for every fill, or the
filter. Not both. Bold suggestion A shows my choice.

### 5. Basil is spent on decoration

The concept says "one accent and one filled button per view", and that green means action. But the mockup uses
`action` for the squiggle under each section head, the difficulty pips and the brand mark tile. A cook learns from
this that green is not always tappable. Fix: draw the squiggle and the difficulty pips in `ink-muted` or
`line-control`. Then green stays the colour of things you can press. My advice is to drop the squiggle anyway. It is the
one flourish that reads as a template, and Fraunces already marks the heads.

### 6. Fraunces is pinned to a display optical size at small sizes

`.display` sets `"opsz" 96` for every use, including the 22 px desktop card titles and the 24 to 26 px section
heads. At those sizes a 96 optical size brings back the thin hairlines you blamed on Playfair. Fix: use
`font-optical-sizing: auto`, or set `opsz` to the real pixel size, and set only `SOFT` and `WONK` by hand. Also make
the floor one number. The concept says 22 px and up. The token strip says 24 px and up.

### 7. Owner rulings: two more you touch and do not list

You flagged D13 (basil instead of seafoam) and #145 (flat oat instead of the wash). Good. Two more need the same flag:

- **D11** says the greys become warm: slate `#6B645C` and pewter `#8A847C`. Your `ink-muted` `#5E6259` and
  `line-control` `#8C8578` are different values, and `#5E6259` leans green, not warm. If you mean to amend D11, say
  so and say why. If not, re-measure with D11's values. I expect slate `#6B645C` on oat to land near 5:1, which is
  enough.
- **Covers.** The current six typographic cover tints (`covers.ts`, `darkTheme.md` §4) are a shipped system. The
  plates replace it. That is the right call, but it is a bigger change than a re-theme, so list it.

On D13: I agree with you that the plates carry the identity and the action hue does not. When you ask the owner, put
that sentence first. It is the strongest argument for the change. It also makes a "no" cheap: swap two tokens and
re-measure.

### 8. A plate built from ingredients changes when the cook edits

`plateFor(recipe)` reads the first matched ingredients. If a cook swaps lemon for lime, or reorders the list, the
recipe gets a new face. Cooks find recipes by sight. A face that moves under them breaks that. Fix: compute the plate
once, at first save, and store its seed. When the cook asks, regenerate it ("New plate" in the ⋯ menu). Never
regenerate it on your own. This also
gives the cook a small, pleasant choice.

### Smaller points

- The rating shows five full stars for 4.8. The `halfstar` gradient is defined but unused. Show the honest fraction.
- The "Soon" skeleton bars are `surface-muted` on `paper` at **1.22:1**. That is fine for decoration, but in dark it
  is **1.14:1**, and the cards nearly vanish. Give the dark skeletons a little more lift.
- The difficulty "off" pip is **1.22:1** on paper. That is fine only because the word "Medium" is there. Keep the word
  in every size.
- In dark, the status bar text on the hero plate (`#EEEBE3` on the dimmed terracotta) is about **4.2:1**. Add a soft
  top scrim to the hero in dark, or fix point 4, which also fixes this.
- The phone card shows "American · 35 min". The desktop card shows an overline, a clock and "Serves 4". The current
  boards have the same split, so this is not new, but the plate system is a good time to give both one anatomy.

## What to keep

- **The plate system itself.** It is the best idea in this round. It turns the empty state of every photoless recipe
  into the thing people will love.
- **No text on a ground, and status chips on `paper`.** This removes the whole matrix of chip-by-ground contrast
  checks. It is a rule a build can enforce.
- **The sheet that overlaps the hero by 28 px.** It is calm, it feels physical, and it keeps the layout.
- **Dark action as a light fill with a dark label** (9.24:1). That keeps the CTA the brightest thing at night, and it
  matches the existing "light fills take charcoal" family.
- **The ruled ingredient list**, and the current step as the only step on paper.
- **Open-arc icons.** Small, original, and they rhyme with the cut paper without being cute.
- **The light palette's numbers.** Every text pair I re-checked matches your table.

## Two bold suggestions

**A. Light the plates like a pendant lamp at night.** Do not dim the whole plate. Make the dark ground deep and low
in chroma, for example a dark terracotta near `#3A2A22`. Keep the food shapes at almost their daytime value. The
plate then reads like food under one warm light on a dark table. That fixes point 4 at its cause, it makes
dark mode the more beautiful theme rather than the dimmer one, and it removes the filter.

**B. Give the chrome one idea of its own.** Take it from the plate. Oat, green-black ink, Fraunces and Inter is a
very familiar look right now. The plates are original. The chrome around them is not yet. Let the
recipe's ground colour reach into the chrome on the recipe page only, in one decorative place. For example, the
sheet's top edge and the rule under the title take a deep tone of that ground. Everything else stays oat, and no
state or control takes the ground colour. Each recipe then feels like its own small book, and Home stays calm.

For one moment of delight, use first save. The plate assembles, shape by shape, in about 400 ms, once in the
recipe's life. It stays inside your quiet motion rules, and it shows the cook that the picture was made for their
food. Reduced motion shows the finished plate.
