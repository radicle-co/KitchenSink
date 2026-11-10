# Round 2 critique by Designer 1 (Options 2 and 3)

Heuristic judgement, untested with users. I read `canon.md` and `personaV4.md` first.

**Render, for both options.** I rendered each phone frame with Playwright at 390 px, light and dark, and again with
`html{font-size:200%}`. I ran the full page at 1400, 390 and 320 px. Neither page scrolls sideways or logs a script
error. I measured gaps and font sizes from the DOM and computed colour figures with culori. They are not estimates.

**The set.** `round1/option1.html` (Carton, mine), `option2.html` (Deli Counter), `option3.html` (Food Edge), the
round-0 files and workshops 1 to 3.

- **2 and 3 are distinct** on two axes. Hero form: full-width photo bands with a card over them, against square plates
  flush to the left edge with a white strip facing each one. Palette: pistachio and cured red, against steel and yolk.
- **The set risk is the Home outline.** All three Homes share the same structure: a fixed title, three dinners each with
  a stored reason, and the one primary under the first dinner. Two of the three actions are red (Tomato and Prosciutto,
  ΔE00 19.8 in light). At thumbnail size the set separates by look, not by concept.

**Not run, for both:** a device distance test, Increase Contrast, an app-by-app check of the closest apps, and APCA and
colour-blind filters on my proposed `#DE9410`.

## Option 2: Deli Counter

**What must survive.**

- The wide food slices with an opaque card in front, where food is the largest thing on Home.
- Three reasons from stored data.
- The palette in light.
- Cook mode: a 28 px step, labelled 68 px buttons, the timer strip.

**What fails, most important first.**

1. **The signature reads as a price.** On every card, "6:35" is set at 36 px with a 14 px superscript "pm", the way a
   shop prints a price with small pence. It is bigger than the 24 px dish name. Price-like numbers over food photos with
   a red button read as a food-delivery Home, so a first-time user may think they are ordering. It also ranks the time
   above the dish being chosen. **Fix:** set the time no bigger than the name, with "pm" at full size.
2. **The primary has no clear owner.** Start cooking sits 14 px below card 1 and 20 px above slice 2, only 1.4×, so it
   reads as a divider. **Fix:** 8 px above, 28 px below, and the dish in the label ("Cook the asparagus").
3. **A wrong ingredient list.** Step 1 says "Warm 2 tbsp olive oil", but olive oil is not in the ingredient list.
4. **The current step is pink, and pink means error.** A Rose wash (`#F8E9E7`, 1.01:1 against the ground) marks step 3.
   Pink rows mean "invalid" in forms. **Fix:** use the Shell tone for the wash, with a 4 px Prosciutto rule at its left
   edge.
5. **The food shrinks at 200% text.** The slice drops to a strip about 70 px tall, so the signature becomes a card with
   a green line.
6. **Placeholders are the loudest thing in the library.** Two of four rows show solid Pistachio no-photo blocks (chroma
   0.14), louder than the food.
7. **The copy exposes a gap in the system.** "Your place in a recipe is not saved after you close the app" is a system
   limit as copy (Nielsen H2). Store the place.

**Original:** partly. A card over a photo band is the common 2018 to 2020 overlap card, and big time numerals were a
peer prediction. **Simple:** yes. **Palette:** right in light. In dark, I found no darker rose that clears Tomato and
Chilli by ΔE00 15, so keep the pale pill.

**The direction.** Keep **Prosciutto & Pistachio**. The idea is cured meat behind pale green deli glass. The action
stays `#620914` / `#FBD7D7`. Only the wash changes. The push: let the slice carry the drama, not the numerals. Use
taller 16:9 slices with tight crops and a card that covers less. The clock is just a fact.

## Option 3: Food Edge

**What must survive.**

- The 62% flush-left recipe hero with the facts stacked beside it, the best editorial move in the set.
- Neutral timer buttons on their own lines, ingredient groups, the Keep screen on switch, the 88 px library.
- The cooking-state Home, and copy like "One pan, half an hour."

**What fails, most important first.**

1. **A reason built on data that cannot exist.** The first pick says "You gave it 5 stars". The recipe page says it is
   "From your own recipes", with Edit and Delete. The recipe service refuses an owner's rating
   (`CANNOT_RATE_OWN_RECIPE`, `recipe-service/src/ratings/ratings.service.ts`). Canon §4 forbids this.
2. **The food is drawn, so the thesis cannot be judged.** The plates are noise textures with clip-art eggs and polka-dot
   curry. The signature is the food at 40% width, and drawings fail the 50 ms appeal test. Use real home-cooked photos.
3. **Yolk is Bumble's yellow.** `#F3C324` is ΔE00 2.5 from Bumble `#FFC629`
   ([brandcolorcode](https://www.brandcolorcode.com/bumble)). A cool grey with a yellow is also Pantone's 2021 pair,
   Ultimate Gray and Illuminating
   ([Dezeen](https://www.dezeen.com/2020/12/10/pantone-colour-year-2021-ultimate-gray-illuminating/)). Dark Yolk is ΔE00
   2.7 from Illuminating. It reads as one brand and one year.
4. **The current tab is shown with too little contrast.** The Yolk pill is 1.66:1 against the white bar, and the label
   only moves from weight 500 to 600. WCAG 1.4.11 asks 3:1 for a state indicator
   ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)). **Fix:** a filled icon on the current tab.
5. **The primary has no clear owner.** Start cooking has gaps of 10 px above and 16 px below, only 1.6×.
6. **The strips disappear in dark.** Ground against strip is 1.11:1 (ΔE00 3.6), so the common region is gone.
7. **A false signifier.** The first-run "+" plate is not a link.
8. **Unclear copy.** "Picks for tonight start at three" can mean 3 o'clock.
9. **Delete is low.** Delete recipe sits at the foot, about 100 px from the docked primary. Canon §4.1 puts rare and
   destructive actions at the top.

**Original:** weakly. The flush column is a list row with its inset removed, which is a subtraction. **Simple:** yes.
**Palette:** distinct, but borrowed.

**The direction: Stainless & Duck Yolk.** The idea is the deep orange yolk of a farm egg on a steel sink. The fill is
`#DE9410` in both themes. It clears Bumble by ΔE00 14.0 and Yolk by 14.3. Its Ink label is 7.28:1. It is 28.7 / 15.3
from Paprika. Saffron `#6B5600` stays for text. The push: real photos, cropped close so the food meets the screen edge,
so the edge reads as food, not a missing margin.
