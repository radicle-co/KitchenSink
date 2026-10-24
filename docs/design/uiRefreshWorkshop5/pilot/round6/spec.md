# Pilot round 6: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder. It shows the same six screens as rounds 4 and 5, at 390 px: `homeLight`, `homeDark`, `recipeLight`,
`recipeDark`, `recipeScrolled` and `recipeScrolledDark`.

**Scope.** Round 6 changes only the colors. The structure, controls, type, photos, voice and motion are those of round
4 (`../round4/spec.md`). The color roles are those of round 5 (`../round5/spec.md`). Content ideas are in
`proposals.md`.

## The brief for the palette

The owner's favorite color is "blue like the ocean after a storm". The owner rejected round 5's teal and round 3's
bright cobalt. So the blue must be deep, cool, a little grey and calm, and never electric. The scene gives the
palette:

- **Deep notes.** Slate, steel and dark sea water. These give the signature blue and the dark mode.
- **Light notes.** Mist, a pale clearing sky and sea foam (a blue-grey white, not green). These give the cool tints.
- **One warm note.** Wet sand and driftwood. These keep the screens from going cold beside the warm food.

Every hue was made in OKLCH. The blues sit between hue 246 and 262, well away from teal, which sits near 190 to 200.
Their chroma is low: 0.055 to 0.075, against cobalt's 0.23.

## Three storm blues, side by side

I rendered all six screens for each blue, on both light bases, and in dark mode. Then I compared the Home lower half,
the recipe sheet with its tiles, and the steps. The signature is deep enough to carry **white text** in light mode.
In dark mode it becomes a light blue with a dark label.

| Variant   | Hue | Light `sig` | Dark `sig` | Read in the renders                                                                                                                                                                        | Verdict                                                                                       |
| --------- | --- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Slate** | 255 | `#425C7F`   | `#A0BADB`  | It is clearly blue, and grey enough to feel like a stormy sky. It holds well beside golden food, and the FAB, the selected tab and the current step are easy to find without looking loud. | **Chosen.**                                                                                   |
| Steel     | 246 | `#325C7F`   | `#96BCDE`  | A little brighter and leans toward sea water. It is lively, but it is the closest of the three to the teal the owner rejected.                                                             | A close second.                                                                               |
| Grey-navy | 262 | `#2D3D5A`   | `#A7B8D6`  | The moodiest. At FAB and number size it reads as near-black, so the three jobs lose their color, and the screen looks heavier.                                                             | Rejected for light mode. Its dark-mode blue is lovely, but the system needs one hue for both. |

**Why slate.** It is the one variant that is clearly a blue, clearly calm and clearly "after a storm", in both themes.
It has room both ways: a cook can find the main action at a glance, and nothing on the screen shouts.

## The base: warm or cool

I tested both light bases with each blue. Each is one attribute (`data-base` on `<body>`).

| Base                 | Ground / card / surface           | Read in the renders                                                                                                                                                                            | Verdict       |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Warm (rounds 2 to 5) | `#F3F1ED` / `#FFFEFC` / `#F1EEE9` | Soft and homely, but the warm grey sits between the blue and the food and muddies both a little.                                                                                               | The fallback. |
| **Cool**             | `#EFF3F6` / `#FCFDFF` / `#E9EDF2` | It belongs to the scene: a misty morning after the storm. The blue sits in it naturally, and the warm food stands out more against it. The sand and driftwood tints keep it from feeling cold. | **Chosen.**   |

The ink moves with the base. On the cool base, ink is `#171B20` and ink2 is `#5C646E`. Both are slightly blue, so the
text belongs to the same light.

## Dark mode: the sea at dusk

Dark mode is no longer warm grey-black. Its surfaces are deep blue-charcoal: ground `#0E161E`, card `#172029` and
surface `#212B36`, each one step lighter. Ink is `#EBEFF2` and ink2 is `#A3ACB6`. The signature becomes a light,
misty slate (`#A0BADB`) with a near-black label. The current step is a deep sea-blue block (`#23344A`) with a light
slate border.

## The tint family

There are five tints per variant, each with an icon ink, in light and dark versions. **The tints carry no meaning.**

| Tint | Scene                      | Light     | Dark      | Used for                                                                                            |
| ---- | -------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------- |
| `t1` | Mist                       | `#E1EDFA` | `#202B37` | The Total fact tile, the Calories tile, the first Coming next icon                                  |
| `t2` | Pale clearing sky          | `#DDEEFC` | `#1C2C38` | The Prep fact tile, the Protein tile, the second Coming next icon, and the top of the no-photo tile |
| `t3` | Sea foam (blue-grey white) | `#E4EDF2` | `#232B30` | The Difficulty fact tile and the Carbs tile                                                         |
| `t4` | Wet sand                   | `#F7E9D7` | `#342817` | The Fat tile, the tag chips, and the bottom of the no-photo tile                                    |
| `t5` | Driftwood                  | `#F5E9DF` | `#32281F` | The third Coming next icon                                                                          |

Rules carried from round 5:

- The fact tiles show times, so they only get cool tints (mist, sky and foam). Sand and driftwood never sit next to a
  time, a temperature or an allergen.
- No state depends on telling two tints apart.
- Reading surfaces stay neutral: the recipe sheet, the ingredients card, the step cards and the rating row.
- Only the signature's three jobs get a strong fill.

## Round 5's faint selected tab: fixed

In round 5 the selected segment was a soft fill on a pale track, at 1.81:1. The slate fill is now deep, with a white
label. In light mode it is **5.82:1** against the track. In dark mode it is **8.27:1** against the card. So the selected
state passes SC 1.4.11 on the fill alone.

## Contrast: every pair, slate on the cool base and at dusk

Ratios are WCAG 2.x. Thresholds come from the corpus `accessibility.md`: 4.5:1 for text (SC 1.4.3) and 3:1 for
non-text (SC 1.4.11). There are 60 pairs, and all of them pass. The other variants and the warm base were checked the
same way, and all of them pass too. The lowest text pair on the cool base is 5.02, and on the warm base it is 4.91.

| Theme | Pair                                                   | Colors                 | Ratio | Needs |
| ----- | ------------------------------------------------------ | ---------------------- | ----- | ----- |
| light | white on `sig` (FAB, selected segment, current number) | `#FFFFFF` on `#425C7F` | 6.84  | 4.5   |
| light | `sig` against the segment track (selected state)       | `#425C7F` on `#E9EDF2` | 5.82  | 3     |
| light | `sigText` on card                                      | `#425C7F` on `#FCFDFF` | 6.72  | 4.5   |
| light | `sigText` on ground                                    | `#425C7F` on `#EFF3F6` | 6.13  | 4.5   |
| light | `sigText` on surface                                   | `#425C7F` on `#E9EDF2` | 5.82  | 4.5   |
| light | `sigText` on `sigTint`                                 | `#425C7F` on `#E6EEF8` | 5.85  | 4.5   |
| light | ink on `sigTint`                                       | `#171B20` on `#E6EEF8` | 14.78 | 4.5   |
| light | `sigLine` on `sigTint` (non-text)                      | `#425C7F` on `#E6EEF8` | 5.85  | 3     |
| light | ink on ground                                          | `#171B20` on `#EFF3F6` | 15.5  | 4.5   |
| light | ink2 on ground                                         | `#5C646E` on `#EFF3F6` | 5.37  | 4.5   |
| light | ink on card                                            | `#171B20` on `#FCFDFF` | 17.0  | 4.5   |
| light | ink2 on card                                           | `#5C646E` on `#FCFDFF` | 5.89  | 4.5   |
| light | ink on surface                                         | `#171B20` on `#E9EDF2` | 14.71 | 4.5   |
| light | ink2 on surface                                        | `#5C646E` on `#E9EDF2` | 5.1   | 4.5   |
| light | control on card (checkbox, non-text)                   | `#80878F` on `#FCFDFF` | 3.57  | 3     |
| light | ink on t1                                              | `#171B20` on `#E1EDFA` | 14.58 | 4.5   |
| light | ink2 on t1                                             | `#5C646E` on `#E1EDFA` | 5.05  | 4.5   |
| light | t1i icon on t1 (non-text)                              | `#466688` on `#E1EDFA` | 5.03  | 3     |
| light | ink on t2                                              | `#171B20` on `#DDEEFC` | 14.59 | 4.5   |
| light | ink2 on t2                                             | `#5C646E` on `#DDEEFC` | 5.06  | 4.5   |
| light | t2i icon on t2 (non-text)                              | `#37688C` on `#DDEEFC` | 5.03  | 3     |
| light | ink on t3                                              | `#171B20` on `#E4EDF2` | 14.57 | 4.5   |
| light | ink2 on t3                                             | `#5C646E` on `#E4EDF2` | 5.05  | 4.5   |
| light | t3i icon on t3 (non-text)                              | `#4F6775` on `#E4EDF2` | 5.01  | 3     |
| light | ink on t4                                              | `#171B20` on `#F7E9D7` | 14.49 | 4.5   |
| light | ink2 on t4                                             | `#5C646E` on `#F7E9D7` | 5.02  | 4.5   |
| light | t4i icon on t4 (non-text)                              | `#7C5D31` on `#F7E9D7` | 5.07  | 3     |
| light | ink on t5                                              | `#171B20` on `#F5E9DF` | 14.5  | 4.5   |
| light | ink2 on t5                                             | `#5C646E` on `#F5E9DF` | 5.03  | 4.5   |
| light | t5i icon on t5 (non-text)                              | `#775D48` on `#F5E9DF` | 5.11  | 3     |
| dark  | label on `sig`                                         | `#0E161E` on `#A0BADB` | 9.15  | 4.5   |
| dark  | `sig` against the segment track (card, non-text)       | `#A0BADB` on `#172029` | 8.27  | 3     |
| dark  | `sigText` on card                                      | `#A0BADB` on `#172029` | 8.27  | 4.5   |
| dark  | `sigText` on ground                                    | `#A0BADB` on `#0E161E` | 9.15  | 4.5   |
| dark  | `sigText` on surface                                   | `#A0BADB` on `#212B36` | 7.2   | 4.5   |
| dark  | `sigText` on `sigTint`                                 | `#A0BADB` on `#23344A` | 6.34  | 4.5   |
| dark  | ink on `sigTint`                                       | `#EBEFF2` on `#23344A` | 10.93 | 4.5   |
| dark  | `sigLine` on `sigTint` (non-text)                      | `#A0BADB` on `#23344A` | 6.34  | 3     |
| dark  | ink on ground                                          | `#EBEFF2` on `#0E161E` | 15.76 | 4.5   |
| dark  | ink2 on ground                                         | `#A3ACB6` on `#0E161E` | 7.93  | 4.5   |
| dark  | ink on card                                            | `#EBEFF2` on `#172029` | 14.24 | 4.5   |
| dark  | ink2 on card                                           | `#A3ACB6` on `#172029` | 7.16  | 4.5   |
| dark  | ink on surface                                         | `#EBEFF2` on `#212B36` | 12.41 | 4.5   |
| dark  | ink2 on surface                                        | `#A3ACB6` on `#212B36` | 6.24  | 4.5   |
| dark  | control on card (non-text)                             | `#7D8792` on `#172029` | 4.51  | 3     |
| dark  | ink on t1                                              | `#EBEFF2` on `#202B37` | 12.42 | 4.5   |
| dark  | ink2 on t1                                             | `#A3ACB6` on `#202B37` | 6.25  | 4.5   |
| dark  | t1i icon on t1 (non-text)                              | `#ADC7E3` on `#202B37` | 8.25  | 3     |
| dark  | ink on t2                                              | `#EBEFF2` on `#1C2C38` | 12.38 | 4.5   |
| dark  | ink2 on t2                                             | `#A3ACB6` on `#1C2C38` | 6.23  | 4.5   |
| dark  | t2i icon on t2 (non-text)                              | `#A4C9E7` on `#1C2C38` | 8.24  | 3     |
| dark  | ink on t3                                              | `#EBEFF2` on `#232B30` | 12.44 | 4.5   |
| dark  | ink2 on t3                                             | `#A3ACB6` on `#232B30` | 6.26  | 4.5   |
| dark  | t3i icon on t3 (non-text)                              | `#B4C7D3` on `#232B30` | 8.26  | 3     |
| dark  | ink on t4                                              | `#EBEFF2` on `#342817` | 12.42 | 4.5   |
| dark  | ink2 on t4                                             | `#A3ACB6` on `#342817` | 6.25  | 4.5   |
| dark  | t4i icon on t4 (non-text)                              | `#DCBF98` on `#342817` | 8.17  | 3     |
| dark  | ink on t5                                              | `#EBEFF2` on `#32281F` | 12.45 | 4.5   |
| dark  | ink2 on t5                                             | `#A3ACB6` on `#32281F` | 6.26  | 4.5   |
| dark  | t5i icon on t5 (non-text)                              | `#D8BFAB` on `#32281F` | 8.2   | 3     |

## Swapping

- `data-sig` on `<body>` takes `slate` (the default), `steel` or `navy`. Each value sets the blue, its tint and border,
  and the five tints, in both themes.
- `data-base` on `<body>` takes `cool` (the default) or `warm`. It sets the light ground, card, surface, ink, ink2,
  line and control colors.
- Dark mode is always the dusk palette.

## Checked, and not checked

**Checked:**

- All six screens rendered with Playwright at 2×, for each blue on both bases, and in dark mode. Inter and Manrope
  were both checked as loaded.
- Each screen is 390 px wide, with no overflow, and has exactly one title.
- Contrast computed for 60 pairs for each blue on each base.
- Round 6 compared side by side with round 5 and with Airbnb, Mela and Things 3 at the same phone width.

**Not checked:**

- A real device, and how the cool base looks under warm kitchen light.
- Real Dynamic Type sizes, and a fresh large-text pass.
- The colors under color-blindness simulation.
