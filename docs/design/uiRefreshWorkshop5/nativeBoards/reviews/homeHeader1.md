# Design review: Home header lane, Android (fix/im-homeheader)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/homeHeader/android/`
(HomeTop, light and dark, 1.0 and 2.0). Board: `HomeAndroid384`.

## Verdict: Android passes

- One row: the greeting and the date stacked at the start, the profile button at the end, centered on the pair.
- The greeting is `cardTitle`. The test account has no name, so "Good morning" and the `user` glyph are correct.
- The date has no year. At 2.0 it wraps at a word boundary ("Monday, November / 2"), which is accepted.
- No condensed bar, and no separate button row.

Not this lane: the heading text ("Recent recipes") and the tile titles that truncate at 2.0 ("Peruvian Lentil
Tray..") belong to the card lane (ruling c). The debug toast covers the bottom strip and is a dev-build artifact.

Still owed before merge: web, iOS (after C-1 in `mergedUiIos1.md`) and the night greeting.

## Web (HomeTopWeb390 and 1280, 100% and 200%)

Passes at 1280: one row, the greeting and the date at the start, the profile button at the end, no year.

The 390 at 200% shot is a 195 CSS px viewport, below the 320 px reflow floor (WCAG 1.4.10), so it does not judge
the header. Retake it as 1280 at 400% (320 CSS px). The card text in these shots belongs to the card lane.
