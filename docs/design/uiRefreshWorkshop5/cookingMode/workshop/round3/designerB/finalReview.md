# Designer B: final review of the converged design, round 3 (heuristic judgement, untested with cooks)

## My grafts

- **G4 All steps:** landed. It opens from "Step 4 of 6 ⌄". Timers sit under their step. On 1194 and 1280 it is the
  only place a timer shows. Each step is named by its first line, so it needs no titles.
- **G5 Plain words:** landed. "Nothing needs you for about 35 min", "until the potatoes timer rings", "Step 5 goes
  fast", and "Checking · 10 min past its 1 h 10". There are no clock times while cooking, and the headline keeps one form.
- **G6 Get-ready jobs:** landed, built from ingredient links. But "Do it now" makes a 10-second job into a new screen.
  See Major 2.

## Defects (no blockers)

- **Major 1, the focus line lags a cook who never ticks (CK-008, brief §3b.4).** Fix: let the screen follow the cook.
  Once a cook moves past a step with lines left unticked, they are a cook who does not tick. From then on, show each
  step's lines all at 38, with no "Line N of M". This is C's truthful round 2 form, and it scrolls. A cook who ticks
  keeps the single focus. There is no toggle, and both views stay true.
- **Major 2, one job has two controls (Fix 2).** The job screen has a tick box and "Done · back to step 4". On 1194,
  "1 tbsp flour" shows twice: as a Later row with a tick box, and as a job with "Do it now". Make a job a tick row
  in the wait, like the Later rows. Keep "Do it now" only for a job long enough to need its own screen.
- **Minor 1:** Back on the job screen has no stated target. Say "Back to step 4", or drop it, since Done already
  goes there.
- **Minor 2:** "Lift the chicken onto a board..." cuts mid-phrase. The rationale promises cuts only between
  ingredients.
- **Minor 3:** tablet 834 leaves the bottom half of the step column empty. Next or the dock can sit higher (P5).
- **Minor 4:** the in-app alarm's Stop looks shorter than 112 pt on the phone boards. Check it against the rationale.

**Ready for the canvas?** Yes, once Majors 1 and 2 are fixed. Not checked: contrast on the inverse alarm, the largest Dynamic Type, and
Android and browser alarms.
