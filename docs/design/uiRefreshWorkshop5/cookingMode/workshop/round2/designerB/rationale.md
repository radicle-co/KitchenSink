# Designer B, round 2: the shape of the whole cook

**The idea.** The cook sees the shape of the job once, drawn to scale, on Before you start. After that, each step
tells the shape in words: "Nothing needs you for 38 min", "Step 5 goes fast". The full shape is one tap away in All
steps, and every timer lives there, under the step that started it.

## Round 2 Keep points

1. **Fast warning, one step early.** During the roast, "Step 5 goes fast" lists what to get out. It is also the wait's
   optional jobs, so one block does both (CK-021, CK-022).
2. **Done names the move:** "Done · next: fill the tin", "Done · next: roast" (CK-033).
3. **"Nothing needs you for 38 min"**, with at most two jobs, both from step 5 (CK-033, CK-036).
4. **A timer offered at the moment it helps:** "Then turn the potatoes. Set a timer for it?" (CK-036).
5. **Alarm permission once, on Before you start,** with what No means. If the cook said no, an "Alarms are off" line
   sits above the dock, with Allow (CK-030).
6. **Full-screen alarm in the app.** The inverse surface, the task at 34, a count-up and a 112 pt Stop. The locked
   phone gets the system alarm. The alarm is now readable from across the room (CK-030).
7. **Ingredients by time of use:** Now, Later (with their step), In already. R1's stepper sits at the top.

## Round 2 Fix points

1. **Density.** The step screen is the step on the canvas, with one hairline, Next, and one bottom bar holding the
   dock and the buttons. The only tinted block is the fast warning.
2. **Nothing twice.** On a phone a timer shows only in the dock. On wide screens it shows only in All steps. Once a
   timer holds the potatoes time, the headline drops its number: "until the potatoes timer rings". One pair stays:
   wide screens show amounts in the step and in the ingredients column. The owner ruled both (P1, R2).
3. **Nothing stale.** I dropped round 1's single line in focus, because it went wrong for a cook who never ticks.
   Every unticked line stays at reading size. A ticked line drops to 17. Done never ticks lines for the cook, so the
   record stays true (CK-020, CK-034).
4. **No order the data cannot support.** Steps stay in the recipe's order, and the cook can open any step from All
   steps. The wait jobs are getting ready only: fetching and measuring what a later step uses. That is safe in any
   order, and it uses the step-to-ingredient link that P1 already needs. **Data requirement, for later:** a step can
   state "can start with step N", written by the author. With it, All steps can mark that step "Can start now".
   Without it, nothing changes. The app never guesses.
5. **Steel** fills only the primary button. The current step uses selected-fill, and a running timer has a steel edge.
6. **Reading size: 34.** For a phone that is the only device, the research says to size the text for the distance and
   move the rest to a second view, not to shrink it (research.md problem 6, CK-016). At 34 a phone capital is about
   14.5 arc-minutes at 3 ft (first spec, decision 4). 30 loses about 2 arc-minutes. 40 leaves about 15 characters a
   line. The shape, the ingredients and All steps are the second views. Sizes are 34, 17 and 13, plus 28 only as the
   title of Before you start and All steps.

## The reviews, answered

- **The strip on every phone is dense (A, C).** Adopted: gone from the steps. **Four tablet zones (A):** now three.
- **"In the order you like" needs data (A, C).** Adopted, as Fix 4.
- **The focus is a paragraph (A).** Partly adopted. A step is the focus, written as short lines. A line that runs to
  four lines at 34 tells the author to split it. A long step scrolls, and Next stays as a one-line peek at the bottom.
- **Clock times are a promise the oven breaks (C).** Adopted. No clock times appear while cooking, only durations
  and a doneness cue ("until the juices run clear").
- **Four sizes (C)** and **an alarm band only a looking cook sees (C).** Both adopted, as Fix 6 and Keep 6.
- **A's question: what does the cook lose without the strip?** The gap at a glance. The words replace it: Next says
  "then nothing needs you for about 45 min", and the wait says how long.
- **C's question: the roast runs 20 min over.** All steps shows "Roast · checking, 10 min past its 1 h 30. The oven
  sets the pace." Nothing shows a finish time, so nothing can be late.

## Sizes, and what is not checked

Drawn: phone 390 (step in light and dark), tablet 834 upright, 1194 sideways, web 1280. Web 1024 and 768 take the 834
layout with ingredients in a sheet. Not checked: Android and browser alarms, contrast on the tint and the inverse
alarm, and real cooks. All of this is heuristic judgement.
