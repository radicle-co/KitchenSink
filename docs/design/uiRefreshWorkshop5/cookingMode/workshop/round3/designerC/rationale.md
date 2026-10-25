# Round 3: the converged cooking mode (built by designer C)

**The idea.** One line of the step is the focus, at the 28 pt title size: the first unticked line, or the line the
cook tapped. Everything else is calm at 13, 15 and 17. The soonest timer is the only other 28. Back and Next are a
quiet pair, so the focus line leads.

## Owner decision C1: why the reading size changed

The owner rejected 38 pt: "We don't need everything to be massive - we don't want to be treating our users as if they
are hard of vision." C1 overrides the 3 ft argument and SC-007, the only grounds for 38. The focus line, the wait
headline and the soonest timer are now 28, and the rest is 13, 15 and 17. Controls are 44 to 56 pt. The alarm still
takes the whole screen, with normal type and a 56 pt Stop. Larger text stays the user's choice (Dynamic Type). The
freed space stays empty, apart from one quiet 15 pt line on the shape of the cook. Nothing scrolls.

## What came from where

C's base: a true tick record, Next ticks nothing, a full-screen alarm and an honest "Alarms are off". From A: one focus
line, get-ready jobs that keep the place, timed lines on Before you start, and ingredients as Now, Later and In already.
From B: All steps with each timer under its step, plain words ("Nothing needs you for about 35 min", "Step 5 goes
fast", "checking", never "late"), and jobs drawn from the ingredient list. Dropped: clock times, a countdown in the
headline, and step titles (a step is named by its first line).

## Final fixes (from the round 3 final reviews)

1. **The focus follows the cook (A, CK-008).** A tap on a "Then" line makes it the focus ("Line 3 of 4"), and ticks
   nothing. B's fix (every line at the focus size) is not adopted: it brings back the wall of text (CK-034).
2. **The whole next line (A and B, CK-033),** on up to two lines, cut only at a comma. It now sits above Back and Next.
3. **One job, one control (B, A).** A job is a tick row, the whole row is the target, and it opens no screen. An
   ingredient shows once: it leaves Later while it is a job. **Minors:** "35 min" shows once, and 834 has no empty half.

## Owner feedback on the published canvas (2026-10-25)

1. **Next is not the loudest thing (P4).** The steel slab with the next line in it pulled the eye off the current
   line. Next is now a neutral raised button the same size as Back. Steel shows only on its chevron and on the word
   "Next" over the preview. The next line is a quiet ink preview above the pair: "Next · step 3", then the line.
2. **Back is easy.** "Back" has the same size and weight as "Next step" (52 pt, C1). Both are taps, never swipes.
3. **Getting in.** "Start cooking" is the one primary action on Recipe detail, above Edit recipe and Screen on, which
   keep their pair (R4). During a session it reads "Continue cooking", with the step and time left under it. Home's
   "Pick up where you left off" (H1) has the same button. Continue goes straight to the step. When the cook comes
   back, the step shows one quiet line: "Welcome back. You left at step 4, 25 min ago. The roast kept going", with
   "Start from step 1". It is not a dialog, so it costs no tap. The canvas Recipe detail boards carry the same entry.

## Checks run on every screen

- 105 boards (15 cooking screens at 390 light and dark, 834, 1194, 1280 and 768, plus 4 entry screens). The `#check`
  script finds no text off-screen or clipped. Sizes: 28, 17, 15, 13, and 80 for the system clock on the lock screen.

## Recipe data each feature needs, and what it does without it

| Feature                        | Needs                                              | Without it                                |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| One focus line                 | Steps split into lines                             | Split at sentence ends, with no model     |
| Next-step preview              | The next step's first line                         | Always present                            |
| Timer offers                   | A time in the line ("20 min", "halfway")           | No offer. "Add a timer" is always there   |
| Ingredients by time of use     | Which step uses which ingredient                   | One group, in recipe order                |
| Get-ready jobs                 | The same ingredient-to-step links                  | No jobs. The wait shows its headline only |
| "Step 5 goes fast"             | An author flag, or an inference the author accepts | No warning                                |
| Timed lines and the shape line | Times in the steps, and the recipe's prep time     | Only the lines that have a time           |

**Not tested:** real cooks, the largest Dynamic Type, Android alarms, browser alarms and the inverse alarm's contrast.
