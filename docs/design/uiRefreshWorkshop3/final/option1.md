# Option 1: Pilot Light (final)

**Designer 1.** Mockup: [`option1.html`](option1.html). Draft and critiques: `../draft/option1.md`, `../draft/critique2.md`,
`../draft/critique3.md`.

## The idea

Every screen is a calm, cool room with one warm light in it, on the recipe you opened last or the step you are
cooking now. Everything else is the plain lists, buttons and tabs you already know, so there is nothing to learn.

A pilot light is the small flame that is always on in a stove. It is quiet until you need it. That is the whole
design: a cool, still room, and one warm thing in it.

## What changed from the draft

| Critique                                                                                  | Fix                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Tap a step to make it current" is invisible (critique 2)                                 | Every step number is a real 44 px button, named "Mark step N as current". Tapping the row is a shortcut, not the only way.                                                                |
| "Cooked last" has no signal behind it (both)                                              | The label is **"Last opened"**. The app knows that fact, so the label never lies.                                                                                                         |
| The lit tile has no chevron (critique 3)                                                  | It has one, like every list row. It is a row that happens to be lit.                                                                                                                      |
| The 9 s breathing glow (both)                                                             | Gone. Nothing loops. The light fades on once when a screen opens.                                                                                                                         |
| Dark honey stars = dark saffron "now", 1.03:1 (critique 2)                                | Stars are ink. Draft is a neutral outlined tag, like "Soon". Warning is a separate orange, used only as text with an icon.                                                                |
| Ember and beet both red, 1.23:1 (critique 3)                                              | Danger is **Plum**, a cool wine at hue 323°, 41° to 44° away from ember. Danger always carries the word and an icon too.                                                                  |
| Pewter edge had little margin, 3.47 on fog (critique 2)                                   | Pewter is darker: 4.11 on fog, 4.12 on glow.                                                                                                                                              |
| Plates seen from above echo The Table and Enamelware (critique 3)                         | The art is a soft, out-of-focus colour field in a rounded square. It looks like the dish seen through steam. There are no plates, no rims and no orbs.                                    |
| "Let the light be real light" (critique 3), "sample the glow from the photo" (critique 2) | The lamp falls from the top left of the screen onto the lit tile and onto every piece of dish art. When a recipe has a photo, the photo replaces the art and the glow is sampled from it. |
| It can read as a utility app (both)                                                       | Colour comes from the food, which is now on every row and fills the top of the recipe page. The room stays calm, and the food stays warm.                                                 |

## Why it is fresh

- **Light, not decoration.** Most recipe apps fight for attention with cards and colour on everything. Pilot Light
  is a cool room with a lamp in it. The warm pool falls from the top left of Home onto the recipe you opened last.
  It feels like a kitchen at night with one lamp on.
- **The food is the colour.** We have no photos for most recipes. Each dish gets its own soft field of its own
  colours (tomato red, butter gold, thyme green), out of focus as if seen through steam. It is lit by the same
  lamp from the same corner, so every row on every screen shares one light. It is honest (no fake photo), it is
  warm, and it is nothing like a plate, a cut-out or an orb.
- **Cast iron at night.** Dark mode is not grey. It is green-black cast iron, and the lamp turns to candlelight.
  While a step is current, the lower screen takes a faint warm wash you can see from across the kitchen.

## Why it is simple

Nothing is new to operate. Every screen uses a large-title header, plain lists with chevrons, a search field,
filter chips, a segmented control, plain buttons, a switch, a stepper, checkboxes and the five tabs (Home, Recipes,
Discover, Plan, Shop). The light is never a control. It only says, with a word beside it, "this one".

**The one rule a designer needs:** at most one light per screen, only on what is happening now, and always with a
word ("Last opened", "Current step"). If a screen has no "now", it has no light. At most one ember button per screen.

### Home

- The greeting and date, as today.
- **The light:** the recipe you opened last, in a lit row: art, a "Last opened" pill, title, time and cuisine, and a
  chevron. Tap it to open it.
- Recent recipes as a plain list, with "See all".
- Coming soon as one quiet row: "Meal plans, a grocery list and daily nutrition are on the way." with a "Soon" tag.
- **Primary action:** "New recipe", the only ember thing on the screen.

### Recipe detail

- The dish's colours fill the top of the page, lit from the top left, and fade into the page. Back and More are
  plain discs.
- A plain page below: cuisine, title, Public, source, Version history, then Total, Prep and Difficulty in one strip,
  then the rating (ink stars).
- **Primary action:** "Edit recipe", beside the "Screen on" switch, as today.
- Ingredients with a servings stepper (− 4 +) and checkboxes. A ticked line turns muted with a green tick.
- **Steps:** each step starts with its number in a round button ("Mark step N as current"). Tapping the row does the
  same. The current step grows to 23 px type, takes the light and says "Current step". Done steps show a green tick.
  A step with a time shows a plain "Timer · 20 min" button.

### My recipes

- "Recipes" title, My recipes / Collections, search, filter chips with counts, then the sort.
- A plain list. Each row has the dish's art, title, time and cuisine, and Private or a Draft tag where true.
- **No light here.** Nothing on this screen is "now". The light only means something because it is not everywhere.
- **Primary action:** "New recipe".

## The palette: Pilot Light

**Logic.** Cool fog by day and cast iron by night make a quiet room, so the one warm light always means something.
Lamplight marks what is happening now and ember marks what you can do; the red, orange and yellow sit far apart in
hue and never share a job.

| Name                | Role                                                | Light     | Dark      |
| ------------------- | --------------------------------------------------- | --------- | --------- |
| Fog / Cast iron     | Ground                                              | `#EEF3F1` | `#0F1311` |
| Porcelain / Skillet | Surface (lists, fields, tab bar)                    | `#FFFFFF` | `#1A201D` |
| Stone               | Sunk surface (segmented track, icon tiles, stepper) | `#E1E8E5` | `#242C28` |
| Iron ink / Steam    | Text, stars, selected chip, focus ring              | `#0F1A17` | `#ECF2EE` |
| Slate / Ash         | Muted text, chevrons, tab labels, done steps        | `#4A5853` | `#A3B0AA` |
| Ember               | Primary action, links, selected tab                 | `#B42318` | `#FF6B5B` |
| On ember            | Label on the ember button                           | `#FFFFFF` | `#1A0A04` |
| Lamplight           | Signature: the light. "Now" only. Never text        | `#F4AE2A` | `#FFE39A` |
| On lamplight        | Text on lamplight (pill, current step number)       | `#1A1205` | `#1A1205` |
| Glow                | Surface under the light                             | `#FFF1D6` | `#2B2412` |
| Pewter              | Control edge (field, checkbox, chip, switch, tag)   | `#6B7873` | `#75837C` |
| Leek                | Success (ticks, done steps, Screen on)              | `#2C6A3B` | `#7CCB8C` |
| Amber               | Warning: text with an icon, never a fill            | `#8A4A00` | `#FF9433` |
| Plum                | Danger (Delete, errors)                             | `#8E1F63` | `#F08CCB` |
| Divider             | Hairlines only, decorative                          | `#C3CFCA` | `#3A4540` |

**Dish art** is not a palette colour. Each recipe takes 3 to 4 colours from its main ingredients. It is decoration,
never carries text, and is always paired with the title on a solid surface.

### Contrast (WCAG 2.2, computed from the hex values above)

Every number below was computed from the table above by one script, and the same script wrote the table in the
mockup.

| Pair                                             | Light | Dark  | Needs |
| ------------------------------------------------ | ----- | ----- | ----- |
| Text on ground                                   | 15.86 | 16.50 | 4.5   |
| Text on surface                                  | 17.79 | 14.59 | 4.5   |
| Text on sunk (segmented control)                 | 14.30 | 12.62 | 4.5   |
| Text on glow (current step)                      | 15.93 | 13.57 | 4.5   |
| Muted on ground                                  | 6.66  | 8.33  | 4.5   |
| Muted on surface (meta, chevrons, tab labels)    | 7.47  | 7.37  | 4.5   |
| Muted on sunk                                    | 6.00  | 6.38  | 4.5   |
| Muted on glow                                    | 6.69  | 6.85  | 4.5   |
| Label on ember button                            | 6.57  | 6.89  | 4.5   |
| Ember link on ground                             | 5.86  | 6.69  | 4.5   |
| Ember on surface (link, selected tab)            | 6.57  | 5.92  | 4.5   |
| Ember on glow                                    | 5.89  | 5.50  | 4.5   |
| Label on lamplight (pill, step number)           | 9.65  | 14.75 | 4.5   |
| Selected chip (ground on ink)                    | 15.86 | 16.50 | 4.5   |
| Leek on surface (success text)                   | 6.50  | 8.50  | 4.5   |
| Leek on ground                                   | 5.79  | 9.61  | 4.5   |
| Leek on glow (done step tick)                    | 5.82  | 7.90  | 3     |
| Tick on leek (checkbox, surface colour)          | 6.50  | 8.50  | 3     |
| Amber on surface (warning text)                  | 6.86  | 7.52  | 4.5   |
| Amber on ground                                  | 6.12  | 8.50  | 4.5   |
| Plum on surface (danger text)                    | 8.31  | 7.35  | 4.5   |
| Plum on ground                                   | 7.41  | 8.31  | 4.5   |
| Pewter edge on surface (fields, checkbox, chips) | 4.61  | 4.17  | 3     |
| Pewter edge on ground                            | 4.11  | 4.72  | 3     |
| Pewter edge on glow                              | 4.12  | 3.88  | 3     |
| Pewter edge on sunk                              | 3.70  | 3.61  | 3     |
| Focus ring (ink, 2 px) on ground                 | 15.86 | 16.50 | 3     |
| Disc icon on Back/More disc (ink on surface)     | 17.79 | 14.59 | 3     |

Every text and control pair passes AA.

### Pairing rules

- **Lamplight is light, never text.** It is 1.71:1 on fog, so it never carries meaning alone: the pill always says
  "Last opened" or "Current step".
- **Hue gaps, not luminance, keep the warm colours apart.** Ember is 4° / 6°, amber 32° / 29°, lamplight 39° / 43°.
  Their luminance ratios are small (ember to amber 1.04 light, 1.27 dark), so each also has its own form: ember is
  the button, lamplight is a fill, amber is text with an icon. They never take each other's form.
- **Plum is 41° to 44° in hue from ember** (luminance ratio 1.26 / 1.24). Danger always has the word and an icon,
  and Delete lives in the More menu, away from the ember button.
- **Stars are ink.** Draft and Soon are neutral outlined tags.
- **Dividers are decorative.** Every control has a pewter edge instead.
- **No text on dish art.**

## Type

- **Funnel Display** (700 to 800) for titles, the hero and the current step's number.
- **Funnel Sans** (400 to 700) for everything you read, with tabular numbers for amounts and times.
- Sizes: display 44, title 30, current step 23, body 16, meta 14, label 12.

## Motion

- When a screen opens, the light fades on once (about 1 s). Nothing loops.
- When a step becomes current, it grows and the glow fades in (250 ms).
- Under `prefers-reduced-motion`, nothing moves. The lit state is shown at once.

## Open risks

- The dish art needs a written rule from ingredients to colours. A recipe with no match gets a neutral field of
  stone and pewter.
- The glow sampled from a photo must be clamped, so a dark or blue photo still gives a warm glow that keeps the
  glow surface's contrast. The check: ink on the sampled glow at 4.5:1 or better.
- The dark cooking wash needs a test on a real phone in a real kitchen.
