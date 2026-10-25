# Designer C, round 2: Glance from across the kitchen

**The idea.** The lines of the step are the text the cook reads from across the kitchen, at one cooking size, 38.
The soonest timer is the only other big thing. Everything else is 17 or 13, for the cook who steps closer.

## The two shared faults, resolved

- **Nothing twice (Fix 2).** The far band that copied a line is gone: the list itself is at 38. The soonest timer
  shows in one place: the dock while the cook works, or the wait sentence. Other timers are 17.
- **Nothing stale (Fix 3).** The screen never claims what the cook is doing. It shows the lines the cook has not
  ticked. A cook who never ticks sees every line, as written. Ticked lines fold into one record that says "You ticked
  2 lines", not "Done". Next ticks nothing, so the record stays true (B). A long step scrolls, and a "More below" cue
  says so. Scrolling cannot change the step.

## Reading size: 38 (Fix 6)

With the first spec's figures (cap 0.727, about 163 pt per inch, 16′ of arc), 38 is the smallest size that meets
16′ at 3 ft on a phone (SC-007). Research.md says to size text for the distance and move the rest to a second view
(CK-016). 30 fails at 3 ft. 40 costs a line in six for no gain. No study measured real kitchen distance.

## Keep points

1. **Fast stretch, one step early:** "Step 5 goes fast", with what to have out. It shows near the end of the wait, in
   place of the jobs (CK-021, CK-022).
2. **Next names the move:** the button reads "Next · Step 3" over "Toss the vegetables in oil". The preview is the
   button, so the next step shows once (CK-033).
3. **Waits:** "Nothing needs you for 35 min", then what ends it, and at most two jobs, all prep for later steps (CK-036).
4. **A timer where the time is:** "Roast 20 min at 220°C" carries "Start · 20 min". "Turning the potatoes halfway"
   becomes "Time the turn? Start · 35 min" (CK-031).
5. **Alarm permission in Before you start.** A cook who said no sees "Alarms are off" (CK-030).
6. **A full-screen alarm in the app, and the system alarm on a locked phone.** Only alarms invert (A).
7. **Ingredients by time of use:** Now, Later, and "In already" folded. No strikethrough list, no tint (A, P4).

## Other review points

- **Adopted:** no cards on the step screen, only space and hairlines. The ingredients button says "Ingredients",
  and the sheet says "Ingredients for 4 · 11 items" (B, R1). Once every line is ticked, the next step's lines show at
  38 (B, CK-033). Tablet 834 is drawn (P5). The recipe name left the phone's top bar, so it is never cut off.
- **Rejected: a goal title in the band** (B's question). Recipes do not carry goal titles. A parser must invent them,
  or an author must write them. The lines are real data.
- **Rejected: time and step count only** (A's question). From a metre, the cook needs the action and its amount.
  That is the reason this direction exists.
- **"Rewrite every step as short lines" (A):** a data requirement, with a fallback. Without line data, the steps split
  at sentence ends, which needs no model. A step that is one long sentence stays one line and scrolls.

## Data this needs, and what happens without it

- **Fast steps** need an author flag or a confirmed inference. Without it, no warning shows.
- **Ingredient-to-step links** order the ingredients and give the jobs. Without them: one group, and no jobs.
- **No step order is assumed.** The jobs are prep, such as getting out a board, which never depends on the oven.

## Sizes (P5)

Drawn: 390 light and dark, 834 upright, 1194 in a stand, and 1280. Web 1024 and 768 follow 834. Round 3 draws them.

## Both cooks (§3b)

The cook who struggles gets the step at reading size, ticks, offered timers, jobs and the fast warning. The
experienced cook never ticks, reads the lines and taps Next. Nothing asks to be dismissed. **Not tested:** real cooks,
the largest Dynamic Type, Android alarms and browser alarms.
