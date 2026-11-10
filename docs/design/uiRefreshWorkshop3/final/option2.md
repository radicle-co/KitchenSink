# Option 2: Fresh Cut (final)

Mockup: [`option2.html`](option2.html). It is one file of 44 KB. It was checked at 390 px with no horizontal scroll and
no script errors.

## The idea

Every recipe wears a bold, flat cut-out picture of its own ingredients, in market-stall colours. So even a recipe with
no photo looks good enough to eat. Around that colour sits a calm, ordinary app you already know how to use.

The excitement is in the look. Nothing about how the app works is new. The picture is just a picture: you never read
it, turn it or decode it. If the cook adds a photo, the photo takes its place.

## What changed from the draft

| Finding                                                        | Fix                                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The Home carousel hid most recipes behind a swipe              | One large picture for the newest recipe, then plain rows. You can see everything with no gesture.                                 |
| Home had no primary action, but the app has "New recipe" there | "New recipe" is Home's one Tomato button, as in the app.                                                                          |
| Primary (Tomato) and danger (Chili) were the same red          | Danger is now **Wine**, a cool magenta. See the rules below.                                                                      |
| Rind failed 3:1 on Shell, and chips had no edge                | Rind is darker (3.4 on Shell). Unselected chips are Counter with a Rind edge.                                                     |
| Surface on ground was 1.09:1                                   | Lists, facts and sheets carry a 1 px **Hair** outline.                                                                            |
| The current step was cold blue                                 | The current step is warm **Zest** with an ink "Current step" badge.                                                               |
| Art colours shared names with UI tokens                        | The produce colours have their own names: Lemon, Persimmon, Pea, Plum, Carrot, Damson.                                            |
| "Screen on" is unclear                                         | The label is now "Keep screen awake" (see Copy).                                                                                  |
| Small thumbnails could turn into clip-art noise                | A thumbnail shows **one** shape, the lead ingredient, at 78% of the tile.                                                         |
| My recipes had too many controls                               | The controls stay, because Sort and View are in the app. They sit on one quiet line: "9 recipes · Recently edited ▾ · List/Grid". |
| Push: let the art tint the screen                              | The detail sheet starts in a faint wash of the art's ground colour and fades to white.                                            |
| Push: shapes for empty and loading states                      | The empty state shows a single cut-out. While loading, the tiles wait in Shell.                                                   |

## Why it is simple

Every control is one people already know. There is a large title, a plain list with chevrons and a segmented control.
There is a search field, chips, a stepper, a switch and a pill button. There is a five-tab bar: Home, Recipes,
Discover, Plan and Shop. Each screen has one Tomato button.

- **Home.** It shows the date, the greeting and the avatar. Under "Recent recipes", with "See all", comes the newest
  recipe as a picture with its title below it. Then three rows, each with a small picture, a title, its facts and a
  chevron. "Coming soon" keeps its real line and three rows tagged "Soon". The primary action is **New recipe**.
- **Recipe detail.** The picture fills the top. Back and More sit on solid white circles. A sheet slides up over the
  picture. It holds the cuisine and visibility, the title, the rating, three facts (Total, Prep, Difficulty), the
  **Edit recipe** button and the "Keep screen awake" switch. Then come the description, Nutrition, Ingredients with a
  Servings stepper, and the numbered steps. The current step has a warm tint and says "Current step" in words. Timers
  are plain chips.
- **My recipes.** It has the "My recipes / Collections" switch, search, filter chips, then the count, Sort and View
  on one line. Below is a list in which each row starts with its lead-ingredient picture. The primary action is
  **New recipe**.
- **Discover, Collections and the editor** use the same parts. A collection's cover is its first four recipes'
  pictures in quarters. In the editor, the picture redraws as ingredients are added. That is a small delight, and you
  need to know nothing about it.

**Three rules keep it calm.** Text never sits on art. Produce colours never carry meaning. Only one thing on each
screen is Tomato.

**How it differs from the other options.** Pilot Light is a colourless room lit by one warm glow. Enamelware is a blue
table of plates seen from above. Fresh Cut has no light, no plates and no table. It is flat, rectangular poster art
in six market colours, on a cool white. All three use plain lists, so the difference is in the art and the palette.

## Palette: Greengrocer

**Logic.** The app wears quiet, cool neutrals, so the only bright colour on a screen comes from the food. In the
controls, Tomato is the one bright colour and always means "do this". Every other UI colour is either a neutral or a
single-job signal.

Contrast ratios use the WCAG 2.x formula and were computed from the hex values below. The mockup's swatch sheet shows
the same numbers.

### UI colours

| Name       | Role                                                          | Light     | Dark      | Text and control contrast (light · dark)                                                 |
| ---------- | ------------------------------------------------------------- | --------- | --------- | ---------------------------------------------------------------------------------------- |
| Rinse      | Ground                                                        | `#F3F5F2` | `#131116` | n/a                                                                                      |
| Counter    | Surface: lists, sheets, fields, unselected chips              | `#FFFFFF` | `#1E1B22` | Counter on Rinse 1.10 · 1.10, so a Hair outline is required                              |
| Shell      | Fills: tab pill, timer chips, segment track, loading tiles    | `#E8EBE6` | `#2C2832` | Never the only edge of a control                                                         |
| Hair       | Dividers and outlines (decorative)                            | `#DCE0D9` | `#36313D` | No contrast duty                                                                         |
| Peppercorn | Text                                                          | `#17161C` | `#F4F1EC` | ground 16.4, surface 18.0, shell 15.0, zest 15.9 · 16.7, 15.1, 12.8, 11.7                |
| Clove      | Muted text                                                    | `#57555F` | `#B5AFBB` | 6.7, 7.3, 6.1, 6.5 · 8.8, 8.0, 6.7, 6.2                                                  |
| Rind       | Control edges: field, chip, stepper, switch, selected segment | `#7A7F79` | `#7E7788` | ground 3.7, surface 4.1, shell 3.4 · 4.4, 4.0, 3.4 (3:1 needed)                          |
| Tomato     | Primary action, one per screen                                | `#B83419` | `#FF7A57` | Label on fill: white 5.9 · `#1C0904` 7.5. Fill on ground 5.4 · 7.3, on surface 5.9 · 6.6 |
| Blueberry  | Links and the focus ring                                      | `#3442C2` | `#9DA8FF` | 7.1, 7.8, 6.5 · 8.5, 7.7, 6.5                                                            |
| Zest       | Current-step background                                       | `#FFF1C2` | `#3A2F14` | Peppercorn on it 15.9 · 11.7. The badge is ink with Counter text (18.0 · 15.1)           |
| Basil      | Success                                                       | `#1D6B47` | `#5FD39A` | 5.9, 6.5, 5.4 · 10.1, 9.1, 7.7                                                           |
| Turmeric   | Warning, rating star                                          | `#8A5300` | `#F2B54A` | 5.8, 6.3, 5.3 · 10.3, 9.3, 7.9                                                           |
| Wine       | Danger: delete, erase                                         | `#8E1A4F` | `#FF8FC0` | 8.0, 8.7, 7.2 · 8.9, 8.1, 6.8                                                            |

Other pairs:

- The selected chip and the ink badge are Counter on Peppercorn: 18.0 light, 15.1 dark.
- The detail wash is the art's ground colour at 10% on Counter (light) or 16% on Counter (dark). Over all six produce
  colours, the worst cases are Clove 6.2, Blueberry 5.7 and the Tomato fill 4.9, all of them dark Lemon. Everything
  passes AA.
- The status bar over the art is white on the dark grounds (Plum, Damson, and every dark-mode ground except Lemon and
  Carrot). It is Peppercorn on the light grounds (Lemon, Persimmon, Pea, Carrot), which gives at least 4.86.
- Every text pair passes AA, and most pass AAA. Every control edge passes 3:1.

**Danger is not primary.** Tomato is orange-red (hue about 10°). Wine is magenta (about 330°) in light, and pink in
dark. They are close in lightness (1.47 light, 1.22 dark), so hue is the separator, backed by three rules:

1. Wine is never a filled button next to Tomato.
2. Wine always appears with a word and an icon ("Delete recipe" with a bin).
3. Wine appears only in delete and erase dialogs and menus, where Tomato is not shown.

No produce colour sits in Wine's hue band. Beet was removed for that reason.

### Produce colours (art only, decorative)

| Name      | Light     | Dark      |
| --------- | --------- | --------- |
| Lemon     | `#FFCF3A` | `#D9A814` |
| Persimmon | `#EE4B2B` | `#C93A1E` |
| Pea       | `#2F9E5E` | `#237A48` |
| Plum      | `#5B2A86` | `#4A2270` |
| Carrot    | `#FF8C2E` | `#D96E14` |
| Damson    | `#3D4BD6` | `#2C37A6` |

A recipe's art ground is chosen from its lead ingredient, so the colour never stands for a category or a status. In
dark mode each colour steps one shade deeper, so the art glows without glaring. The dark ground is aubergine, not
pure black.

## Type

- **Bricolage Grotesque** (700 to 800) for titles, section heads and facts. It is warm and a little hand-cut, like
  the art. Large title 32/34, section 20/24, facts 19 with tabular figures.
- **Figtree** (400 to 700) for everything you read. Body 17/27. Amounts are 700 with tabular figures.
- Nothing is smaller than 12 px.

## Motion

When a picture first appears, its shapes land once, softly, over 0.7 s, each 80 ms after the last. Nothing loops,
and nothing moves while you read. With `prefers-reduced-motion`, the art is still. When loading ends, a Shell tile
fades to its colour.

## Copy

- "Screen on" becomes **"Keep screen awake"**. This is a proposed string change, not the app's current copy. It needs
  a localisation key update on web and mobile together.
- Every other string in the mockup is the app's real copy, including "Your recipe box is empty" and "Add your first
  recipe".

## Open risks

- **The shape set is the real cost.** About 40 shapes can cover most ingredients. Before committing, draw them for
  20 real recipes and check two things: no two recipes look the same, and every thumbnail reads at 60 px.
- **Unknown ingredients** fall back to a shape from the recipe's food family, in its colour, and never to a blank.
- **Mixed lists.** We must check that a list with some photos and some art still looks calm.
- **Hue-only danger.** Wine and Tomato differ in hue more than in lightness. The three Wine rules above carry the
  difference for colour-blind users, so they must be enforced in the design system, not just written down.
