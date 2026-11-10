# Option 3: Enamelware (final)

Designer 3. Mockup: [`option3.html`](option3.html) (one file, about 48 KB, checked at 390 px with no horizontal
scroll).

## The idea

Every recipe sits on its own glossy enamel plate. The cobalt rim around the plate is the same cobalt as the one
button you press. By day the table is pale enamel. By night it is deep blue graniteware. Everything you touch is a
plain list, a plain button or the usual tabs.

The new thing is in the look: one real object (an enamel plate) gives the app its colours, its frame and its brand.
How the app works does not change.

## What changed from the draft

| Feedback                                                                                                                | What I did                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The look needs overhead photos, which cooks do not take (critique 2)                                                    | **The rim is the frame, not the camera angle.** Any photo is cropped round inside the cobalt rim. So a photo taken at an angle still sits on the table. The detail page shows an angled photo of the roast.                                                                                 |
| Fallback art chosen by cuisine makes every Italian recipe look the same, and shows a dish that is not the cook's (both) | **Monogram plate.** A recipe with no photo gets a plate in one of six glaze colours, picked from its id. Its first letter sits in the middle. There is no made-up dish and no art library, and it reads at 38 px. I did not use option 2's cut-outs, so the options stay different.         |
| "Screen on" and "Mark step as current" were missing (critique 2)                                                        | Both are back as visible controls. "Screen on" is a labelled switch under Edit recipe. Each step has a numbered round button. The current step's number is filled cobalt, and the step says "Current step" in words.                                                                        |
| Other content had also dropped out                                                                                      | All of it is back. Home has its greeting, the date and all three Coming soon rows. My recipes has the search field and the quick filters. The recipe has the rating block, the source, Version history, More, the tags, Nutrition, both edit buttons, every ingredient and the step timers. |
| Steam loops forever (critique 1)                                                                                        | Gone. Each plate settles once on load, and nothing loops.                                                                                                                                                                                                                                   |
| Blue ground is cold, and reads as a camping mug or Delftware (both)                                                     | The light ground is now a much paler enamel (`#E8EDF5`), with no speckles, chips or pattern. Enamel shows through gloss and one crisp rim.                                                                                                                                                  |
| The hob glow                                                                                                            | Cut. "One warm pool of light" is option 1's idea, and the alpha colour had no real role. Dark mode is now navy graniteware, the other classic enamel colour.                                                                                                                                |
| Palette pairs (critique 2)                                                                                              | The light star has a dark outline. "Soon" is an outlined tag, not Yolk. The avatar has a dark ring. Dark warning moved away from Yolk. The focus ring is Ink, not Cobalt. A "must not be confused" table is below.                                                                          |
| Cobalt did five jobs (critique 1)                                                                                       | Focus moved to Ink. Cobalt now means "act here or this is chosen": the primary action, links and selected state, plus the plate rim. The current step uses a pale Cobalt wash.                                                                                                              |

## Why it is simple

- **Nothing new to learn.** There are five tabs with icons and words. Every screen is one column that scrolls. Lists
  are lists, checkboxes are checkboxes, the stepper says − and +, and the switch is a switch.
- **One obvious action per screen**, always the single cobalt pill: **New recipe** on Home and My recipes, and
  **Edit recipe** on a recipe.
- **Status is always a word**, never colour alone. Private and Draft are outlined tags with an icon. Soon is the same
  outlined tag. Public is a meta line with a globe icon.
- **The picture is the only decoration.** Plates are pictures. You do not turn, size or read them.

### Screen by screen

- **Home.** "Good morning, Eliza Ramirez" with "Friday, October 16, 2026" and the avatar. "Recent recipes" and
  "See all". The latest recipe sits large on the table with its name and "American · 35 min", and the other three
  follow as list rows. "Roast tomato soup" is a Draft with no photo, so it wears a monogram plate. "Coming soon" keeps
  its line and three rows (Today's nutrition, Resume cooking, This week's meals), each with a "Soon" tag.
- **My recipes.** "Recipes", the My recipes / Collections switch, "Search your recipes", and the quick filters
  (All, Under 30 min 2, American 3…). Then "9 recipes · Recently edited", the list and grid toggle, and the list.
  Each row starts with its plate, and long names wrap to two lines.
- **Recipe detail.** The cook's photo sits round in its plate on the table, with a Back button. A white sheet holds
  the rest, in the app's order:
    - British, the title, Public, `Source: Family recipe card` and Version history
    - Community rating, `4.8 · 12 ratings`, `You can't rate your own recipe.` and 8 comments
    - Total, Prep and Difficulty
    - **Edit recipe**, then the Screen on switch
    - the description with More, the tags, and `Nutrition · 612 cal per serving`
    - Ingredients, with `− for 4 +` and the two groups as checklists
    - Steps, with numbered buttons and timers
- **Discover, Collections and the editor** use the same parts. The plate is the thumbnail, rows are rows, and the
  editor is a white sheet with the photo slot at the top.

## The palette: Enamelware

**The logic.** The palette is one enamel plate on its table, and the button you press wears the plate's cobalt rim.
The food brings the warm colours, so the interface stays cool and quiet.

| Name                 | Role                                                               | Light     | Dark       |
| -------------------- | ------------------------------------------------------------------ | --------- | ---------- |
| Enamel / Graniteware | ground                                                             | `#E8EDF5` | `#0C1424`  |
| Plate / Stoneware    | surface: lists, sheets, tab bar                                    | `#FFFFFF` | `#172037`  |
| Seam                 | hairline that separates surface from ground (decoration)           | `#D3DBE8` | `#2A3550`  |
| Well                 | inset: fact strip, Screen on row                                   | `#F1F4F9` | `#222C46`  |
| Ink                  | text, and the focus ring                                           | `#0E1A2E` | `#EEF2FA`  |
| Slate                | muted text                                                         | `#475468` | `#A8B3CA`  |
| Cobalt rim           | primary action, links, selected control, plate rim                 | `#0B4DBE` | `#80B0FF`  |
| On cobalt            | label on primary                                                   | `#FFFFFF` | `#0C1424`  |
| Cobalt wash          | current step background                                            | `#E3ECFB` | `#1D2B4D`  |
| Yolk                 | accent: avatar and star fill only                                  | `#F2B233` | `#FFD34E`  |
| Yolk deep            | outline of the light star and the avatar                           | `#7A4E00` | not needed |
| On yolk              | initials on the avatar                                             | `#1B1405` | `#1B1405`  |
| Herb                 | success: ticked ingredient                                         | `#1B6E41` | `#66D69A`  |
| Amber                | warning                                                            | `#8F4A00` | `#FF9B52`  |
| Tomato               | danger                                                             | `#B3261E` | `#FF8A94`  |
| Edge                 | control outlines: fields, chips, tags, checkboxes, switch, stepper | `#6E7A90` | `#7684A4`  |

Plate art (not UI meaning):

- The plate is `#FFFFFF` in light and `#2C3754` in dark.
- There are six monogram glazes, given as fill and letter: Delft `#D9E2F2`/`#2A4A85`, Celadon `#CFE3D3`/`#2D5B3A`,
  Paprika `#F6D2C4`/`#8E2F17`, Mustard `#F5E1A6`/`#6E4D00`, Heather `#E2D5EE`/`#5B3A7A` and Lagoon
  `#CDE7EA`/`#1F5C66`.
- The letter on its glaze is 5.8 to 6.7 : 1.

### Contrast (WCAG 2.2, computed from the hex values)

| Pair                                                  | Light              | Dark               | Needs |
| ----------------------------------------------------- | ------------------ | ------------------ | ----- |
| Ink on ground                                         | 14.81              | 16.40              | 4.5   |
| Ink on surface                                        | 17.41              | 14.42              | 4.5   |
| Ink on well                                           | 15.80              | 12.34              | 4.5   |
| Ink on cobalt wash                                    | 14.64              | 12.44              | 4.5   |
| Slate on ground                                       | 6.53               | 8.73               | 4.5   |
| Slate on surface                                      | 7.68               | 7.68               | 4.5   |
| Slate on well                                         | 6.96               | 6.57               | 4.5   |
| Slate on cobalt wash                                  | 6.45               | 6.62               | 4.5   |
| Label on cobalt (primary button, selected chip)       | 7.45               | 8.39               | 4.5   |
| Cobalt as link text on ground                         | 6.34               | 8.39               | 4.5   |
| Cobalt as link text on surface                        | 7.45               | 7.37               | 4.5   |
| Cobalt "Current step" on cobalt wash                  | 6.26               | 6.36               | 4.5   |
| Cobalt button against ground (non-text)               | 6.34               | 8.39               | 3.0   |
| Initials on Yolk (avatar)                             | 9.74               | 12.78              | 4.5   |
| Herb on ground / surface                              | 5.33 / 6.26        | 10.21 / 8.97       | 4.5   |
| Amber on ground / surface                             | 5.68 / 6.67        | 8.82 / 7.75        | 4.5   |
| Tomato on ground / surface                            | 5.56 / 6.54        | 8.16 / 7.18        | 4.5   |
| Edge on ground / surface / wash (non-text)            | 3.68 / 4.33 / 3.64 | 4.91 / 4.32 / 3.73 | 3.0   |
| Switch: Edge outline on well (off)                    | 3.93               | 3.70               | 3.0   |
| Switch: Cobalt track on well (on)                     | 6.76               | 6.31               | 3.0   |
| Star: Yolk deep outline on ground / surface (light)   | 6.12 / 7.20        | none               | 3.0   |
| Star: Yolk fill on ground / surface (dark)            | none               | 12.86 / 11.31      | 3.0   |
| Avatar ring (Yolk deep) on ground                     | 6.12               | Yolk fill 12.86    | 3.0   |
| Focus ring (Ink) on the ground behind its 2 px offset | 14.81              | 16.40              | 3.0   |
| Plate rim (Cobalt) on its plate                       | 7.45               | 5.37               | 3.0   |

Surface on ground is only 1.18 (light) and 1.14 (dark), so every list and sheet also carries a Seam line. The
surface never relies on its fill alone.

### Must not be confused

| Pair             | Light         | Dark | What tells them apart                                                                   |
| ---------------- | ------------- | ---- | --------------------------------------------------------------------------------------- |
| Cobalt vs Tomato | 1.14          | 1.03 | Blue vs red. Danger always says "Delete" with an icon.                                  |
| Amber vs Tomato  | 1.02          | 1.08 | Orange-brown vs red, plus a warning or error icon and a word.                           |
| Yolk vs Amber    | 3.56          | 1.46 | Yolk is only a fill (avatar, star) and never a status. Amber is only text with an icon. |
| Star vs Amber    | outlined fill | 1.46 | The star is a shape next to a number. Amber is never a star.                            |

Cobalt sits at hue 218°, which is clear of option 2's Blueberry (234°).

## Type

- **Bricolage Grotesque** 800 for screen and recipe titles (32 px and 30 px), and 700 for section heads (20 px). It is
  warm and a little hand-cut. It is narrow, so the longest real titles take two lines at 390 px.
- **Figtree** 400 to 700 for reading: 16 px body, 14 px meta, 12 px tags. Amounts and times use tabular numbers.

## Motion

- Each plate settles once on load: 0.7 s, from 8 px above and 3% larger.
- A tick draws in 0.15 s, and the switch slides in 0.2 s.
- Nothing loops, and nothing moves while you read.
- Under `prefers-reduced-motion`, all of it is off. Nothing depends on motion.

## Open risks

- **Photo crop.** A round crop loses the corners of a wide photo. The crop needs a focus point, centred by default
  and movable in the editor. That is a normal crop control, not a new idea.
- **Monogram glaze.** The glaze is picked from the recipe id, so two similar recipes can share a colour. That is fine,
  because the letters differ, but the rule has to be stable across devices.
- **"Screen on".** This is the app's own label. Critique 1 found "Keep screen awake" clearer. I kept the label and
  added the sub-line "Keeps the screen awake while you cook". A rename is a copy decision for the owner.
- **Retro risk.** Cobalt and white can drift toward heritage enamel. The guard is to never add speckles, chips,
  stripes or Delft patterns. The enamel lives in the gloss and the rim only.
