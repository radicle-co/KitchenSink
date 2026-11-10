# Home, 390 px phone (Designer 0, probe v2)

**Pick: A, "Poster".** One dish fills the top, with its name readable from across the counter.

## Point of view

The obvious three, which I cut: a serif on cream, an iOS card grid with a Netflix row, and black and gold.

- **Type:** one grotesque, at poster scale for one line only.
- **Food:** shot from above in daylight, with the plate cut by the screen edge.
- **Composition:** extreme scale contrast, on a strict grid.
- **Colour:** it belongs to the food and to one control you press.
- **References:** Müller-Brockmann's 1960 _musica viva_ posters, and Falcon Enamelware's white plate with its navy
  rim.
- **Refusal:** no horizontal row on Home.

## Frame

**Job:** "Get back to the dish I'm on, and cook it." **Success:** a return visit starts cooking in one tap.
**Pretty only:** people admire the hero, then open the Recipes tab.

The hero and filled primary follow the state:

- **Cooking:** that dish, "Step 4 of 7 · Simmer the sauce" and a timer strip "Rice 06:12". Primary: **Back to step 4**.
- **Deciding:** the last recipe opened. Primary: **Start cooking**.
- **Nothing yet:** "Your recipes live here." Primary: **Write your first recipe**.

## A, "Poster": layout from the top

1. **Top bar:** the wordmark. On the right, **New recipe**, an outlined pill 44 px high with a + icon.
2. **Hero photo:** full-bleed, 390 × 312, square corners, with no text on it. The right edge cuts the plate.
3. **Dish name (signature):** Archivo Expanded ExtraBold at 44 pt, flush left, at most 3 lines. A name over 28
   characters drops to 34 pt. Below it in Muted: "Opened Tuesday · 45 min · Serves 4".
4. **Recent** (22 pt), 40 px below. Recipes 2 to 8 sit in rows 96 px high. Each photo is 128 × 96 and bleeds off
   the left edge. The title is 17 pt, at most 2 lines, with the meta and a chevron.
5. **All 142 recipes:** a row with a chevron, which ends the list.
6. **Coming soon**, 48 px below, on one Well surface: Meal plans, Shopping list and Nutrition. Each has one line of
   text and a "Soon" tag. No chevron: they cannot be tapped.
7. **Primary:** a filled pill, 358 × 56, fixed 16 px above a standard tab bar. It never moves.

**Scrolling:** only the page scrolls, and only up and down. Recent is vertical because the cook finds a dish by its
name, and 8 rows fit. Coming soon is vertical because you read all three.

**Visual language:** one family, Archivo. Its expanded width is for the dish name only. No shadows, one surface,
square photos, round pills. A press shows in 80 ms. When the state changes, the hero cross-fades in
200 ms, and Reduce Motion stops this.

**Thesis (50 ms):** one dish, named like a concert poster, above a strict timetable. **Signature:** the dish name at poster scale, so you can tell the dish from 60–90 cm. It is the title, so it adds no
meaning. **Banned** in cook mode, on controls and in lists. It appears only in the Home hero and the recipe-page
title.

### Palette "Enamel"

White enamel with a navy rim. Cold chrome, so the food carries the warmth. Light / dark:

- **Glaze (ground):** `#F6F6F5` / `#0E0F10`
- **Plate (surface):** `#FFFFFF` / `#18191B`
- **Well (sunken):** `#ECEDEC` / `#222326`
- **Rim (edge):** `#74767A` / `#808287`
- **Pepper (ink):** `#121314` / `#F2F3F3`
- **Ash (muted):** `#4E5156` / `#B9BCC1`
- **Navy rim (action):** `#1E4C8A` / `#A6C6F4`
- **On rim:** `#FFFFFF` / `#0A1A30`
- **Chip (wash):** `#E4EBF5` / `#18233A`
- **Amber (warning):** `#8A4A00` / `#FFB868`
- **Tomato (danger):** `#B3261E` / `#FFA59D`

Computed with culori and APCA 0.0.98G, as WCAG ratio / Lc:

- **Light:** Ink 15.5–18.6 / 93–105. Ash 6.6–8.0 / 75–88. Navy 7.1–8.6 / 77–89. Rim 3.9–4.6.
- **Dark:** Ink 14.1–17.3 / 97–99. Ash 8.2–10.1 / 63–66. Navy 9.0–11.0 / 68–70.
- **Ink to Ash:** 2.33 light, 1.71 dark.

**States:**

- **Loading:** grey blocks after 1 s.
- **Error:** "Your recipes did not load." with **Try again**.
- **Offline:** "Offline. Showing saved copies."

## B, "Contact sheet": the spread, not one dish

- **Structure:** no hero. The 8 recents form a two-column vertical grid, edge to edge, each at its own aspect.
  Names in Bodoni Moda 20 pt, the rest in Inter. At 200% text the grid is one column. A cook
  in progress gets an opaque band at the top: "Cooking: Pad see ew · Step 4 of 7 · 06:12". The primary and states
  match A.
- **Signature:** 2 px white gutters and square corners. It is banned in cook mode and on controls.
- **Reference:** _Magnum Contact Sheets_ (Lubben, 2011).
- **Palette "Rosemary":** a herb-teal action, `#145E57` / `#86D8CA`, on `#F4F5F5` / `#0D1010`. Its content hue,
  "Crust" (`#C9A27A`), is used only as the ground of a photo while it loads. Action: 6.4–7.6 / 75–86 light,
  9.3–11.5 / 71–74 dark. ΔE00 from Navy rim: 26.9 light, 24.1 dark.

## Not done

The brief asked for words in one file. So there are no mockups, renders or contact sheet, and no §5 or Nielsen
pass from images. These are untested heuristic judgements. The risk in B is that, as a small
thumbnail, it reads as an equal-card grid.
