# Pilot round 5: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder. It shows the same six screens as round 4, at 390 px: `homeLight`, `homeDark`, `recipeLight`, `recipeDark`,
`recipeScrolled` and `recipeScrolledDark`.

**Scope.** Round 5 changes only the color system. The structure, controls, type, photos, voice and motion are those of
round 4 (`../round4/spec.md`), and the "App, not article" rule there still holds. Content ideas are in
`proposals.md`.

The owner said of round 4: "I like it, but the blue seems out of place. Something more relaxing and subtle. I think
we can add a little more color to the app too." Round 5 makes two changes. A calm signature color replaces cobalt,
and a small family of soft tints brings color to the neutral parts.

## How the calm signature works

Cobalt was a dark, saturated fill with a white label. A calm color cannot work that way, because a muted color dark
enough for a white label turns muddy. So the signature is now a **soft, mid-light fill with a deep label in the same
hue**. The color stays visible, and nothing on the screen shouts. Each candidate has five tokens, made in OKLCH from
one hue and one chroma.

| Token      | Job                                                                                                   | How it is made                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `sig`      | The fill for the main action (FAB), the selected segment, the checked box and the current-step number | Lightness 0.76 (light) and 0.74 (dark), with low chroma                             |
| `sigLabel` | Text and ticks on `sig`                                                                               | The same hue at lightness 0.27 in light mode. Near-black ground color in dark mode. |
| `sigText`  | Signature color as text: the active tab, `You're here`, the done tick and the timer icon              | The same hue at lightness 0.47 (light) and 0.80 (dark)                              |
| `sigTint`  | The current-step block                                                                                | Lightness 0.94 (light) and 0.30 (dark)                                              |
| `sigLine`  | The current-step border                                                                               | Lightness 0.62                                                                      |

The three jobs are the same as before: the main action, the current step and the selected state.

## The tint family

Each candidate has four soft tints (`t1` to `t4`). Each tint has a matching icon ink (`t1i` to `t4i`), and all of
them have light and dark versions. `t1` is the signature hue. `t2` and `t3` are its neighbours on the cool side. `t4` is a warm oat
neutral with very low chroma. **The tints carry no meaning.** They only add calm color where the screen was grey.

| Where                                          | Tint                                                                             | Note                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact tiles: Total, Prep, Difficulty            | `t1`, `t2`, `t3`, with a matching icon ink                                       | These tiles show times, so they only ever get **cool** tints. For clay, whose `t1` is warm, the mapping switches to cool tints (`--fact1` to `--fact3` in the CSS). |
| Nutrition tiles: Calories, Protein, Carbs, Fat | `t1`, `t2`, `t3`, `t4`                                                           | One soft tint each, so the four read as separate values at a glance.                                                                                                |
| Tag chips                                      | `t4` (oat)                                                                       | A warm neutral. Tags are not times, temperatures or allergens.                                                                                                      |
| No-photo tile                                  | A gradient from `t1` to `t4`, with the icon in `t1i`                             | It looks intended and calm, and never like a loading state.                                                                                                         |
| Coming next rows                               | A 32 px rounded square in `t1`, `t2` and `t3`, with the icon in the matching ink | The only color on the Home lower half besides the FAB.                                                                                                              |
| The `You're here` step                         | `sigTint` with a 1.5 px `sigLine` border                                         | This is a signature job, so it uses the signature tokens, not the tint family.                                                                                      |

**Rules for the tints.**

- No red, orange or yellow tint goes near a time, a temperature or an allergen.
- No tint carries meaning on its own, and no state depends on telling two tints apart.
- Reading surfaces stay neutral: the recipe sheet, the ingredients card, the step cards and the rating row.
- Only the signature color's three jobs get a fill stronger than a tint.

## Three candidates, side by side

I rendered all six screens three times, once for each candidate, in both themes. Then I compared the Home lower half,
the recipe sheet with its tiles, and the steps.

| Candidate                         | Hue (OKLCH) | Light `sig` | Dark `sig` | Beside the food and the warm base                                                                                                                 | The current step                                                                                                                                                                       | Verdict         |
| --------------------------------- | ----------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Eucalyptus** (dusty blue-green) | 190         | `#8DBCB8`   | `#84B6B2`  | Fresh and quiet. It is a soft opposite of the golden food, so the FAB and the selected tab are still easy to find. It sits well on the warm base. | A clear, cool aqua block, and a deep-teal block in dark mode. It reads as "here", calmly.                                                                                              | **Chosen.**     |
| Sage                              | 145         | `#9CBB9C`   | `#95B595`  | Very calm, but close to the herb green already in the photos (thyme, rosemary, chives), so the main action blends with the food. Slightly greyer. | A pale green block. Pleasant, but less distinct.                                                                                                                                       | A close second. |
| Clay (muted apricot)              | 45          | `#D8A48C`   | `#D39D84`  | Cozy, but it has the same hue as roast chicken, focaccia and pancakes, so the FAB disappears among the photos.                                    | A peach block in light mode and a brown block in dark mode. Brown is the least liked hue in the research (perception rule 12), and a warm block mid-cook sits close to warning colors. | Rejected.       |

**Why eucalyptus.** It is the only candidate that is calm, clearly a color, and still distinct from the food. It
harmonizes with the warm base, because the cool and warm hues balance each other. Its tint family (aqua, mint and
sky, plus oat) gives the "little more color" the owner asked for without any warm tint near a time. Dark mode gets its
own tuned version (`#84B6B2` with a near-black label), not a dimmed copy.

**Swapping.** The color lives in one place, the `data-sig` attribute on `<body>`. Set it to `eucalyptus` (the
default), `sage` or `clay`. Each value sets the signature and its four tints in both themes.

## Contrast: every text pair, eucalyptus, both themes

Ratios are WCAG 2.x. Thresholds come from the corpus `accessibility.md`: 4.5:1 for text (SC 1.4.3) and 3:1 for
non-text (SC 1.4.11). The neutral pairs (ink and ink2 on ground, card and surface) are unchanged from round 4 and
listed there. All 35 checked pairs pass for all three candidates. The lowest text pair is 4.90 (eucalyptus), 4.90
(sage) and 4.88 (clay).

| Theme | Pair                                                        | Colors                                                     | Ratio                         | Needs |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- | ----- |
| light | `sigLabel` on `sig` (FAB, selected segment, current number) | `#022D2B` on `#8DBCB8`                                     | 7.09                          | 4.5   |
| light | `sigText` on card (active tab, `You're here`)               | `#326562` on `#FFFEFC`                                     | 6.57                          | 4.5   |
| light | `sigText` on ground (tab bar)                               | `#326562` on `#F3F1ED`                                     | 5.87                          | 4.5   |
| light | `sigText` on surface (timer icon, done tick)                | `#326562` on `#F1EEE9`                                     | 5.72                          | 3     |
| light | `sigText` on `sigTint`                                      | `#326562` on `#D6F2EF`                                     | 5.61                          | 4.5   |
| light | ink on `sigTint` (current-step text)                        | `#1D1B18` on `#D6F2EF`                                     | 14.57                         | 4.5   |
| light | `sigLine` on `sigTint` (current-step border)                | `#62908D` on `#D6F2EF`                                     | 3.02                          | 3     |
| light | ink2 on `t1` / `t2` / `t3` / `t4` (tile labels, tags)       | `#69645D` on `#D5F2F0` / `#DAF2E4` / `#D6F0FB` / `#F5E9DA` | 4.97 / 4.97 / 4.95 / 4.90     | 4.5   |
| light | ink on `t1` / `t2` / `t3` / `t4` (tile values)              | `#1D1B18` on the same                                      | 14.55 / 14.57 / 14.50 / 14.36 | 4.5   |
| light | icon ink on its tint (`t1i` to `t4i`)                       | `#3B6D6A`, `#476D58`, `#3F6A7B`, `#6E6150`                 | 4.97 / 4.95 / 4.98 / 5.03     | 3     |
| dark  | `sigLabel` on `sig`                                         | `#121110` on `#84B6B2`                                     | 8.37                          | 4.5   |
| dark  | `sigText` on card                                           | `#99C9C5` on `#1E1C1A`                                     | 9.31                          | 4.5   |
| dark  | `sigText` on ground                                         | `#99C9C5` on `#121110`                                     | 10.34                         | 4.5   |
| dark  | `sigText` on surface                                        | `#99C9C5` on `#2A2724`                                     | 8.14                          | 3     |
| dark  | `sigText` on `sigTint`                                      | `#99C9C5` on `#1D3231`                                     | 7.42                          | 4.5   |
| dark  | ink on `sigTint`                                            | `#F3F0EB` on `#1D3231`                                     | 11.90                         | 4.5   |
| dark  | `sigLine` on `sigTint`                                      | `#62908D` on `#1D3231`                                     | 3.80                          | 3     |
| dark  | ink2 on `t1` / `t2` / `t3` / `t4`                           | `#A9A39A` on `#162F2D` / `#1C2F25` / `#182D36` / `#2E2923` | 5.68 / 5.66 / 5.72 / 5.76     | 4.5   |
| dark  | ink on `t1` / `t2` / `t3` / `t4`                            | `#F3F0EB` on the same                                      | 12.49 / 12.46 / 12.59 / 12.67 | 4.5   |
| dark  | icon ink on its tint                                        | `#99C9C5`, `#A3C8B3`, `#9CC5D6`, `#C9BBA9`                 | 7.79 / 7.74 / 7.75 / 7.66     | 3     |

**One known weak point.** In light mode the selected segment's fill against its track is only 1.81:1. The selected
state is also shown by its label, which is deep teal at 7.09:1, against a grey label on the other segments. This
matches the system segmented controls on iOS. A stricter build can add a 1 px `sigLine` outline to the selected
segment. In dark mode the fill is 7.54:1 against the card.

## Checked, and not checked

**Checked:**

- All six screens rendered with Playwright at 2×, for all three candidates. Inter and Manrope were both checked as
  loaded.
- Each screen is 390 px wide, with no overflow.
- Each screen uses 13, 15 and 17 px plus one title, and weights 400 to 600 only.
- Contrast computed for every pair above, for all three candidates.
- Round 5 compared side by side with round 4 and with Airbnb, Mela and Things 3 at the same phone width.

**Not checked:**

- A real device, and how the soft fill looks in bright kitchen light.
- Real Dynamic Type sizes, and a fresh large-text pass.
- The colors under color-blindness simulation.
