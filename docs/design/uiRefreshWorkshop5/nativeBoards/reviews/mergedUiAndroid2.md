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

Corrected 2026-11-02. The board puts the handle and the email in the header, which breaks owner rulings S2 and T8
in `ownerFeedback.md`. So the board is wrong there, and the owner rulings win.

1. Header: the 72 pt disc, then the display name in `cardTitle`. With no display name, it shows "@username" (T8).
   The "Profile" large title stays above it. The disc stays the photo control (`AvatarField`) as it is today.
2. Keep the Display name, Username and Email rows. They are the one place the username and the email appear (S2).
3. Group order: the account rows, Preferences (Food data sources), Sign out, Danger zone. Leave out Subscription,
   AI and connected apps and the Privacy and rules group until their pages ship.
4. A long email wraps. It never truncates.
