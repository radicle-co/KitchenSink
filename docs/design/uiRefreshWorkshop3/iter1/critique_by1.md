# Iteration 1 critique, by Designer 1 (Pilot Light)

I read each option's `final/*.md` and rendered each `final/*.html` in Chromium at 390 px, light and dark. Contrast is
WCAG 2.x, computed from the hex values. "Lc" is APCA 0.0.98G, computed the same way.

**One finding for both of you first: you share the same type.** Options 2 and 3 both load Bricolage Grotesque 700–800
for titles and Figtree for reading. Put side by side, "Lemon and thyme roast chicken" looks the same in both. The owner
asked for three clearly different options. Type is half of the feel, so one of you must move. My suggestion is
below.

## Option 2: Fresh Cut

**Fresh?** Yes. It is the freshest of the three, with flat poster art, a cool white and no paper. The risk is not that
it looks dated. The risk is clip-art. The pancake hero has two navy "stars" that read as decoration, not food. The
Pad Thai thumbnail is a red "C". Two recipes show the same tomato. Your own risk, "no two recipes look the same", already fails here.

**Simple?** Almost. Two gaps:

1. **Ingredient check-off is missing.** The app has it (`IngredientCheckRow.tsx`). Paprika's "Cook" mode treats
   crossing off ingredients and keeping the screen on as one feature set
   ([App Store](https://apps.apple.com/il/app/id1303222868)). Put it back.
2. **Steps are real buttons, but they do not look pressable** (grey discs on grey). NN/g measured 22% longer looking
   time and 25% more fixations on pages with weak signifiers
   ([NN/g](https://nngroup.com/articles/flat-ui-less-attention-cause-uncertainty)). Give the number an outline (Rind).

**Palette.** It is calm and well documented. The checks:

- **Tomato and Wine:** 1.47 in light, 1.22 in dark, Lc 0 in dark. In dark, coral `#FF7A57` and pink `#FF8FC0` are a
  similar pastel. Your three rules carry this, as WCAG 1.4.1 requires
  ([W3C](https://w3.org/WAI/WCAG22/Understanding/use-of-color.html)). Make them lint rules, not prose.
- **Art Persimmon `#EE4B2B` against Tomato `#B83419` is 1.60**, the same hue. Your "only one thing is Tomato" rule
  breaks on every Persimmon thumbnail beside the New recipe button.
- **Dark muted text**: Clove on Counter is 7.95 in WCAG but **Lc −58.6** in APCA, under the Lc 75 body minimum
  ([APCA](https://github.com/Myndex/apca-introduction)). Meta text at 14 px will look faint on a dim phone.

**At the stove.** It is good. Body is 17/27, amounts are bold and tabular, and the Zest step is easy to see from
across the room. Ticking is the gap.

**Keep:** the rule "text never sits on art", and art chosen from the lead ingredient.

**Fixes, in order:**

1. Restore ingredient check-off.
2. Remove Persimmon from the art set, or add a rule that keeps it away from Tomato.
3. Draw the shape set for 20 real recipes before you commit, and fix the tomato collision.
4. Lift dark Clove to about `#CBC6D0`.
5. Outline the step numbers.

**Bold push:** change the type. Keep Bricolage, but pair it with a grotesque that has true poster weight, such as
Archivo or Familjen Grotesk, instead of Figtree. Fresh Cut then owns "poster" in its letters as well as its art.

## Option 3: Enamelware

**Fresh?** Partly. Cobalt on pale blue-grey is clean, and dropping the speckles was right. But the rendered page leans
on plates in rings everywhere: the hero, every row, the monogram dots. It reads like an icon set, not a
material. Home's single small plate floats in empty space above the fold.

**Simple?** Yes. It has the most complete content: checklists, step radios, "Screen on", rating and source. Two things need words:

- The **icon-only pencils** beside Ingredients and Steps. A third edit door next to "Edit recipe" makes the cook ask
  which one to use.
- On Home, the floating **New recipe** button sits over "Coming soon" at the fold. Add bottom padding so it never
  hides the last row.

**Palette.** It is the most rigorous, with a "must not be confused" table. But:

- **Light Slate on Enamel is 6.53, Lc 75.7, and on the wash Lc 75.0.** Both are right at the APCA body minimum.
- **Dark Slate on Stoneware is Lc −58.7**, the same dark-mode weakness as option 2.
- **Ticked ingredients become Slate plus a strikethrough.** At arm's length, a line through 14–16 px text makes the
  cook squint to check what they already added. Fade the text, or tick it without a line
  ([Setproduct](https://setproduct.com/blog/strikethrough-text-deserves-more-love-in-ui)).
- **Is blue unappetising?** The evidence is weak. Background colour had no effect on food wanting ([Frontiers 2020](https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full)). The coolness is
  a mood risk, not an appetite risk.

**At the stove.** It is strong. The cobalt current step and the full-width Edit recipe are clear. Body at 16 px is
small for distance reading. Use 17 px, as option 2 does.

**Keep:** one cobalt for "act here", the monogram plate, and the honest round crop.

**Fixes, in order:**

1. Add bottom padding under the floating button.
2. Drop the pencil icons, or give them words.
3. Remove the strikethrough.
4. Use 17 px body, and lift dark Slate.
5. Show a **real** angled photo in the round crop to prove the claim. Today it is drawn art.

**Bold push:** make the enamel a material, not a ring. Apple's Liquid Glass guidance says the material is there to frame
content and never outshine it ([STRV summary of HIG](https://www.strv.com/blog/how-to-apply-liquid-glass-to-your-app)).
So keep the rim for the photo alone, and let rows use the plain square thumbnail. Then let the gloss live only on the
one cobalt button: one glossy object per screen.

## Sources and what each changed

- NN/g, flat UI and weak signifiers: this is why I ask for outlined step numbers in option 2.
- W3C, Understanding 1.4.1: this is why the hue-only danger pairs need enforced rules.
- APCA introduction (Myndex): this showed that the dark-mode muted text in both options is weaker than WCAG 2.x
  suggests.
- Frontiers 2020 (Schlintl & Schienle): this softened my old "blue is cold for food" objection to option 3.
- Paprika App Store listing: this confirms that ingredient check-off and screen-on belong together while cooking.
- Setproduct, strikethrough legibility: this is the basis for the no-strikethrough fix.
- STRV, a summary of Apple's Liquid Glass HIG: this grounds the "one glossy object" push.
