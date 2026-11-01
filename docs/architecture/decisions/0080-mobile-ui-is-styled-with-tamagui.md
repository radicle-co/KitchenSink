# 0080 — Mobile UI is styled with Tamagui, configured by the design system and held there by guards

- **Status**: Proposed
- **Date**: 2026-10-31
- **Drivers**: Owner rulings, 2026-10-31. Tamagui styles the mobile app, the shared native components included. "Make
  sure all React Native styling is replaced by tamagui." Design patterns, a seam-and-module architecture and correct
  React component architecture are required. Constitution 2.0.0, Principle VII, records the same rule.
- **Relates to**: [ADR-0056](0056-native-navigation-react-navigation-7.md), whose back-handler order every native
  sheet, dialog and popover must keep. `docs/design/uiOverhaul/ownerDecisions.md` D15 (colour comes from roles only) and
  D17 (the scheme follows the system).

## Context

The mobile app listed Tamagui as a dependency and mounted `TamaguiProvider`, but nothing was styled with it. Every
native screen and every `@commise/ui` native component used React Native's `StyleSheet` and inline style objects,
with colours applied by hand from `useTheme()`.

Measured on 2026-10-31, the 366 native modules held 2,513 React Native styling uses in 241 files. They also held 644
theme colour reads in 200 files.

The Tamagui config sat in the mobile app, and it had three faults:

- It held a second colour vocabulary: palette swatches as tokens, and theme keys such as `primary`.
- It named fonts that React Native cannot resolve: a CSS font stack, and the bare family `'Inter'`.
- It fixed the theme to light.

Tamagui was upgraded to 3.1.9 first. Version 3 changes three facts this decision depends on. Each was read in the
installed source, not in the documentation.

- A numeric `lineHeight` is a RATIO of the font size. This is true for a style prop and inside `style={…}`
  (`@tamagui/web` `nativeTextMetrics.ts`, `getSplitStyles.tsx`). Only a `px` string is pixels.
- There is no `pressStyle`, `hoverStyle` or other `…Style` prop. An interaction state is a modifier inside a value,
  for example `backgroundColor="$paper press:$paperPress"`, or a key of the object form. The vocabulary lives in
  `@tamagui/style-grammar`, and it has eight states: `hover`, `press`, `focus`, `focus-visible`, `focus-within`,
  `disabled`, `enter` and `exit`. It reads `active` and `pressed` as `press`. A press modifier makes Tamagui attach its own press
  handling.
- Tamagui's native build cannot load under react-native-web. It requires React Native's Fabric renderer shim and
  `usePressability`. Component tests therefore run its web build.

## Decision

### 1. The design system owns the one Tamagui config

`@commise/ui` exports `@commise/ui/tamagui-config`, a native-only subpath, and the mobile app mounts it. The `./modal`
export is the precedent. Pure projections feed one `createTamagui` call.

- **Tokens** come from `tokens/scale.ts`. There is no colour group, because a colour on native is a theme key and
  never a palette swatch. The zero radius step is `0`, because Tamagui reserves CSS-wide keywords such as `none`.
  The stacking group holds only `0` until a ported component names a step on the scale.
- **Themes** are `light` and `dark`. Each key is a colour role, or a surface tone's `${tone}Fill`, `${tone}Press` or
  `${tone}ChipFill`. The tone keys are generated from the surface-tone table, never listed by hand.
- **Fonts** are keyed by type size and name only registered faces. Each leading is a `px` string. No component reads
  the fonts, because text is set by type role.

### 2. Two config options are one-way doors

- `styleCompat: 'react-native'` lays out by React Native's flex rules. Tamagui's default is the CSS rules, under which
  `flex: 1` also shrinks. Every ported screen is laid out under this option, so a later change re-lays all of them.
- `allowedStyleValues` is strict for colour, radius and stacking, and token-first for space and size. A hex colour or
  an off-scale radius is a type error.

A test builds the real config and pins both options.

### 3. The scheme is read once

`useColorSchemeName`, in `@commise/ui/theme`, is the one reading of the system scheme on native. `useTheme` and the
provider's `defaultTheme` both take it, so Tamagui follows the device's scheme live (D17).

### 4. Guards hold the migration, and each guard is proven able to fail

All guards live in `packages/tools/repoGuards`. Each new rule was written as a failing fixture row before its code.

| Guard                                          | Rule                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Styling ratchet (`nativeStylingRatchet`)       | React Native styling only falls per file. A new native file has none, and a file that imports Tamagui has none.                                                                                                                                                                                                                         |
| G1 (`tamaguiImportRules`, `webTamaguiClosure`) | Only `.native` leaves and the mobile app import Tamagui or the config. App code imports only the Tamagui values the guards classify (`styled`, the views, `Text`, the provider and the config builders), so an unclassified component such as `Sheet` is a finding. A program over the web app's own tsconfig resolves no Tamagui file. |
| G2 (`tamaguiImportRules`)                      | No app module imports Tamagui's own `useTheme`, `useThemeName` or `getTokens`.                                                                                                                                                                                                                                                          |
| G3 (`themeColourReadsRatchet`)                 | Theme colour reads through `useTheme()` only fall per file.                                                                                                                                                                                                                                                                             |
| G4 (`tamaguiTypeProps`)                        | A Tamagui element sets no type part by itself. A `styled()` line height is a `px` string.                                                                                                                                                                                                                                               |
| G6 (`tamaguiPressOwnership`)                   | No Tamagui element owns a press: no press handler, no press modifier, no object-form press key. `PressScale` owns the one press responder.                                                                                                                                                                                              |
| G7 (`tamaguiShorthands`)                       | No Tamagui shorthand (`lh`, `col`, `o`, `pe`, `bblr` and the rest) on a Tamagui element or in `styled()`. Every other guard reads long names, so a shorthand would pass them all. The names come from a config Tamagui itself builds, and a ui config test pins that our config adds none.                                              |
| Text-scale ratchet (`nativeTextScaleCap`)      | A React Native `Text` or `TextInput` without `maxFontSizeMultiplier={FONT_SCALE_CAP}` only falls per file, and a new file has none. The design system's `Text` carries the cap, and a text nested in a capped text inherits it (§8).                                                                                                    |
| Older native guards                            | Labelled views, flatten flips, text pointer events, touch floor, face weight, colour roles, radius and the pattern register also read Tamagui elements and `styled()` definitions.                                                                                                                                                      |

The styling ratchet counts each `StyleSheet.create` entry, each other `StyleSheet` member, and each `style` or
`…Style` attribute. It honours one exemption, `// NATIVE-STYLE-ADAPTER: <reason>`, and only in `ui/src`. The
exemption is for an Adapter over a platform value with no Tamagui path, such as `StyleSheet.hairlineWidth` behind the
`$hairline` token or a third-party list's `contentContainerStyle`. It is never for layout, so the ledger stays small.
Its uses are counted apart, and the marker needs a reason.

A `styled()` config the walk cannot read is a finding, never a pass. Examples are a config that is not a literal
object, a spread, and a function variant.

### 5. A ratchet's baseline only falls, and a better detector re-records by evidence

The two ratchets share `ratchetBaseline.ts`. No file's count is ever above the LOWEST count any version of the
baseline in this history recorded for it, the copy on `origin/main` included. A file absent from a version counts 0
there. So a file the first version did not list can never appear, and a file that fell to zero can never come back. A
comparison with one version only (the first, or main's) would let a count that fell be raised back on a long-lived
branch such as `fix/ingredient-matching`, where every slice lands before main.

No single commit has to stay reachable, and no tag is needed. A squash, a rebase or a deleted branch does not break
the rule. A shallow clone, or a clone without `origin/main`, fails with the command to fetch.

One rise is allowed: a recount. When a detector learns a new shape, each file whose count rose is recounted. The
current detector reads the file as it stood at the version that holds its lowest count. If that old source already
holds the new count, the rise is a recount of existing code. A file absent there, or a rise beyond what its old source
holds, is new styling, and the guard refuses it. No override is written, reviewed or expired.

The exemption ledger takes one more kind of entry: a new design-system Adapter. A path may enter it only if it is in
`ui/src` and no committed version of the baseline ever counted a use in it, so a marker cannot relabel styling that
still owes a migration. From the version that first records it, its count only falls, and once it is gone it cannot
come back. The counted-use map admits no new path.

The first recording was proven once, by hand. Every file in the styling baseline existed at `5979abcd5` with at least
its recorded count.

### 6. Component tests prove structure, and a device proves styling

Native component tests run Tamagui's web build under react-native-web. There a theme token is a CSS variable that
jsdom does not resolve. A component test renders inside the design system's provider (`DesignSystemProvider`, which the
app's provider tree also mounts) and reads a colour or a length through `@commise/ui/testing/tamagui`. Its
`resolvedColour` and `resolvedStyle` follow the element's class rules and the theme variables to a value, as a browser
would, so a test can assert the colour a role paints in each scheme and its contrast. The shared render helpers in
`@commise/test-utils` mount the same provider in a native lane, through a `.native` leaf that the web lane never loads.

The resolver reads what Tamagui's web build emits: the theme rule's selector, the repeated class that a variant uses
to win on specificity, and the shorthands it writes. Its own tests pin each of those, so a Tamagui upgrade that changes
one fails there and not in a component test. jsdom drops some rules as it parses them, such as `font-variant`, so a
style it cannot hold is asserted on the variant table.

A component test proves structure, accessibility, behaviour and the values the web build paints. It does not prove
what a device draws. Maestro on iOS and Android is the evidence for that. `tamaguiRuntimeProbe.native.test.tsx` pins
what the test lane does, so a Tamagui upgrade that changes it fails there.

There are no pixel baselines and no design gallery (owner ruling, 2026-10-31: "I don't care about the before and
after - work with the designer agent"). The designer session judges each ported slice. It runs `staff-ux-engineer`
EVALUATE against the design system's tokens, type scale, both schemes, every state, 320 px, the text cap, touch
targets, accessibility and the owner's standing decisions. Its input is the slice's branch, head commit, component
list and any change in look or behaviour with its reason, plus the screenshots of the slice's dark-mode capture flow.
A High finding blocks the merge.

### 7. Shared native components are built from Tamagui's components, behind `@commise/ui`

Owner ruling, 2026-10-31: "We should use tamagui's components but work with the designer agent to make sure the
results still look like our app. We should continue to use the @commise/ui package for all shared components."

- Each shared component keeps ONE `@commise/ui` export. Its web leaf (`Component.tsx`) is built on Radix, and its
  native leaf (`Component.native.tsx`) is built from Tamagui's component of the same job: Button, Sheet, Dialog,
  Popover and the rest. A screen imports the export, never Tamagui's component.
- G1 opens to each Tamagui component only after the guards are taught it, one component per slice.
- ADR-0056 still binds. Back must reach an open sheet, dialog or popover through our `BackInterceptProvider`, which
  sits outside the `NavigationContainer`. So a Tamagui overlay's open state is wired into our back-intercept seam by an
  Adapter, and neither Tamagui nor React Navigation answers Back first. `staff-architect` blueprints that Adapter
  before the first Sheet or Dialog port, and the port keeps ADR-0056's device check, because jsdom cannot see
  back-handler order.
- Every sheet, dialog and popover is built from Tamagui's parts for everything the user sees (frame, handle, overlay,
  content and the rest), and React Native's `Modal` stays its host (owner ruling, 2026-10-31). Tamagui renders these
  in a Portal, which gives none of what the `Modal` gives today: Back reaching the overlay first, a screen reader kept
  inside it, and the dismiss order. G1 is taught the parts each port uses, never the Portal hosting.

### 8. Text grows with the system's text size, up to 2×

Owner ruling, 2026-10-31: the cap is 2×, which is WCAG 1.4.4's 200 %. It is `maxFontSizeMultiplier: 2`, set once on the
text primitive (`FONT_SCALE_CAP`). React Native 0.86 scales a set `lineHeight` by the same capped multiplier as the
font size: iOS multiplies it by `min(maxFontSizeMultiplier, scale)` (`RCTAttributedTextUtils.mm`), and Android converts
it with `toPixelFromSP(lineHeight, effectiveMaxFontSizeMultiplier)` (`TextAttributes.kt`). So a `px` leading that
holds its text at 1× holds it at the cap, and a test of the tokens at 1× covers every scale. Only a device shows the
clamp itself, so a slice pass checks one dense screen at a system scale above 2×.

Until a shared control is ported, its React Native text carries the same cap as a prop: the button's label, the field
label and hint, the live region, and the input adapter, which is the one place the app renders React Native's input. A
box sized around capped text reads `cappedFontScale`, so it stops growing where its text does. The text-scale ratchet
(§4) holds the count of uncapped native text, so it only falls.

### 9. The migration moves in slices

Slice 0 is this config, the scheme hook and the guards. Each later slice ports components onto Tamagui and lowers the
counts.

- Slice 1 ports the text primitive (`@commise/ui/text`, a `typeRole` variant), the status badge, and the provider the
  app and the tests share.
- Later slices port the remaining shared components, each from its Tamagui counterpart under §7, starting with the
  button. The press and back-handling Adapters are blueprinted before the components that need them.

Each slice adds a dark-mode Maestro capture flow once it renders a theme key, and the designer evaluates it (§6).

## Consequences

- A new native file is styled with Tamagui from its first line. An existing file's counts only fall. The guard
  refuses a rename of an unmigrated file until the file is migrated.
- The design system is the only place a token, a theme key or a font face is defined for native. A change to a role
  or a surface tone moves web, native and Tamagui together.
- Tests that render the provider tree load it at module scope. Inside a test body, the graph's transform counted
  against the test's time limit, and the test timed out under parallel load.
- `@tamagui/style-grammar` and `@tamagui/web` are repo-guards dev dependencies, at the version Tamagui pins. G6
  reads press modifiers with Tamagui's own alias table, and G7 reads shorthands from Tamagui's own table.

## Residual risk

- The tree-wide checks of G1, G2, G4, G6 and G7 see two Tamagui components so far, the text primitive and the status
  badge, so their fixture tables still carry most of the proof. A slice that needs another Tamagui component, such as
  `Paragraph`, classifies it in the guards first, because G1 refuses it until then.
- G6 does not see a press modifier held in a variable and passed to a Tamagui element.
- On a developer machine with a stale local `origin/main`, main's copy of a baseline can be out of date. CI fetches
  full history, so this affects local runs only.
- Nothing searches the web build's output for Tamagui. The resolution check follows TypeScript's imports with the web
  tsconfig, so it misses a runtime `require` inside a package and any Next or webpack alias. A web build in the guards
  job would close that gap.
- `tamaguiScaleKeys.ts` loads three pure design-system modules by file URL at test time (`theme/tamaguiThemes.ts`,
  `tamagui/tamaguiTokens.ts`, `tokens/colors.ts`), because their keys are computed. This is a deliberate exception to
  the package-boundary rule: no dependency graph sees the edge, and repo-guards runs uncached, so nothing goes stale.
  Do not turn it into a package import.

## Alternatives rejected

- **Keep `StyleSheet`, and use Tamagui for new code only.** The owner's ruling rejects it: all React Native styling is
  replaced.
- **Keep the config in the mobile app.** The design system owns tokens and themes. A config outside it held a second
  colour vocabulary and unregistered fonts.
- **Pin the styling baseline to one commit, or protect it with a tag.** A pinned commit breaks under a squash, and a
  tag is a remote ref to protect forever.
- **A reviewed override for a detector change.** Someone writes, reviews and expires it. The recount decides the same
  question from evidence.
- **Run Tamagui's native build in component tests.** It cannot load under react-native-web.
- **Restyle our own sheet, dialog and popover instead of adopting Tamagui's.** It was the first plan, for ADR-0056's
  back-handler order. The owner ruled for Tamagui's components behind `@commise/ui` (§7), and an Adapter keeps the order.
- **Host the overlays in Tamagui's Portal.** We would rebuild Back order, the screen-reader trap and the dismiss order,
  and own them on both platforms. The owner kept React Native's `Modal` as the host (§7).
- **A gated design gallery with pixel baselines.** The owner ruled for designer review instead (§6).
- **Raise a test timeout when a test is slow under load.** Where the test loaded its code caused the cost. How long it
  ran did not.
