# Home, 390 px: probe v4 (Designer 0)

**Pick: "Tonight", palette Beetroot.** It helps a tired cook choose dinner with stored data only. Rendered at
390 and 320 px, both themes, 200% text. Heuristic judgement, untested. Files:
`/tmp/claude-1000/-home-brandon-Development-KitchenSink/7091c8e5-d5b1-4d19-bb4d-8da0ff6bbb8c/scratchpad/home/`.

## Where the brief breaks the canon

- **Coming soon** gets one line below the first screen, not three cards: "Coming soon: meal plans, a grocery list
  and daily nutrition."
- **A recent list is recall.** Home asks one question with a one-tap answer.
- **"Recent" means last edited.** The API sorts only by `updatedAt`, `createdAt` and `title`. Nothing reads
  `recipe_viewed` back per user. The label says "Last edited first".
- **No cooking state exists.** Cook marks live in memory only (`useCookMarks.ts`), so no "Step 4 of 7" bar is drawn.

**Data audit** (`recipes.schema.ts`): title, photo, minutes, servings, meal type, difficulty, status, updatedAt.

## Direction A: Tonight

**Job:** "Show me a dish that fits my time. Or let me write one down."

**Layout, top to bottom:**

1. Large title "Home".
2. "How long have you got tonight?" with a standard segmented control: 30 min · 1 hour · Any time (default). It
   filters the 8 recents by `totalTimeMinutes`.
3. Heading **RECENT RECIPES**, with "Last edited first" or "4 of 8 ready in 30 min" at the right.
4. The top recipe: a full-bleed 4:3 photo, title 24/700, "35 min · Serves 4" in Muted.
5. The other recipes: 72 px rows with a thumbnail, title 17/600, time and servings, chevron, and a Hairline between.
6. "All your recipes 124 ›", a full-width row: the way into the library.
7. The Coming soon line.

**Scrolling:** one vertical page. Recents are vertical because the cook scans and compares them. The segment
control is fixed in the flow. No horizontal row: the canon permits one, so it is the median, and it hides recipes 4–8.

**Primary:** filled **+ New recipe**, docked low right above the tab bar. Choosing a recipe means tapping its row.
Each row has one target.

**Visual language:** one family, Schibsted Grotesk 400–800, on a neutral ground that serves the photo.
**Signature:** section headings as laminated label tape: Yolk ground, letter-spaced capitals, 2 px corners. It
comes from the labels cooks put on freezer tubs. Reference: Brother P-touch TZe tape, which few pick because Dymo
is the known label trope. It encodes nothing. It is banned from cook mode, controls and rows. It survives 320 px at
200% text.

**Palette "Beetroot":** a clean counter, a market beetroot accent and a yolk label. Food is never tinted.

| Role        | Name        | Light     | Dark      |
| ----------- | ----------- | --------- | --------- |
| Ground      | Counter     | `#F5F5F2` | `#0F0F0E` |
| Surface     | Board       | `#FFFFFF` | `#1A1A18` |
| Sunken      | Ballast     | `#EAEAE6` | `#242422` |
| Edge        | Rail        | `#73736E` | `#82827C` |
| Ink         | Ink         | `#141414` | `#EFEFEA` |
| Muted       | Slate       | `#4D4D49` | `#BCBCB5` |
| Action      | Beetroot    | `#8C1D4F` | `#F7A6CA` |
| On action   | On beet     | `#FFFFFF` | `#2A0716` |
| Action wash | Beet wash   | `#F6E3EA` | `#3A1726` |
| Warning     | Ochre       | `#7A5200` | `#FFA95E` |
| Danger      | Brick       | `#B3300F` | `#FF9E8E` |
| Hairline    | Seam        | `#DDDDD8` | `#2E2E2B` |
| Content hue | Yolk (tape) | `#FFE27A` | `#E8DA5C` |

**Script output** (culori, APCA 0.0.98G, exits non-zero on a fail). It caught two fails, now fixed: dark Warning
9.6 ΔE00 from Yolk, and dark Danger at Lc 57.

- Action as text: 8.0:1, Lc 83 light. 10.3:1, Lc 67 dark.
- Ink to Muted: 2.17 light, 1.66 dark.
- Tape text on Yolk: Lc 89 light, 82 dark.
- Smallest role-to-role gap: 22.98 light, 17.38 dark (ΔE00).
- Action vs earlier rounds: 42 ΔE00 or more.

**States rendered:** deciding, filtered, and empty, in light and dark.

## Direction B: Write it down

Home is a place to write. A field, "Name a dish or paste a link", and a filled **Start** button dock above the tab
bar like a message bar. Recents form one column of 3:4 portrait photos, 42% wide, bleeding off the left edge, with
20 px titles beside them. **Palette "Label":** cool white, paprika `#B23A0C` / `#FFA77C`, blue-black dark. It is
28 ΔE00 from Beetroot and passes the script. **Not ready:** at 320 px and 200% text, the titles break to one word
per line.

## Self-review

- **Stranger:** A is a filter, a hero and a list. B is tall photos and a writing bar. They differ in structure.
- **Family:** A is close to the tasteful default. Its tape is the one move, and it is small.
- **Fault:** the + New recipe button covers the first row's meta at rest. Fix: 88 px end padding.
- **Fault:** at 200% the tab labels collide. Fix: the platform's large-text tab bar.
- **Cut:** an oval "platter" crop. It read as a 1990s vignette and cropped the asparagus to tablecloth.

## Not run or unverified

- **Prior art:** no shipping app uses tape headings, but web "eyebrow" badges are close. Not checked against
  top-chart apps.
- **Trajectory and closest-app tests:** not searched.
- **Photos:** repo photos are restaurant plating, so the photo-hero check is weak.
- **Not built:** web width, recipe page, cook mode, offline, error and loading.
