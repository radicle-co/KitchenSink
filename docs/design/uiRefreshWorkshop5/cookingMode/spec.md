# Cooking mode: design and spec (feature 008, redesign system)

This is a design spec, not a build plan. The boards are in `../redesignCanvas/boards/CookingMode*.dc.html`, in the
"Cooking mode" row of the redesign canvas. Each board renders in light and dark. Sources:

- `specs/008-cooking-mode/`: the spec, the product spec, the five wireframes and the plan.
- The user-needs database.
- The owner register (`../ownerFeedback.md`).
- The round 9 recipe screens.

## Boards

| Board                                | Size       | What it shows                                                         |
| ------------------------------------ | ---------- | --------------------------------------------------------------------- |
| `CookingModeEntryMobile`             | 390        | Recipe detail with "Start cooking"                                    |
| `CookingModeBeforeYouStartMobile`    | 390        | The first screen of cooking mode (P3)                                 |
| `CookingModeStepMobile`              | 390        | One step, with its amounts inline (P1)                                |
| `CookingModeTimerReadyMobile`        | 390        | A step with a timer that is not started                               |
| `CookingModeTimerRunningMobile`      | 390        | The timer running and docked (P2)                                     |
| `CookingModeTwoTimersMobile`         | 390        | Two timers running at once                                            |
| `CookingModeTimerDoneMobile`         | 390        | A finished timer: the alarm state                                     |
| `CookingModeIngredientsMobile`       | 390        | Ingredients over the step, at 8 servings, with the advisory           |
| `CookingModeResumeMobile`            | 390        | Coming back after leaving                                             |
| `CookingModeOfflineMobile`           | 390        | Offline after the recipe loaded                                       |
| `CookingModeCompletedMobile`         | 390        | The completed screen                                                  |
| `CookingModeBeforeYouStart834Mobile` | 834        | Before you start on a tablet                                          |
| `CookingModeStep834Mobile`           | 834        | Ingredients beside the step, with a timer running                     |
| `CookingModeStep1194Mobile`          | 1194 × 834 | Tablet held sideways: ingredients, the step, and timers with an alarm |
| `CookingModeStep`                    | web 1280   | The same three columns on web                                         |
| `CookingModeCompleted`               | web 1280   | Completed on web                                                      |

## Decisions

1. **Entry.** Recipe detail gains a filled "Start cooking" button above the existing "Edit recipe" and "Screen on" pair.
   It is the screen's one primary action. Cooking is the main job of this screen (FR-001, CK-002).
2. **Screen on stays on Recipe detail, beside Edit recipe (R4).** Some cooks follow the full page and never open
   cooking mode, and they still need the screen awake (CK-002). Cooking mode keeps the screen on by itself (FR-035).
   So it shows no toggle there. Before you start says `The screen stays on while you cook`. The completed screen says
   `The screen can turn off again`.
3. **One step at a time, with place always shown.** The top bar shows "Step 4 of 5", the recipe name, Exit and
   Ingredients. Under it a segmented bar shows done, current and later steps. The bar repeats the words, so color is
   never the only signal (NFR-004, CK-008, CK-020).
4. **The reading size is 34 pt, line height 1.25, weight 400.** Amounts are 600 (P1). Running timers use the same 34
   for their time left, because they are read from across the kitchen. Everything else stays on the ramp: 13, 15
   and 17, plus the 28 title on Before you start and Completed.
    - **Why 34.** SC-007 asks for steps readable from 3 feet. Legibility guidance asks for capital letters of 16 to 22
      minutes of arc. These figures come from secondary sources quoting ANSI/HFES 100-2007 (checked 2026-10-25).
    - **On a phone.** Inter's capitals are 0.727 of the font size, and a phone shows about 163 points per inch. So a
      34 pt capital is 3.85 mm tall. That is 14.5 minutes at 3 feet, and 16 minutes at about 2.7 feet.
    - **On a tablet.** A tablet shows about 132 points per inch, so the same 34 pt is about 18 minutes at 3 feet.
    - **The trade-off.** The full 16 minutes at 3 feet on a phone needs about 38 pt. That gives about 14 characters
      per line, and the longest steps no longer fit on one screen. 34 pt is the plan's 32 sp plus one step. Dynamic
      Type can raise it further (CK-016).
5. **Amounts sit inside the step (P1, CK-001).** The steps scale with the servings. A review records that having to
   tap to see amounts in cooking mode is "counterproductive" (CK-001).
6. **Timers (P2, CK-003, CK-020, CK-021).**
    - **Not started:** a step with a duration shows "Start timer · 1 h 30 min".
    - **Running:** the timer docks above the Back and Next buttons. Each row has the time left, what it is for and
      Pause.
    - **Two at once:** the dock stacks two rows.
    - **Finished:** an alert card appears at the top of the step, with a bell icon, "Roast is done", what to do now,
      and "Stop alarm". The dock row says "Done" with a bell, so icon and words carry the state, not color (NFR-004).
      The alert has `role="alert"`, and the sound and haptic come from the platform. The alert does not pulse, because
      motion stays short and quiet (brief §3).
    - **Wide screens:** timers have their own column on the right, with the alarm at its top.
7. **Ingredients are reachable from any step without losing the place (R1, CK-001, CK-022).**
    - **Phone:** "Ingredients" in the top bar opens a sheet over the step. The step and its number stay behind the
      scrim.
    - **Tablet and web:** the ingredients sit in a pinned column beside the step, as on the round 9 tablet.
    - **Checklist (FR-032a):** a 28 pt box on a 56 pt row. A checked item is struck through and muted.
    - **This step:** the current step's ingredients are tinted and tagged "Step 2", so the cook finds them at a glance.
    - **Scale (FR-034a):** servings are a 2 / 4 / 8 / 12 segmented control (CK-012). When the scale is not the
      recipe's own, an advisory reads `Amounts are doubled. Cook times are not. Check that it is done, not only the
clock`.
8. **Before you start is the first screen (P3, CK-007, CK-013, CK-022).** It shows a hands-on / oven / rest bar with
   its legend in words. It shows the real total (`About 2 h 05`) and the `Do first` lines. It has a link to the 11
   ingredients and the servings, and one primary `Start step 1`. It is a screen of its own, not a step, so an experienced cook taps once and moves
   on (brief §3b).
9. **Completed (CK-027).** A photo of the dish, "All 5 steps done", the recipe name, "Enjoy it.", a quiet summary
   line, then "Back to the recipe" and "Cook it again". It is a short, calm reward with no confetti (brief §3).
10. **Resume.** A session left less than 24 hours ago (plan §8) opens with a dialog: `Pick up where you left off?`
    It shows the step and any timer that kept running, with "Resume step 4" (primary) and "Start from step 1"
    (CK-008).
11. **Offline after loading (spec edge case, plan §7).** A neutral notice under the progress bar says three things: the cook is offline, the recipe is
    saved on this device, and timers still work. It is not a warning, because
    nothing is wrong for the cook.
12. **Voice control is left out.** It is deferred (US-006 is not a must-have, plan §10 step 7) and has no build date. A mic
    button that does nothing is a broken promise, and the big buttons already work with a knuckle (CK-002). It is
    added in the voice round.
13. **No sideways phone board.** The user-needs database has no evidence that cooks prop a phone sideways. The
    tablet is drawn sideways at 1194, because people use tablets both ways (corpus, device ergonomics).

## Sizes and targets

- **Phone 390:** one column, with Back and Next at the bottom in thumb reach.
- **Tablet 834:** ingredients | step, with the dock in the step column. Back sits low left and Next low right, where
  the thumbs reach on a tablet.
- **Tablet 1194 and web 1280:** ingredients | step | timers. Web has no sidebar, because cooking mode is a focused
  task.
- **Minimum target is 56 × 56 pt.** Back and Next are 72 pt tall. Start timer and Start step 1 are 64 to 72 pt.
  Apple asks for 44, Material for 48 dp and NN/g for 1 cm. A wet or floury knuckle is wider than a fingertip, so
  the main controls go past all three.

## Accessibility contract

- **Contrast.** Step text and timers are ink on canvas: 15.9:1 or more in both themes. Cooking mode darkens its
  secondary text to `#474E57` light (7.54:1 on canvas) and `#B4BCC5` dark (9.50:1), and uses `#264A68` for steel
  text in light mode. So every text pair reaches 7:1 (plan §6, WCAG AAA).
- **Announcements.** The step region and the place in the top bar are `aria-live="polite"`, so a new step is
  announced. The finished timer is `role="alert"`, and running timers are `role="timer"`.
- **Names.** Exit is "Exit cooking mode". A timer's Pause is "Pause Roast · Step 4". Each ingredient is a
  `role="checkbox"` with its full line as its name.
- **No color alone.** Progress has words, a finished timer has a bell and "Done", and a checked item has a tick and
  a strike-through.
- **Motion.** A step change is an instant swap or a 150 to 250 ms fade. Under reduced motion it is instant.
- **Gestures.** A swipe moves between steps, and Back and Next are always on screen as the visible alternative.

## Conflicts with the 008 spec and plan, and how they were resolved

| Conflict                                                                                        | Resolution                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The plan and the product spec cite FR-032a and FR-034a "in spec.md", but `spec.md` has neither. | The boards follow the plan text. **Owner:** add both FRs to `spec.md`.                                                                                                                                                          |
| The plan's §6 sets body text at 24 sp and step text at 32 sp.                                   | Step text is 34 (one step above the plan). Labels and ingredient rows stay on the 15/17 ramp, because the brief caps sizes and the ingredient list is read close up. **Owner:** decide whether the ingredient list stays at 17. |
| The plan's §6 sets the minimum target at 48 dp.                                                 | Raised to 56 pt, with 72 pt for Back and Next.                                                                                                                                                                                  |
| The plan's §4 uses tap zones at 40% width and step dots.                                        | Explicit Back and Next buttons plus swipe, and a segmented bar with "Step 4 of 5". A tap zone over the text fires on every touch of the screen.                                                                                 |
| The wireframe shows a "Screen awake: ON" line on every step.                                    | The boards say it once on Before you start and once at the end. The step stays clean.                                                                                                                                           |
| The plan's §4 shows a pulsing timer banner at the top.                                          | A still alert card in the step (phone) or the timer column (wide), with sound and haptic.                                                                                                                                       |
| The ingredients wireframe has "Mark all for this step" and "Reset".                             | Replaced by tinting the step's ingredients. Reset stays as "Clear checks" in the recipe menu (R12).                                                                                                                             |

## Not checked

- On a real phone at 3 feet, and under kitchen light.
- Dynamic Type at its largest sizes, in cooking mode.
- How alarm sounds and haptics play on each platform.
