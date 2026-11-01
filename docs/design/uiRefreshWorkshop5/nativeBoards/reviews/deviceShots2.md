# Design review: device screenshots after the cap fixes (Thing 1, cde16d713)

Author: designer session, EVALUATE mode, 2026-11-01. Source: `~/.local/state/kitchensink/shots/auth/`, three
screenshots. Earlier screenshot folders were lost in a restart, so this covers only these three.

## Verdict: sign-in passes on Android; one fix on iOS sign-in; Home needs its port

## Findings

### Medium

**M-1. iOS sign-in: the Google label is now smaller than the Apple label beside it.** Shot V
(`ios_signIn_axXL.png`).

- Apple's own button does grow a little at accessibility sizes. Our Google label is fixed at 1x, so it is clearly
  smaller and the pair still does not match, which was the point of the ruling.
- **Fix:** on iOS, size the Google label to match the Apple button's label as drawn (measure it at default and at
  the accessibility sizes), not to 1x. If that cannot be read from the system, cap Google at the size Apple draws at
  accessibility extra large. Keep the icon and label centred as a group, like Apple's.

**M-2. iOS Home: the tab icons do not line up.** Shot V (`ios_home_axXL_tabBarBreaks.png`).

- Home has a one-line label, and Recipes and Discover wrap to two lines. So the Home icon sits lower than the other
  two. The icon row must be one fixed row at the top of every tab, whatever the label does. The chrome cap fixes the
  wrapping, but keep the icons top-aligned anyway.

**M-3. iOS Home: the "couldn't load" state shows no way to retry in view.** Shot V.

- "We couldn't load your recent recipes." fills the visible screen, and no retry control shows. If a Try again button
  is below the fold, it must sit directly under the message. If there is none, add one. An error state needs its
  action in view.

### Low

- **Home date:** "Sunday, November..." truncates. It must wrap, per the earlier ruling.
- **Home section header:** at large text, "Recent recipes" wraps beside "See all". When the title does not fit on one
  line, put "See all" under it, so the title keeps the width.
- **Home floating button:** it sits over the error text. The 88 pt end room under the button applies here too.
- **Android sign-in at 3.1:** pass. The Google label fits on one line at the chrome cap, and the title and body
  stop at their caps.

## Not judged here

"Good afternoon" and the Home text are not ported yet, so their size is not final. The tab label breaks are the
known chrome-cap port.
