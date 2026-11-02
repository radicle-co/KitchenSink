# Design review: merged UI on Android, second set (error, empty, populated Home, Profile)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/mergedUi/android/`
(the error, empty and populated files). Boards: the published mobile canvases. This is the merged UI, not the
redesign lanes. The Home header and card differences are already in `mergedUiAndroid1.md` and in the lanes, so they
are not repeated here.

## Verdict: two fixes and one Profile build

## Home load error

1. "Try again" draws as bare text with a glyph. buildSpec §4.2 makes it a secondary button (outlined, 44 pt
   target). Build it as the secondary `Button`.
2. At 2x its label is clearly larger than "See all", which uses the same label role. It does not follow the cap.
   Moving it to the `Button` fixes this too.

## Recipes empty

Passes at 1x and 2x, light and dark. The buttons wrap neither label, and the text stops at the cap.

## Populated Home

The old layout. It is covered by the Home header and card lanes. Nothing new.

## Profile (`ProfileAndroid384`)

The app is the old Profile. Build it to the board:

1. Header: a 72 pt initials disc, then the display name (`cardTitle`), "@handle" and the email (`meta`, `inkMuted`)
   stacked beside it. Today the app shows an empty disc with a camera badge and the handle in a large title.
2. Remove the Username and Email rows. They live in the header now. Display name stays the first row.
3. Groups in order: Display name; Subscription; Preferences (Food data sources, AI and connected apps); Privacy and
   rules (Your data, Rules and policies); Sign out; Danger zone (Close account, Erase my data).
4. Accepted differences: Subscription, AI and connected apps and Your data have no feature on this branch, so leave
   them out until they ship. Build "Rules and policies" only if its page exists. Otherwise leave it out too.
5. A long email wraps. It never truncates.
