# Round 2 critique by Designer 2

Heuristic judgement, untested with users.

**Render.** I rendered both round-1 files with Playwright: at 1400, 390 and 320 px, in light and dark, and with a
real `html{font-size:200%}`. I screenshotted every phone frame and read each image. Neither file scrolls sideways or
throws a script error. I computed ΔE00, WCAG ratios and OKLCH with culori, and I checked data claims against
`recipe-service`.

**The set.** The three files are `round1/option1.html` (Carton), `round1/option2.html` (Deli Counter, mine) and
`round1/option3.html` (Food Edge). The earlier rounds are in `uiRefreshWorkshop{,2,3}/` and `round0/`.

- **Structure: distinct.** Carton shows one coloured pack with stacked type. Deli shows full-width slices with a
  price card. Food Edge shows a list with the image flush left.
- **Palette: distinct.** The strips read as "white, sky and tomato", "pistachio and cured red" and "steel and yolk".
- **Dark actions, ΔE00:**
    - Tomato `#FFA294` to Prosciutto `#FBD7D7`: **15.7**, a pass by a hair.
    - Yolk `#F7D84E` to Tomato: 36.7.
    - Yolk to Prosciutto: 32.6.

## Option 1: Carton

**What must survive.** The name printed on colour with the food in a window, so no text ever touches the photo. Home now
shows all three dinners above the tabs. At 320 px and 200% text it is still clearly a carton. Keep cook mode: 28 px
steps, labelled 72 px Previous and Next, a fixed timer strip.

**What fails, most important first.**

1. **Two targets lead to one place, and the button's label is wrong.** The carton is a link to the recipe.
   **Cook this tonight**, 16 px below it, has a play icon, which promises cook mode, but the file says it "opens the
   recipe at the ingredients". That breaks information scent and Hick's law. The fix: start cook mode at "Gather
   ingredients" with the screen kept on, or label the button "Open recipe".
2. **In dark mode, the brightest shape on Home is the facts band, not the food.** The band flips to Squid ink
   `#EEF2F5` (L 0.96), a 358 × 46 px bar at 16.7:1 against the ground. It outshines the dish and gives glare in a dim
   kitchen. The fix: keep the band near-black in dark (for example `#05080B`), with Shelf text on it.
3. **My recipes is the platform default in its default order:** segmented control, search, chips, then rows with
   76 × 57 photos. Nothing on it says Commise (canon §6.1). The draft row's empty window is a sky box with a rounded
   outline, and at 76 px it reads as a disabled text field.
4. **The food is clip-art.** The flat SVG salmon and chili sit on round plates, and in the 76 px rows they read as
   circle crops. This is the "dated" signal the owner names in his first sentence. Use photographic stand-ins.
5. **Calm.** The cooking state adds a footnote under the button: "kept on this phone… not saved to your account yet".
   A worry raised mid-cook. Show it only if the place is actually lost.
6. **Signifier.** Cook mode's "Why one layer?" is a grey block with no chevron, so it does not look like it opens.

**Original:** yes. I found no shipping recipe app that prints the name on a carton above a framed window. **Simple:** yes, and the list of new interactions is empty. **Palette:** right and
complete. One residual: Tomato is ΔE00 5.8 from flag red, next to sky and white.

**One push.** Give the pack a pantry. Make **Collections** a vertical two-column shelf of cartons: each collection's
name is condensed on Sky, over a window of its cover, with crisp 8 px corners and no shadow. The library then
becomes the one screen only Commise has.

## Option 3: Food Edge

**What must survive.** The cool steel ground under warm food. Yolk is a food colour, and no recipe app ships it.
"Ready by" is the best reason in the set. Keep the neutral "Start 8 min timer" buttons, the Custard current step,
and the Keep screen on switch.

**What fails, most important first.**

1. **Home's data contradicts itself.** At 6:12, Green curry (25 min in the library) shows "Ready by 7:05 pm" and is
   ranked last. It is the quickest dish and should read 6:37. Dal is 35 min, so it should read 6:47, not 6:52. Two
   reasons are also not served by a list read:
    - "You gave it 5 stars": `viewerRating` is on detail reads only (`recipeResponse.ts:64`).
    - "In your Weeknights": collection membership is not on a list item either.

    The data audit names only the sort gap.

2. **You cannot choose by looking, which is this option's own sign of success.** The dal and the curry are
   yellow and green textures with no edge or vessel. Without the titles I cannot name them. Fix: keep one identifying
   feature in each crop.
3. **Start cooking splits the list.** It sits 10 px below pick 1 and 16 px above pick 2, so proximity gives it to
   neither. It sits in the upper middle (y 380 to 432), not low in reach. Nothing says which dish. The fix: 8 px under pick 1, 24 px before pick 2, labelled "Cook shakshuka".
4. **It fails the closest-app test.** Yellow on the iOS grouped grey with white rows is Apple Notes, whose accent is
   yellow ([GadgetHacks](https://ios.gadgethacks.com/how-to/sick-yellow-links-notes-make-them-any-color-you-want-with-these-hidden-iphone-ipad-and-mac-settings-0385154/)).
   The tab pill is the stock Material 3 active indicator
   ([Flutter](https://api.flutter.dev/flutter/material/NavigationIndicator-class.html)). The signature differs from a
   media-object row only by its margin.
5. **At 320 px and 200% text, the plate becomes an 80 px banner.** Start cooking touches the tabs, and its label
   fills the pill.
6. **False signifier.** The first-run "+" tile is a plain `div`. It looks tappable, and it duplicates the button.
7. **Edit is only at the page foot,** about 1700 px down, on the cook's own recipe. Put it in the nav bar.
8. **Cooking state.** "Three for tonight" shows one pick.

**Original:** partly. **Simple:** yes. **Palette:** the hues are right, but the arrangement is Notes. The sibling
table misquotes my dark action as `#FFD7CF`. It is `#FBD7D7`, at 29.5, which still passes.

**One push.** Remove the white grouped rows. Set the captions straight on Stainless. Make the plates 50% wide and run
them the full height of their pair, with a 12 px gap inside a pair and a 28 px gap between pairs. Food, not a settings
table, carries the screen.

## Not run

- App-store screenshot checks: the searches return text only.
- Increased-contrast mode, OS text-size settings (I emulated them with the root font size) and device tests at 60
  and 90 cm.
- Screen-reader passes.
- Colour-blind simulation of either palette.
