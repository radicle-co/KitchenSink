---
title: 'feat: native Google sign-in and Sign in with Apple on mobile'
type: feat
date: 2026-10-15
status: built (2026-10-15) — staff-architect BLUEPRINT and staff-ux-engineer SPECIFY folded in below; Maestro written, not run
---

# Native Google sign-in and Sign in with Apple

## Owner facts (2026-10-13)

- One iOS app. The iOS bundle ID is `com.radicle-co.commise` (Apple Team `6822556035`, owner ruling 2026-10-16) and the Android package is `io.commise.mobile`, for both stages.
- Apple Team ID `6822556035`. The App ID has only Sign in with Apple (primary).
- Google OAuth client IDs (public, not secrets):

    | Client  | Sandbox (Clerk `nice-fowl-6.clerk.accounts.dev`)                             | Prod (Clerk `clerk.commise.app`)                                     |
    | ------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
    | Web     | `191572900034-br586l3hrkje8c6499tpnkf0h0duuqtc` (in sandbox Clerk, verified) | `686681118292-l1g5nhd9akk3f490f11ikepanb6ikvfj` (live in prod Clerk) |
    | iOS     | `191572900034-7umbfpo56atk161tpu88jup50ma0pscg`                              | `686681118292-325832urtk1g3077qv5mcdrv8q7sji80`                      |
    | Android | `191572900034-entaq2q4ofkgm333h3dks156kbph3cef`                              | none yet — waits for the first release build's signing key           |

    (all end in `.apps.googleusercontent.com`)

- Sign-up collects first name, last name, username and email. A social sign-up asks only for what the provider did
  not supply. Both Clerk instances already require all four.
- Sign in with Apple is built alongside Google (App Store Review Guideline 4.8).

## Facts read from source (the installed `@clerk/expo@4.6.0`, not the docs)

1. **The Google hook reads its client IDs from `Constants.expoConfig.extra`, then `process.env`** —
   `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID` only. It never reads an
   Android client ID: Android's Credential Manager is configured with the WEB client, and the Android OAuth client in
   Google Cloud only has to EXIST (package + SHA-1) for Google to accept the call. So "prod Android has no client" is
   invisible to the app unless the config says so explicitly.
2. **`@clerk/expo-google-signin`'s config plugin reads `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` from the env or
   `config.extra`, and silently does nothing when it is absent.** The iOS Google SDK then fails on tap. One bundle ID
   with two iOS clients means the Info.plist URL scheme differs per build, so it must be decided at PREBUILD.
3. **Cancel does not throw in 4.6.0** (the docs say it does). Google swallows `SIGN_IN_CANCELLED`, Apple swallows
   `ERR_REQUEST_CANCELED`; both return `{ createdSessionId: null, signIn, signUp }`. "Clerk not loaded" returns the
   same shape. So does a sign-up that ended in `missing_requirements` (e.g. the required username).
4. **The hooks act on the LEGACY `client.signIn` / `client.signUp` resources** (Apple through
   `@clerk/react/legacy`'s `useSignUp`, captured at render). The screens use the future `useSignUp()` /
   `useSignIn()` signals. The finish step must act on the resource the hook RETURNED, not on a signal that may or may
   not reflect it.
5. **`signUp.create` always creates a new sign-up id.** A null session is classified by comparing the returned
   resources' ids with the ids captured just before the call: a changed sign-up id in `missing_requirements` is "ask
   for the missing fields"; an unchanged pair is cancel (or not loaded). This stops a cancel from reopening an earlier
   abandoned sign-up.
6. **The Apple hook is iOS-only** (it throws elsewhere). `@clerk/expo`'s plugin writes the
   `com.apple.developer.applesignin` entitlement unless `appleSignIn: false` — today it is `false`.
7. **`@clerk/expo/google` exports only the hook.** `ClerkGoogleOneTapSignIn.signOut` is not in the package's exports
   map, so it is not deep-imported.
8. **The publishable key selects the stage today.** `load-secrets` (CI) and `scripts/fetchSecrets.mjs` (local) put the
   stage's Clerk publishable key in `EXPO_PUBLIC_IDP_PUBLISHABLE_KEY`. `EXPO_PUBLIC_STAGE` is NOT set by the CI test-app
   build, the `e2e` profile, or local dev, so it cannot select anything safely.
9. **The CI Android test app is signed with Expo's template debug keystore**
   (`expo-template-bare-minimum@57.0.31`, `android/app/debug.keystore`):
   SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`,
   SHA-256 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`.
   The sandbox Android OAuth client must carry that SHA-1, or Google rejects the CI app.
10. **The CI emulator image is `default` (no Google Play Services)** — a Google tap there errors instead of opening an
    account sheet. An iOS Simulator with no Apple ID signed in also errors for Apple.
11. **Native sign-up is broken today** (plan 010): `screens/signup.tsx` sends only email + password. Plan 010 D13
    names the shape: a `SIGN_UP_FIELDS` registry and a pure `signUpFieldPlan` over `signUp.missingFields`. This plan
    builds that one shape (D8) and does not invent a second.
12. **Web needs no code.** Clerk's `<SignIn>` / `<SignUp>` render every enabled social connection
    (`ui/src/clerk.ts`: `socialButtonsPlacement: 'top'`). Google is live on both instances. Enabling the Apple
    connection (needed for native) will ALSO render Apple on web, where a production instance needs an Apple Services ID
    and key.
13. **Expo's config loader cannot import a sibling value module** (staff-architect, run): `app.config.ts` importing
    `./src/…/x.js` or `./src/…/x` fails with `Cannot find module`; only a `.ts` suffix loads, which the house rules
    forbid. `import type` works (erased). `@clerk/shared/keys` loads. `expo config --type introspect` runs on Linux and
    prints the Info.plist URL scheme and the `applesignin` entitlement.
14. **clerk-js mutates the resource in place** (`_baseMutate` returns `this.fromJSON(…)`), so "did this attempt create
    a sign-up" is answered by the id STRINGS captured before the call, never by object identity.

## Decisions (staff-architect BLUEPRINT + staff-ux-engineer SPECIFY, 2026-10-15)

- **D1 — One authority, keyed on the Clerk instance.** `app.config.ts` holds `SOCIAL_AUTH_BY_CLERK_INSTANCE`, keyed on
  the frontend-API host from `@clerk/shared/keys` `parsePublishableKey(EXPO_PUBLIC_IDP_PUBLISHABLE_KEY)`. That binding
  is the real invariant: the Google web client must be the one in that Clerk instance's custom credentials. Each row
  states its `instanceType`; a key whose type disagrees THROWS. An unknown `pk_live` THROWS (a production build never
  ships quietly without social sign-in); an unknown or absent `pk_test` turns every provider off. The iOS URL scheme is
  DERIVED from the iOS client ID. `app.config.ts` THROWS if any `EXPO_PUBLIC_CLERK_GOOGLE_*` is in the environment: the
  plugin reads env before `extra` and the hook reads `extra` before env, so a stray variable would make the Info.plist
  and the runtime disagree. No new environment variable, so `turbo.json` `env`, the content key's variable list and the
  manifest are untouched; the content key moves through `$TURBO_DEFAULT$` (asserted).
- **D1a — The table lives inside `app.config.ts`**, because only prebuild needs it (fact 13). The runtime reads
  `Constants.expoConfig.extra` — Clerk's three names (web ID, iOS ID, iOS URL scheme) plus our own
  `socialAuth: { googleIos, googleAndroid, appleIos }`, always a full object. `googleAndroid` is the explicit "Android
  client registered" marker (fact 1). `src/auth/socialAuthConfig.ts` parses `extra` with zod and falls back to all-off.
- **D2 — `app.json` is deleted; `app.config.ts` is the one config.** Plugins `["@clerk/expo", { appleSignIn: true }]`
  and `"@clerk/expo-google-signin"`. `expo-apple-authentication`'s own plugin is NOT added (it repeats the
  entitlement); its other effect, `CFBundleAllowMixedLocalizations: true`, is set in the static `ios.infoPlist` because
  the native Apple button is used (D9).
- **D3 — Prod Android hides the Google button.** Without a registered Android client, Credential Manager answers with a
  status-prefixed error that `ClerkGoogleOneTapSignIn` rethrows as `GOOGLE_SIGN_IN_ERROR`: the button would be broken,
  not degraded. A web-flow fallback (`useSSO`) would be a third sign-in path, needing a Clerk redirect allowlist and
  browser-session handling, built for a window (Play internal testing) with no public users. Reversal: one table row
  and a new build.
- **D4 — Apple on iOS only; Google on iOS only alongside Apple** (App Store Review Guideline 4.8: a third-party login on
  iOS must be offered with an equivalent). One availability policy, `socialProvidersFor(config, os)`. Residual: an
  Apple-only account has no password and cannot sign in on Android (web offers Apple once the connection is on).
- **D5 — Outcome rule**, pure, `classifySocialOutcome(before, result)`, `before` being the sign-in / sign-up id strings
  read from `useClerk().client` at press time: a session id → `complete`; a changed sign-up id in
  `missing_requirements` with no unverified fields → `needsFields`; any other changed id → `unsupported` (including
  `needs_second_factor`); unchanged ids, or Google's not-loaded answer → `cancelled`. A THROWN `SIGN_IN_CANCELLED` /
  `ERR_REQUEST_CANCELED` is also `cancelled`, so a version that throws as the docs say cannot regress it.
- **D5a — Failure rule**, pure, `socialAuthFailure(error)`: network → `auth.networkError`; `GOOGLE_SIGN_IN_ERROR` →
  `auth.googlePlayServicesUnavailable`; Apple's not-available / `ERR_REQUEST_*` → `auth.appleUnavailable`; a Clerk API
  error → `authFailureMessage` (Chain of Responsibility); anything else → `auth.socialFailed`. Everything but a Clerk
  API answer and a network failure reaches `Sentry.captureException` (provider, platform, code — never a token or an
  email).
- **D6 — The finish step is an `AuthGate` screen** (`CompleteSignUpScreen`), because both login and sign-up reach it.
  It calls `signUp.update(values)` on the RETURNED legacy resource (it throws), then `setActive`. "Start over" drops
  the attempt (no call; it expires at Clerk) and returns to sign-in.
- **D7 — Sign-out unchanged** (ADR-0009). No deep import of `ClerkGoogleOneTapSignIn`. Residual: the Google SDK may keep
  the last-chosen account on the device; explicit sign-in still shows the picker.
- **D8 — Plan 012 takes ALL of native sign-up, including plan 010 D13's typed fields**, because both halves edit
  `signup.tsx`. Plan 010 keeps D13's web docstring fix only. Shared shape, at these paths: `src/auth/signUpFields.ts`
  (`SIGN_UP_FIELDS` keyed by Clerk field name, `signUpFieldPlan(missing) → { fields, unknown }`, `normalizeSignUpValue`);
  `src/auth/signUpFailure.ts` (EVERY Clerk error routed by `meta.paramName` to the shown field it names, the password
  included, the rest to the alert — folded in from plan 010's build at the merge); `src/components/auth/SignUpFields.tsx`; `@commise/ui` `InputAutoComplete` gains
  `given-name` / `family-name`. **Merge point for the coordinator.**
- **D9 — Buttons** (staff-ux-engineer): order mark → H1 → brand line → provider group → "or" divider → email form →
  primary → switch link (buildSpec §8). iOS: Apple then Google; Android sandbox: Google; no provider → no group and no
  divider. All three controls 52 pt (`lg`), full width, 12 pt apart — the email primary moves from the default `md` to
  `lg`, as §8 already says. Apple: the native `AppleAuthenticationButton`, `CONTINUE`, `cornerRadius` 26,
  `WHITE_OUTLINE` (light) / `WHITE` (dark). Google: white fill, 1 px `#747775` stroke, `#1F1F1F` text, the official
  colour G, never recoloured — which is why it cannot be built on `Button`, whose glyph takes the label colour. Label
  "Continue with …" on both screens: the same tap may sign in or create an account.
- **D9a — The Google button lives in the mobile app** (`src/components/auth/GoogleSignInButton.tsx`), not
  `@commise/ui`: it is a third-party brand control whose look Google specifies, and web renders Clerk's own. A recorded
  deviation from the SPECIFY's suggestion. Font: Inter `label`, not Google Sans, as the web Clerk button already does —
  a branding risk, recorded.
- **D10 — Busy locks everything** (both providers, the fields, the primary, the switch link); a polite status line
  `auth.socialBusy` sits under the provider group, and provider errors use the same slot (`role="alert"`). Email-form
  errors stay above the primary.
- **D11 — The finish step** asks only for registry fields among `missingFields`, in order first name, last name,
  username. It never draws a password field, and never an email field after a social sign-up (Apple may have given a
  relay address): either missing → `auth.additionalVerification` + Sentry. It never derives the username from the
  name. Per-field Clerk errors route by `meta.paramName`; the rest go to the alert. The username hint states what the
  username is FOR and not its length: the 4–64 bound is customisable per Clerk instance, so Clerk's own error states
  the rule (a recorded deviation from the SPECIFY's `{min}`/`{max}`, which would restate a bound this app does not own).

### Patterns

Registry (`SOCIAL_AUTH_BY_CLERK_INSTANCE`, `SIGN_UP_FIELDS`), Factory (`buildAppConfig`), Anti-Corruption Layer /
parse-don't-validate (`readSocialAuthConfig`), Null Object (the all-off config), Policy (`socialProvidersFor`), Visitor —
an exhaustive switch over a union (outcome and failure rules), Command behind a headless hook (`useSocialSignIn`,
`useCompleteSignUp`, the shape of `useSignOutAndVerify`), Adapter (`useSocialSignIn` over the two vendor hooks), Chain
of Responsibility (`socialAuthFailure` → `authFailureMessage`), state render map (`AuthGate`, already satisfied).
Preserved: ADR-0009's sign-out Command, `authFailureMessage`.

## Build order (each commit typechecks alone; red tests first inside each)

1. Dependencies and the `networkFailure.ts` docstring that claimed `@clerk/shared` is not a dependency.
2. `app.config.ts` + `socialAuthConfig.ts`; `appConfig.test.ts` rewritten; an integration test that runs
   `expo config --type introspect` for the sandbox, prod, unknown-test and unknown-live keys; `test:integration` script,
   config and `_ci.yml` step; `testAppContentKey` asserts `app.config.ts` is an input.
3. The pure rules (outcome, failure, field plan) and the i18n keys.
4. `Input` autoComplete, `SignUpFields`, the typed sign-up (D8).
5. The hooks, the buttons, `CompleteSignUpScreen`, `AuthGate`, component tests.
6. Maestro: `auth/loginFlow` asserts the buttons (an iOS-only branch for Apple); `auth/socialCancel` taps Google and
   cancels the system prompt on iOS (Android is excluded: the `default` emulator image has no Play Services).

## Test tiers

| Tier        | What                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Unit        | table rows and refusals; `socialProvidersFor`; outcome and failure rules; the field plan and its errors |
| Integration | `expo config --type introspect` per key: URL scheme, entitlement, `extra` (fact 13)                     |
| Component   | buttons per platform and config; busy; silent cancel; each error; the finish step; the typed sign-up    |
| Maestro     | written, not run: the buttons present; the iOS Google cancel                                            |
| Playwright  | none — web code is unchanged                                                                            |

Real OAuth cannot be automated: it needs a real Google / Apple account and the provider's own UI.

## What the build changed from the blueprint

- **`AuthGate`'s signed-out state moved into its own component** (`SignedOutSurfaces`). Kept in the gate, the finish
  step would have outlived its session and reappeared after a sign-out; a red test pinned it first.
- **Google's colours are tokens** (`@commise/ui/brands`, `googleSignIn`), not literals in the button: the colour-roles
  guard admits no new raw colour, and a brand colour fixed by its owner is a token, not a role.
- **`@commise/ui/button` exports `BUTTON_VISUAL_HEIGHT`**, so the brand button stands at the `lg` height without a
  second copy of 52.
- **`auth/socialCancel` is recorded in `KNOWN_UNRUN_FLOWS`, not planned**: it must start signed out, so each run would
  pay one more Clerk email-code sign-in against the budget that suite pins. The spine asserts the buttons' presence.
- **Android hardware Back on the finish step exits the app**, as it already did on sign-in and sign-up: the back
  provider is mounted under the gate. Not changed here.

## Residual risks

- iOS Simulator ad-hoc signing with the `applesignin` entitlement: Linux cannot prove it; the first CI iOS rebuild will.
- Whether Clerk accepts the iOS Google ID token's audience: the first real-device sign-in will tell.
- Apple-only accounts cannot sign in on Android; Google accounts cannot sign in on prod Android until its client exists.
- Guideline 4.8's "limits data collection to name and email": the username is asked of every sign-up method equally,
  with its purpose stated.
- Erase should revoke Apple tokens (Apple's account-deletion guidance); not verified for Clerk.

## Owner actions (Clerk dashboard — not changed here)

1. Both instances: Native applications → enable the Native API; add the iOS app (Team ID `6822556035`, bundle
   `com.radicle-co.commise`).
2. Sandbox: add the Android app (package `io.commise.mobile`, SHA-256
   `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`, the CI debug
   keystore). Confirm the sandbox Android OAuth client in Google Cloud carries SHA-1
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
3. Prod Android, after the first release upload: take the Play App Signing SHA-1 / SHA-256, create the prod Android
   OAuth client, add the Clerk Android entry, then set `googleAndroid: true` on the prod row.
4. Apple connection: enable it "for sign-up and sign-in" on sandbox (native only). On prod, do not enable it before an
   Apple Services ID and key exist, or prod web renders a broken Apple button. Configure the private-relay email source.
5. Confirm both instances keep the username length rule that the hint does not restate.
