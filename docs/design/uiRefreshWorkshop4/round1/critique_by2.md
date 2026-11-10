# Round 1 critique by Designer 2

**Render, for both options.** I rendered both files with Playwright: 1400, 390 and 320 px, light and dark, and with
the root font size set to 200%. I measured the phone frames with `getBoundingClientRect` and computed ΔE00 and WCAG
ratios with culori. Neither file scrolls sideways and neither throws a script error.

**The set, for both options.** The siblings are `round0/option1.html` (Carton), `round0/option2.html` (Deli Counter,
mine) and `round0/option3.html` (Food Edge), plus the earlier rounds in `uiRefreshWorkshop{,2,3}/`.

- **Structure: distinct.** Carton puts one coloured block with stacked type on Home. Food Edge puts a column of food
  down the left edge of every list.
- **Palette: twins.** Both use a pale cool blue, blue-black ink and a red-orange action.
    - Sky carton `#B9D8F2` and Glacier `#9DC4E0` are ΔE00 **5.6** apart (hue 244 and 240).
    - The dark-theme actions, Tomato `#FFA294` and Persimmon `#FFA478`, are ΔE00 **9.6** apart. That fails the
      15 that canon §3.2 sets. In light they are 15.8 apart, which passes by a hair.
    - Both swatch strips read as "pale blue, ink and red".

My ruling: distinct in structure, twins in palette. This is heuristic judgement, untested.

## Option 1: Carton

**What must survive.** The name on solid colour with the food in a window, so text never sits on the photo. The one
Tomato button, apart from the carton. Honest reasons ("Your quickest dinner", your own rating). Cook mode's 28 px
steps and 72 px Next and Previous.

**What fails, most important first.**

1. **Home offers one dish, not a choice.** The carton is 458 of 844 px (54%). "Or one of these" starts at y 713, and
   both other dinners start under the tab bar at y 762. That breaks the short choice of canon §4. Fix: make the carton 340 px or less (a 16:9 window and a two-line name), so that two 72 px rows show above the tabs.
2. **The recipe page has a false floor.** The carton is 571 px tall and ends in a black band. The Ingredients
   heading sits at y 783, under the docked Start cooking button (y 781 to 833). Canon §1.4 says the next group must
   show above the fixed bars. Fix: cut about 120 px so that Ingredients and the servings stepper show.
3. **At 200% text the first screen fails.** Home shows the date, the title, the lede and the dish name, but no food
   and no Cook this tonight. Fix: limit the name to three lines and
   keep the button on the first screen.
4. **At thumbnail size the carton reads as a card, not a pack.** It is a blue rectangle with 28 px corners and an
   inset image with 18 px corners. That is the App Store Today card, or an iOS widget. Only the black band says
   "packaging". Fix: give the carton crisp 6 to 8 px folded corners, and print a thin ink keyline around the window.
5. **The tab bar adds Profile.** The shipped tabs are Home, Recipes and Discover (`TabsNavigator.tsx:41-43`).
   The avatar already opens the account, so two doors lead to one place. Fix: keep the avatar and drop the tab.

**Original:** yes; my search found no recipe app with a name on a carton above a food window. **Simple:** yes.
**Palette:** the idea is right. It fails only as a set, in dark mode, against Food Edge.

**The direction.** Carton keeps its palette, because blue is its signature: Tomato `#C41E3A` light, `#FFA294` dark.
Food Edge moves instead.

**One push.** Make it a pack at thumbnail size. Use folded corners and a printed window, and make the carton
shorter, so the shelf shows three dinners and not one box.

**Not run.** Real photos, a live check of App Store screens, and device text-size settings. I emulated 200% text
with the root font size.

## Option 3: Food Edge

**What must survive.** "Ready by 6:45 pm", the best reason in the set: stored total time plus the clock. The Keep
screen on switch. Ticked lines with tick, strike and muted text. "You are here · Step 3 of 5".

**What fails, most important first.**

1. **The rows group the wrong way.** In a list, the photos sit **3 px** apart, and each title sits about 13 px
   from its photo. The photos fuse into one strip, so the eye reads a column. That breaks proximity (canon §1.2:
   group gaps at least 2×). Fix: 12 to 16 px between rows.
2. **My recipes is too loose to scan.** The header ends at y 302 and each row is 136 px, so 3.5 recipes show
   per screen, in planning mode where density helps. Fix: 72 to 88 px rows here, and keep the big column for Home's picks.
3. **Plan and Shop are tabs for features that are not built.** The shipped tabs are Home, Recipes and Discover,
   and the persona refuses unbuilt features. Fix: remove both.
4. **The 200% text pass is staged.** The fixes hang on a `.x2` class that the test setup adds. With a real 200%
   root size, the first screen holds the date, the greeting and "Three for tonight", with no food and no primary.
   It also hides "Picked from…" from the people who enlarge text (WCAG F69). Fix: an em-based media query.
5. **The zero has a slash or a dot.** The page shows "2Ø min", "22Ø °C" and "8ØØ g". Recipe numbers read as
   code. Fix: a face with a plain zero.
6. **The recipe hero shrinks** to 226 × 318 px, 42% below full width. Fix: full width. "Good evening, Eliza" is
   the median greeting; name the screen.

**Original:** partly. The column is the standard thumbnail row, enlarged, with inset, corners and gaps removed:
mostly subtraction (canon §6.1). **Simple:** yes. **Palette:** a twin of Carton, and Persimmon is ΔE00 6.2 from
round 3's Persimmon `#C93A1E`.

**The direction: palette "Steel & Carrot."**

A fridge's stainless inside and one carrot. Ground Steel `#F1F3F4` (L 0.963). Action Carrot `#B34500` (5.01:1 on
Steel, white label 5.57:1) and `#FFAE66` dark (10.3:1), ΔE00 19.1 and 17.8 from Tomato. No content hue: the food is
the colour. Re-derive Warning. The ground nears neutral, so the composition must carry the look.

**One push.** Take the field guide's real lesson, plate and facing caption: Home's three picks each get a full-height
picture and a ruled caption, with clear gaps. Do not stretch the column across every list.

**Not run.** Cook mode (not drawn), device text settings, a live store search.

## Sources

- [W3C, Failure F69: resizing text causes clipped or obscured content](https://www.w3.org/WAI/WCAG22/Techniques/failures/F69.html)
- [Atkinson Hyperlegible (Wikipedia)](https://en.wikipedia.org/wiki/Atkinson_Hyperlegible)
- [Spurlock Museum on the Atkinson zero](https://spurlock.illinois.edu/blog/p/updated-website-typefaces/454)
