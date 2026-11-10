> SUPERSEDED (2026-10-22). Do not use this for design work. The current design brief is docs/design/uiRefreshWorkshop5/brief.md, and the user needs are in docs/research/userNeeds/.

# Final brief: two proposals

## How we chose

Round 2 still had one overlap. D2's "Live Hob" and D3's "Overhead" both draw a recipe as a round object on a
surface. Each is sized by its time, with a ring of time around the food. So they merge into proposal B. D1's "Now Line" has no ring and no
object. It is about reading and time, so it is proposal A.

Put A and B in the same colours and they are still two products. A is a **typographic
stream that scrolls past one fixed line of light**. B is a **still scene of objects seen from above, which you
touch and turn**. Both keep every flow and every screen's content. Neither uses paper, a
serif or a card grid.

---

## Proposal A: The Now Line

**Lead: Designer 1.** From D2 it takes the rule of one light source per screen, and the room-wash in cooking. While a
timed step runs, the lower screen takes a faint wash that reads from across the kitchen. From D3 it takes data
honesty (only real fields are drawn) and one short fill on each finished step.

### The idea

Every screen is drawn across one line that never moves: a thin band of light at eye height. The past sits above
it. What is ahead sits below. Content scrolls past the line, and what crosses it is lit. It grows, turns to full
ink, and reads from the stove.

- **Home** is a river of your cooking. Recent recipes flow down into the line, older ones smaller and quieter.
  Below the line, the real "Coming soon" items (meal plans, grocery list, nutrition) are dashed, unlit points.
- **Recipe detail** keeps hero, facts, ingredients with servings, steps and Start cooking. The steps share the
  axis. The step on the line is large and lit. Read steps sit above it in muted ink. A knuckle-scroll is the only
  control a cook needs, and a "Next step" target is always there for wet hands.
- **Each dish has a colour.** A photo sits inside its orb. A recipe with no photo gets a flavour orb, mixed from its
  main ingredients' food families.

### Why it is new

No app is built on a fixed reading line. A teleprompter has one. Here one stroke is the brand mark, the map of
time and a hands-free reading aid. Screens went from pages to cards to feeds to live surfaces that know "now"
(Live Activities). A goes further: "now" is not a widget on the screen, it is the screen's structure. Colour is
not fenced into a picture. It flows from orb, to river, to line.

### Visual system

| Role   | Light                                | Dark                                |
| ------ | ------------------------------------ | ----------------------------------- |
| Ground | `#EEF3F1` cool fog                   | `#0F1311` cast-iron green-black     |
| Ink    | `#0F1A17` (15.9:1)                   | `#ECF2EE` (16.5:1)                  |
| Muted  | `#44524D` (7.3:1)                    | `#A3B0AA` (8.3:1)                   |
| Action | `#B3330E` (5.5:1), white on it 6.2:1 | `#FF8A5C` (8.1:1), near-black label |
| Line   | saffron `#E2961C`, tomato, leek      | saffron `#FFC04D`, brighter         |

The line is decorative. The "Now" pill (15:1+) carries its meaning. The lit step's
number disc is `#1A1205` on saffron, at 7.6:1.

- **Type:** Funnel Display for titles, numbers and the lit step. Funnel Sans for body, with tabular amounts.
- **Material:** none. Only light: one line and the one pool of colour it throws. No glass, no blur, no shadow on
  content. A solid tab bar.
- **Motion:** content scrolls under a fixed line. The item that crosses it scales up and inks in. The line's colour
  drifts over 16 s. The now point breathes over 5 s. Under `prefers-reduced-motion` all of it stops, and position
  alone sets the lit step.

### What to show

Home in light, with one photo orb and one flavour orb. Recipe detail with step 3 on the line, in light and dark.
Cooking with the room-wash. All at 390 px.

### Open risks

The reading line needs a real scroll-linked build and a test with wet hands. The rule from ingredients to orb colour
is not yet written.

---

## Proposal B: The Table

**Lead: Designer 3.** From D2 it takes three things:

- **The rim is a knob.** Turn the plate to move through steps. It is a `slider` with real values, and arrow keys
  work. Start cooking stays as a button.
- **Residual warmth.** A dish cooked last night keeps a faint warm halo under its plate, which cools over days. A
  date label states the same fact for screen readers.
- **Night is the hob.** In dark mode the table is black glass, lit from beneath.

It drops D2's heat scale, because we have no heat data.

### The idea

Commise is seen from directly above, the camera angle of every cooking video. The screen is a table, and each
recipe is a plate on it. The rim shows the recipe's real prep, cook and rest time. The well holds the food: the
cook's photo, or a still life of its ingredients. Plate area follows total time: "Bigger plates take longer."

- **Home** has no rows and no cards. Plates sit at true size with real overhead shadows. Each name sits beside its
  plate like a place card. "Coming soon" features are closed cloches.
- **Recipe detail** shows the hero plate, then ingredients as **bowls** (88 px, quantity inside, food-family
  colour). Tap a bowl and it empties. The current step rests on a chopping board while the rim fills. When you
  scroll into the steps, the plate docks into the top bar as "Step 3 of 5".
- **Controls are objects:** a tray for servings, square tokens, and the tab bar as a dark tray on the table.

### Why it is new

Recipe apps are magazines or productivity tools. B is a spatial interface with one fixed camera, and every object
is one a cook already owns. Screens are moving from flat panes toward objects with weight. B brings that to a
phone with no 3D: one camera, real shadows, and an object you turn. No recipe app shows ingredients as bowls you empty, or lets you turn
the dish to cook it.

### Visual system

| Role    | Light: enamel table                    | Dark: hob glass                          |
| ------- | -------------------------------------- | ---------------------------------------- |
| Ground  | `#C9D6EC` soft enamel blue             | `#0A0C10` black glass                    |
| Objects | plates `#FFFFFF`                       | stoneware `#1C2027`                      |
| Ink     | `#0D1520` (12.5:1 table, 18.3:1 plate) | `#ECEFF4` (17.0:1 glass, 14.2:1 plate)   |
| Muted   | `#34405A` (7.1:1)                      | `#A3ACBB` (8.6:1 glass, 7.1:1 plate)     |
| Action  | `#9E240E` (5.3:1), white on it 7.7:1   | `#FF9070` (8.8:1), `#1A0E08` on it 8.5:1 |

The table moved from round 2's celadon to enamel blue, so B shares no ground with A. Five food families (Green, Red,
Gold, Earth, Pale) hold 3:1 on their plate. Pale carries an outline. Colour never carries meaning alone, because
every bowl shows its quantity and name.

- **Type:** Syne 700 and 800 for display. Instrument Sans 400 to 600 for reading, with tabular numbers.
- **Material:** matte. In light, objects cast soft overhead shadows. In dark, light comes up through the glass
  from under a warm plate, and nothing else glows.
- **Motion:** plates set down once on load. A rim tick fills after a step (1.1 s). A bowl empties on tap. The rim
  turns under the finger with a detent per step. Under `prefers-reduced-motion` all of it stops, and the knob steps
  by tap and arrow keys.

### What to show

Home with five plates: one photo, four still lifes, one warm from last night, and two cloches. Recipe detail with
bowls and the knob mid-turn, in light and dark. The docked "Step 3 of 5" bar. One Collection as a laid table with
overlapping plates. All at 390 px.

### Open risks

The free layout needs placement rules for 1 to 12 recipes. Syne is wide, so a long title needs a smaller size. A
rotary control needs a test for discoverability, and the button path stays first-class.

---

## Recommendation

**The designers recommend A, The Now Line, two to one** (D1 and D2 for A, D3 for B).

- **It serves the hardest moment.** At the stove the cook has wet hands and eyes away, and loses the step. A makes
  that moment the design itself: the step you need is always at eye height, large and lit. B helps there only
  through features.
- **It is calmer.** A is one line and type. B is many objects on a table, and its calm depends on placement rules
  that do not exist yet.
- **It covers every screen with no new parts.** Home, Recipes, Discover, Collections and the editor are one stream
  at different time scales. B needs a new object for each.
- **It is cheaper to build and to keep accessible.** A is a scroll-linked list. B needs a free layout and a knob.

**D3's dissent, for the owner:** B is more striking at first sight and more about food. If the first test is "is it exciting the moment I open it", B is the stronger bet.

**Next step:** build A's reading line on a real phone first. That one claim decides whether A works.
