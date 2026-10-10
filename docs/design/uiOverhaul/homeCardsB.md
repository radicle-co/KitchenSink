# Home's recent recipes: compact or full cards above phone width (answer B)

⛔ **DESIGN ANSWER. NOT PRODUCTION CODE.** It answers one question about `buildSpec.md` §4.2 and "Settled
here" item 19. I did not read the other designer's answer.

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`.
- **The question.** The owner approved a compact 2 × 2 photo grid of recent recipes on Home, **for phones
  only**. Item 19 of the build spec uses compact cards on Home at every width. The question is which card
  tablet and wide web get: compact or full (768, 1280, 1920, and native tablet).
- **Not user evidence.** It rests on the repo's rulings, the captures, and named principles. Judgement is
  labelled.

## §1. The recommendation

**The card follows the column width, with one break at a 960 px container.**

| Container (`<main>`) | Examples                                                                                     | Home's recent recipes               | Card                                     |
| -------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| below 600            | web 320 and 390, native phone                                                                | **2 × 2**                           | **Compact** (owner ruling)               |
| 600–959              | web 768, native tablet portrait (744–834 dp), a native tablet held sideways with the sidebar | **one row of 4**                    | **Compact** ⚠️ needs the owner's yes     |
| 960 and up           | web 1280 (column 222 px), web 1920 (1440 cap, column 342 px), a wide native tablet           | **one row of 4**, exactly 4 columns | **Full grid card**, the whole CR-002 set |

So: compact where the column is too narrow to hold the CR-002 fields, and full where it is wide enough.
Item 19 is right below 960 and wrong from 960.

## §2. Why

### 2.1 CR-002 names Home explicitly

The merged-card ruling in `specs/001-commise-recipe-app/product-spec/wireframes/recipe-list.md` (line 70)
says:

- CR-002 "unifies them into one card so the shared `RecipeCard` (also the Home 'recent recipes' widget
  card) never diverges".

So Home is in the ruling's scope by name, and compact cards on Home are an **exception**. The owner
granted it for phones only. Extending it to every width departs further from an explicit ruling than the
owner approved. Item 19 itself admits this ("needs the owner's confirmation").

The default must therefore be the ruling, **wherever the space allows it**. An exception goes only where
the space forces one.

### 2.2 The space decides, which is the build spec's own rule

`buildSpec.md` §4.1 says the space the card gets picks the variant, never the device. The grid card needs
a column of about 240 px to hold its one-line rows. Home shows **up to 4** recipes (FR-046), and one
row of 4 keeps the whole widget in about one card's height.

The column per width, with the gaps in §3 (12 on phones, 16 at 600–959, 24 from 960):

| Viewport | `<main>` content | Column         | Full card fits?                                                                                                                                                          |
| -------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 390      | 358              | 2 columns, 173 | No                                                                                                                                                                       |
| 768      | 720              | 4 columns, 168 | No. Rows 3 and 4 lose most items, and the tags line is gone.                                                                                                             |
| 1280     | 960              | 4 columns, 222 | Yes. The card has 190 px inside its padding. Row 3 ("●●○ Medium · ★ 4.8 (12)") fits one line. So does row 4 ("Moroccan · 612 cal · Serves 8"), with the §4.1 drop rules. |
| 1920     | 1440 (cap)       | 4 columns, 342 | Yes, with room.                                                                                                                                                          |

These figures follow from the spec's own widths. The type widths are my estimates for Inter at 14 px,
which is judgement until the slice measures them.

**One change to the grid rule for Home only.** Home uses `grid-template-columns: repeat(4, 1fr)` from a
960 container, not the library's `repeat(auto-fill, minmax(15rem, 1fr))`. Two reasons:

- With auto-fill, a 960 container gives 3 columns. The fourth recipe drops alone to a second row, and the
  widget doubles in height.
- At 1440, auto-fill gives 5 columns, so four cards leave a fifth, empty column that reads as a missing
  card.

The library's rule stays as it is. Home's count is fixed at 4 by FR-046, and the library's is not.
That is a different fact with a different reason to change, so it is not duplicated knowledge.

### 2.3 Home's job against the library's

- **Home's job** (FR-046): "up to 4 most recently viewed or edited recipes". The cook comes back to a
  dish they already know. Recognising it by photo and title is enough. That is why a compact card is
  right where space is short.
- **The library's job:** finding and comparing among many recipes, which needs the fields: rating,
  difficulty, time, tags.
- Where there is room, the full card costs Home nothing on the first screen. At 1280 × 800, the greeting,
  the heading and one row of full cards fit, with the placeholders below. And the extra fields help
  the "what was that one?" case: two lamb recipes, told apart by time and rating. That last point is
  judgement.

### 2.4 Consistency across widths and across screens

Nielsen #4 (consistency) pulls two ways here, so I weigh them:

- **Same screen across widths:** Home switches variants once, at 960. Two variants is the minimum the
  space allows. Item 19's single variant buys sameness by going against CR-002 at every desktop width.
- **Same width across screens:** at 960 and up, Home and My recipes both show the full grid card. A
  card then means the same thing in both places, which is the reason CR-002 gives for unifying the card.
- **Accepted gap at 600–959:** Home shows compact cards, while the library shows full cards in 2
  columns. The jobs differ (§2.3), and the alternative is worse. A 2 × 2 of full cards at 720 is about
  1,000 px tall: four cards of about 500 px, two to a row. That pushes the "Coming soon" section to a
  second screen on a tablet (judgement from the card's row heights).

### 2.5 What the captures show

From `.local-sandbox/uiAudit2026-10-08/home/`:

- **1920:** four full cards sit in one row, but their heights run from about 310 to 520 px. Most rows
  hold empty grey calorie bars, and tags stack one per line. So today's full card fails because of
  **layout, not field count**. The §4.1 grid card (one-line rows, tags as text, subgrid rows, a
  `RecipeCover` in place of the grey box) fixes exactly that.
- **768:** the same four full cards at about 168 px each wrap every badge to its own line, up to 520 px
  tall. It is the narrow-column failure §2.2 predicts, and the reason the compact card is right there.

## §3. The layout per width

| Width                           | Layout                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 320 and 390 web, native phone   | H2 "Recent recipes" + "See all". A 2 × 2 grid, gap 12. Compact cards: cover 4:3 with the time chip and PRO, title truncate:2. All four on the first screen at 390 × 844. |
| 768 web, native tablet portrait | One row of 4 compact cards, gap 16, each about 168 px. The whole widget is about 220 px tall. "Coming soon" starts on the first screen.                                  |
| 1280 web                        | One row of 4 **grid** cards at 222 px, `repeat(4, 1fr)`, gap 24, subgrid rows, so all four share one height. Every CR-002 field, with the §4.1 drop order.               |
| 1920 web                        | The same, at 342 px columns in the 1440 cap. Cover about 256 px tall.                                                                                                    |
| Native tablet, sideways         | It follows its container. With the sidebar (owner decision W7) the content is about 870 dp, so compact. On a 13-inch tablet the content is above 960, so full.           |
| Fewer than 4 recipes            | The grid keeps 4 tracks at every width, so 2 recipes take half a row and never stretch.                                                                                  |
| Loading                         | Skeletons of the variant that width uses, the same count, the same sizes.                                                                                                |

## §4. What changes in the build spec

- **Item 19, reworded:** "Home uses **compact** cards below a 960 container (2 × 2 below 600, one row of
  4 from 600) and **grid** cards in a fixed `repeat(4, 1fr)` row from 960. The owner approved compact for
  phones. The 600–959 band needs the owner's confirmation, because it extends that exception. The
  fallback there is a 2 × 2 of grid cards."
- **§4.1, the compact variant's line** becomes "(Home below a 960 container. Discover results below 600)".
- **§4.2:** the 840+ sketch label stays. The Recent recipes row reads "**grid** cards, 4 columns" from 960.
- **Tests:**
    - Playwright at 1280: all four Home cards share one height, and each shows its rating.
    - Playwright at 768: one row of four compact cards.
    - A vitest test: below 960 the Home widget renders compact cards, and from 960 it renders grid cards.

## §5. The owner's call

| Decision                                                                                               | My recommendation                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Compact cards on Home from 600 to 959 px (tablets): an extension of the phone-only exception to CR-002 | **Approve.** Full cards do not fit four to a row there. A 2 × 2 of full cards pushes the rest of Home off the first screen. |
| Full grid cards on Home from 960 px                                                                    | No decision is needed. It is CR-002 as written.                                                                             |

## Sources

- **Repo:**
    - `specs/001-commise-recipe-app/product-spec/wireframes/recipe-list.md` line 70 (the CR-002 merged
      card names the Home widget)
    - `specs/001-commise-recipe-app/spec.md` FR-046 (up to 4 recent recipes)
    - `docs/design/uiOverhaul/buildSpec.md` §4.1, §4.2, §11 item 19
- **Captures:** `.local-sandbox/uiAudit2026-10-08/home/768.png`, `1280.png` and `1920.png`, viewed today.
- **Principles:**
    - Nielsen #4 (consistency)
    - `visual-systems.md` ("adapt by container, not device")
    - `device-ergonomics.md` (specify behaviour by the space a component occupies)
- **Judgement:** the 14 px Inter line widths, the 500 px full-card height at 348 px, and the "two lamb
  recipes" benefit.
