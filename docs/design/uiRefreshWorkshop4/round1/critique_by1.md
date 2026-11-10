# Round 1 critique by Designer 1 (Carton)

Heuristic judgement, untested with users.

## Render (both options)

- **Tool.** Playwright Chromium.
- **Widths and themes.** 1400 px in light and dark. 390 and 320 px in light.
- **200% text.** I tested at 320 px with the root font size set to 200%. The designers' methods can differ from mine.
- **Result.** No script errors, and no sideways scroll at any size.
- **Other measures.** Colours were measured with culori: ΔE00 and WCAG. APCA used my own implementation of 0.0.98G, checked against the canon's Leaf-on-white Lc 83. DOM sizes came from `getBoundingClientRect`.

## The set

- **The files:** `round0/option1` (Carton, mine), `option2` (Deli Counter) and `option3` (Food Edge).
- **Structure: distinct.**
    - Carton puts one blue block on each screen.
    - Deli Counter stacks full-width food slices, each with a card.
    - Food Edge runs one flush food column down the left edge.
    - Options 2 and 3 differ on composition and type genre (condensed vs humanist). Carton and Deli Counter share heavy condensed names, so those two differ on composition and palette only.
- **Palette: at risk.**
    - Carton and Food Edge are both a cool blue-white ground with a warm red action. On a swatch strip, a stranger can sort them together.
    - **My own breach.** Carton's dark Tomato `#FFA294` is ΔE00 **9.6** from Food Edge's dark Persimmon `#FFA478`. The canon minimum is 15. In light they are 15.8, a bare pass.
    - I tested 12 warm dark tones. All of them landed 4–12 from Carton's dark Tomato, so the set has room for **one** warm-red action in dark. **I will move Carton off the warm family.** The two directions below assume I do.
- **Shared prior.** All three deciding Homes lead on "ready by" clock time.

## Option 2: Deli Counter

**Must survive.** Real photos in full-width slices, so food is the hero of the list. Narrow Archivo, which keeps a
five-line title big at 320 px. The best cook mode in the set: a 28 px step, a timer strip, Next and Previous 68 px tall,
and "Screen stays on". The drawn states. The pistachio ground, which is fresh and not paper. An honest data audit.

**What fails** (most important first)

1. **The action reads as an office suite (§3.2).** Delft `#204A80` is ΔE00 **5.1** from Microsoft Word's `#2B579A`
   ([TechInch](https://techinch.com/blog/The-Colors-of-Microsoft-Office)). On green it reads as a form's Submit.
2. **The signature is a false signifier (§1.2, §2.2 rule 2).** A dot on a stem over a photo is a shoppable-image
   hotspot, which people tap ([example](https://help.the4.co/hc/articles/245/image-hotspots)). The dot is 15 × 15 px,
   about 4 px at thumbnail size, so it also fails §2.3. Fix: remove the dot. Let the card's price setting be the
   signature.
3. **Home re-sorts the library and offers no short choice (§4).** "Quickest first" gives every dish the same reason, and
   the same dish always leads. Fix: three picks with different stored reasons, as Food Edge does.
4. **At 320 px and 200% text, Home ends at "Charred"** and Start cooking is below the fold (§1.4).
5. **My recipes uses 84 × 60 px rounded thumbnails (§6.1),** so the signature is absent where the library lives.
6. **The current-tab label is Delft at about 12 px.** Text below 16 px uses Ink (§3.4 rule 7).
7. **The gate passed Ink at Lc 64.** Ink needs Lc 75. Drop the Pistachio pair, or fix the gate.

**Original:** partly. A card over a photo is common. **Simple:** yes. **Palette:** the ground is right, the action is
wrong.

**Direction: "Pistachio & Bresaola".** Cured meat behind deli glass. No blue that I tried clears Word by 15 and still
reads apart from the ink (15 is my yardstick, not a canon number).

- Light `#6E2C2C`: white label 10.2:1 (Lc 97), link Lc 72–80. Dark `#F0A8B8`: label 9.6:1 (Lc 66), link Lc 64–66.
- ΔE00 to Paprika: 19 light, 15 dark. To Roast (below): 15 and 20.
- Risk: it is 6 from probe v4's Beetroot dark, which is not a canon rule.
- **Push:** carry the slices into My recipes, so the library becomes the counter.

**Not run.** Increased contrast, dark cook mode, Bresaola's full role table, and tests on a device.

## Option 3: Food Edge

**Must survive.** The flush food column, which makes the list itself the image. "Three for tonight", the best decision
aid in the set, with stored reasons: your stars, a collection, and the time it is ready. The Keep screen on switch. The
ice ground. A careful data audit.

**What fails** (most important first)

1. **Two of five tabs go nowhere (§4, refusals).** Plan and Shop do not exist. `mobile/src/navigation/stacks.tsx`
   `rootScreenOf` has only home, recipes and discover. They also add choices on every screen (Hick). Fix: three tabs.
2. **The imagery breaks the option's own refusal.** It refuses "circles, rims, plates", yet every tile is a clip-art
   round plate seen from above. At thumbnail size the signature reads as plate icons in a 2016 flat style (§2.2 rule
   8). Option 2 shows that real photos fit in 70 KB.
3. **The action is an alarm colour (§3.4 rule 3).** Persimmon `#B33A06` is 8.2 from M3's error `#B3261E`
   ([token reference](https://abacktools.com/tools/data/dev-utilities/material-design-color-reference). Material.io
   still lists `#B00020`). Carton is just as close, at 8.3. It is 6.2 from round 3's "Fresh Cut Persimmon", and 3.6
   from Option 2's Danger. It also breaks the thesis "warm food is the warmest thing", because the button is warmer
   than the salmon.
4. **At 320 px and 200% text, the recipe facts clip and overlap the title** ("1 h 5", "Medi"). Fix: put the photo
   above the facts at large text.
5. **A 44 px timer pill inside a sentence opens 38 px line gaps (§1.2 load).** Fix: put the timer below the step.
6. **"Others" with a shuffle icon has weak scent.** Fix: "Show 3 more". The current-tab label is Persimmon at about
   12 px.
7. **Two risks the designer accepted are still open:** a fintech-blue read, and a two-line greeting.

**Original:** modestly. Clip-art hides the column. **Simple:** yes, with three tabs. **Palette:** the ground is right,
the action is wrong.

**Direction: "Cold Light & Roast".** The browned skin of a roast chicken under fridge light, not an alarm.

- Light `#7A3B12`: white label 8.5:1 (Lc 93), link 7.3:1 (Lc 78) on Frost. Dark `#F5B08A`: label 10.4:1 (Lc 69), link
  Lc 65–68.
- ΔE00, light: 15 to M3 error, 17 to Fresh Cut, 16 to Mustard, 25 to Raspberry. Dark: 20 to Mustard, 23 to Raspberry.
- Danger stays a text row, because the lightness ratio is still 1.20.
- **Push:** real photos in the column, with no gaps, so the edge reads as one strip of food.

**Not run.** Cook mode and four states (none of them drawn), increased contrast, Roast's full role table and dark
distances, and tests on a device.
