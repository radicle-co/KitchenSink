# Designer B, round 1: the shape of the whole cook

**The idea.** One line of the step is in focus at reading size. Around it, quietly, sits the whole cook as two lanes
on one time line: **You** (work for your hands) and **Food** (what heats, roasts or rests without you). So the cook
sees the gaps, fills them, and picks their own order wherever the recipe allows it.

## Decisions

1. **The line, on every screen.** Phone: a 64 pt strip under the top bar, drawn to scale. It is one button that opens
   the whole cook. Tablet and web: a full time line along the bottom, with clock times and a "Now" marker. At a glance
   it tells the cook what is next and how long they are free (CK-033, CK-007, CK-021). It is P3's bar, kept in view.
2. **Timers are the Food lane.** The oven, roast and rest are blocks on the line. Their docked rows (P2) have the same
   names, by task and step. A timer never covers the recipe, and moving to another step does not reset it (CK-031).
3. **The cook picks the order.** Where steps do not depend on each other (steps 2 and 3), the screen shows "Then, in
   the order you like" with **Do it now**. The whole cook view marks each step Done, In focus, Ready or Needs. It
   suggests and never schedules: cooks rated a planned order 3.5 out of 10 (CK-003).
4. **A wait is a gap, said in words.** "Nothing needs you for 38 min." Below it are up to two optional small jobs,
   taken only from later steps. There is no chatter, and "Or sit down" is a valid answer (CK-033, CK-036).
5. **A timer is offered at the moment it helps.** At the start of the wait the screen asks "Set a timer for the
   potatoes?" with "Start · 38 min" (CK-036, Jaber 2024 in the research).
6. **One line of a step in focus.** A long step is split into its action lines. The current line is at reading size,
   and the rest are at 17 after "Then:". **Line done** is optional, and **Step 2 done** finishes the whole step. The
   overline counts "1 of 4 done", so the place survives a look away (CK-034, CK-008).
7. **Coming up names what starts it.** For example: "Step 4 · after the oven beep" (CK-033, CK-021).
8. **Ingredients are grouped by time:** Now, Later (tagged with their step), In already. Servings sit at the top of
   the sheet (R1). Tablet and web pin the list in a column (CK-001, CK-020, R2).
9. **An alarm that reaches you.** Before you start asks for the permission once, and says what "No" means. A locked
   phone uses the system alarm: AlarmKit on iOS 26 and later sounds on silent and repeats until Stop. In the app, an
   attention band shows above the step. It has a bell, the task and a count-up ("0:42 over"). Its buttons are a
   72 pt Stop alarm and +5 min. Colour is never the only signal (CK-030, NFR-004).
10. **Type and colour.** I keep the first spec's one cooking reading size, 34 (its decision 4). The rest is 13/15/17
    and one 28 title, read from close up. Steel is only on the primary button, the "now" block, edges and words (P4).
11. **Wet hands.** There are no swipes and no tap zones on the step text. Back is 72 pt, and no target is under 48 pt.

## Rejected

- **A Gantt chart with a lane per pan.** It makes the cook a project manager. Two lanes are enough at home.
- **A set order, or moving to the next step on its own.** Both take control away (CK-003).
- **Only the next step as a preview.** It does not say how long the cook is free, and that is what a wait asks.
- **Swipe between steps.** A splash can cost the cook their place (CK-002).
- **Tips during the wait.** Cooks missed tips that came unasked (CK-036).

## Both cooks, one screen

The struggling cook gets one line in big type and "Nothing needs you for 38 min". The app offers them a timer and
sorts the ingredients into now and later. The experienced cook reads the strip at a glance, ignores the line ticks, taps
Step done, and jumps to any ready step. Nothing must be dismissed (brief §3b).

## Sizes (P5)

Drawn: phone 390, tablet 1194 held sideways, web 1280. Not drawn this round: tablet 834, web 1024 and 768. At 834 the
time line must drop its clock ticks or the Then column, and I want the reviews to settle the line first.

## Open, and not checked

- Does a time line drawn to scale help a beginner? A 5-cook test of the strip can settle it (heuristic, untested).
- "Steps 2 and 3 in either order" needs data that recipes do not carry today. The author can state it, or the app
  can infer it for the author to confirm. That is a question for the architect before any build.
- Web alarms after the tab closes were not researched. Contrast on the attention band was not measured.
