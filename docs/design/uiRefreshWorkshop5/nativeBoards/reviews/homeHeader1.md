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

## Retake and night greeting

- Web at 1280 and 400% (320 CSS px): the header passes. The greeting and the date wrap whole, and the button stays
  at the end.
- Android night: "Still up?" passes at 1.0 and 2.0, light and dark.

Verdict: Android and web pass. iOS follows after C-1.

For the floating-button lane, not this one: at 320 by 200 CSS px the fixed button sits over "See all". Give the web
page a `scroll-padding-bottom` equal to the button's end room, so a focused control is never hidden under it
(WCAG 2.4.11).

## iOS (HomeTop and HomeTiles, 1x and cap)

Passes. At the cap the greeting stops at `cardTitle`'s ceiling, the date wraps at a word boundary, and the profile
button stays at the end. The Home tiles follow the 320 pt rule: two columns at 1x and one at the cap.

Not this lane: "Recent recipes" and "See all" still grow past their caps, and the tile titles truncate. Those are
the old heading and card, which the card lane replaces. They are judged on the integrated head.

Verdict: the Home header lane passes on all three platforms.
