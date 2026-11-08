# Design review: Tamagui slice 1 follow-up (badge box)

Author: designer session, EVALUATE mode, 2026-11-01. This is a review, not code and not a spec.

- **Branch:** `fix/im-tamagui-slice1b`, commit `81a3badfb` on `a003be117`. I read the code with `git show`. I did not
  check it out and did not run it.
- **Answers:** M-1 and M-2 of `slice1.md`.

## Verdict: pass

M-1 is fixed in code. Both native badges read one box: a 24 pt floor, 1 pt padding and 1 pt edges. A caption line
of 20 pt plus 2 × (1 + 1) fills the floor exactly. So the neutral badge draws 24 pt in every row at 1x. The tests now
compute the drawn height, so a 26 pt box fails them.

M-2 is fixed in code. The card row reads `badgeHeightOf` and no longer restates the badge.

M-3 stays open. No screenshot yet shows the badge above 1x, in light mode, or in the PRO or attention tone. The next
device pass must include those captures before I close slice 1.

## Findings

### Low

**L-1. Above 1x, the neutral badge is 2 pt taller than the PRO and attention badges.** Code V (computed).

- Only the neutral tone has the 1 pt edge. At 1x every tone draws 24 pt, because the floor wins. Above about 1.1x
  the word sets the height, and then neutral is 2 pt taller. At 2x, neutral is 44 pt and PRO is 42 pt.
- `badgeHeightOf` adds the edges for every tone. So the row is right for neutral and 2 pt tall for the others. That
  is harmless, but the badge and the row agree for only one tone.
- **Fix:** give every tone the same 1 pt edge in its own fill colour (PRO edge `$proFill`, attention edge
  `$attentionTint`). Then all tones draw the same height at every scale, and `badgeHeightOf` is exact for all of
  them. Do not take the edge off neutral: it needs the line on the paper ground.

### Noted, not a finding

- The difficulty badge still uses React Native `StyleSheet`, and its word is not on the capped `Text`, so it grows
  past 2x and sets the row. This is recorded in the code and is right until it ports.
- The letter cover tile (H4) and off-scale component text: when they port, Thing 1 will fix both in the shared
  primitives.

## Correction to the L-1 fix

My fix was wrong for the attention tone. `$attentionTint` is a 20 % tint, and React Native paints the fill under the
edge, so an edge in the same tint draws a darker ring. Thing 1 made the PRO and attention edges transparent instead
(`25c21951c`). The edge keeps its 1 pt width, so every tone still draws one height, and the fill shows through
unchanged. I accept this fix.
