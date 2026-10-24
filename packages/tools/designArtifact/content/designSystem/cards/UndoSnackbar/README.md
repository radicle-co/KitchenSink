The snackbar a host draws: one short message of at most two lines, with at most one action such as Undo. It uses the inverse surface roles, so it inverts in either theme, and its action has a 44 px target that never wraps. Pointer or focus inside it calls `onPause`, and leaving calls `onResume`, so the host can stop its timer. It rises into place only when motion is allowed. Show it through `useSnackbar().show`, not by mounting it yourself.

On native the action target is 44 pt (48 dp on Android), and onPause/onResume are not wired because the host pauses while a screen reader runs.
