# Modernising Commise, and where Liquid Glass belongs (answer B)

⛔ **DESIGN ANSWER. NOT PRODUCTION CODE.** It answers the owner's note: "I like the color palette we have,
mostly, but our app feels… dated. I like Liquid Glass effect too." I did not read the other designer's
answer.

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`.
- **What I looked at:**
    - the 2026-10-08 captures in `.local-sandbox/uiAudit2026-10-08/`. They were taken **before** slices 0
      and 1 landed (commits `2c801c190`, `87c7b206c`).
    - the code as it stands after those slices
    - Apple's HIG Materials page, two WWDC25 sessions and the June 2025 newsroom post
    - the Expo SDK 57 docs, MDN, NN/g, and React Navigation docs
      All were read today and are listed in §9.
- **Not user evidence.** Judgement is labelled.

## §1. The answer in short

1. **The app does not look dated because of its colours.** It looks dated because it still uses the
   **2020–21 "glassmorphism" style**: frosted white gradients on every bar _and on the recipe cards_,
   gradient buttons, a pill shape on everything, and soft shadows on every box. Remove that style, and
   the same palette reads as current.
2. **Keep the palette's hues.** Seafoam, sand, charcoal and coral stay. **Warm up the neutrals.** Today
   the greys are cool blue-greys on a warm sand page, and that temperature clash reads as unconsidered.
3. **Liquid Glass belongs only on the floating navigation layer**, exactly as Apple's guidance says:
    - the tab bar
    - the condensed title bar
    - the editor's action bar
    - the detail page's jump bar
    - the hero's back and ⋯ buttons
    - menus and sheets
      It never goes on content: cards, forms, ingredient rows, steps or nutrition.
4. **Be honest per platform:**
    - **iOS 26:** use Apple's real material, through the system tab bar and `expo-glass-effect`.
    - **Android:** use solid tonal surfaces, because Material has no Liquid Glass and our blur does not
      run there.
    - **Web:** a light translucent material on a few small fixed bars only, which stays readable even
      with no blur.
5. **Nothing in `ownerDecisions.md` needs to change.** I propose **one addition**: "Glass is for the
   floating navigation layer only. Content is never glass." With it, recipe cards lose the glass they
   carry today.

## §2. What reads as dated today, and why

| What                                                | Where (capture or code)                                                                                                                                                                                               | Status after slices 0 and 1                                       | Why it dates the app                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frosted **white-gradient glass** on every bar       | `HomeTopBar.tsx:82` (`from-white/50 to-white/40 backdrop-blur-[16px]`), `HomeTabBar.tsx:56`, `HomeSidebar.tsx:74`. All home, recipes and discover captures at 390 and 1280.                                           | **Still present**                                                 | It is the "glassmorphism" trend of 2020–21: a milky gradient with a white hairline. Liquid Glass reads differently. It lenses, it is not milky, and it adapts its tint to what is under it (WWDC25 "Meet Liquid Glass"). Today's frosting is the old idiom. (Judgement on the trend history.) |
| **Glass on recipe cards**                           | `RecipeCard.tsx:279` (the card's fill is `from-white/70 to-white/50 backdrop-blur-[16px] saturate-[140%]`), and `RecipeCard.glass.native.test.tsx`. Every grid card in `recipesLibrary/1280.png` and `home/1920.png`. | **Still present**                                                 | Apple: `Don't use Liquid Glass in the content layer.` Glass on content muddies the hierarchy, because every card then competes with the navigation (HIG Materials, WWDC25).                                                                                                                   |
| **Gradient primary buttons**                        | `ui/src/button/surfaceClass.ts:89` (`bg-gradient-to-br from-seafoam to-ocean-dark`)                                                                                                                                   | **Still present**                                                 | A gradient on a flat control is a 2015–2020 tell. Current systems (iOS 26, Material 3) fill primary buttons with one flat colour. Depth belongs to the material, not to the button. (Judgement.)                                                                                              |
| **Coral outline pills** on Back, More, Prev, Save   | `recipeDetail/390.png`, `recipeNewStep2Rows/390.png`. In code, 2 files still use `border-coral`.                                                                                                                      | Ruled out (owner), **2 files left**                               | Saturated outlines on every control mean no focal point (Von Restorff). Coral outline on sand is 2.23:1.                                                                                                                                                                                      |
| **A pill shape on everything**, inputs included     | step 2 rows (`recipeEditStep2/1280.png`)                                                                                                                                                                              | Ruled out (owner: inputs are rectangles). Not built yet.          | Shape carries no meaning. A row of pill inputs reads as a row of buttons.                                                                                                                                                                                                                     |
| **Playfair on card titles and numbers** ("3o min")  | `recipeDetail/390.png` stats, `home/1920.png` card titles                                                                                                                                                             | Type roles landed in slice 1. Screens adopt them in later slices. | A display serif at 16–18 px in a dense card reads as decoration. Its old-style figures misalign numbers.                                                                                                                                                                                      |
| **Grey box with a broken-image glyph** for no photo | `home/1920.png` (third card)                                                                                                                                                                                          | Not built yet (`RecipeCover`)                                     | It reads as a loading failure.                                                                                                                                                                                                                                                                |
| **Six-item tab bar plus a bell and search icons**   | every phone capture                                                                                                                                                                                                   | Ruled out (owner IA). Not built yet.                              | It is the 2016 "everything in the bar" pattern. Two of the icons are dead buttons.                                                                                                                                                                                                            |
| **Tinted boxes around headings**                    | Recipes and Home captures                                                                                                                                                                                             | **Removed in slice 1**                                            | The box-in-a-box. Fixed.                                                                                                                                                                                                                                                                      |
| **A narrow centred column at 1920**                 | `home/1920.png`, `recipeDetail/1920.png`                                                                                                                                                                              | Layout tokens landed in slice 1. Screens follow.                  | A stretched phone layout on a desktop.                                                                                                                                                                                                                                                        |

**What this means:** about half of the "dated" feeling is already ruled out and is waiting to be built.
The other half (frosted chrome, glass cards, gradient buttons) has no ruling yet. §3 to §7 cover it.

## §3. Palette: keep the hues, warm the neutrals, flatten the fills

The owner likes the palette, and its hues are its character, so they stay: seafoam `#31807A`, ocean-dark
`#2A6B65`, sand `#FAF6F0`, charcoal `#2D3436`, coral, sky, premium and honey.

What changes is **temperature**. Today the neutrals are cool blue-greys: slate `#636E72`, mist `#B2BEC3` and
pewter `#858F93`. Pearl `#F5F5F5` is a dead neutral. All of them sit on a warm sand page. Cool grey on warm paper
looks muddy and unconsidered. Warm neutrals make the same seafoam look fresher, because the page and the
greys finally agree. That is judgement. The figures below are computed.

| Token (the value changes, the meaning does not) | Today     | Proposed                   | Contrast check (computed today)                                                                                                  |
| ----------------------------------------------- | --------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `inkMuted` (slate)                              | `#636E72` | **`#6B645C` "stone"**      | 5.41:1 on sand (was 4.87), 5.83:1 on white (was 5.24). Better, not worse.                                                        |
| `lineControl` (pewter)                          | `#858F93` | **`#8A847C` "taupe"**      | 3.70:1 on white, 3.44:1 on sand, 3.21:1 on linen. It passes SC 1.4.11 on every surface. The old pewter falls to 2.86:1 on linen. |
| `lineDivider` (mist)                            | `#B2BEC3` | **a warm mist, `#C9C1B6`** | Decorative only, so exempt                                                                                                       |
| `surfaceMuted` (pearl)                          | `#F5F5F5` | **`#F3EEE6` "linen"**      | Charcoal 10.98:1 and stone 4.54:1 on it                                                                                          |

- **The primary button becomes one flat seafoam fill.** Hover and press use ocean-dark. The gradient goes.
  White on seafoam stays at 4.67:1. This is a `@commise/ui/button` value change (`surfaceClass.ts`), and
  the design system is mine to change.
- **These are value changes, not meaning changes**, so every consumer keeps working (`visual-design.md`:
  changing a token's value is safe, changing its semantics is a migration). Slice 1's contrast tests
  re-run on the new values.
- **Dark mode** is the other big "fresh" signal in 2026. ReciMe users ask for it, and a rival markets
  against its absence (`docs/competitive/01RecimeTeardown.md` §6A). It is a second design, not an inversion
  (`visual-systems.md`). I recommend designing it right after the overhaul, on the surface tokens slice 1
  laid down. It is not part of this answer.

## §4. Liquid Glass, per Apple

- **What it is.** "A translucent material [that] reflects and refracts its surroundings, while dynamically
  transforming to help bring greater focus to content" (Apple Newsroom, 9 June 2025). It "dynamically
  bends, shapes, and concentrates light in real time", where earlier materials "scattered light" (WWDC25
  session 219, "Meet Liquid Glass").
- **Where it goes.** "Liquid Glass forms a distinct functional layer for controls and navigation elements,
  like tab bars and sidebars, that floats above the content layer" (HIG, Materials).
- **Where it does not go.** `Don't use Liquid Glass in the content layer.` The one exception is a
  transient control such as a slider being dragged (HIG). And: "Always avoid glass on glass" (WWDC25 219).
- **Use it sparingly.** "Limit these effects to the most important functional elements in your app"
  (HIG).
- **Two variants:**
    - **Regular** "blurs and adjusts the luminosity of background content to maintain legibility". It is
      for "alerts, sidebars, or popovers".
    - **Clear** is "highly translucent", only for "components that appear over visually rich backgrounds"
      such as photos. With a bright image under it, Apple suggests a 35% dark dimming layer (HIG).
- **Accessibility, built into the material** (WWDC25 219):
    - Reduce Transparency "makes Liquid Glass frostier and obscures more of the content behind it".
    - Increase Contrast "makes elements predominantly black or white and highlights them with a
      contrasting border".
    - Reduce Motion "decreases the intensity of some effects and disables any elastic properties".
    - "These are available automatically whenever you use the new material." So a **faked** glass gets
      none of this for free. That is the main argument for using Apple's real material on iOS.
- **The legibility risk is real.** NN/g (Raluca Budiu, 10 October 2025) found text on translucent
  layers over images often too low in contrast, and called the motion "distraction". Apple's own answers
  are the regular variant, scroll-edge effects, dimming and the settings above. **So our rule is that no
  text we own sits on the clear variant**. The one exception is the white 44 px back and ⋯ discs on the
  hero. They carry an icon, not text, on a dimming layer.

## §5. Bringing glass to our stack, honestly

### 5.1 iOS 26 (Expo SDK 57, React Native 0.86.3)

| Need                                                                                                               | Use                                                                                                                                                                                            | Facts (read today)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The tab bar**                                                                                                    | **The system tab bar**: React Navigation's native bottom-tab navigator (`createNativeBottomTabNavigator` from `@react-navigation/bottom-tabs/unstable`), which wraps `UITabBarController`      | It "uses native components on iOS and Android", it gets Liquid Glass on iOS 26, and it needs an app built with **Xcode 26**. It requires React Native 0.79+ and Expo SDK 53+, so we qualify. It is marked **unstable**.                                                                                                                                                                                                                                           |
| Custom floating pieces: the condensed title bar, the editor action bar, the detail jump bar, and the FAB container | **`expo-glass-effect`** `GlassView`, `glassEffectStyle="regular"`. `GlassContainer` groups pieces that sit near each other.                                                                    | Expo docs (SDK 57): "GlassView is only available on iOS 26 and above. It will fallback to regular View on unsupported platforms." Use `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()`. Caveat: setting opacity to 0 on a `GlassView` or a parent stops the glass from rendering at all. So fade it with its own `animate` option, or with Reanimated. **It is not in `mobile/package.json` today** (only `expo-blur` is), so it is a new dependency. |
| Menus, sheets and alerts                                                                                           | Native presentations pick up the material automatically. Our custom `@commise/ui/sheet` uses a `GlassView` (regular) background on iOS 26. **The sheet's form fields keep their white fills.** | "Standard components from system frameworks pick up the appearance and behavior of this material automatically" (HIG)                                                                                                                                                                                                                                                                                                                                             |
| iOS 18 and earlier                                                                                                 | Paper surfaces (opaque), the same as Android                                                                                                                                                   | Do not stack `expo-blur` frosting on old iOS. That is the dated look this answer removes.                                                                                                                                                                                                                                                                                                                                                                         |

**The cost of the tab bar change.** Today the native app has no navigation library. `AppRoot.tsx` switches
on a `useState` union. The native tab navigator brings React Navigation. With it come the per-tab stacks
proposal A already wanted, and the iOS back swipe I flagged in proposal B (§3.4). That is a
`staff-architect` blueprint, about 1 week. **The 70% path without it:** a `GlassView` behind our own tab
bar. It gives the look, but not the system behaviour, such as the bar shrinking as you scroll.

### 5.2 Android

- **Material has no Liquid Glass.** Material 3's answer to "this floats above content" is **tonal
  elevation**: a surface colour a step darker or lighter, plus a shadow. Reports that Material 3
  Expressive adds background blur, with a user toggle to turn it off, come from secondary press coverage
  (androidfaithful.com, via search). I did not find them in Google's own guidance today, so this
  answer does not build on them.
- **Our blur does not run there anyway.** The repo's own probe (`ui/src/surface/blurSupport.native.ts`)
  records that `expo-blur` defaults to `blurMethod: 'none'` on Android and renders a plain translucent
  view, which looks like a rendering fault. And `GlassView` falls back to a plain `View`.
- **So Android gets solid tonal surfaces.**
    - Bars at rest: a **linen** fill, level 0.
    - Bars with content scrolled under them: a **paper** fill with a level-2 shadow.
    - Sheets and menus: paper at level 3.
      This is Material's own idiom, so it reads as current on a Pixel rather than as a cheap copy of iOS.
      Following the platform rather than porting one to the other is the corpus rule (`visual-systems.md`).

### 5.3 Web

- **Support.** `backdrop-filter` is Baseline 2024, available in current browsers since September 2024
  (MDN, read today). Keep the `-webkit-` prefix for older Safari.
- **The trap.** A parent with `opacity` below 1, `filter`, `mask` or `will-change` becomes a "backdrop
  root", and the blur then sees only part of the page (MDN). Glass bars must sit directly under `body`'s
  stacking context.
- **Accessibility.** `prefers-reduced-transparency` is **not Baseline** (MDN: "Limited Availability").
  So the opaque state cannot depend on it. The rule: **every web glass surface is legible with the blur
  off**.
    - Its tint is paper at 88% (charcoal on it is about 12:1), and blur only adds depth.
    - Under `@media (prefers-reduced-transparency: reduce)` and under `forced-colors`, the tint goes to
      100%.
- **Performance.** A backdrop blur re-samples what is under it on every scroll frame. On a low-end phone
  that costs most where the blurred area is large or many surfaces blur at once. This is judgement, from
  how compositing works, not a published measurement. So:
    - blur only **small fixed bars**: the tab bar (64 px), the condensed title bar (56 px), the editor
      action bar (72 px) and the jump bar (48 px)
    - a blur radius of 16 px or less
    - no blur on anything that scrolls, and none on cards
    - Playwright's trace on a throttled CPU (4× slowdown) checks that scrolling Discover keeps frames
      under 16 ms with the bars on.
- **Acceptable:** a bar fixed to a screen edge, with content scrolling under it. Its tint is strong enough
  to read alone.
- **Harmful:** glass on a card, a list row, a form or a dialog body. Also any surface where text sits on
  the material while busy content moves under it.

## §6. Type, space, shape, motion, depth and icons that read as 2026, not as a fad

| Area       | Choice                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**   | Keep Playfair for names (large titles, recipe titles, the greeting). Track it slightly tighter at 34–40 px (letter-spacing −0.01em, judgement). Inter for everything else, with section titles **bolder and left-aligned**. Numbers in Inter tabular figures (decided).                    | Apple's 2025 design system: typography "now bolder and left-aligned to improve readability" (WWDC25 session 356). A serif used only for names is a lasting editorial choice, not a trend. |
| **Space**  | Fewer boxes, more air _between_ groups (32 between sections, 16 within). Content on the canvas, not in cards, wherever it is not one tappable object.                                                                                                                                      | Proximity groups better than borders (`visual-design.md`). Removing containers is the main thing that makes a 2026 interface look calm.                                                   |
| **Shape**  | **Concentric radii.** An inner radius equals the outer radius minus the padding. Card 20 with 8 px padding gives a cover image of 12. A sheet is 28, and its first row is 28 minus the padding. Capsules only for controls (decided). Rectangles for inputs (decided).                     | WWDC25 356: "concentric shapes calculate their radius by subtracting padding from the parent's". Mismatched nested radii are the reason a rounded UI looks "off".                         |
| **Depth**  | Content is **flat**: level 0 or 1, a hairline, at most `shadow-sm`. Depth belongs only to the floating layer (glass or tonal, level 2 and 3).                                                                                                                                              | Mirrors Apple's two layers. One elevation ladder, one meaning per level (`visual-systems.md`).                                                                                            |
| **Motion** | Springs, critically damped, on native. One signature motion: the check toggle's overshoot (decided). On iOS 26 the material morphs: a bar shrinks, and a menu grows out of its button. That is **the system's** motion, not a second brand motion. We do not imitate it on web or Android. | The one-signature-motion rule stays intact, and Reduce Motion is honoured by the system material automatically (WWDC25 219).                                                              |
| **Icons**  | Lucide at a 2 px stroke on both platforms (decided). **Exception:** in the iOS system tab bar, use the matching SF Symbols (`house`, `book`, `safari`). The system bar expects them and renders them with the material's vibrancy.                                                         | Platform convention inside a platform component (Jakob's law). Outside the system tab bar, Lucide keeps glyphs the same across platforms. Judgement.                                      |

## §7. Exactly where glass goes, and where it must not

| Surface                                                                                              | iOS 26                                                                       | Android                         | Web                                    | Notes                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab bar**                                                                                          | ✅ the system tab bar (Liquid Glass)                                         | tonal: linen, level 2 on scroll | ✅ light material: paper 88% + blur 16 | the most visible use, and the one Apple names first                                                                                                                                   |
| **Condensed title bar** (after the large title scrolls away)                                         | ✅ `GlassView` regular, with the scroll-edge effect                          | tonal                           | ✅ light material                      | the large title itself sits on the canvas, never on glass                                                                                                                             |
| **Editor action bar** (Preview, Publish, Save changes)                                               | ✅ regular                                                                   | tonal                           | ✅ light material                      | Publish stays a **solid seafoam** button on top of it. A filled button on glass is "a thin overlay", not glass on glass (WWDC25 219).                                                 |
| **Detail jump bar** and the editor's phone section bar                                               | ✅ regular                                                                   | tonal                           | ✅ light material                      | navigation that floats over content                                                                                                                                                   |
| **Hero back and ⋯ buttons**                                                                          | ✅ **clear** variant on a 35% dimming layer, 44 px                           | paper discs at 92%              | paper discs at 92%                     | the one use of the clear variant: over a photo, as the HIG describes                                                                                                                  |
| **Menus, sheets, popovers**                                                                          | ✅ regular (system, or `GlassView` for our sheet). Fields inside stay white. | paper, level 3                  | paper, level 3 (no blur)               | a sheet's body holds forms, so web and Android stay opaque                                                                                                                            |
| **FAB** ("New recipe")                                                                               | **solid seafoam**, the same as today                                         | solid seafoam                   | solid seafoam                          | It is the one primary action. Its white label must keep 4.67:1 over any photo that scrolls under it, which tinted glass cannot promise. iOS 26 surrounds it with system glass anyway. |
| **Desktop sidebar** (web, 840 px and wider)                                                          | not applicable                                                               | not applicable                  | ❌ opaque linen                        | It sits _beside_ the content, not over it, so there is nothing to see through. Glass there is decoration.                                                                             |
| **Snackbar**                                                                                         | ❌ opaque charcoal                                                           | ❌                              | ❌                                     | A transient message must stay legible: white on charcoal is 12.68:1 (NN/g's legibility finding)                                                                                       |
| **Delete dialogs**                                                                                   | the system alert where native, paper otherwise                               | paper                           | paper                                  | destructive copy must be read, not looked through                                                                                                                                     |
| **Recipe cards**, list rows, collection cards                                                        | ❌ **never**. Remove today's `GlassCard` fill.                               | ❌                              | ❌                                     | The HIG rule on the content layer (§4)                                                                                                                                                |
| **Forms**: inputs, the ingredient read rows, the step textareas                                      | ❌ never                                                                     | ❌                              | ❌                                     | content layer, and text entry needs a solid field                                                                                                                                     |
| **Recipe content**: ingredients, steps, nutrition, tags, chips, empty states, the section index rail | ❌ never                                                                     | ❌                              | ❌                                     | content layer                                                                                                                                                                         |

**Never glass on glass.** A control sitting on a glass bar uses a fill or the material's own vivid text, never a second glass.

## §8. `ownerDecisions.md`: keep, and one addition

- **The canvas wash stays.** It also helps the glass: a material needs something behind it to bend, and the
  wash gives a soft, colour-consistent backdrop where content is sparse. No change.
- **Coral off controls stays.** It fits the "one action colour" logic Liquid Glass relies on. No change.
  The two remaining `border-coral` files must still be fixed.
- **One signature motion stays.** The system material's own morph on iOS is platform behaviour, not ours
  (§6). No change.
- **Proposed addition (needs the owner's yes):**
    - "**Glass is for the floating navigation layer only.** Tab bar, condensed title bar, action bar, jump
      bar, hero buttons, menus and sheets."
    - "On iOS 26 it is Apple's real material. On Android it is tonal surfaces. On web it is a light
      material that reads without blur."
    - "**Content is never glass**: the recipe cards' glass fill comes out."
- **Also needs a yes**, because it is a dependency and navigation change: the native tab bar moves to the
  system tab bar through React Navigation (§5.1). The fallback is `GlassView` behind our own bar.

**Where it fits the build order.**

- The palette values and the flat primary go into the tokens slice. They are value changes, and slice 1's
  tests re-run on them.
- Removing glass from cards goes into the cards slice.
- The glass bars go into the shell slice, with `expo-glass-effect` and the navigation change.
- On web the light material is a few class changes on four bars. On iOS it is the system tab bar plus
  `GlassView` in four places.

Tests:

- Playwright: each bar stays opaque under `forced-colors`, and stays legible with `backdrop-filter`
  disabled.
- Vitest: `GlassView` renders only where `isLiquidGlassAvailable()` is true, with the paper fallback
  elsewhere.
- Maestro on an iOS 26 simulator: screenshots with Reduce Transparency on and off.

## §9. Sources (read 2026-10-08)

- Apple, Human Interface Guidelines, **Materials** (Liquid Glass): the functional layer, the rule against glass in
  the content layer, "Use Liquid Glass effects sparingly", the regular and clear variants, and
  the 35% dimming layer. Read from `developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`.
- Apple, WWDC25 session 219 **"Meet Liquid Glass"**: lensing, adaptivity, "Always avoid glass on glass",
  the navigation layer, Reduce Transparency, Increase Contrast and Reduce Motion, scroll-edge effects.
- Apple, WWDC25 session 356 **"Get to know the new design system"**: concentric shapes, capsules, and type
  "bolder and left-aligned".
- Apple Newsroom, 9 June 2025, "Apple introduces a delightful and elegant new software design".
- Expo SDK 57, **`expo-glass-effect`** docs: `GlassView`, `GlassContainer`, iOS 26 only with a View
  fallback, the availability functions, and the opacity caveat.
- React Navigation, **Native Bottom Tabs Navigator** docs: `UITabBarController`, Liquid Glass on iOS 26
  with Xcode 26, and the RN 0.79+ / Expo SDK 53+ requirement. It is marked unstable.
- MDN, **`backdrop-filter`** (Baseline 2024, backdrop roots) and **`prefers-reduced-transparency`** (not
  Baseline, experimental).
- NN/g, Raluca Budiu, "Liquid Glass Is Cracked, and Usability Suffers in iOS 26" (10 October 2025):
  legibility and motion problems.
- Secondary, **not relied on:** press reports of Material 3 Expressive background blur
  (androidfaithful.com, androidauthority.com, via search).
- **Repo:**
    - `HomeTopBar.tsx:82`, `HomeTabBar.tsx:56`, `HomeSidebar.tsx:74`
    - `features/recipes/src/card/RecipeCard.tsx:279`
    - `ui/src/button/surfaceClass.ts:89`
    - `ui/src/surface/blurSupport.native.ts`
    - `mobile/package.json` (`expo-blur` present, `expo-glass-effect` absent, RN 0.86.3, Expo ~57.0.17)
    - `ownerDecisions.md`
    - commits `2c801c190` and `87c7b206c`
- **Judgement:**
    - the trend-dating of glassmorphism and gradient buttons
    - the cool-on-warm temperature clash
    - the −0.01em tracking
    - the SF Symbols exception
    - the web blur performance budget, which is to be measured, not assumed
