# Native and web screen boards: plan

Status: amended to the owner's answers of 2026-10-31, with a Home pilot built (section 6). The 25 published
canvases are untouched. Author: staff-ux-engineer. This is a design artefact, not app code.

## The request

Owner, 2026-10-31: check the mobile screens. Style them to match what Tamagui renders. Make separate screens for
mobile and tablet. Name every screen so it says web or mobile. Web follows our Tailwind style guide at 1280, 1024, 768
and a phone width. Mobile is drawn as Tamagui renders it. All 25 canvases are in scope. Tamagui code belongs to another
session ("Thing 1"), and this plan does not change it.

The owner's answers the same day (recorded as T28 to T30 in `ownerFeedback.md`):

1. iPad: "Yes, use 820". This amends P5.
2. "Too many different screen sizes for mobile - pick the most important ones that will work for iPhone, android, and
   iPad".
3. "We should have screens for each feature for web, for each feature of mobile". Publish them as new canvases, and
   keep today's 25 as the archive.

## What already binds this plan

- `ownerFeedback.md` **P5**: "Every round designs phone, tablet and desktop. Tablet is the native 834 and 1194
  boards, desktop is the web 1280 board, and web 1024 and 768 show the breakpoints." The owner amended it on
  2026-10-31 (T28): the tablet board is the iPad at 820.
- **R1, R3, N7, N8, N9** apply to every native board: the pinned ingredients bar, no tabs for ingredients and steps,
  no permanent scrollbar, a chevron-only back on phones, and four tabs (Home, Recipes, Discover, Meal plan).
- Memory `ownerCanvasDecisionsBind`: the owner decisions live in the `…Mobile` boards
  (`RecipeDetailMobile`, `HomeMobile` and others), not in the web `…390` boards. A pilot that started from
  `RecipeDetail390` lost those decisions for six rounds. So every new phone board, web or native, starts from the
  `…Mobile` content.
- CLAUDE.md on `fix/ingredient-matching` (e10b5f000, line 340): "Mobile UI is styled ONLY with Tamagui". No ADR
  covers Tamagui yet. I checked every file under `docs/architecture/decisions/` at e10b5f000.
- ADR-0056: the app draws its own tab bar (`AppTabBar` → `HomeTabBar`) and sets `headerShown: false`. Every
  header on screen is ours, not the system's.

- `tamaguiAudit.md` Part 5 sets four native limits that every native board follows: the bar has no blur and is solid
  `paperRaised` (X1), iOS titles are not balanced (X2), underlines are the platform default (X3), and only a focused
  text field keeps our focus ring (X4). The text-size cap is 2x.

---

## 7. Do the mobile screens need to be updated? Yes.

Today's "Mobile" boards are web pages at phone and tablet widths. `Home390.dc.html` and `HomeMobile.dc.html` are
nearly the same file (180,836 and 180,810 bytes). None of them is drawn the way the native app renders. Here are the
problems, by class. Counts are over the 203 phone boards in `redesignCanvas/boards/`.

1. **There is no device frame.** 178 of the 203 phone boards have no status bar, and no board models a safe area.
   On `ProfileMobile` the back chevron sits about 32 px from the top. On an iPhone that is under the status bar.
   I rendered it with the audit renderer to check.
2. **Web screens appear where the app has its own native screen.** `SignInMobile` is the web Clerk card floating
   on a grey page (rendered and checked). The native app opens on its own `LoginScreen` inside
   `AuthScreenFrame`. 18 phone boards draw a web sidebar. Most are app-wide states and sign in or sign up. The
   native app uses the tab bar there.
3. **Dialogs are web dialogs.** 32 phone boards draw `role="dialog"`. The app calls no `Alert.alert` and no
   native picker (checked at e10b5f000), so each one must become our own sheet (`BottomSheetPanel`) or our own
   centred card. Each needs a decision.
4. **Some layouts React Native cannot draw.** React Native lays out with flexbox only, and has no CSS grid.
    - 103 phone boards use `display: grid`. Most of that is simple (`1fr 1fr`, `repeat(3, 1fr)`, `1fr auto`) and
      turns into a flex row with nothing lost. A tool can convert it.
    - 32 boards use `position: sticky`. The native app pins bars through its own frame (`usePinnedFooter`,
      `pinnedBarHeight` 56), not through sticky CSS.
    - 4 boards use `backdrop-filter` blur. Tamagui does not do that. It needs `expo-blur` or a solid surface.
5. **The tablet sizes are not the common iPads.** 834 × 1194 is the 11-inch iPad Pro up to its 4th generation.
   The common iPad today is 820 × 1180 (section 1).
6. **There is no Android at all.** Android's touch floor is 48 dp, not 44 pt (`touchFloor.native.ts`). Its
   system bars differ, and it has a system Back.
7. **Native-only states are missing.** Examples: keyboard open, a timer alert while the app is closed (T2, T17),
   compact height on a phone held sideways (the `HomeTabBar` compact form, under 480 dp tall), and Android Back closing a sheet (ADR-0056).

Two checks came back clean. `cursor: pointer` (60 boards) and the scrollbar rules (73 boards) are not problems. The
scrollbar rules hide the bar, which is what N7 asks for. Fonts are not a problem either: Tamagui uses the same
bundled Inter and Manrope faces as web (`tamaguiFonts.ts`). Only the status bar uses SF or Roboto.

---

## 1. Native device sizes: three

Sizes are logical: points on iOS, dp on Android. StatCounter counts browser traffic, so it is only a proxy for which
devices our app users hold.

| Board token  | Size (w x h) | Device                                           | Width class (`tokens/layout.ts`) | Evidence                                                                                |
| ------------ | ------------ | ------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| `Iphone390`  | 390 x 844    | iPhone 12, 13, 14, 16e                           | compact, sides 16                | Largest named iPhone size in US mobile traffic, 9.48% (StatCounter, Oct 2026).          |
| `Android384` | 384 x 832    | the most common Android phone size in US traffic | compact, sides 16                | 8.97% US, 7.24% worldwide (StatCounter, Oct 2026). 412 x 915 is not in either top list. |
| `Ipad820`    | 820 x 1180   | iPad 10th gen and iPad Air 4th gen, upright      | medium, sides 16                 | 7.75% of US tablet traffic (StatCounter, Oct 2026). 1640 x 2360 px at @2x.              |

- **Android tablets take the `Ipad820` board.** They have no board of their own. 800 x 1280, the top US tablet size,
  is in the same medium width class as 820, so the same layout applies.
- **The larger and smaller phones are covered by the layout, not by boards.** 393, 402 and 440 wide iPhones and the
  360 wide Android phone all sit in the compact class with the same 16 sides. The 360 case is the wrapping risk. The
  audit renderer checks it as a measurement (section 6), not as a board.
- **No sideways boards.** I checked the two pages where a sideways tablet is likely to change the layout. Home at 1194 shows
  five meal-plan days instead of four, and nothing else moves. Cooking mode at 1194 uses the same two columns as
  at 834. Its only difference is that Before and Done centre their content and actions as one group. Neither is a new layout,
  so neither earns a board. If a later design gives a sideways tablet its own layout, it adds `Ipad1180` for that page
  only.
- **Safe areas** come from `devices.json`, each with its source: iPhone 47 top and 34 bottom (Use Your Loaf), iPad 24
  and 20 (Apple Developer Forums), Android 24 and 24 (a measured table from a third party, not from Google).
  Re-measure all three with `useSafeAreaInsets()` on a simulator and an emulator.

## 2. Web sizes

`Web1280`, `Web1024`, `Web768` and `Web390`. Web 390 is a phone browser, for example a recipe link opened from a
message. Every state gets 1280 and 390. The key states also get 1024 and 768. The 320 px reflow check (WCAG 1.4.10)
is a measurement in the audit renderer, not a board.

## 3. Naming

Every board is `<Screen><State><Platform><Width>.dc.html`, and every name carries its width. There is no bare name
and no default case. Platforms: `Web`, `Iphone`, `Ipad`, `Android`. Examples: `HomeWeb1280`, `HomeWeb390`,
`HomeIphone390`, `HomeAndroid384`, `HomeIpad820`.

- `redesignCanvas/boardNames.py` holds the one parser (`parse`) and the one legacy map (`legacy_to_new`). Its tests are
  `nativeBoards/tests/testBoardNames.py`. I mapped all 505 boards in today's assembled redesign canvas (2026-10-31).
  Each maps once or is dropped on purpose, and no two boards share a name.
- Titles end with the platform and size: "Home (web, 1280)", "Home (mobile, iPhone 390)".
- Canvas slugs: `homeWeb` and `homeMobile`, and so on. Canvas titles: "Commise Screens, web: Home" and "Commise
  Screens, mobile: Home".

| Today                  | New                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `Name` (web 1280)      | `NameWeb1280`                                                                                   |
| `Name1024`, `Name768`  | `NameWeb1024`, `NameWeb768`                                                                     |
| `NameMobile` (390)     | `NameWeb390` (it already is web at 390), and the source of `NameIphone390` and `NameAndroid384` |
| `Name834Mobile`        | The source of `NameIpad820`. Not published itself.                                              |
| `Name1194Mobile`       | Not used. Not published.                                                                        |
| `Name390` (legacy web) | Retired. These lost the owner decisions.                                                        |

**The rename happens at split time.** Source names do not change. `assembleRedesign.py` stops on a name the legacy
canvas lacks. `heights.json`, `extraBoards.json`, `ownerFeedback.md` and the bug-sweep notes all use the old names.

## 4. How native boards are drawn

**What "what Tamagui renders" means today.** Tamagui's themes are the same `role` and `roleDark` colours as web. Its
spacing, radii and fonts are the same `@commise/ui` scale. One native file uses Tamagui and the rest still use
`StyleSheet`, so the boards set the target Thing 1 builds to. `tamaguiAudit.md` lists the config gaps for Thing 1.

**The parts (built, under `nativeBoards/`):**

| File                   | What it does                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `devices.json`         | The three devices: size, OS, kind, insets with sources, touch floor (44 iOS, 48 Android, from `touchFloor.native.ts`).                 |
| `chrome.json`          | The tab bar, the four N9 tabs, the sheet width rule and the home indicator. Each cites the component it comes from.                    |
| `nativeTokens.py`      | Writes `native.css` from `tokens.json` (type roles), and gives the T31 side spacing. It names roles and restates no colour.            |
| `toNative.py`          | The converter (below). Tests: `tests/testToNative.py`.                                                                                 |
| `shell.py`             | The device frame: status bar, safe areas, our tab bar on tab roots, the home indicator, and a dashed line where the first screen ends. |
| `checkNative.py`       | The build check (below). The build stops on any finding.                                                                               |
| `nativeLayouts.json`   | Per-page tablet rules for states that have no tablet board to start from. This is the hand-designed part.                              |
| `buildNativeBoards.py` | The driver: every state of a page, at every device, converted, framed and checked.                                                     |
| `heights.json`         | Each native board's measured height, from the audit renderer.                                                                          |

**What the converter does by itself:**

- CSS grid becomes flexbox, because Yoga has no grid and no `calc()`. A centring grid becomes a centring flex box. A
  grid with no columns becomes a flex column. A grid with columns becomes rows of cells. Each cell is sized by its
  track: `1fr` grows, `auto` hugs, `Npx` is fixed. Invisible spacers keep a short row at its column widths.
- Hover rules and `cursor` are dropped.
- X1 to X4: backdrop blur becomes solid `paperRaised`, balanced titles are dropped on iOS (kept on Android, which has
  a balanced break strategy), underline thickness is dropped, and drawn focus rings are dropped except on a text field.
- The board's own tab bar and status-bar gap are replaced by the shell's. Side spacing is 16 on screens and sheets, on
  phone and iPad (owner ruling T31). `chrome.json` `sideSpacing` holds any exception, and an exception without a source
  stops the build. None is applied yet: the iPad's 20 pt margin is stated only by a third party, and Material's 24 dp
  medium margin was found only second-hand.
- A state with a scrim and a sheet is drawn at the device height, with the tab bar under the scrim, because a sheet
  covers the screen you are on, not the end of the scroll. A bottom sheet on a window 600 or wider is capped at 560
  and stays at the bottom, as `sheetPresentation.ts` does.
- What it cannot convert, it writes to `report.json` and leaves for a person: `minmax()` tracks, grid placement, and
  sticky or fixed positioning.

**What the build check refuses** (`checkNative.py`): CSS grid, `:hover` and `cursor`. It also refuses backdrop blur,
sticky or fixed position, balanced titles on iOS and underline thickness. It refuses weights above 600 and type sizes
off 14, 16, 18 and 28.

**Android and iPhone** use the same body in a different frame: status bar, bottom bar and touch floor differ.

## 5. Which boards exist, and the canvases

**The rule:**

- Every state that exists on that platform: `Web1280`, `Web390`, `Iphone390`, `Android384`, `Ipad820`.
- A native-only state gets no web board. Examples are a timer alert while the app is closed, and Android Back over a
  sheet. A web-only state gets no native board.
- Key states also get `Web1024` and `Web768`. On pages, these are the states that have breakpoint boards today. On
  features, they are the main screen, plus the states with a sheet, a dialog, a pinned bar or the keyboard.
  I estimate 30% of states, and at least 2.

**Canvases:** one web and one mobile canvas per page and per feature, so 50 new canvases. Today's 25 stay as the
archive and are not changed. Mobile boards are three per state (S). The counts come from the 2026-10 split.

| Canvas              |   S | Web boards | Mobile boards |
| ------------------- | --: | ---------: | ------------: |
| home                |   6 |         16 |            18 |
| recipeDetail        |  38 |         84 |           114 |
| cookingMode         |  20 |         80 |            60 |
| editor              |  68 |        144 |           204 |
| library             |  27 |         62 |            81 |
| discover            |   7 |         16 |            21 |
| account             |  20 |         54 |            60 |
| appWide             |   8 |         16 |            24 |
| 17 feature canvases | 183 |        494 |           549 |
| **Total**           | 377 |    **966** |     **1,131** |

Home is measured, not estimated: 16 web boards (28 files) and 18 mobile boards (29 files). The largest canvas, the
mobile editor, is about 204 boards plus 11 shared files, well under the 489 own-file budget `splitScreens.py`
enforces.

**New artifacts (50).** The page canvases are listed here.

`homeWeb`, `homeMobile`, `recipeDetailWeb`, `recipeDetailMobile`, `cookingModeWeb`,
`cookingModeMobile`, `editorWeb`, `editorMobile`, `libraryWeb`, `libraryMobile`, `discoverWeb`, `discoverMobile`,
`accountWeb`, `accountMobile`, `appWideWeb`, `appWideMobile`.

Each of the 17 features also gets a `Web` and a `Mobile` canvas: `featureMealPlan`, `featureGrocery`, `featureNutrition`, `featureImport`, `featureCircle`,
`featureAssistant`, `featureOffline`, `featureNotice`, `featureSubscription`, `featureCreator`, `featureReward`,
`featureRights`, `featureSchool`, `featureChef`, `featureSourceCheck`, `featureDraft` and `featureCookWithMe`.

**`splitScreens.py`** keeps its old mode and gains `--by-platform <outDir> <redesignProject> <nativeOut> <page>`, which
writes `<page>Web` and `<page>Mobile`. Web boards are renamed on the way. Mobile boards come from
`buildNativeBoards.py`. Web canvases copy the redesign `ds/` as before. Mobile canvases copy only `tokens.css`,
`tokens.json`, the fonts, `native.css` and `redesignNative.css` (a converted copy of `redesign.css`), and no
`bundle.js`.

**Photos.** The boards still point at the redesign canvas's photo uploads. Each new canvas uploads the photos its
boards use (Home: `roastChicken`, `padThai`, `pancakes`, `tomatoSoup`) and records them in `photos/assetUrls.json`
under its own slug. Then `photo_urls(<slug>)` repoints them. For a slug with no uploads yet, `photo_urls` now stops with a clear
message.

## 6. Build order and how each batch is checked

**Batch 0 (done): the tools and the Home pilot.** Built from
`assembleRedesign.py <out> .worktrees/daRenames/packages/tools/designArtifact/dist/canvas/project`, then
`buildNativeBoards.py <redesignProject> <nativeOut> home`, then `splitScreens.py --by-platform … home`. Results:

- 18 Home native boards (6 states x 3 devices), all through `checkNative.py`, 0 items in `report.json`.
- Rendered light and dark with the audit renderer: no page errors, no sideways overflow, no clipped or cut-off text
  outside the deliberate sheet states, and every height matches its declared height. I looked at the dark images.
- Converted automatically: every grid on Home (the recipe tiles, the nutrition row, the week, the avatar and icon
  circles), the tab bar, the status bar, the 16 side spacing (T31), the safe areas, and the Pro offer sheet as a one-screen state.
- Designed by hand (`nativeLayouts.json`): the iPad board for the four states with no tablet board to start from.
  On the Empty, error and Loading boards, Today's nutrition and Pick up where you left off sit side by side. Each row
  shows four tiles, as the iPad Home does. Loading also shows four day placeholders. The Pro offer borrows the iPad Home's
  own tiles and week, so it shows the same data.

**Found by the pilot, still open:**

1. Sheet side padding: settled by T31 (16, as the code's `SHEET_EDGE_PADDING_DP`). The native boards now pad 16.
2. The `Web390` boards are the old phone boards renamed. They still leave a 60 px gap for a status bar and draw the
   native tab bar. A phone browser has neither. They need a web pass before the web canvases are final.
3. The Android gesture handle is drawn approximately. The OS draws it, so this is only a likeness.
4. Touch targets: Android needs 48 dp hit frames. The visual controls on Home are drawn at 44, which is fine inside a
   48 hit frame, but the renderer does not check hit frames yet.

**Batch 1 (built 2026-11-01): the seven other pages.** One web and one mobile canvas each, 14 canvases, all under
the budget (largest: the mobile editor, 210 boards and 223 files). The builder now reads all three board formats. The
first is the static `.rd` boards. The second is the cooking-mode and editor mockup `.screen` boards. The third is the
legacy boards drawn from the design bundle's own React Native components, which keep their logic script and load
`bundle.js`. Every mobile board was
rendered light and dark with no page error, no sideways overflow and every height matching.

What the builder now does by itself, on top of the Home pilot:

- A web dialog (a centred card with `role="dialog"`) becomes our sheet in its 'dialog' presentation: bottom-anchored
  with a 36 x 5 handle on phones, a centred card at most 448 wide on the iPad (`sheetPresentation.ts`).
- Every bottom sheet on a wide window is capped at 560 and centred.
- A board's hard-coded device width (390, 834, 1194) and a baked-in 47 pt status gap become the frame's own size and
  inset.
- On the iPad, a modal state with no tablet board of its own is laid over the page's tablet board (`tabletBase`).
- Keyboard-up boards for every screen with a field the cook types in, with the keyboard drawn as a likeness at a
  sourced or marked-approximate height (`devices.json`).
- Sign in and sign up are the app's own full-screen form, not the web card, with Sign in with Apple on iOS.
- Web-only states (`webOnly`: page not found, route loading) get no mobile board.

**Still owed (the hand-pass list):** 119 iPad boards are the phone layout in a centred 640 column. Their state has no
tablet design to start from, and no tablet board to lay a sheet over. That is a holding layout, not a tablet
design. They need a real tablet pass, page by page.

**Then the features, three or four per batch**, in `features.json` order and then `features2.json`. Feature mockups
use the same converter, through a native size prefix in `mockupBoards.SIZES`.

## Asks of Thing 1 (Tamagui owner)

These are questions, not changes made here. The full list is `tamaguiAudit.md` Part 1.

1. Can the tab bar, sheet and pinned bar be Tamagui components that `Commise.Native` exports? Then the boards can draw
   the real thing.
2. Can `tamaguiConfig.native.ts` load under react-native-web in the design bundle?
3. The config gaps: media at 600 and 840, a stacking scale, elevation tokens, the touch floor as a size token, and an
   animation driver.

## Owner answers (2026-10-31), now settled

1. **Tablet size:** iPad 820 upright. This amends P5 (T28).
2. **Fewer sizes:** three native sizes. Android tablets use the iPad board. No sideways boards (T29).
3. **Canvases:** one web and one mobile canvas per page and feature, published new. Today's 25 are the archive (T30).

## Sources

- StatCounter, US mobile screen resolution, Oct 2026: https://gs.statcounter.com/screen-resolution-stats/mobile/united-states-of-america
- StatCounter, worldwide mobile, Oct 2026: https://gs.statcounter.com/screen-resolution-stats/mobile/worldwide
- StatCounter, US tablet, Oct 2026: https://gs.statcounter.com/screen-resolution-stats/tablet/united-states-of-america
- Use Your Loaf, "iPhone 17 Screen Sizes", 2025-10-13: https://useyourloaf.com/blog/iphone-17-screen-sizes/
- iOS device point sizes table (iPad rows): https://gist.github.com/ricsantos/e7baee6885626b9cb87c021a5097623f
- Android Developers, window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Apple's HIG layout page did not return its device table to the fetcher. The iPad sizes above therefore come from
  the gist, and the pixel sizes divided by the @2x scale agree.
- Use Your Loaf, "iPhone 14 Screen Sizes" (updated 2023-09-18): https://useyourloaf.com/blog/iphone-14-screen-sizes/
- Apple Developer Forums, iPad safe area insets: https://developer.apple.com/forums/thread/110724
- edge_to_edge_plus, measured Android insets: https://pub.dev/packages/edge_to_edge_plus
- All checked 2026-10-31.

## Mockup fixes owed (found in UI reviews)

Differences where the board, not the app, is wrong. Fix each in the board source at the next rebuild.

- Sign-in boards (every size) title the screen "Sign in". `buildSpec.md` §8 and the app say "Sign in to Commise".
  Found reviewing Thing 1's Google label (925e3bffe), 2026-11-01.
- No recipe board draws the Pro pill or the Pro cover chip. Add one Pro recipe to the Recipes list and grid boards,
  per `designAnswers.md` 2026-11-02. Asked by Nova Squad, 2026-11-02.
