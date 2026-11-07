# Design review: Tamagui port of the sign-in and sign-up screens

Author: designer session, EVALUATE mode, 2026-11-01. This is a review, not code and not a spec.

- **Branch:** `fix/im-tamagui-auth`, head `1496401fa`, against `12617d798`. I read the diff with `git diff`. I did not
  check it out and did not run it.
- **Components:** `AuthHeader`, `AuthSwitchLink`, `AuthCodeFields`, `SignUpFields`, `SocialSignInButtons`,
  `GoogleSignInButton`, and the sign-up and finish-sign-up screens.

## Verdict: pass, with screenshots still owed

Every line of the screens' own text now goes through the design system's `Text` with a type role and a theme colour.
The sizes and colours match what each line used before: brand `sectionTitle`, title `largeTitle`, prompts `body`,
and errors, status and "or" `meta`. So the look does not change at 1x, and the text stops growing at 2x.

`largeTitle` now ignores the container class. That is safe today because all three classes are equal, and a test
holds that. If the iPad title ever gets its own size, the shared `Text` must read the container class again.

The sign-up link now wraps instead of showing "Create an accou..". This follows the rule that a control's label
is never cut off. Its 48 pt target stays.

The Google label stays React Native with Google's own colours, capped by prop. That is right, because no theme role
holds Google's colours. The Apple button is drawn by the system, so its text is not ours to cap.

## Still owed

- Device screenshots at 1x, 2x and above 2x, in light and dark, on Android and iOS. I need to see the link wrap, the
  title at 2x, and the field placeholders.
- At 2x, a placeholder can clip inside a one-line field. If the clip is at the end of the hint and the field still
  reads as empty, that is accepted. I will judge it from the screenshots.

## Findings

None in the code.

## Device check (Android, fix/im-tamagui-ds at 8ff3bec6c)

Pass. At 2.0 and 3.1, in light and dark, the sign-in and sign-up screens stop growing at the cap. The field labels,
the hint and the button labels now share the capped `Text`, and every control can be reached by scrolling. The
placeholders fit on one line, "Create an account" and "Sign in" do not truncate, and the hint sits closer to its
field than to the next label.

Still open: the Google label's 1.5x chrome cap on Android and fixed size on iOS, which Thing 1 builds next.
