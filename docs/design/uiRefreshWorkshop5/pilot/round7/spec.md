# Pilot round 7: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder.

**Scope.** Round 7 keeps the round-6 look: slate, the cool base, dusk dark mode, Manrope titles, Inter body and the
cards. It rebuilds Recipe detail on the owner's mobile structure (`../../ownerFeedback.md`, R1 to R12). It also adds
three proposals of the same kind, each drawn from a need record. Home is unchanged.

Rounds 1 to 6 started from the web board at 390 px (`RecipeDetail390`). That board shows a section switch the owner
removed on mobile. This round starts from `RecipeDetailMobile`, `RecipeDetailScrolledMobile` and
`RecipeDetailIngredientsOpenMobile`.

## Screens

| Screen                                               | What it shows                                                                                                      | Status          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| `homeLight`, `homeDark`                              | Home, unchanged from round 6                                                                                       | Owner decisions |
| `recipeLight`, `recipeDark`                          | The full recipe page on the owner's structure                                                                      | Owner decisions |
| `recipeScrolled`                                     | R1: the ingredients card is out of view, and a pinned `Ingredients for 4` bar with the stepper sits over the steps | Owner decision  |
| `recipeIngredientsOpen`, `recipeIngredientsOpenDark` | R1: the bar is tapped, and the list opens over the steps with a scrim                                              | Owner decision  |
| `proposalStepAmounts`                                | P1: each step shows its own amounts                                                                                | **Proposal**    |
| `proposalBeforeYouStart`                             | P2: a short "Before you start" card with the whole job and its waits                                               | **Proposal**    |
| `proposalStepTimer`                                  | P3: the running timer for the step in progress, docked above the tab bar                                           | **Proposal**    |

Each proposal screen says "Proposal" and "Not an owner decision" in its caption.

## Recipe detail, top to bottom

1. Photo carousel with dots and quiet edge arrows (R8).
2. Rating: stars, `4.8 · 12 ratings`, the note `Only other cooks can rate your recipe.`, then `8 comments` with a
   chevron (R6).
3. Eyebrow and title, with more space under the title (R10).
4. `Public`, `From a family recipe card` and `Version history`, under the name (R6).
5. Total, Prep and Difficulty on one line. There is no Cook time (R5).
6. `Edit recipe` with `Screen on` beside it (R4).
7. The description (two lines and `Read more`) and the tags.
8. `Nutrition`, a collapsed accordion with `612 cal per serving` and a chevron (R3).
9. Ingredients card, at full length, with no inner scroll (R9). It holds the title, `for 4`, the stepper and `Edit`.
10. Steps, one card each, with the current step marked `You're here`.

There is no Ingredients/Steps/Nutrition switch (R3).

## Owner decisions: how each one is met

| ID                   | Decision                                                                                                                                                     | How round 7 meets it                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1                   | Pinned, collapsed ingredients bar with the stepper. Tap opens the list over the content with a scrim. The bar goes away once the list's end is back in view. | `recipeScrolled` shows the bar under the top bar, above the steps. `recipeIngredientsOpen` (light and dark) shows the list open with a scrim, and the bar's chevron turns up. The bar's exit is a scroll behaviour, so it is described here and not drawn. |
| R2                   | Web: ingredients pinned beside the steps                                                                                                                     | Not in scope. This pilot is mobile only.                                                                                                                                                                                                                   |
| R3                   | No mobile section switch. Nutrition is a collapsed accordion.                                                                                                | The switch is gone. Nutrition is an accordion card in its place.                                                                                                                                                                                           |
| R4                   | Screen on beside Edit recipe                                                                                                                                 | They sit side by side as one button pair.                                                                                                                                                                                                                  |
| R5                   | No Cook time. Total, Prep and Difficulty on one line.                                                                                                        | Three fact tiles on one line.                                                                                                                                                                                                                              |
| R6                   | Rating under the photo, then `# comments` with a chevron, then nutrition. Source and Version history under the name, by Public.                              | It follows that order. `Public`, the source and `Version history` sit under the name.                                                                                                                                                                      |
| R7                   | Rating dialog, editable and deletable comments, `Add your rating`, no rating for the owner                                                                   | The owner's view shows `Only other cooks can rate your recipe.` The dialog and the comments list are not drawn in this round.                                                                                                                              |
| R8                   | Carousel for more than one photo                                                                                                                             | Dots and edge arrows on the photo.                                                                                                                                                                                                                         |
| R9                   | The list grows to full length, with no inner scroll                                                                                                          | The ingredients card runs to its full 11 rows. The open sheet is a short view over the steps, and it scrolls as one sheet, as in the owner's board.                                                                                                        |
| R10                  | More space under the title and above the ingredients                                                                                                         | 4 px more under the title, and 28 px before the ingredients card.                                                                                                                                                                                          |
| R11                  | Reader view                                                                                                                                                  | Not drawn in this round. The structure is the same, with `Save a copy` in place of `Edit recipe` and the cook's name in the eyebrow.                                                                                                                       |
| R12                  | The more menu shown open                                                                                                                                     | Not drawn in this round.                                                                                                                                                                                                                                   |
| N1, N2, N4 to N7, E1 | Lists, Discover, version history, editor and food search                                                                                                     | These screens are not in this pilot. Home's `Add a recipe` stays in the content area, not the nav bar.                                                                                                                                                     |
| N3                   | Avatar at the top right                                                                                                                                      | Home keeps the avatar at the top right.                                                                                                                                                                                                                    |

R7, R11 and R12 are the gaps to draw next.

## Proposals: the next decisions of the same kind

These follow R1's rule: help is there at the moment the cook needs it, and it never blocks. Each one stays quiet for
an experienced cook (brief §3b).

### P1. The amount inside the step (CK-001, CK-012)

**Need.** CK-001: "know the exact amount and form of each ingredient at the moment the step uses it". R1 brings the
list to the step. P1 brings the amount into the step itself, so most of the time the cook does not open the list at
all.

**Design.** Each amount in a step is set in 600 weight, the same as in the list (`proposalStepAmounts`, steps 2 and
3). Amounts follow the servings stepper (CK-012). A split amount says so: "half of the thyme leaves (from 3 sprigs)".
An experienced cook reads the step as before, because only the weight changes.

**Cost and risk.** The parse pipeline must link each step to its ingredient lines. A wrong link puts a wrong amount
in front of the cook (CK-006). So a step shows only the amounts whose link is certain.

### P2. Before you start (CK-007, CK-013, CK-022)

**Need.** CK-007: "know before starting what the recipe involves, what has to happen first, and how long the waits
are". CK-013: the stated time is not the real time. CK-022: when to prep.

**Design.** A card under the facts (`proposalBeforeYouStart`). It holds:

- A bar showing hands-on time, oven time and rest time, with a text legend.
- The honest total: "About 2 h 05 from start to the table. The rest is not in the total."
- Three short "Do first" lines.

The bar is decoration for the legend, which carries the same facts in words. The card has a `Hide` control and stays
hidden once hidden, so it follows the cook as they grow (§3b).

**Cost and risk.** It needs each step's active and waiting time. Until the data has those, the card shows only what
the recipe states.

### P3. The timer for the step in progress (CK-003, CK-021)

**Need.** CK-003: what to do while something else cooks. CK-021: keep up with the steps that cannot wait.

**Design.** Tapping a step's timer pill starts it, and the pill fills with slate. A small dock sits above the tab bar
(`proposalStepTimer`). It shows the time left, what is happening ("Roasting at 190°C · then rest 15 min") and
a pause button. The dock stays on screen while the cook scrolls, so the time is never lost. There are no
pop-ups. On native the timer also runs as a Live Activity or notification, and its end plays a sound and a haptic.

**Cost and risk.** Several timers at once need a list in the dock. That is the next design step.

## Look

The look is unchanged from round 6 (`../round6/spec.md`): palette, contrast table, type scale and photo treatment. The
new parts use only existing tokens:

| Part                   | Tokens                                         |
| ---------------------- | ---------------------------------------------- |
| Pinned bar             | `card`, `line`                                 |
| Scrim                  | ink at 42%                                     |
| Running timer pill     | `sig` with `sigLabel` (white on slate, 6.84:1) |
| Timer dock icon        | `sigText` on `sigTint`                         |
| "Before you start" bar | `t3i`, `t2` and `t1i`                          |

Three photos were re-encoded a little smaller (hero, pad thai and focaccia, now about 15 KB each), so that ten screens
fit under 150 KB.

## Checked, and not checked

**Checked:**

- All ten screens rendered with Playwright at 2×, with Inter and Manrope loaded. Each is 390 px wide with no overflow
  and one title.
- Each screen uses 13, 15 and 17 px plus one title, and weights 400 to 600 only.
- Compared side by side with `RecipeDetailMobile`, `RecipeDetailScrolledMobile`, round 6, Airbnb and Things 3.
- Every owner decision in the register, with the result in the table above.

**Not checked:**

- R7, R11 and R12 are not drawn.
- A real device, real Dynamic Type, and the motion of the pinned bar.
- How P1 to P3 work with real cooks. They are judgement from desk research and need a test.

## The pinned ingredients bar: three options

The owner asked whether the bar's chevron is too easy to miss. The three options are in `ingredientsBarOptions.html`.

| Option              | What changes                                                                              | Open target                                                    | Stepper                                    |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| A                   | The chevron is 20 px, in a 36 px round button with an outline                             | The 44 × 44 button                                             | Its own buttons, 8 px from the open button |
| **B (recommended)** | A second line, `11 items · 1 ticked`, and a `Show` button with a chevron, in the sky tint | The label area and the `Show` button, both at least 44 px tall | In the middle, with its own buttons        |
| C                   | The whole bar is a mist-tinted surface with a grab handle                                 | The label and chevron, at full bar height                      | Raised on a white pill                     |

**Why B.** It has the clearest cue that the bar opens: a word, a button shape and a chevron. Perception rule 15 says
that taking away such cues slows people down and causes errors. The preview line also tells the cook what is inside
before they tap. A is clear but is still only an icon. In C the stepper sits inside the tappable surface, so a tap
near the stepper's edge can open the list by mistake.
