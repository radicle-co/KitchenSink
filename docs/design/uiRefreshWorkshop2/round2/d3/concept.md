# Overhead (Designer 3, round 2)

## The idea

Commise is seen from directly above, the camera angle of every cooking video. The screen is a coloured table, and
each recipe is a real plate on it. The plate's rim is painted with the recipe's own time. Its well holds the dish's
food. If the recipe has a photo, the photo goes there. If not, a still life of its ingredients goes there. Plates are sized by how long
the dish takes. Ingredients wait in bowls that you empty as you cook. The step you are on rests on a chopping board
while the plate's rim fills.

Round 1's "signature" was a data glyph inside a card app. Round 2 makes the whole screen the scene the glyph belongs in.

## What changed, point by point

| Critique                                                            | Round 2                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop the cards, and put plates on the ground like a table (D1, D2)  | Home has no cards and no rows. Plates sit on the table at their true size, with real overhead shadows. Each name sits beside its plate like a place card. DOM order is the reading order. The hit areas do not overlap.                                    |
| Size = total time is the best idea (D2)                             | Kept, and made exact. Area grows with total time, so diameter follows the square root. The section says it in plain words: "Bigger plates take longer."                                                                                                    |
| Reads as a fitness tracker, and no food anywhere (D1, D2)           | The ring is now the plate's painted **rim band**. The centre is **food**. A recipe with a photo shows it clipped into the well, with the time band still on the rim (the ragù on Home). In the mockup this is a painted stand-in. A real photo goes there. |
| Nine food hues is too many (D1)                                     | Five families: Green, Red, Gold, Earth, Pale.                                                                                                                                                                                                              |
| Seeds too small at 390 px (D2)                                      | Level of detail. Home plates show only the three biggest dollops. The full set appears only on the detail hero, at a larger size. Each ingredient is also a large **bowl** (88 px) with its quantity inside, in the same family colour as its dollop.      |
| Hero legend repeats the facts strip (D1)                            | Each fact appears once. Prep, cook and rest are short straight labels at their own arcs on the rim. Total, steps, difficulty and rating are on one line under the title. No legend.                                                                        |
| One moment of delight (D2)                                          | If you finish a step, its rim tick fills (one 1.1 s draw). If you tap a bowl, it empties. The "breathing" tick is gone.                                                                                                                                    |
| Old-app tells: pills, uppercase overlines, white rounded cards (D1) | Gone. The controls are objects on the table: a dark tray for servings, soft square tokens, and the tab bar as a dark tray resting on the table. The overline is sentence case.                                                                             |
| Plate stays visible while cooking                                   | New: when you scroll into the steps, the hero plate shrinks and docks into the top bar, showing "Step 3 of 5". It answers "where am I?" on every scroll position.                                                                                          |

## Why it is new

Recipe apps are magazines (photo plus serif) or productivity apps (cards plus chips). Overhead is neither. It is a
**spatial** interface with one fixed camera, and every object is something a cook already owns: plate, bowl, board,
tray, cloche. "Coming soon" features are **covered dishes**: closed cloches, not yet served. Mise en place, the way
chefs lay out a station, becomes the ingredient list. No other recipe app shows the list as bowls you empty. The
light theme is the hero: a cool celadon table with white plates, the look of styled overhead food photography,
without one photo needed.

## Why it fits cooking

- **Hands busy.** The bowl and the step are big targets (88 px bowls, 52 px step buttons, 56 px servings tray).
  "What's left to add?" is answered by which bowls are still full, from arm's length.
- **Time.** Big plates are slow dishes. A cook choosing tonight's dinner sees that before reading.
- **Memory.** A dish is remembered as "the big one with the red rim", like a real plate.

## Why it stays calm

One table colour per theme, white (or stoneware) objects, and colour only as food. Reading text is straight, solid and
left-aligned. Nothing glows and nothing blurs, except the soft shadow under each object. Motion is two things. Plates set down once
on load. A tick fills after each step. Both are off under `prefers-reduced-motion`.

## Data honesty

- Real fields: prep, cook and rest minutes (rim band), step count (ticks), photo (well), quantities and names (bowls).
- **Derived:** food family and dollop size, from the ingredient catalog, sized by each ingredient's share of the
  dish. No heat-per-step data is invented.
- The family colour never carries meaning alone: every bowl shows its quantity and name. The plate has an
  `aria-label` stating its times, its step count and how many steps are done.

## Palette and type

- **Light, celadon table:** table #C6DAD3, ink #0D1916 (12.3:1), muted #33463F (6.9:1), action #A3260F (5.1:1 on the
  table, and white on it is 7.4:1). Plates are #FFFFFF, and text on plates or bowl tints is at least 13:1.
- **Dark, bottle-green table at night:** table #0F241E, ink #E9F2EE (14.3:1), muted #A6C2B7 (8.5:1), action #FF9070
  (7.3:1). Plates are stoneware #1B362E (ink 11.4:1, muted 6.8:1).
- **Rim and dollop graphics** hold at least 3:1 on their plate in both themes. Pale is the one exception. It carries
  an outline, so it still meets 3:1.
- **Type:** Syne 700/800 for display, a wide face that neither D1 (Bricolage) nor D2 (Sora) uses. Instrument Sans
  400 to 600 for reading, with tabular numbers.

## How it differs from D1 and D2

There is no time axis or "now line" (D1's lane), and no light coming through glass or unlit burners (D2's lane). The
idea is objects on a table in one overhead view, with a coloured, light-first ground.

## Open, for later

Collections: a collection becomes a laid table, with its plates overlapping. Discover: a long shared table you pan
across. Risk 1: the scattered Home layout needs placement rules for 1 to 12 recipes. Risk 2: Syne is wide, so long
titles at 31 px take three lines.
