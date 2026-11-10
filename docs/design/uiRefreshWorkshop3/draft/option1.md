# Option 1: Pilot Light

**Designer 1.** Evolves workshop 2's "The Now Line". Mockup: [`option1.html`](option1.html).

## The idea

Every screen is calm cool fog (or cast iron at night), with one warm pool of light on what matters now: the
recipe you cooked last, or the step you are on. The rest is plain lists, plain buttons and the tabs you already
know, so there is nothing to learn.

A pilot light is the small flame that is always on in a stove. It is quiet until you need it. That is the
whole design: a cool, still room, and one warm thing in it.

## What we kept from The Now Line, and what we cut

| Kept                                                | Cut                                |
| --------------------------------------------------- | ---------------------------------- |
| One light source per screen                         | The fixed line at eye height       |
| Focus on what matters now                           | The past-above, future-below axis  |
| The current step, large and readable from the stove | Scroll-linked scaling and inking   |
| Cool fog and cast iron                              | The line's drifting colour         |
| A faint warm wash while you cook (dark mode)        | "Next step" as a special target    |
| Dish colour drawn from the food                     | The orb as a concept you must read |

The light used to be a line you had to understand. Now it is just a warm glow behind one thing. You do not
need to know why it is there. Your eye goes to it, and that is enough.

## Why it is fresh

- **Light, not decoration.** Most recipe apps fight for attention with photos, cards and colour on everything.
  Pilot Light is almost colourless, so one warm glow does all the work. It feels like a kitchen at night with
  one lamp on.
- **Two colours with two jobs.** Saffron means "now". Ember means "do". A person never has to learn that, but
  the screen always feels clear because no colour is ever used for a third thing.
- **Dishes as their own colours.** We have no photos for most recipes. Each dish is drawn as a plate holding its
  own food colours: tomato red for the soup, butter gold for the pancakes, green flecks of thyme on the chicken.
  It is honest (no fake photo), warm and always on brand.
- **Cast iron at night.** Dark mode is not grey. It is green-black cast iron, and the light gets warmer. While a
  step is current, the lower screen takes a faint warm wash you can see from across the kitchen.

## Why it is simple, screen by screen

Every screen uses standard parts. There is a large-title header, plain lists with chevrons, a search field and
filter chips. There is a segmented control, a floating "New recipe" button and the five tabs (Home, Recipes,
Discover, Plan, Shop). Nothing is new to operate.

### Home

- The greeting and date, as today.
- **The one light:** the recipe you cooked last sits in a warm glowing tile with a "Cooked last" label. Tap it to
  open it. The label says in words what the glow says in light.
- Recent recipes as a plain list, with "See all".
- Coming soon as one quiet row: "Meal plans, a grocery list and daily nutrition are on the way." with a "Soon"
  tag.
- **Primary action:** the ember "New recipe" button. It is the only ember thing on the screen.

### Recipe detail

- **The one light:** the dish, on cast iron, under a warm glow. Back and More are plain white discs.
- Below that is a plain page on fog: cuisine, title, Public, source, Version history, then Total, Prep and
  Difficulty in one strip, then the rating.
- **Primary action:** "Edit recipe", the one ember button, beside the "Screen on" switch. This matches today's
  screen. We did not add a new flow.
- Ingredients with a servings stepper (− 4 +) and checkboxes. A ticked line turns muted with a green tick.
- **Steps:** tap any step to make it current. This is today's "Mark step as current", with no new gesture. The
  current step grows to 23 px type, takes the light and gets a "Current step" label. Done steps shrink back
  to muted text with a green tick. A step with a time shows a plain "Timer · 20 min" button.

### My recipes

- "Recipes" title, then My recipes / Collections, then search, filter chips with counts, then the sort.
- A plain list. Each row has the dish's colours, the title, the time and cuisine, and Private or Draft where true.
- **No light here**, because nothing on this screen is "now". This is on purpose: the light only means
  something because it is not everywhere.
- **Primary action:** "New recipe".

### The one rule a designer needs

At most one saffron light per screen, and only on the thing that is happening now. If a screen has no "now",
it has no light. At most one ember button per screen.

## The palette: Pilot Light

**Logic.** Cool fog and cast iron make a quiet room, so the one warm colour always means something. Saffron marks
what is happening now and ember marks what you can do. Everything else stays cool and steps back.

| Name                | Role                                         | Light     | Dark      |
| ------------------- | -------------------------------------------- | --------- | --------- |
| Fog / Cast iron     | Ground                                       | `#EEF3F1` | `#0F1311` |
| Porcelain / Skillet | Surface (lists, fields, tab bar)             | `#FFFFFF` | `#1A201D` |
| Sunk                | Inset surface (segmented track, icon tiles)  | `#E1E8E5` | `#242C28` |
| Iron ink / Steam    | Text                                         | `#0F1A17` | `#ECF2EE` |
| Slate / Ash         | Muted text                                   | `#4A5853` | `#A3B0AA` |
| Ember               | Primary action, links, selected tab          | `#B3330E` | `#FF8A5C` |
| On ember            | Label on the ember button                    | `#FFFFFF` | `#1A0A04` |
| Saffron             | Signature: the light, "now" only             | `#F4AE2A` | `#FFC04D` |
| On saffron          | Text on saffron (step number, "now" pill)    | `#1A1205` | `#1A1205` |
| Glow                | Surface under the light                      | `#FFF1D6` | `#2B2412` |
| Pewter              | Control edge (field, checkbox, switch, chip) | `#77847F` | `#728079` |
| Leek                | Success (ticks, done steps, saved)           | `#2C6A3B` | `#7CCB8C` |
| Honey               | Warning (Draft, unsynced, rating stars)      | `#8A5300` | `#F2C14E` |
| Beet                | Danger (Delete, errors)                      | `#A3173F` | `#FF7F98` |
| Divider             | Hairlines only, decorative                   | `#C3CFCA` | `#3A4540` |

### Contrast (WCAG 2.2, computed from the hex values above)

| Pair                               | Light | Dark | Needed       |
| ---------------------------------- | ----- | ---- | ------------ |
| Ink on ground                      | 15.9  | 16.5 | 4.5          |
| Ink on surface                     | 17.8  | 14.6 | 4.5          |
| Ink on sunk                        | 14.3  | 12.6 | 4.5          |
| Ink on glow (current step)         | 15.9  | 13.6 | 4.5          |
| Muted on ground                    | 6.7   | 8.3  | 4.5          |
| Muted on surface                   | 7.5   | 7.4  | 4.5          |
| Muted on sunk                      | 6.0   | 6.4  | 4.5          |
| Muted on glow                      | 6.7   | 6.9  | 4.5          |
| On-ember label on ember            | 6.2   | 8.3  | 4.5          |
| Ember link on ground               | 5.5   | 8.1  | 4.5          |
| Ember link on surface              | 6.2   | 7.1  | 4.5          |
| Ember on sunk                      | 5.0   | 6.2  | 4.5          |
| Ember on glow                      | 5.5   | 6.6  | 4.5          |
| On-saffron on saffron              | 9.7   | 11.4 | 4.5          |
| Leek on surface                    | 6.5   | 8.5  | 4.5          |
| Leek on ground                     | 5.8   | 9.6  | 4.5          |
| Honey on surface                   | 6.3   | 9.9  | 4.5          |
| Honey on ground                    | 5.6   | 11.2 | 4.5          |
| Beet on surface                    | 7.6   | 6.9  | 4.5          |
| Beet on ground                     | 6.8   | 7.8  | 4.5          |
| Selected chip (ground text on ink) | 15.9  | 16.5 | 4.5          |
| Pewter edge on surface             | 3.9   | 4.0  | 3 (non-text) |
| Pewter edge on ground              | 3.5   | 4.5  | 3 (non-text) |
| Pewter edge on glow                | 3.5   | 3.7  | 3 (non-text) |
| Focus ring (ink, 2 px)             | 14+   | 12+  | 3 (non-text) |

Every text and control pair passes AA.

### Pairing rules

- **Saffron is light, never text.** It is 1.7:1 on fog. It is never the only sign of "now": the pill always says
  "Cooked last" or "Current step" in words.
- **In dark mode, text on saffron is always on-saffron `#1A1205`.** Steam on saffron is 1.4:1 and is not allowed.
- **Ember on saffron is 3.2:1**, so it is used only for large shapes, never for text.
- **Dividers are decorative** (1.6:1). Every control has a pewter edge instead.
- **Ember and beet never sit side by side.** Delete lives in the More menu, away from the primary button.
- **No text on dish art.** Titles always sit on a solid surface.

## Type

- **Funnel Display** (700 to 800) for titles, the hero and the current step's number.
- **Funnel Sans** (400 to 600) for everything you read, with tabular numbers for amounts and times.
- Sizes: display 44, title 30, current step 23, body 16 to 17, meta 14, label 12. No serif, no paper, no cream.

## Motion

- The pool of light on Home breathes once every 9 seconds, very softly. That is the only ambient motion.
- When a step becomes current, it grows and the glow fades in (about 250 ms).
- Under `prefers-reduced-motion`, all of it stops. The lit state is shown at once.

## Open risks

- The dish art needs a written rule from ingredients to colours. Until then a recipe with no match gets a neutral
  plate.
- The warm wash in dark cooking mode needs a test on a real phone in a real kitchen, to check it reads and is not
  too dim.
- "Cooked last" needs a real signal. If we only know "last opened", the label must say "Opened last".
