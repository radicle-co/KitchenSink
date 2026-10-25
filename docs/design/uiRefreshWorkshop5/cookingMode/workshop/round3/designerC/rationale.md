# Round 3: the converged cooking mode (built by designer C)

**The idea.** One line of the step is the focus, at the 28 pt title size: the first unticked line, or the line the
cook tapped. Everything else is calm at 13, 15 and 17. The soonest timer is the only other 28. The next step shows
once, in the Next button.

## Owner decision C1: why the reading size changed

The owner rejected 38 pt: "We don't need everything to be massive - we don't want to be treating our users as if they
are hard of vision." C1 overrides the 3 ft legibility argument and SC-007, which were the only grounds for 38. Now the
focus line and the soonest timer are 28. The wait headline is 28 and the rest is 13, 15 and 17. Controls are normal
app sizes: 44 to 56 pt, with Back and Next at 56. The alarm still takes the whole screen, so a cook across the room
sees it, but with normal type and a 56 pt Stop. Larger text stays the user's choice, through Dynamic Type. The space
this frees is left as space. One quiet 15 pt line now gives the shape of the cook ("After this step, one more for your
hands. Then the oven takes over for 1 h 30"), and nothing scrolls.

## What came from where

- **Base (C).** Ticked lines fold into one record ("You ticked 2 lines · Show"). Next ticks nothing. A finished timer
  takes the whole screen once, and a locked phone gets the system alarm. "Alarms are off" is one honest line.
- **Graft 1 (A).** One focus line (now 28). The other unticked lines sit at 17, each with its own tick box.
- **Graft 2 (A).** Get-ready jobs keep the cook's place at step 4. Step 5 later shows them as ready.
- **Graft 3 (A).** Timed lines on Before you start. Ingredients are Now, Later and In already, under the R1 stepper.
- **Graft 4 (B).** All steps opens from "Step 4 of 6 ⌄". Each timer sits under the step that started it.
- **Graft 5 (B).** "Nothing needs you for about 35 min", "Step 5 goes fast", and "checking", never "late".
- **Graft 6 (B).** Get-ready jobs measure what a later step uses, taken from the ingredient list.
- **Drops.** No clock times. The wait headline holds no countdown. No step titles: a step is named by its first line.

## Final fixes (from the round 3 final reviews)

1. **The focus follows the cook (A, CK-008).** A tap on a "Then" line makes it the focus, and the label follows
   ("Line 3 of 4"). Nothing is ticked. Passed lines stay above it under "Not ticked". **B's fix is not adopted:** it
   shows every line at the focus size, which brings back the wall of text and the scroll (CK-034).
2. **The whole next line (A and B, CK-033).** Back is a 56 pt icon button named "Back to step N", so the Next label
   gets two lines of 17. A longer line is cut only at a comma. "For 15 min" stays, and so do the onions and the oil.
3. **One job, one control (B, A).** A get-ready job is a tick row in the wait, and the whole row is the target. It
   opens no screen. An ingredient shows once on every size: it leaves Later while it is a job.
4. **Minors.** "35 min" shows once ("Time the turn"). Stop is a normal 56 pt button (C1). On 834, All steps fills the
   lower half of the step column. Added: step 5 after the jobs, and the moved-focus board.

## Checks run on every screen

- 85 boards: 15 screens on phone 390 in light and dark, plus 834, 1194, 1280 and 768 (the lock screen is phone only).
  The page's `#check` script runs after the fonts load: no text outside its screen, none clipped, no 3-line Next.
- Font sizes: 28, 17, 15 and 13, plus 80 for the system clock on the lock-screen schematic. Colour is never the only
  signal: Done has a tick and a word, Now a ring, a bar and a word, a fast step an icon and words.

## Recipe data each feature needs, and what it does without it

| Feature                        | Needs                                              | Without it                                |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| One focus line                 | Steps split into lines                             | Split at sentence ends, with no model     |
| Next button's preview          | The next step's first line                         | Always present                            |
| Timer offers                   | A time in the line ("20 min", "halfway")           | No offer. "Add a timer" is always there   |
| Ingredients by time of use     | Which step uses which ingredient                   | One group, in recipe order                |
| Get-ready jobs                 | The same ingredient-to-step links                  | No jobs. The wait shows its headline only |
| "Step 5 goes fast"             | An author flag, or an inference the author accepts | No warning                                |
| Timed lines and the shape line | Times in the steps, and the recipe's prep time     | Only the lines that have a time           |

**Not tested:** real cooks, the largest Dynamic Type, Android alarms, browser alarms and the inverse alarm's contrast.
