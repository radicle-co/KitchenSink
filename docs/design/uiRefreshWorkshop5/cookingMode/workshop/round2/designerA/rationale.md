# Designer A, round 2: Now and next, revised

This file explains `mockup.html`. The mockup is a design study, not production code. It has 16 boards: 12 phone boards,
tablet 834 upright, tablet 1194 sideways, and web 1280 in light and dark.

## The idea, kept

Every screen answers two questions: what do I do now, and what comes after it. The cook never holds the next action in
memory. Round 2 keeps that and removes the frames around it. One line is in focus at the reading size. The rest of the
screen is quiet text at 17 pt, separated by space and hairlines. On the phone there are no cards. The only tinted
surface is the sand band for a fast stretch.

## The screens

1. Before you start. The whole job as five timed lines, the free time named, and the alarm permission asked once.
2. A step. Done lines are muted at the top. The current line is at 38 pt. The rest of the step and the first line of
   the next step sit under "Then". A running timer sits in the dock above the controls.
3. A timer offered where the step needs it: "Start a 1 h 30 timer". One sentence says when it rings.
4. The fast stretch, one step early, in one sand band.
5. A wait. The countdown is the Now, and it leaves the dock, so it shows once. One cue, then "After that, nothing needs
   you for 1 h 10 min", then two optional jobs.
6. The honest notice, with "Allow alarms". This board shows a wait after the cook said no to alarms.
7. "Do it now". The job from step 5 becomes the Now, and the place stays at step 4.
8. Two timers in the fast stretch.
9. A finished timer with the app open: the whole screen, once. A finished timer on a locked phone: the system alarm.
10. Ingredients by time of use, with the servings stepper at the top.

## The reading size: 38 pt

38 pt is the size of the one focus line and of the countdown. Everything else is 13, 17 or 28.

- SC-007 asks for steps readable from 3 feet on a phone. research.md says the cost of large text is what fits on the
  screen (CK-016), and that a phone is the only device for most cooks.
- Legibility guidance puts the minimum character height at 16 arc minutes and the comfortable range at 20 to 22. I took
  this from a secondary source (a Taylor and Francis chapter). I did not read the primary standard (ANSI/HFES 100).
- With Inter's cap height of 0.727 em, at 3 feet, 38 pt gives these angles:
    - 17.2′ on a 390 pt phone (about 153 pt per inch).
    - 16.2′ on a 163 pt per inch phone.
    - 20.0′ on a tablet (about 132 pt per inch).
- 30 pt gave 13.6′ and 34 pt gave 15.4′, so both are under the minimum on a phone. 40 pt adds little and fits about 15
  characters per line.
- The cost of 38 pt is fit, so only one line is that size. A long line wraps to three or four lines, and that is
  acceptable for one line.

## Each Keep point from the brief

1. The early warning for a fast stretch: kept. It is now one band without chips, so it is less dense (board 4).
2. A Done button that names the next move: changed. It names where the tap goes ("Done · next line", "Done · step 5 of
   8", "Done · back to step 4"), not the words of the next line. The next line is already on screen under "Then".
   The same words in the button break Fix 2.
3. "Nothing needs you" with at most two optional jobs: adopted (board 5).
4. A timer offered at the moment the step needs it: adopted (board 3). A line with a wait but no stated time gets
   "Set a timer" with a picker, which is not drawn.
5. Alarm permission asked once, and an honest notice after a no: adopted (boards 1 and 6).
6. A finished timer that reaches a cook across the room: adopted. In the app, the whole screen turns to the inverse
   surface once, with a 112 pt Stop and +5 and +10 min. When the cook taps Stop, the normal screen comes back and the
   job is the new Now. On a locked phone, the system alarm (AlarmKit on iOS 26, the alarm path on Android) rings
   through silent mode.
7. Ingredients grouped as Now, Later and In already: kept, with the stepper from R1.

## Each Fix point from the brief

1. Density: fixed. The phone has no cards. One line is large, and the rest is 17 pt text with space between groups.
2. Nothing twice: fixed. A timer that is the Now leaves the dock. The Done button names a place, not a line.
3. Nothing stale: fixed by removing the per-line ticks. One control moves the focus: the Done button. The screen claims
   only the place the cook last reported. The whole step stays visible at 17 pt, so a cook who does not tap still reads
   the truth. The cost is one tap per line, and most steps have one to three lines.
4. Step order: fixed. The app never reorders the recipe. The optional jobs need data that says a step can be done
   early. Without that data, the wait shows the countdown, the cue and "nothing needs you", and no jobs.
5. Steel as a fill: fixed. The cue band and the selected-fill tints are gone. Steel marks the Done button, the timer
   icon and the stepper's plus and minus. The servings control is a stepper (R1).
6. The reading size: 38 pt, as above.
7. Tablet 834: added. It has two columns, ingredients and the step, with the timer dock under the step. The Done record
   is not drawn at 834, because the done lines at the top of the step carry it.

## Answers to the round 1 reviews

From designer B:

- "Every line is 30 pt, nothing is in focus": adopted. One line at 38, the rest at 17.
- "The phone is dense": adopted. No cards, and the Next card is gone. Next is now the "Then" text.
- "1:12:40 twice": adopted (Fix 2).
- "The in-app alarm is easy to miss": adopted (Keep 6).
- "R1 is broken": adopted. A stepper, not a segmented control.
- "The order is still the app's": rejected in part. Done goes one way, because the recipe's order is the only order
  the data supports. The cook takes jobs out of order with "Do it now", and nothing forces it.
- "30 pt falls short of SC-007": adopted. Now 38 pt.

From designer C:

- "Too many boxes": adopted (Fix 1).
- "30 pt fails SC-007": adopted.
- "The in-app alarm is a dock row": adopted.
- "1:12:40 twice": adopted.
- "Goal titles need data nobody has": adopted. Goal titles are gone. A line is a sentence of the step. A step with one
  sentence is one line. The only data need is a sentence split, and a step that cannot be split is shown whole.
- "Do it now loses step 4": answered by board 7. The place stays at step 4. The job becomes the Now, the roast timer
  goes to the dock, and the button reads "Done · back to step 4". Step 5 later shows the job as done.

## Data this design needs

- Which step uses which ingredient, for Now, Later and In already. Without it, the list is one group.
- Which steps can be done early, for the optional jobs. Without it, no jobs show.
- Which steps run together, for the fast warning. The rule is two timers within one step or two steps under 5 minutes
  each. Without it, Before you start still shows the stretch from the step times.

## Not drawn

- The "Set a timer" picker for a wait with no stated time.
- The alarm on web. On web, board 6's notice says that a browser tab rings only while it is open.
  research.md did not cover browser alarms.

## Open question

Is one tap per line acceptable for an experienced cook, or does the step need a "Done with step" control that skips its
remaining lines?
