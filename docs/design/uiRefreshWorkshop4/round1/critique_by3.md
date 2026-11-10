# Critique by Designer 3: options 1 and 2

Heuristic judgement, not tested with users. Every number below comes from a script run with culori 4 and APCA 0.0.98G. I checked the APCA code against the
canon's "On leaf on Leaf" figure (6.77:1, Lc 88). No number is estimated.

## Render

- I rendered both files with Playwright (Chromium):
    - 1400 px, in light and dark
    - 390 px
    - 320 px at 200% text, with each Home frame captured separately.
- Neither page scrolls sideways at 390 px, at 320 px, or at 200% text. Neither logs a console error.
- I measured the Option 2 pick in its CSS (`.tag::before`, `.tag::after`).
- The captures are in `scratchpad/d3c/`.

## The set

The siblings are `round0/option1.html`, `round0/option2.html` and `round0/option3.html`. Option 3 is mine, and I
judge it here by the same rules as the others.

- **Structure: distinct.** Each has its own hero form:
    - Option 1: one coloured carton, with the photo in a window.
    - Option 2: stacked full-width slices of food, each with a name card.
    - Option 3: a column of food down the screen edge.
- **Palettes: options 1 and 3 are twins.** I measured them role by role (ΔE00):

    | Role        | Light | Dark                            |
    | ----------- | ----- | ------------------------------- |
    | Action      | 15.8  | **9.6** (the canon asks for 15) |
    | Content hue | 5.6   | 9.5                             |
    | Warning     | 6.5   | 3.4                             |
    | Danger      | 12.0  | 5.4                             |
    | Ink         | 3.8   |                                 |
    | Muted       | 4.0   |                                 |

    Both swatch strips read as "pale blue with a red accent". Option 2's spec says that a stranger can tell all three
    strips apart. Measured, that is false.

    One palette must move. The carton's blue _is_ Option 1's idea, while my ground's blue is incidental, so **I move
    Option 3** off blue and off orange.

- **Shared content.** All three Homes say "your quickest dinners, from your recipes", with the primary on the top
  pick. Two of them say "Ready by". This is a shared prior. It is honest, because it uses stored total time, but it is
  not anyone's idea.
- Options 1 and 3 also draw the same vector dishes.

## Option 1: Carton

**What must survive.**

- **The name on solid colour above the food.** Text stays off the photo with no scrim (§3.4 rule 4). It is the only
  signature in the set that reads at thumbnail size.
- **The reversed facts band** ("25 min · Serves 2 · Easy"): pack grammar and a stored-fact line at once.
- Half-rate display scaling, the audit that fixed ten targets under 44 px, Undo on delete, and a cook mode with no
  carton.

**What fails, most important first.**

1. **A palette twin with Option 3.** See The set.
2. **Home promises facts that the API cannot serve.** "Your quickest dinner" needs a dinner filter and a time sort.
   `listRecipesQuerySchema` sorts only by `updatedAt`, `createdAt` or `title`, with no `mealType`. Fix: name the gap,
   as Option 2 did.
3. **A Profile tab that does not exist.** The app has three tabs (`TAB_ROUTES`, `navigation/routes.ts:46`), and the
   ER avatar already opens the account. Two doors to one place break consistency (Nielsen H4). Fix: three tabs.
4. **At 320 px and 200% text, the food and the button leave the first screen.** What remains is a blue block with
   "Miso-glazed salmon with" over four lines. This fails §2.2 rule 11 and "food is the largest thing".
5. **The food claim is unproven.** The blue is 67,143 px² and the window 69,312 px², so they tie. Vector food hides
   whether a brown stew still reads warm in a pale-blue window.
6. **Taste risk, not a rule.** Tomato `#C41E3A` is ΔE00 5.8 from Old Glory Red `#B31942`, so "not a flag" does not
   hold. In dark, Tomato `#FFA294` and Radicchio `#F59AC9` are both pastel pink, and the button sits under a salmon
   fillet.

**Original?** The composition is. At thumbnail size the window still reads as a photo in a padded card.
**Simple?** Yes. **Palette?** Complete and measured, but a twin in this set.

**The direction.** Keep "Carton": Sky carton `#B9D8F2` / `#21405E`, Tomato `#C41E3A` / `#FFA294`. I fix the
collision on my side. Calm the type: a condensed 800 name under a condensed 800 large title is two shouts. Set
"Tonight" at 700, normal width.

**One push.** Put the window at the top of the carton and print the name under it. The food then comes first at every
text size, and the carton reads as a pack, not a card with a header.

## Option 2: Deli Counter

**What must survive.**

- **Real, wide photos.** Only here does food carry the screen at thumbnail size.
- **The most honest data audit in the set.** It found the API gap that Option 1 missed.
- "Ready by 6:35" from stored total time, the three real tabs, and narrow Archivo names that hold at 320 px and 200%.

**What fails, most important first.**

1. **The pick looks tappable.** A 15 px pistachio dot with a white ring and a shadow, on a 3 × 30 px stem, over a
   photo, is the shoppable-image hotspot: Pinterest asks users to "tap the circle on a product". Here it does nothing.
   Without the dot, a white card overlapping a photo is common, so the closest-app test fails.
2. **Delft reads as an office suite (§3.2).** `#204A80` is ΔE00 5.1 from Word's `#2B579A` and 6.2 from Facebook's
   `#3B5998`. None of eight deeper or greyer blues I tried reached 15 from both.
3. **Green food on a green page.** Case glass `#E2EDDA` sits behind pea risotto and asparagus. In the render the
   risotto's edge sinks into the ground (§3.1).
4. **Warning and Danger merge for colour-blind users.** Mustard `#6B4C00` and Paprika `#A33A00` are 20.2 apart, but
   1.6 simulated for deuteranopia and 3.0 for protanopia. Their icons must differ in shape. Mustard is also the rating
   star, a second meaning (§3.4 rule 1).
5. **The Home title changes** from "Dinner tonight" to "Still cooking". A tab's title names the place, not the state.
6. **Home's "Start cooking" has no stated target.** It must open Ingredients with the screen on, or the cook finds no
   feta at step 3.

**Original?** The slices are. The signature, without its false button, is not. **Simple?** Yes. **Palette?** The
structure is good. The action fails.

**The direction: "Pimentón & Pistachio".** The cured-meat red of the deli case marks what you press. Pistachio stays
only in the pick and the no-photo field, so green food sits on a near-neutral case.

| Role   | Light     | Dark             |
| ------ | --------- | ---------------- |
| Ground | `#F1F5EE` | `#0B110A` (kept) |
| Action | `#94400A` | `#F5B97A`        |

- On the ground: 6.35:1, Lc 77 light. 11.0:1, Lc 71 dark.
- Label on action: white 7.01:1, Lc 89. Dark `#1F0B02`, Lc 72.
- From Tomato 19.8 / 18.9. From earlier rounds, at least 34.9.
- Conditions: my Option 3 leaves orange (now 6.9 / 10.8), and dark Warning is re-derived (now 11.3).

**One push.** Remove the dot. Set the ready time like a deli price, the freshest thing in the mockup. Then nothing on
the card asks to be tapped.

## Not run

- **Distance at 60 and 90 cm.** No device was available.
- **Increased contrast.** Not checked.
- **Real photos inside Option 1's window.** Not checked.
- **Prior-art screenshots.** I did not open them app by app. My prior-art claims come from search text.
- **Brand hexes.** These come from secondary sources, not from Microsoft's brand guide.
- **Option 2's no-photo field.** Ink on Pistachio is Lc 63.6, which is under 75. I found no text on that field, so I
  did not count it as a fail.
- **The brief's image rule.** Option 2 embeds WebP photos. Whether that fits "CSS, inline SVG or canvas" is the
  owner's call.

## Sources

- Pinterest "tap the circle": [floortrendsmag.com](https://www.floortrendsmag.com/articles/102926-the-home-depot-and-pinterest-to-expand-shop-the-look-feature?v=preview)
- Word blue `#2B579A`: [oppadu.com](https://www.oppadu.com/tools/design-systems-site/brand/ms-word.html),
  [techinch.com](https://techinch.com/blog/The-Colors-of-Microsoft-Office)
- Old Glory Red `#B31942`: [fotw.info](https://fotw.info/flags/us.html)
- Colour-blindness simulation: culori's `filterDeficiencyDeuter` and `filterDeficiencyProt` (Machado 2009 model)
