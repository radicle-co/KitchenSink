The host mounted once per app that gives screens `useSnackbar` and draws the one snackbar on screen. A new snackbar commits the one it replaces, so an undo window is never silently lost. Its status region is always mounted and polite, so a message is announced, and it never takes focus. The timer pauses while the pointer is over the snackbar or focus is inside it. Mount it once, near the root, and ask for snackbars with `useSnackbar().show`.

On native the snackbar floats 16 pt above the bottom chrome, and while a screen reader runs it does not time out at all.
