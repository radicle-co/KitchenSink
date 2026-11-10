# Home, 390 px phone (Designer 0, probe v1)

**Pick: Direction A, "Last on the counter".** A cook most often goes back to the dish they just used. So that dish
is the biggest thing on the screen. Everything else is quiet and standard.

## Frame card

- **Job:** "Get back to what I was making, or start a new one." Planning mode: seated, dry hands (canon §4).
- **Success:** a return visit starts with one tap on the hero. **Misleading sign:** people like the hero but still
  open the Recipes tab to find a recipe (§1.1, aesthetic-usability).
- **Cut first ideas:** a greeting and date header, a 2×4 grid of shadowed cards, and skeleton cards with fake
  charts for Coming soon.

## Direction A: layout, top to bottom

1. **Large title "Home"** (34 pt bold). Standard tab bar at the bottom, Home current. No greeting or date.
2. **"Recent recipes"** heading (20 pt semibold). On its right, the text link **"All 142 recipes"** (Action colour,
   48 px target). The Recipes tab is the second way in.
3. **Hero: recent recipe 1.** Full-width photo, 358 × 239, 16 px corners, no shadow, no text on the photo. Below it,
   the title in 24 pt semibold (two lines, then an ellipsis), then "Opened Tuesday · 45 min" in Muted. One link.
4. **Row: recent recipes 2 to 8.** Seven tiles, each a 132 px square photo and a two-line 15 pt title. The next tile
   always peeks 48 px at the right edge.
5. **"Coming soon".** Three plain rows on one Plate surface: icon, name, one line, "Soon" in Muted. Meal plans:
   "Plan the week from your recipes." Grocery list: "All your ingredients in one list." Daily nutrition: "See what
   you ate today." No chevron, fill or shadow. A tap does nothing, so they must not look tappable.
6. **Primary: "New recipe".** A filled Action pill with a + icon and its label, 56 px tall, 16 px above the tab bar,
   on the right, in thumb reach. It never shrinks or moves on scroll.

The first screenful holds the title, hero and the peeking row. Coming soon, the least useful part, sits below the
fold. The hero ends in white space, so there is no false floor.

## Scrolling (canon §1.3)

- **Page: vertical.** The only free scroll.
- **Recent 2 to 8: horizontal, with a peek.** An optional sampler of peers. Nothing essential lives there. The full
  library is a vertical list with "Load more". On web the row gets visible buttons and keyboard support.
- **Coming soon: vertical.** You read all three.

## Signature: "The dish sets the light"

A wash behind the hero block only. Its hue comes from the hero photo. Its tone is fixed: OKLCH L 0.95, C 0.03
(light) and L 0.22, C 0.03 (dark). It carries no meaning. **Banned:** cook mode,
every control, behind body text, every other screen, the page ground. Worst case over 24 hues, light: Ink 15.5:1
Lc 94, Muted 6.9:1 Lc 77, Action 8.3:1 Lc 81. Dark: 15.0/96, 11.8/80, 9.6/68.

## Palette: "Aubergine"

| Role        | Name         | Light     | Dark      |
| ----------- | ------------ | --------- | --------- |
| Ground      | Steel        | `#F4F5F7` | `#0E0F12` |
| Surface     | Plate        | `#FFFFFF` | `#18191D` |
| Sunken      | Well         | `#EBEDF0` | `#222429` |
| Edge        | Rim          | `#737882` | `#808590` |
| Ink         | Ink          | `#14161A` | `#EEF0F3` |
| Muted       | Slate        | `#4A505A` | `#D3D7DD` |
| Action      | Aubergine    | `#5E2B86` | `#D5B6F2` |
| On action   | On aubergine | `#FFFFFF` | `#22102F` |
| Action wash | Lilac        | `#F0E8F7` | `#2A1E36` |
| Warning     | Amber        | `#8A4A00` | `#FFB868` |
| Danger      | Tomato       | `#B3261E` | `#FFA59D` |
| Hairline    | Seam         | `#DDE0E5` | `#2E3036` |

**Computed by script** (culori, APCA 0.0.98G). WCAG ratio / Lc on Steel, Plate, Well and Lilac.

- Light: Ink 15.2–18.1 / 93–105. Slate 6.8–8.1 / 76–88. Aubergine 8.1–9.7 / 80–92. On aubergine 9.7 / 96. Rim
  3.7–4.4.
- Dark: Ink 13.6–16.8 / 95–98. Slate 10.7–13.3 / 79–82. Aubergine 8.7–10.8 / 67–70. On aubergine 10.0 / 69. Rim
  4.2–5.2.
- Steel is L\* 96.5, chroma 1.1: cool, not cream. Aubergine is ΔE00 72.6 (light) and 60.4 (dark) from Mise's Leaf.
- Dark Aubergine and dark Tomato have a 1.06:1 lightness ratio. So danger stays a text row with an icon (§3.4).

**Visual language.** One grotesque family (such as Inter), weights 400, 600, 700. No serif. The photo is the largest,
most colourful element. Space groups: 32 px between sections, 8–12 px inside. One surface, for Coming soon. No
shadows. Motion: a 150 ms pressed state, and a 300 ms cross-fade of the wash for a new hero. Reduce Motion turns
the fade off.

**States.** Empty: "Your recipes will show up here", with the same pill. Loading: skeletons after 1 s. Error: "Your recipes did
not load." and a "Try again" text button. Offline: saved recents with "Offline. Showing saved
copies."

## Direction B: "The index" (differs in structure)

No hero and no row. Home is a typographic list. The eight recent recipes are full-width vertical rows: a 72 px photo
on the left, the title in 20 pt, "Opened Tuesday" below. The last row is "All 142 recipes". The type is the hero,
not the photo. Coming soon folds to one line under the list. Same pinned "New recipe" pill. Signature: large
cook-time numerals in the right column. Axis: **hero against index**. A bets on "reopen the last one". B bets on
"find one of my recent few".

## Limits

Heuristic judgement, untested. Words only, no mockup, so 320 px, 200% text and the stranger test were not run.
