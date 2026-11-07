# Design review: native recipe detail, first ported leaves

Author: designer session, EVALUATE mode, 2026-11-01. This is a review, not code and not a spec.

- **Branch:** `fix/ingredient-matching`, head `290514394`. I read the native files and their web twins with
  `git show`. I did not run them.
- **Components:** `detailFrames.native.ts`, `DetailInstructionsSection`, `DetailFooter`, `DetailDescription`,
  `NutritionFigure` and `DetailEmptySection`.

## Verdict: pass with one fix and one ruling

The roles and colours match the web: `readingBody` for the description, `figureStat` over `caption` for a nutrition
figure, `body` in `$inkMuted` for an empty section, and `sectionTitle` for headings. Actions are ghost small buttons,
as on the web.

## Ruling: the section gap (superseded, see designAnswers.md: 32 pt)

The two-column steps stack uses `$8`, which is 64 pt. The web `STEPS_COLUMN` is `gap-10`, which is 40 px, and the
one-column layout already sits 40 apart. So 64 is the old mix-up between the Tailwind scale and the native token
scale. Use 40 in both layouts, and change the frame and its test.

Also state the one-column 40 as one gap, not as 32 plus an 8 margin. One number in one place cannot drift.

## Findings

### Medium

**M-1. A screen reader reads a nutrition figure as two separate items, number first.** Code V.

- On the web, `dt` and `dd` pair the label with its value. On native, the two `Text` nodes are separate, so
  VoiceOver and TalkBack read "320" and then "Calories" as two stops.
- **Fix:** make the `YStack` one accessible element with the label first, for example "Calories, 320". The visual
  order stays the value over the label.

## Still owed

Device screenshots in light and dark mode at 1x and 2x: the description clamped to 4 lines with its More button,
the 5:7 column split on a tablet, a section heading, and the nutrition figures.
