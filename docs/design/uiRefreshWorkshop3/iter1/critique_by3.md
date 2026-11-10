# Iteration 1 critique, by Designer 3 (Enamelware)

I read both specs and rendered both mockups in light and dark at 1400 px. I computed every contrast number here from
the hex values (WCAG 2.x), and every colour distance as CIELAB ΔE76.

## One finding that affects both options

Options 1 and 2 share a primary button and a ground:

- Ember `#B42318` and Tomato `#B83419` are **ΔE 5.6** apart: the same red, side by side.
- Fog `#EEF3F1` and Rinse `#F3F5F2` are **ΔE 1.5** apart, which is below what most people can see.

Shown at the same size, both options are a pale green-grey room with white lists and one red pill. The brief says
the options must stay clearly different. I think **option 1 should move**, because ember is not its signature; the
lamp is. (My own ground, `#E8EDF5`, is ΔE 5.5 from Fog, so all three of us sit on pale cool grounds. That is
acceptable only while the accents differ.)

## Option 1: Pilot Light

**Fresh or dated?** Fresh. A cool room with one lamp is original, and fits Apple's direction: material whose "color is shaped by nearby content" and which "gives way to content"
([Apple, Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)).
One risk: the Glow surface `#FFF1D6` is cream, the one colour the owner rejected. Keep it to the single lit thing.

**Simple at first use?** Mostly; the pill and visible step buttons fixed the draft. Two things need explaining:

1. **The blurred dish art reads as an image still loading.** Blurred colour fields are the standard loading
   placeholder ([Wolt BlurHash](https://github.com/woltapp/blurhash)). (a convention, not a study). Google found that "unstructured and unlabeled images weren't recognized"
   ([Google, M3 Expressive research](https://design.google/library/expressive-material-design-google-research)). Titles save the rows;
   the detail hero has no such help.
2. **The lamp is not alone.** On Home the lit row competes with four warm thumbnails, weakening the
   isolation the idea relies on
   ([Von Restorff](https://lawsofux.com/von-restorff-effect/)).

**Palette.** AA throughout; I confirmed Pewter on Stone 3.70 and dark Pewter on Glow 3.88. Glow on Fog is **1.00:1**, so the lit row is set apart only by hue and a 50% amber rim. Allowed (not a control), but gone in greyscale. The spec says New recipe is "the only ember thing
on the screen", yet "See all", "Version history" and the selected tab are also ember. The floating New recipe button
covers the "Pad Thai with Shrimp" row and the Coming soon card.

**At the stove.** This is the best stove screen of the three. The current step is 23 px with a lamplight number,
and the "Timer · 20 min" matches the step's first phase. The dark cooking wash is a real idea
([Calm Technology: "use the periphery"](https://calmtech.com/)).

**Keep:** one light, only on "now", always with a word.

**Fixes, in order:**

1. Move away from Tomato. Make the primary button **Iron ink** (`#0F1A17`, white label 17.79:1), so the lamp is the
   only warm accent in the UI.
2. Make the dish art sharper (a soft gradient with a crisp edge) so it does not read as loading.
3. Use one ember role, and dock the primary button so it never covers a row.

**Bold push:** at night, the current step is the only lit thing on screen; everything else dims to Ash, findable
from two metres.

## Option 2: Fresh Cut

**Fresh or dated?** Joyful, but flat full-chroma vector produce is 2017–2020 style and can read as stock art. It
works on the hero; at 60 px it fails:

- Pad Thai's shrimp reads as a letter "C".
- The pancakes' blueberries are navy discs with stars, which look like rating badges beside a Turmeric rating star.
- Weeknight Chicken Cacciatore and Roasted Tomato Basil Soup both show one tomato.

The spec's own risk ("no two recipes look the same") already fails in the mockup.

**Simple at first use?** Familiar controls, but:

1. **Ingredient checkboxes are missing.** The app ships `IngredientCheckRow` on web and native, and the mockup has
   no checkbox at all. A parity defect.
2. **The Home hero is a tappable image with no chevron or other affordance.** Weak signifiers made people 22% slower
   and caused 25% more fixations ([NN/g](https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/)).

**Palette.** It is AA-clean. I confirmed Rind on Shell at 3.40 light and 3.35 dark. But Tomato is ΔE 5.6 from option
1's Ember, and the Persimmon art `#EE4B2B` is close to Tomato, so the one action competes with red art on every row.
Purple and blue grounds behind chicken and pancakes may work against appetite. Colour sets taste expectations
([Spence, _Flavour_ 2015](https://flavourjournal.biomedcentral.com/articles/10.1186/s13411-015-0031-3)), but applying
that to a background is my inference.

**At the stove.** This is the weakest of the three:

- The Zest tint is **1.13:1** on Counter (1.29 in dark), and the step text stays at body size, so across the
  kitchen only a small badge marks the current step.
- Step 4 has two timed phases (20 min, then 1 h 10), but it offers a single "1 h 30 min" timer, so the cook is never
  told to lower the oven at 20 minutes.

**Keep:** "Text never sits on art", and the hand-cut type.

**Fixes, in order:**

1. Restore the ingredient checkboxes.
2. Give each timed phase its own timer.
3. Enlarge the current step to at least 22 px.
4. Draw two shapes per thumbnail, and keep star and disc shapes out of the art.
5. Keep produce reds out of Tomato's ΔE range.

**Bold push:** make the ground true market white `#FFFFFF`, and let the art be the only colour, so this option owns
"poster on white" and no longer shares the pale grey room with the other two.
