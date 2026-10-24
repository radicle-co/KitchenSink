# Pilot round 9: visual spec for Home and Recipe detail, on phone, tablet and desktop

This is a design artifact for the owner to judge, and it is not a build spec yet. It has two files, and each one stays
under 150 KB:

- `mockup.html` holds the phone screens at 390 px.
- `mockupWide.html` holds tablet (native 834 and 1194) and desktop (web 1280).

Every screen has its `data-screen` name and its real width. Steel is the only signature color, on the cool base, with
dark mode.

**What changed.** The look is the same as round 8 (steel, cool base, Manrope dish names, Inter body, cards). Three
things are new:

1. P1 to P3 are now built into the recipe screens.
2. The ingredients bar is neutral (P4).
3. Every size is drawn (P5).

## Screens

| Size               | Screens                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone 390          | `homeLight`, `homeDark`, `recipeLight`, `recipeDark`, `recipeScrolled`, `recipeScrolledDark`, `recipeBarPressed`, `recipeIngredientsOpen`, `recipeIngredientsOpenDark` |
| Desktop web 1280   | `home1280`, `recipe1280`, `recipeScrolled1280`                                                                                                                         |
| Tablet native 834  | `home834`, `recipe834`                                                                                                                                                 |
| Tablet native 1194 | `home1194`, `recipe1194`, `recipe1194Dark`                                                                                                                             |

## P1 to P3, built in on every size

- **P1, amounts in each step (CK-001).** Steps 2 and 3 name each amount in 600 weight: "Mash the **3 tbsp**
  butter…". The amounts follow the servings stepper.
- **P2, docked timer (CK-003, CK-021).** A running step timer fills its pill with steel. A dock shows the time left,
  what is happening and a pause button. On phone the dock sits above the tab bar (`recipeScrolled`, the cook at step
  4). On desktop it sits at the bottom right of the steps column (`recipeScrolled1280`). It never covers the
  ingredients.
- **P3, Before you start (CK-007, CK-013, CK-022).** The card sits after the recipe's facts and before the
  ingredients: under the sheet on phone, and full width under the top block on tablet and desktop. It has `Hide`.

## P4: the ingredients bar (phone)

The bar is still one whole-bar button, a raised card inset 12 px. Steel is only an accent now.

| State   | Surface                                                   | Edge                                    | Steel                                      |
| ------- | --------------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| Resting | `card` (light) or `surface` (dark)                        | 1 px `line` hairline, soft shadow       | Chevron circle (36 px) and the `Show` word |
| Pressed | Pale neutral (`#F6F8FA` light, `#283440` dark), 1 px drop | 1.5 px `control` edge, shadow collapses | The circle steps one shade deeper          |
| Open    | As resting                                                | As resting                              | `Hide` and an up chevron                   |

It reads as tappable at a glance from three cues: the raised card, the word and the filled circle. The pressed state
is never steel-filled. Its edge stays visible against the page at 3.26:1, so it is never grey on grey.

Measured contrast:

| State          | Label | Count line | Show/Hide | Chevron on circle |
| -------------- | ----- | ---------- | --------- | ----------------- |
| Light, resting | 17.00 | 5.89       | 6.94      | 7.06              |
| Light, pressed | 16.25 | 5.63       | 6.64      | 9.28              |
| Dark, resting  | 12.41 | 6.24       | 7.21      | 9.15              |
| Dark, pressed  | 10.97 | 5.52       | 6.37      | 11.31             |

## P5: tablet and desktop

**Tablet decision: a pinned ingredients column beside the steps, as on web.** At 834 and 1194
both columns fit at full reading size. So the cook sees every amount and the current step at once, with no tap at
all (CK-001, R1's rule). The phone bar exists only because a phone has no room for a second column.

Translating the job, not the layout (agent §3.6):

| Element                              | Phone                                    | Tablet 834 / 1194                                             | Desktop 1280                         | Disposition       |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ----------------- |
| Navigation                           | Tab bar                                  | Tab bar (native)                                              | Left sidebar (web)                   | Kept per platform |
| Photo                                | Full-bleed hero with quiet controls      | Right column, rounded, carousel arrows                        | Same as tablet                       | Moved             |
| Back and More                        | On the photo                             | `My recipes` back link and a More button above the content    | Same                                 | Moved             |
| Rating, comments, Nutrition          | Under the photo                          | Under the photo, right column                                 | Same                                 | Kept (R6, R3)     |
| Name, facts, Edit recipe + Screen on | Sheet under the photo                    | Left column card                                              | Same                                 | Moved (R4, R5)    |
| Before you start                     | Under the sheet                          | Full width under the top block                                | Same                                 | Kept (P3)         |
| Ingredients                          | Full list, then the pinned bar on scroll | Column 340 px (834) or 360 px (1194), pinned beside the steps | Column 360 px, pinned (R2)           | Moved             |
| Steps                                | Single column                            | Right column                                                  | Right column                         | Kept              |
| Timer dock                           | Above the tab bar                        | Above the tab bar                                             | Bottom right of the steps column     | Moved (P2)        |
| Home grid                            | 2 columns                                | 4 columns                                                     | 4 columns                            | Kept              |
| Add a recipe                         | FAB                                      | FAB                                                           | Not on Home, as in the current board | Kept              |

**Touch and reach on tablet.**

- Every control has a 44 pt target: the stepper buttons, checkboxes, chips, More and the timer pause.
- The stepper and Edit sit at the top of the ingredients column, within thumb reach of a propped tablet.
- Nothing depends on hover. The carousel arrows are always visible, and every chevron row is a full tap target.

**Scroll.** On tablet and desktop the ingredients column sticks at the top of the view while the steps scroll.
`recipeScrolled1280` shows this, with a compact title bar. A list taller than the window scrolls with the page until
its end shows (R2).

## Every earlier change, on every size

Tablet and desktop carry all of the changes from rounds 1 to 8 that apply on a wide screen:

- Steel on the cool base, with dusk dark mode.
- Type at 13, 15 and 17 plus one title. Manrope is used for dish names only.
- The photo grade and the carousel.
- The round-3 voice and copy.
- The fact tiles and the tinted nutrition, tag and no-photo surfaces.
- R3 to R10 as listed in the check below.
- P1 to P3.

The phone changes below were deliberately not carried to the wider sizes.

| Phone change                                                       | Why it is not on tablet or desktop                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pinned ingredients bar and the open list with a scrim (R1, P4) | The ingredients column is always in view beside the steps, so there is nothing to open.                                                            |
| The full-bleed hero, with Back and More on the photo               | A full-width photo at 1194 or 1280 pushes every fact below the fold. The photo sits in the right column, and Back and More move above the content. |
| The recipe sheet that overlaps the photo                           | It only makes sense under a full-bleed photo. On wide screens the facts are a card beside the photo.                                               |
| The compact top bar that shows the dish name on scroll             | It is kept on desktop (`recipeScrolled1280`). On tablet it is described but not drawn this round.                                                  |
| `Add a recipe` as a FAB on desktop                                 | It is not carried, because the current desktop Home has none. N1 puts creation on My recipes.                                                      |

## Owner decisions: the check

| ID  | How round 9 meets it                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Met on phone: the pinned bar, the open list with a scrim, and servings at its top. On tablet the list is pinned beside the steps, which serves the same rule without a tap. |
| R2  | Met: on desktop the ingredients stay pinned beside the steps (`recipeScrolled1280`).                                                                                        |
| R3  | Met: no section switch, and Nutrition is an accordion on every size.                                                                                                        |
| R4  | Met: `Screen on` sits beside `Edit recipe` on every size.                                                                                                                   |
| R5  | Met: Total, Prep and Difficulty on one line, with no Cook time.                                                                                                             |
| R6  | Met: the rating sits under the photo, then comments, then Nutrition. Public, the source and Version history are on one line under the name.                                 |
| R7  | Partly met: "Only other cooks can rate your recipe." The dialog is not drawn.                                                                                               |
| R8  | Met: a carousel with dots and arrows on every size.                                                                                                                         |
| R9  | Met: the ingredients list runs to full length, with no inner scroll.                                                                                                        |
| R10 | Met: space under the title and above the ingredients.                                                                                                                       |
| R11 | Not drawn (reader view).                                                                                                                                                    |
| R12 | Not drawn (the open More menu). The More button is now on every size.                                                                                                       |
| N1  | Met where shown: `Add a recipe` is in the content area, never in a nav bar.                                                                                                 |
| N2  | Not in scope (My recipes search on wide web).                                                                                                                               |
| N3  | Met: the avatar is at the top right on Home at every size.                                                                                                                  |
| N4  | Not in scope (Discover).                                                                                                                                                    |
| N5  | Not broken: no horizontal scrollers.                                                                                                                                        |
| N6  | Met: every block keeps its margin.                                                                                                                                          |
| N7  | Not in scope (editor). No scrollbars are drawn.                                                                                                                             |
| P1  | Met on every size.                                                                                                                                                          |
| P2  | Met on phone and desktop. On tablet the dock sits above the tab bar, as on phone. It is described here and not drawn.                                                       |
| P3  | Met on every size.                                                                                                                                                          |
| P4  | Met: neutral card, steel only on the circle and the word, and a neutral pressed state.                                                                                      |
| P5  | Met: phone, tablet 834 and 1194, and desktop 1280. The web 1024 and 768 breakpoints are not drawn this round.                                                               |

## Checked, and not checked

**Checked:**

- All 17 screens rendered with Playwright at 2×, with Inter and Manrope loaded.
- Each screen is at its real width, with no overflow and one title.
- Text sizes are 13, 15 and 17 plus one title. Weights are 400 to 600.
- Contrast was measured for every bar state.

**Not checked:**

- The web 768 and 1024 breakpoints.
- A tablet scrolled screen and a tablet timer dock.
- R7, R11 and R12.
- Real devices and Dynamic Type.

The hero photo is 440 px wide, so it looks soft at desktop and tablet size. This is a limit of the mockup's size
budget, and the build uses full-size images.
