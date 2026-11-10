# Option 2: Fresh Cut

Mockup: `option2.html` (one file, 41 KB, checked at 390 px with no horizontal scroll).

## The idea

Every recipe wears a bold, flat cut-out of its own ingredients, in the bright colours of a market stall. So even a
recipe with no photo looks good enough to eat. Everything around that colour is a plain, quiet app you already know
how to use.

The excitement is in the look, not in how anything works. The art is just a picture. You never have to read it,
turn it or understand it. If the cook adds a photo, the photo takes the art's place.

## Why it is fresh

- **Food is the colour.** Recipe apps either show a photo or show a grey box. Here every recipe gets its own picture
  from day one: lemon slices, thyme sprigs, carrots, tomatoes, cut as flat shapes and cropped by the frame like a
  poster. It is the energy of modern produce packaging and Matisse's cut-outs, not of a cookbook.
- **The chrome steps back.** The interface is cool white and ink, with one bright colour (Tomato) that only means
  "do this". So each screen has one loud thing, the food, and one clear action.
- **It is not workshop 2.**
    - The Now Line drew colour as a flavour orb and built the screen around a fixed line of light. Fresh Cut has no
      line, no orb and no new reading model.
    - The Table showed round plates seen from above, sized by time, with a rim you turn. Fresh Cut has nothing round,
      no plates, no table and no objects to handle. The art is a flat, rectangular picture.
- **It is not workshop 1.** There is no paper, no cream, no serif, no grain, no torn edges and no card grid. The
  ground is a cool near-white. Home uses a carousel, and My recipes uses a list.

## Why it is simple, screen by screen

Every control is one people already know. There is a large title, a carousel, a grouped list and a segmented control.
There is a search field, filter chips, a stepper, a switch, a pill button and a five-tab bar.

- **Home.** It shows the greeting and the date, the avatar, then "Recent recipes" with "See all". The recipes sit in a
  carousel you swipe. The newest recipe is the largest thing on the screen, so it is the obvious tap. "Coming soon"
  is a plain list of three rows, each tagged "Soon". No new button was added.
- **Recipe detail.** The art fills the top of the screen. A white sheet slides up over it. On the sheet are the title,
  the rating, three facts (Total, Prep, Difficulty) and one Tomato button, "Edit recipe". Next to it is the "Screen
  on" switch, which keeps the phone awake at the stove. Then come the description, Nutrition, ingredients with a
  servings stepper, and numbered steps. The current step has a soft blue tint and says "Current step" in words.
  Timers are plain chips.
- **My recipes.** It has a large title, the "My recipes" and "Collections" switch, search, filter chips, a list and
  grid toggle, and a list where each row starts with a small square of its art. The one Tomato button is "New
  recipe".
- **Discover** looks the same as My recipes, with a large carousel at the top.
- **Collections.** A collection's cover is its first four recipes' art, cut into quarters.
- **The editor** is a plain form. Its art redraws live as you add ingredients. That is a small delight, and you need
  to know nothing about it.

**One rule keeps text readable:** text never sits on art. Titles sit below the art, on the surface. The only things
on art are the Back and More buttons, which sit on solid white circles.

## Palette: Greengrocer

**Logic.** The chrome wears quiet, cool neutrals, so the only saturated colour on screen comes from the food.
Tomato is the one bright colour in the controls and always means "do this". Six produce colours belong to the art
alone and never carry text or meaning.

| Name           | Role                                      | Light     | Dark      | Contrast (light · dark)                                             |
| -------------- | ----------------------------------------- | --------- | --------- | ------------------------------------------------------------------- |
| Rinse          | Ground                                    | `#F4F6F3` | `#131116` | n/a                                                                 |
| Counter        | Surface, lists, sheets                    | `#FFFFFF` | `#1E1B22` | n/a                                                                 |
| Shell          | Chips, fields, active tab pill            | `#E7EAE5` | `#2C2832` | n/a                                                                 |
| Peppercorn     | Text                                      | `#17161C` | `#F4F1EC` | 16.5 ground, 18.0 surface, 14.8 shell · 16.7, 15.1, 12.8            |
| Clove          | Muted text                                | `#57555F` | `#B5AFBB` | 6.7, 7.3, 6.0 · 8.8, 8.0, 6.7                                       |
| Tomato         | Primary action                            | `#B83419` | `#FF7A57` | Label on fill: white 5.9 · `#1C0904` 7.5. Fill on ground: 5.5 · 7.3 |
| Blueberry      | Accent: links, focus ring, current step   | `#3442C2` | `#9DA8FF` | 7.2 ground, 7.8 surface, 6.5 on its tint · 8.5, 7.7, 6.3            |
| Blueberry tint | Current step background                   | `#E8EAFB` | `#272A4A` | Peppercorn on it: 15.1 · 12.3                                       |
| Basil          | Success                                   | `#1D6B47` | `#5FD39A` | 6.0, 6.5 · 10.1, 9.1                                                |
| Turmeric       | Warning, rating star                      | `#8A5300` | `#F2B54A` | 5.8, 6.3 · 10.3, 9.3                                                |
| Chili          | Danger                                    | `#B0241B` | `#FF8A80` | 6.2, 6.7 · 8.2, 7.5                                                 |
| Rind           | Control borders (search, stepper, switch) | `#858A84` | `#7A7383` | 3.5 surface, 3.2 ground · 3.7, 4.1                                  |

Other pairs:

- The selected chip is Counter on Peppercorn: 18.0 light, 15.1 dark.
- The current step number is Counter on Blueberry: 7.8 light, 7.7 dark.
- Every text pair passes AA. Most pass AAA. Every control boundary passes 3:1.

**Signature produce colours, for art only and decorative:**

| Name       | Light     | Dark      |
| ---------- | --------- | --------- |
| Lemon      | `#FFCF3A` | `#D9A814` |
| Tomato red | `#EE4B2B` | `#C93A1E` |
| Basil      | `#2F9E5E` | `#237A48` |
| Beet       | `#8C2A5A` | `#6E1F46` |
| Carrot     | `#FF8C2E` | `#D96E14` |
| Blueberry  | `#3D4BD6` | `#2C37A6` |

In dark mode each produce colour steps deeper, so the art glows without glaring in a dark kitchen. The dark ground
is a deep aubergine, not pure black.

## Type

- **Bricolage Grotesque** (700 to 800) for titles, section heads and facts. It is warm and a little hand-cut, like
  the art.
- **Figtree** (400 to 700) for everything you read. Amounts use tabular figures.
- Large titles are 32/34. Body text is 17/27. Nothing is smaller than 12 px.

## Motion

When a piece of art first appears, its shapes land once, softly, over 0.7 s, slightly staggered. Nothing loops and
nothing moves while you read. With `prefers-reduced-motion`, the art is still.

## Open risks

- **The rule from ingredient to shape is not written.** We need a list of about 40 shapes that covers most
  ingredients, plus a rule for which three to five lead, and a layout rule so two recipes never look the same.
- **We need a fallback for unknown ingredients.** It must be a shape from the recipe's food family in its colour,
  never a blank.
- **A photo replaces the art.** We must check that a mixed list, with some photos and some art, still looks calm.
- **Tile colour must not read as meaning.** The art's ground colour must not look like a status or a category. It is
  chosen from the lead ingredient only.
