# Pilot round 3: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder. It shows four screens at 390 px: `homeLight`, `homeDark`, `recipeLight` and `recipeDark`.

**Scope.** The sections, data, actions and their order are the same as in the current UI and in round 2. Round 3
changes the color, the copy and the motion, and it replaces one photo. Round 2 stays the record for type, spacing,
photo treatment and the reflow rules (`../round2/spec.md`). This file covers only what changed. Content ideas are in
`proposals.md`.

## What round 3 changed

| #   | Direction              | What changed                                                                                                                                                                                                                                         |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A bold signature color | **Cobalt** replaces the muted teal (comparison below). It has three jobs only: the main action, the current step and the selected state. Links, the avatar and the Edit buttons went neutral, so that the blue always means one of those three jobs. |
| 2   | Voice                  | 20 strings were rewritten in a warm, plain voice (table below). Times, temperatures, amounts, ratings and allergens were left alone.                                                                                                                 |
| 3   | Motion                 | Three short motions are specified below. The mockup shows their end states: step 1 done, step 2 current, and one ingredient ticked.                                                                                                                  |
| 4   | Photo                  | The focaccia is now a sharp, golden close-up with rosemary and salt (Fred Benenson, CC BY-SA 4.0). It has the same crop and grade as the other photos.                                                                                               |
| 5   | Kept                   | Layout, serif recipe names, type sizes (13, 15, 17 and the one 30 title), the photos, the quiet hero controls and the warm base.                                                                                                                     |

## Signature color: three candidates

I rendered the full mockup three times, once for each color, in both themes, and compared the parts that carry the
color side by side. Those parts are the FAB, the active tab, the ticked ingredient, the done step, the current-step
block and the timer icons. Each candidate was picked in OKLCH at the highest chroma that is in gamut. Its lightness
was set so that a white label clears 4.5:1 with margin. Its dark-mode version was tuned separately: brighter, with a
dark label. It is not the light color dimmed.

| Candidate            | Light fill | Dark fill | Next to the food                                                                                                                                                          | The current-step block                                                                                                                            | Verdict                                                                                                                                                                      |
| -------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jade (a bolder teal) | `#0E8066`  | `#19B794` | Calm and close to the brand. Against green herbs and blue plates it fades back.                                                                                           | A pale mint wash. Readable, but quiet.                                                                                                            | Safe, and not exciting enough. This is round 2's problem again.                                                                                                              |
| Paprika              | `#D0390C`  | `#FD7C5D` | The warmest and most appetizing hue, but it competes with the food instead of framing it.                                                                                 | A peach wash in light mode. In dark mode it becomes a muddy brown-red, and dark orange-brown is the least liked hue in Palmer and Schloss (2010). | Rejected. It also sits next to the error red (`#C05238`), so the current step mid-cook can read as a warning. That is the wrong signal at the panic moment CK-021 describes. |
| **Cobalt**           | `#2863FB`  | `#75A0FC` | It sits opposite the warm food on the color wheel, so each makes the other stronger. Blue is the most liked hue on average (Palmer and Schloss 2010, perception rule 12). | A clear blue wash in light mode and a deep navy in dark mode. It reads as "here", not "warning".                                                  | **Chosen.** It looks the most alive beside the photos, it is never confused with an error, and it holds in both themes.                                                      |

Cobalt is close to the accent of Things 3, which is now a pass reference. The risk is that blue reads as generic
tech. What stops that is the Newsreader dish names and the food photos, which give the identity. The blue only does
its jobs.

### Cobalt roles and contrast

The ratios are WCAG 2.x. Thresholds come from the corpus `accessibility.md`: 4.5:1 for text and 3:1 for non-text
(SC 1.4.3 and 1.4.11).

| Role                                                                  | Light     | Dark      | Pair and ratio (light / dark)                  |
| --------------------------------------------------------------------- | --------- | --------- | ---------------------------------------------- |
| `sig`: FAB, ticked box, current-step number, section-switch bar       | `#2863FB` | `#75A0FC` | Label on it: white 4.92 / `#181614` 7.04       |
| `sigText`: `You're here`, the active tab label, done tick, timer icon | `#2459E6` | `#75A0FC` | On canvas 5.57 / 7.04. On the tint 5.04 / 5.48 |
| `sigTint`: the current-step block                                     | `#E9F0FF` | `#1C2B4A` | Ink on it 15.03 / 12.37                        |

The light text color (`#2459E6`) is one step darker than the fill. The fill as text on the tint gave only 4.30:1, so
text uses its own token. All other roles (canvas, surface, ink, ink2, line, control) are unchanged from round 2.

**Calm setting (brief §3, "offer calm").** The current step shows the number disc and the label but no tint block.
Motion is reduced as described below. The FAB and the selected states keep the color, because they carry meaning.

## Voice: old and new strings

The rules: warm, plain and exact. No jokes. Nothing is changed near a time, a temperature, an amount, an allergen or
a rating. Some labels stay as they are, because they are names people learn. These are the navigation labels (Home, Recipes,
Discover, Ingredients, Steps, Nutrition), the status words (Private, Draft, Pro, Public) and the fact labels (Total,
Prep, Difficulty).

| Where                    | Old                                                                                                               | New                                                                                                      | Why                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Home greeting            | Good morning, Eliza Ramirez                                                                                       | Good morning, Eliza                                                                                      | People greet by first name.                                                |
| Home section             | Recent recipes                                                                                                    | Your recent recipes                                                                                      | Says whose they are.                                                       |
| No-photo tile            | No photo yet                                                                                                      | Waiting for its photo                                                                                    | It is the same fact, said warmly. It sounds like a state that will change. |
| Coming soon heading      | Coming soon                                                                                                       | Coming next                                                                                              | Plainer, and it sounds like a plan.                                        |
| Coming soon line         | Meal plans, a grocery list and daily nutrition are on the way.                                                    | `We're building meal plans, a grocery list and daily nutrition. They'll appear here when they're ready.` | Says who is doing it and where the features will appear.                   |
| Coming soon row          | Resume cooking                                                                                                    | Pick up where you left off                                                                               | Says what the feature does for the cook (CK-008).                          |
| Coming soon row          | This week's meals                                                                                                 | Your meals this week                                                                                     | Warmer, with the same meaning.                                             |
| FAB                      | New recipe                                                                                                        | Add a recipe                                                                                             | It is a verb, so it reads as an action.                                    |
| Recipe byline            | Source: Family recipe card                                                                                        | From a family recipe card                                                                                | Reads as a sentence, not a form field.                                     |
| Recipe link              | Version history                                                                                                   | Earlier versions                                                                                         | Plain words for the same thing.                                            |
| Description link         | More                                                                                                              | Read more                                                                                                | Says what happens.                                                         |
| Rating heading           | Community rating                                                                                                  | Ratings from other cooks                                                                                 | Says who rated it. The number and the count are unchanged.                 |
| Rating note              | `You can't rate your own recipe.`                                                                                 | Only other cooks can rate your recipe.                                                                   | It says what is possible instead of what is blocked.                       |
| Comments link            | 8 comments                                                                                                        | Read 8 comments                                                                                          | Says what happens.                                                         |
| Nutrition note           | Nutrition comes from public food databases.                                                                       | Worked out from public food databases.                                                                   | Shorter, and it says the numbers are calculated.                           |
| Nutrition link           | Data sources                                                                                                      | See the sources                                                                                          | It is a verb.                                                              |
| Keep-awake helper        | Keeps the screen awake while you cook.                                                                            | Keeps your screen on while you cook.                                                                     | Plainer.                                                                   |
| Current step (new label) | (none, only a colored bar)                                                                                        | `You're here`                                                                                            | The state was shown only by color. Now it is also in words (SC 1.4.1).     |
| Done step (new state)    | (none)                                                                                                            | The number becomes a tick. Its accessible name is `Step 1, done`.                                        | Shows the state the step motion ends in.                                   |
| Unchanged on purpose     | See all, Edit recipe, Edit, Soon, Today's nutrition, Nutrition (per serving), all times, amounts and temperatures | (no change)                                                                                              | They are already plain and exact.                                          |

## Motion

The brief's defaults apply: 150 to 250 ms, ease-out, interruptible, no overshoot, and nothing long on actions a cook
repeats. The curve called **ease-out** below is `cubic-bezier(0.2, 0, 0, 1)` on web. On iOS and Android it is the
equivalent decelerate curve, with no spring bounce.

| Motion                                                     | Trigger                                               | What moves                                                                                                                                                                                                                                                                             | Duration and curve                                                                                                    | Reduced motion                                                                                    | Why                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. The step marker moves on** (the one signature motion) | The cook marks a step done, or moves to the next step | The blue tint block slides down from the finished step to the next one, resizing to fit it. The finished step's number cross-fades to a tick (160 ms), and its text fades to `ink2`. The `You're here` label moves with the block. On native, a light haptic plays as the block lands. | 240 ms, ease-out. If the cook taps again during the move, the block goes straight to the new target from where it is. | No slide. The block fades out at the old step and in at the new one, in 120 ms. The haptic stays. | It shows where the cook now is. That is the CK-021 and CK-008 need: find your place at a glance. It is the only expressive motion on these screens (brief §3, one signature). |
| **2. Ticking an ingredient**                               | Tap on the row                                        | The box fills with blue from 60% to 100% scale, and the tick draws on with a stroke-dash. The row text fades to `ink2`. Unticking reverses it.                                                                                                                                         | 160 ms, ease-out.                                                                                                     | Fill and tick appear at once, and the text color changes at once.                                 | It shows the tap landed. It stays short because a cook ticks 10 to 20 of these per recipe (Apple HIG: avoid motion on frequent interactions).                                 |
| **3. Pressing a recipe tile**                              | Finger down on a Home tile                            | The tile scales to 0.98 and the photo darkens by 4%. On release it returns and the recipe opens.                                                                                                                                                                                       | Press 100 ms, release 160 ms, ease-out. No bounce.                                                                    | Darkening only, with no scale.                                                                    | It gives touch feedback at once on the main path from Home into a recipe.                                                                                                     |

Not animated: the servings stepper (numbers change at once), the section switch (jump scroll, 200 ms, or instant
under reduced motion) and the FAB.

## Need records by section

These are unchanged from round 2 (`../round2/spec.md`), with one addition. The current-step label and the step
motion serve CK-021 and CK-008.

## Checked, and not checked

**Checked:**

- Rendered with Playwright at 2×. Inter and Newsreader were both checked as loaded with `document.fonts.check`.
- Each screen is 390 px wide with no overflow.
- Each screen uses 13, 15 and 17 px, plus one 30 px title on the recipe screen, and weights 400 to 600 only.
- Contrast computed for every cobalt pair above.
- All three color candidates rendered in both themes and compared.
- Round 3 compared side by side with round 2 and with Airbnb, Mela and Things 3 at the same phone width.

**Not checked:**

- The motions run only as a spec. They need a working prototype on a phone.
- The large-text stress pass was not re-run. The round-2 rules still apply.
- A real device, real Dynamic Type, and the Back and More icons over real user photos.
