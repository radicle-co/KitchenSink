# 0080 — Mobile UI is styled with Tamagui, configured by the design system and held there by guards

- **Status**: Accepted
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
- **Themes** are `light`, `dark`, and `${scheme}_${tone}` for each surface tone (`light_inverse`). In `light` and `dark`,
  each key is a colour role, or a surface tone's `${tone}Fill`, `${tone}Press` or `${tone}ChipFill`, plus the seven
  tone keys `ink`, `inkMuted`, `lineDivider`, `color`, `background`, `backgroundPress` and `borderColor` at the canvas
  tone. On a surface whose ink is not the page's (the inverse one), `inkMuted` and `lineDivider` are that ink laid over
  the fill at a fixed alpha, and muted text holds 4.5:1 there. A sub-theme is
  partial: it holds only those seven keys, and Tamagui merges the rest from its parent. A bare `Text` and Tamagui's own
  parts inside `<Theme name={tone}>` therefore read the surface they sit on. Everything is generated from the
  surface-tone table, never listed by hand. The names are fixed: a tone name holds no `_`, and is not `light`, `dark`
  or a component word (`primary`, `secondary`, `quiet`, `danger`, `selected`). A misspelt name finds no theme and keeps
  the parent's colours with no error, so the built config is asserted to hold every name.
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

| Guard                                          | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Styling ratchet (`nativeStylingRatchet`)       | React Native styling only falls per file. A new native file has none, and a file that imports Tamagui has none.                                                                                                                                                                                                                                                                                                                                  |
| G1 (`tamaguiImportRules`, `webTamaguiClosure`) | Only `.native` leaves and the mobile app import Tamagui or the config. App code imports only the Tamagui values the guards classify (`styled`, the views, `Text`, the provider and the config builders), so an unclassified component such as `Sheet` is a finding. `Theme` is classified, with `name` as its only prop (no `inverse`, `reset`, `forceClassName` or spread). A program over the web app's own tsconfig resolves no Tamagui file. |
| G2 (`tamaguiImportRules`)                      | No app module imports Tamagui's own `useTheme`, `useThemeName` or `getTokens`.                                                                                                                                                                                                                                                                                                                                                                   |
| Tone ownership (`surfaceToneScopeOwnership`)   | Only `ToneScope` imports `SurfaceToneScope`, so a surface states its tone once, to Tamagui's `<Theme>` and to the JS context together. Three overlay roots are on a closed list that only shrinks, and a stale entry fails.                                                                                                                                                                                                                      |
| G3 (`themeColourReadsRatchet`)                 | Theme colour reads through `useTheme()` only fall per file.                                                                                                                                                                                                                                                                                                                                                                                      |
| G4 (`tamaguiTypeProps`)                        | A Tamagui element sets no type part by itself. A `styled()` line height is a `px` string.                                                                                                                                                                                                                                                                                                                                                        |
| G6 (`tamaguiPressOwnership`)                   | No Tamagui element owns a press: no press handler, no press modifier, no object-form press key. `PressScale` owns the one press responder.                                                                                                                                                                                                                                                                                                       |
| G7 (`tamaguiShorthands`)                       | No Tamagui shorthand (`lh`, `col`, `o`, `pe`, `bblr` and the rest) on a Tamagui element or in `styled()`. Every other guard reads long names, so a shorthand would pass them all. The names come from a config Tamagui itself builds, and a ui config test pins that our config adds none.                                                                                                                                                       |
| Text-scale ratchet (`nativeTextScaleCap`)      | A React Native `Text` or `TextInput` without `maxFontSizeMultiplier={FONT_SCALE_CAP}` only falls per file, and a new file has none. The design system's `Text` carries the cap, and a text nested in a capped text inherits it (§8).                                                                                                                                                                                                             |
| Older native guards                            | Labelled views, flatten flips, text pointer events, touch floor, face weight, colour roles, radius and the pattern register also read Tamagui elements and `styled()` definitions.                                                                                                                                                                                                                                                               |

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
come back. The counted-use map admits no new path. Every admitted adapter is also listed here, with its reason, and the
styling ratchet asserts this list and the ledger match in both directions:

- `packages/apps/commise/ui/src/tamagui/tamaguiConfig.native.ts`: `StyleSheet.hairlineWidth` behind the `$hairline`
  border-width token, a density-dependent platform value with no Tamagui source.
- `packages/apps/commise/ui/src/textInput/TextInput.native.tsx`: the `style` of React Native's text input, the one place the
  app renders it. The text size and leading are computed per platform and system scale (`inputTextStyle`: no line height
  on iOS, where one sits the text low), which a static Tamagui style cannot express.

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
- ADR-0056 still binds, and the way Back reaches an overlay depends on what hosts it. Back for an overlay in a `Modal`
  window arrives through that window's `onRequestClose`, because React Native emits no `hardwareBackPress` while a
  `Modal` is up. An `OverlayHost` (an Adapter over our `Modal`) turns every dismiss route (Back, scrim, swipe, close
  control, screen-reader escape) into one `DismissRequest`. The screen that owns `open` answers it, and may refuse.
  Interceptors registered inside a window use that window's own scope, so they fire. `BackInterceptProvider` serves
  the surfaces that are not windows. Neither Tamagui nor React Navigation answers Back first. `staff-architect`
  blueprints `OverlayHost` before the first Sheet or Dialog port, and the port keeps ADR-0056's device check, because
  jsdom cannot see back-handler order.
- Every sheet, dialog and popover is built from Tamagui's parts for everything the user sees (frame, handle, overlay,
  content and the rest), and React Native's `Modal` stays its host (owner ruling, 2026-10-31). Tamagui renders these
  in a Portal, which gives none of what the `Modal` gives today: Back reaching the overlay first, a screen reader kept
  inside it, and the dismiss order. G1 is taught the parts each port uses, never the Portal hosting.

### 8. Text grows with the system's text size, up to 2×

Owner ruling, 2026-10-31: the cap is 2×, which is WCAG 1.4.4's 200 % (`FONT_SCALE_CAP`). React Native 0.86 caps a
text's SIZE with `maxFontSizeMultiplier`, but on Android it does not cap a set `lineHeight`: Fabric's
`TextAttributeProps.kt:42` converts it with `toPixelFromSP(value)` and no multiplier, while the size at `:168` does pass
the cap. A device showed it: at font_scale 3.1 the glyphs stopped at 2× and body lines sat about 74 dp apart, not 48.
Upstream fixed it (#58982), but no release has the fix. iOS caps both (`RCTAttributedTextUtils.mm:230`).

So the design-system `Text` turns system scaling off (`allowFontScaling: false`) and draws its size and leading itself,
from the system scale, through one pure function (`scaledTypeMetrics`). `DesignSystemProvider` reads the scale once and
passes it down through `TextScaleContext`. Text takes it through a `styled.dynamic` carrier and one `.resolve`, the
only resolver the style guards admit. The growth is linear, the same on both platforms, so nothing double-corrects
when React Native ships its fix.

Each role grows to its own ceiling (designer ruling 2026-11-01). `largeTitle`, `barTitle` and `sectionTitle` stop at
1.5× (`DISPLAY_FONT_SCALE_CAP`), because a 2× title pushes content off a phone and both platforms grow large styles
less. Every other role grows to 2×. Navigation chrome, the tab bar and the segmented control that switches views, caps
its labels at 1.5×, and never below 1.3×. A label never breaks inside a word, and a fit test proves it per locale.
Chrome says so with Text's closed `chromeCap` variant (`1.5`, `1.4` or `1.3`), which can only lower a role's ceiling, so
nothing can freeze a label at 1×. A guard admits it only in the tab bar and the view-switch control, and never as a
`styled()` default. A mark drawn on a picture, such as PRO on a card cover, is part of that picture. Text's `pictorial`
variant keeps the mark at its role's own size at every scale, so it cannot grow over the cover's letter. The card must
state the same word in its text, at the scaled size (designer ruling 2026-11-01, M-1). A screen reader then hears the
word once. The status badge sets the variant through its `onPicture` prop. A guard admits `pictorial` only in the badge, and
never as a `styled()` default.
The Google sign-in label is the one fixed-scale site. On iOS it sits beside Apple's system button,
which does not grow, so it stays at 1×. On Android it follows the 1.5× chrome cap. It uses our Button label's
role, `cardTitle`, so our two sign-in buttons read alike. Apple's button draws larger letters. A label that matched them
breaks the type scale, so ours keeps its role (designer ruling 2026-11-01). Its colours are no design-system
role, so it is React Native's own text with `allowFontScaling={false}` and its size and leading from `scaledTypeSize`.
The text-scale detector trusts that only in that file (`FIXED_SCALE_SITES`).
A test of `scaledTypeMetrics` covers every role at every scale; a device covers what is drawn.

Until a shared control is ported, its React Native text carries the 2× cap as a prop: the button's label, the field
label and hint, the live region, and the input adapter, which is the one place the app renders React Native's input.
On Android that caps their size but not their leading, so each moves onto the design-system `Text`. A
box sized around capped text reads `cappedFontScale`, so it stops growing where its text does. The text-scale ratchet
(§4) holds the count of uncapped native text, so it only falls.

React Native's own `Text` is not capped by any of this. On iOS it takes the whole Dynamic Type multiplier (about 3.1× at
accessibility-xxx-large), because it neither turns system scaling off nor sets `maxFontSizeMultiplier`. That was the
cause of the designer's iOS finding C-1 (2026-11-02): the large title and the chips drew at about 3× and broke inside
their words. The design-system `Text` is not at fault: React Native's iOS code returns a size multiplier of 1 when
`allowFontScaling` is false (`RCTEffectiveFontSizeMultiplierFromTextAttributes`), so it stops at its ceiling at any
system scale. Every React Native `Text` still in the text-scale ratchet is uncapped on both platforms until it moves onto
the design-system `Text`; a global default cap is rejected, because it would cap display titles at 2× not 1.5×, leave
the Android line height uncapped, and hide the ratchet.

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
