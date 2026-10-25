# Round 3: the converged cooking mode (built by designer C)

**The idea.** One line of the step is big enough to read from 3 ft, at 38. It is the first unticked line, or the line
the cook tapped. Everything else is quiet at 17 and 13. The soonest timer is the only other big number. The next step
shows once, in the Next button.

## What came from where

- **Base (C).** Ticked lines fold into one record ("You ticked 2 lines · Show"). Next ticks nothing. A finished timer
  takes the whole screen once, and a locked phone gets the system alarm. "Alarms are off" is one honest line.
- **Graft 1 (A).** One focus line at 38. The other unticked lines sit at 17, each with its own tick box.
- **Graft 2 (A).** Get-ready jobs keep the cook's place at step 4. Step 5 later shows them as ready.
- **Graft 3 (A).** Timed lines on Before you start. Ingredients are Now, Later and In already, under the R1 stepper.
- **Graft 4 (B).** All steps opens from "Step 4 of 6 ⌄". Each timer sits under the step that started it.
- **Graft 5 (B).** "Nothing needs you for about 35 min", "Step 5 goes fast", and "checking", never "late".
- **Graft 6 (B).** Get-ready jobs measure what a later step uses, taken from the ingredient list.
- **Drops.** No clock times. The wait headline holds no countdown. No step titles: a step is named by its first line.

## Final fixes (from the round 3 final reviews)

1. **The focus follows the cook (A, CK-008).** A tap on any line under "Then" makes it the 38 pt line, and the label
   follows ("Line 3 of 4"). Nothing is ticked. The lines it passed stay above it at 17, under "Not ticked". A tap on a
   line can only move the focus, so a stray wet touch costs nothing. **B's fix is not adopted:** after one unticked
   step, B shows every line at 38. On a phone that brings back the wall of 38 pt text and the scroll that this round
   removed (CK-034).
2. **The Next button shows the whole next line (A and B, CK-033).** Back is a 72 pt icon button named "Back to step
   N". That gives the Next label room for two lines of 17. A longer line is cut only at a comma. Every line in this
   recipe fits whole. "For 15 min" stays, and so do the onions and the oil.
3. **One job, one control (B major 2, A minor).** A get-ready job is a plain tick row in the wait, and the whole row
   is the target. It opens no screen, so there is no second control and no back to name. The cook never leaves step 4. On every size an ingredient shows once: it leaves Later while it is a job, and Later says so.
4. **Minors.** "35 min" now shows once: the offer reads "Time the turn". Stop is 112 pt, measured on every alarm board.
   On tablet 834, All steps (with its timers) fills the lower half of the step column, so 834 has no empty half and no
   dock.
5. **Added:** step 5 after the jobs (A), and the moved-focus board.

## Checks run on every screen

- 85 boards: 15 screens on phone 390 in light and dark, plus 834, 1194, 1280 and 768. The lock screen is phone only.
- The page's `#check` script runs after the fonts load. It found no text outside its screen, and none clipped. It
  found no Next label longer than two lines.
- Font sizes: 38, 28, 17 and 13, plus 80 for the system clock on the lock-screen schematic. Back is 72 × 72 or more.
- Colour is never the only signal: Done has a tick and a word, Now has a ring, a bar and a word, and a fast step has
  an icon and words.

## Recipe data each feature needs, and what it does without it

| Feature                       | Needs                                              | Without it                                |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------- |
| One focus line                | Steps split into lines                             | Split at sentence ends, with no model     |
| Next button's preview         | The next step's first line                         | Always present                            |
| Timer offers                  | A time in the line ("20 min", "halfway")           | No offer. "Add a timer" is always there   |
| Ingredients by time of use    | Which step uses which ingredient                   | One group, in recipe order                |
| Get-ready jobs                | The same ingredient-to-step links                  | No jobs. The wait shows its headline only |
| "Step 5 goes fast"            | An author flag, or an inference the author accepts | No warning                                |
| Before you start, timed lines | Times in the steps, and the recipe's prep time     | Only the lines that have a time           |

**Not tested:** real cooks, the largest Dynamic Type, Android alarms, browser alarms and the inverse alarm's contrast.
