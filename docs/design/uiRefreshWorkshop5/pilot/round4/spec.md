# Pilot round 4: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder. It shows these six screens at 390 px:

- `homeLight` and `homeDark`, at full length.
- `recipeLight` and `recipeDark`, at full length.
- `recipeScrolled` and `recipeScrolledDark`, at one phone height (844 px). These show the compact top bar that
  appears once the title scrolls away.

**Scope.** The sections, data, actions and their order are the same as in the current UI and in rounds 1 to 3. Round
4 changes how the screens are built: surfaces, controls, the title face and the app chrome. Round 3 stays the record
for the signature color, the voice table and the motion spec (`../round3/spec.md`). Round 2 stays the record for the
photo treatment and the reflow rules (`../round2/spec.md`). Content ideas are in `proposals.md`.

## App, not article

The owner said round 3 read "a bit too much like reading a Medium article". These are the article signals I found in
the round-3 renders, and what replaced each one. The rule for every later screen is simple. If a screen shows one of
these signals, it is reading as an article.

| Article signal                                  | Round 3                                                                   | Round 4                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A serif dish name over body text on a warm page | Newsreader on the title and the tiles                                     | **Manrope 600** for dish names and the one title. Inter for everything else. No serif anywhere.                                                                                                                                                                                                                                                                                                  |
| One flat ground with running text               | Everything sat on one ground, separated only by space                     | **Inset-grouped surfaces.** The ground is one step darker, and each section is its own card: the recipe sheet, the rating row, the nutrition tiles, the ingredients card and one card per step.                                                                                                                                                                                                  |
| Long text shown in full                         | The description ran three lines, and each step had a wide reading measure | The description shows **two lines** and `Read more`. A done step folds to two lines. Steps sit inside cards with tighter margins.                                                                                                                                                                                                                                                                |
| Facts set as text                               | Facts were three columns of text between hairlines                        | **Three compact tiles**, each with an icon, a label and a value. Nutrition is **four small tiles**.                                                                                                                                                                                                                                                                                              |
| Few visible controls                            | Links looked like text, and the switch looked like underlined words       | **Clear control shapes.** A segmented control switches between Ingredients, Steps and Nutrition, and its selected part is filled with the signature color. Next to it is a square keep-awake button. There is a pill stepper, and there are chip buttons (`See all`, `Earlier versions`, `Edit`). Timers are pills, `Edit recipe` is an outlined button, and the rating is a row with a chevron. |
| No app chrome                                   | The page scrolled away with nothing fixed except the tab bar              | **A compact top bar** with Back, the dish name and More appears after the title scrolls away. The segmented control sticks under it (`recipeScrolled`). The recipe sheet overlaps the photo with rounded corners, as on Airbnb's listing page.                                                                                                                                                   |
| A wide headline with a byline                   | An eyebrow, a large serif title and byline text                           | The title is set in a sans at 28 px. The byline is one short line, and `Earlier versions` is a chip.                                                                                                                                                                                                                                                                                             |

Round 4 keeps these from round 3: the photos, the type sizes and cobalt with its roles. It also keeps the warm voice,
the quiet hero controls and dark mode.

## The title face: three candidates

I rendered the recipe title, two tile names and the compact top bar in four faces, side by side at true size.

| Face                                                          | Licence | Read in the render                                                                                                                                   | Verdict                                          |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Inter 600 (no change)                                         | OFL     | Clean, but it is the same face as the body, so the title has no voice of its own.                                                                    | Rejected: no identity.                           |
| Inter Display (opsz 32, 600, -0.028em)                        | OFL     | Tighter and sharper than Inter. It is a real step up, but most people cannot tell it from the body face.                                             | The fallback. Use it in case Manrope is refused. |
| Geist 600                                                     | OFL     | Crisp and geometric. It reads as a developer tool (Vercel's own face), which is the wrong voice for food.                                            | Rejected.                                        |
| **Manrope 600** (-0.024em at 28 px, -0.012em at 15 and 17 px) | OFL     | Warm and a little squared, with open, round letters. It has a clear voice in the title and the tiles, and next to Inter it still looks like one app. | **Chosen.**                                      |

All three alternatives are on Google Fonts under the SIL Open Font License, which allows use in an app. I did not
test Satoshi or General Sans. They are Fontshare fonts under the ITF Free Font License, and that licence needs a
legal read before an app can bundle them. Manrope is used only at weight 600, so the brief's 400 to 600 range still
holds.

## Surfaces and tokens

These tokens are new or changed in round 4. All others are unchanged from round 3. Ratios are WCAG 2.x, and the
thresholds come from the corpus `accessibility.md`: 4.5:1 for text and 3:1 for non-text (SC 1.4.3 and 1.4.11).

| Role                                                           | Light     | Dark      | Pair and ratio (light / dark)                   |
| -------------------------------------------------------------- | --------- | --------- | ----------------------------------------------- |
| `ground`: the page behind the cards                            | `#F3F1ED` | `#121110` | ink on it 15.23 / 16.59. ink2 on it 5.20 / 7.54 |
| `card`: sheet, cards and tiles                                 | `#FFFEFC` | `#1E1C1A` | ink2 on it 5.82 / 6.79. ink on it 17.05 / 14.94 |
| `surface`: fact tiles, chips, the stepper, the segmented track | `#F1EEE9` | `#2A2724` | ink2 on it 5.07 / 5.93                          |
| `line`: separators and outlines (exempt from 1.4.11)           | `#EAE6E0` | `#34302C` | n/a                                             |
| `control`: checkbox outline                                    | `#8A847C` | `#878078` | non-text on card 3.67 / 4.36                    |
| `sigText` on card and surface                                  | `#2459E6` | `#75A0FC` | 5.71 and 4.98 / 6.63 and 5.79                   |
| Current-step border (`sig` on `sigTint`)                       | `#2863FB` | `#75A0FC` | non-text 4.30 / 5.48                            |

**The signature color can be swapped.** The color lives in one place, the `data-sig` attribute on `<body>`. Set it to
`cobalt` (the default), `jade` or `paprika`, and every role changes together in both themes. That is the shape the
design-system token needs: one semantic set (`sig`, `sigLabel`, `sigTint`, `sigText`) with one value set per theme.

## Layout of the recipe screen, top to bottom

1. **Hero photo** (340 px), under the status bar, with the quiet controls from round 2.
2. **Recipe sheet** (card, top corners 24 px, overlapping the photo by 24 px). It holds the eyebrow, the title, the
   byline (`Public · From a family recipe card`), the `Earlier versions` chip, three fact tiles, the `Edit recipe`
   button, two lines of description with `Read more`, and the tags as chips.
3. **Ratings from other cooks**: one card row with the stars, `4.8 · 12 ratings`, `Read 8 comments` and a chevron.
   The whole row is one tap target, and the note sits under it.
4. **Nutrition (per serving)**: four tiles with the source note under them.
5. **Section switch**: the segmented control and the keep-awake button, with the helper line under them.
6. **Ingredients card**: the title with `for 4`, an `Edit` chip and the servings stepper. The two groups follow as an
   inset list, with separators that start after the checkbox.
7. **Steps**: one card per step. Done steps are outlined, muted and folded to two lines. The current step has the tint,
   a 1.5 px signature border, a filled number and `You're here`. Timers are pills.
8. **Tab bar**.

**Scrolled state.** Once the title passes under the status bar, the top bar fades in over 160 ms. It holds Back, the
dish name (Manrope 17, one line with an ellipsis) and More, on the bar material. The segmented control then sticks
under it. Under reduced motion the bar appears at once. One string is new: `Servings` labels the stepper, which
before had only an accessible name.

## Need records by section

These are unchanged from round 2 and round 3, with two additions. The sticky segmented control serves FR-001 (get to
the recipe and the current step fast). The top bar with the dish name serves CK-008 (keep my place).

## Checked, and not checked

**Checked:**

- Rendered with Playwright at 2×. Inter and Manrope were both checked as loaded with `document.fonts.check`.
- All six screens are 390 px wide, with no overflow.
- Each screen uses 13, 15 and 17 px plus one title, and weights 400 to 600 only.
- Contrast computed for every new pair above.
- Round 4 compared side by side with round 3 and with Airbnb, Mela and Things 3 at the same phone width.
- The swap was rendered with all three signature sets.

**Not checked:**

- A real device, real Dynamic Type, and a fresh large-text pass. The tile rows (three facts, four nutrition values)
  need the reflow rules in `../round2/spec.md`.
- The motion of the top bar and the sticky switch. They are a spec only.
- The Back and More buttons over real user photos.
