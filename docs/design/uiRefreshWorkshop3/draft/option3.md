# Option 3: Enamelware

Designer 3. This option builds on workshop 2's "The Table". The mockup is `option3.html` in this folder.

## The idea

Commise looks like your kitchen table seen from above. The table is a calm blue enamel top. Each recipe is drawn as
its own dish, seen from overhead, on a white plate with a cobalt rim.

Everything you touch is ordinary: plain lists, plain buttons and the usual tabs. The only new thing to look at is the
food.

## What I kept from The Table, and what I cut

**Kept:**

- the overhead camera
- food in front of everything else
- the enamel blue in light mode
- the hob-glass dark mode, with its warm light from beneath

**Cut:** every mechanic that had to be learned:

- No plate sizes. Every dish in a list is the same size, and time is written as "55 min".
- No rim to turn. Start, edit and servings are buttons.
- No bowls to empty. Ingredients are a checklist with real checkboxes.
- No cloches. "Coming soon" is a list row with a "Soon" label.
- No free layout. Every screen is one column that scrolls.

## Why it is fresh

- **Food leads, in one fixed camera angle.** Recipe apps are magazine pages (a photo on top, then text) or
  productivity lists (grey rows). Enamelware shoots every dish from straight above, the angle of every cooking video.
  So a list of recipes reads as a table of dishes, and a recipe page opens on its dish in the tin.
- **It is one real object.** The whole palette is a piece of enamelware: a blue-grey table, a white plate, and the
  cobalt rim. The button you press is the same cobalt as the rim around every dish. The brand comes from one
  object, not from decoration.
- **At night it is the hob.** In dark mode the table becomes black glass. The plates turn to stoneware, and a warm
  pool of light sits under the main dish. The burner beneath seems still on. Nothing else in dark mode glows.
- **The motion is calm.** A plate settles once on load. Faint steam drifts over the latest dish. Both
  stop under `prefers-reduced-motion`, and nothing depends on them.
- **No paper, cream, serif or card grid.** The type is Bricolage Grotesque, which is warm and slightly hand-cut, with
  Figtree for reading.

## Why it is simple, screen by screen

All screens use the same five tabs (Home, Recipes, Discover, Plan, Shop) with icons and labels. The primary action
is always the one cobalt pill. Draft, private and public are always written as a word with an icon, never shown by
colour alone.

- **Home.** The title is "Home", with the avatar on the right.
    - The latest recipe sits large on the table, with its name and "American · 35 min" on a label below. Tapping it
      opens the recipe.
    - "Recent recipes" is a plain list with "See all". Each row has a small dish, a name, the cuisine and time, and a
      chevron.
    - "Coming soon" keeps its real line, "Meal plans, a grocery list and daily nutrition are on the way.", and its
      rows each carry a "Soon" label.
    - Primary action: **New recipe**, a pill at the bottom right above the tab bar.
- **Recipe detail.** The dish fills the top, seen from above in its roasting tin. "Back to My recipes" is a round button at the top left.
  A white sheet slides over the dish and holds the rest of the page:
    - cuisine, title, the visibility label, "Source: Family recipe card" and "Version history"
    - "Community rating 4.8 · 12 ratings", "You can't rate your own recipe." and "8 comments"
    - Total, Prep and Difficulty in one strip
    - primary action: **Edit recipe**, full width
    - the description with "More", the tags line (gluten-free · dinner · sunday roast), and "Nutrition · 612 cal per serving"
    - Ingredients, with a "− for 4 +" servings stepper and the real groups (Chicken, Vegetables) as checklists
    - Steps, numbered, with each step's own time shown as a small label

    It is one long page that scrolls, with nothing hidden behind a gesture.

- **My recipes.** The title is "Recipes", with the existing **My recipes / Collections** segmented control.
    - Below it: "9 recipes · Recently edited", and the list and grid view toggle.
    - Each row starts with its dish, then the name (long names wrap to two lines), then the cuisine, time and rating
      or a Draft or Private label.
    - Primary action: **New recipe**.
- **Discover, Collections and the editor** follow the same pattern:
    - The dish is the thumbnail.
    - Rows are rows.
    - The editor is a white sheet on the table, with the dish photo slot at the top.

    No screen needs a new kind of object.

**If there is no photo**, the recipe gets a flat overhead illustration of a plate. It uses the dish's main colours
and has no faces and no type. Until a rule exists, it is chosen from a small set by cuisine. The illustrations in
the mockup are SVG stand-ins for the cook's own overhead photos.

## The palette: Enamelware

**The logic.** The palette is one enamel plate on a blue table, and the button you press wears the plate's cobalt
rim. The food brings the warm colours, so the interface stays cool and quiet, with Yolk only for small signals.

| Name               | Role                                                            | Light     | Dark        |
| ------------------ | --------------------------------------------------------------- | --------- | ----------- |
| Enamel / Hob glass | ground                                                          | `#DDE6F4` | `#0B0D12`   |
| Plate / Stoneware  | surface (sheets, lists, tab bar)                                | `#FFFFFF` | `#181C24`   |
| Ink                | text                                                            | `#0F1726` | `#EDF0F5`   |
| Slate              | muted text                                                      | `#465268` | `#A4AEBF`   |
| Cobalt rim         | primary action, links, plate rim                                | `#1D46C2` | `#93ADFF`   |
| On cobalt          | label on primary                                                | `#FFFFFF` | `#0B0D12`   |
| Yolk               | accent: "Soon" label, avatar, rating star in dark               | `#F2B233` | `#FFC64D`   |
| On yolk            | text on Yolk                                                    | `#1B1405` | `#1B1405`   |
| Herb               | success (checked ingredient)                                    | `#1C7344` | `#62D394`   |
| Amber              | warning                                                         | `#8A5300` | `#F4B655`   |
| Tomato             | danger                                                          | `#B3261E` | `#FF8A7E`   |
| Edge               | control outlines (stepper, segmented control, checkbox, labels) | `#6F7C95` | `#6D788C`   |
| Focus              | 2 px Cobalt ring, 2 px offset                                   | `#1D46C2` | `#93ADFF`   |
| Hob glow           | signature: warm light under the dish                            | not used  | `#FF96464D` |

### Contrast (WCAG 2.2, computed from the hex values)

| Pair                                         | Light     | Dark       | Needs |
| -------------------------------------------- | --------- | ---------- | ----- |
| Ink on ground                                | 14.3      | 17.0       | 4.5   |
| Ink on surface                               | 17.9      | 14.9       | 4.5   |
| Slate on ground                              | 6.3       | 8.7        | 4.5   |
| Slate on surface                             | 7.9       | 7.6        | 4.5   |
| Label on Cobalt (primary button)             | 7.8       | 8.9        | 4.5   |
| Cobalt as link text on ground                | 6.2       | 8.9        | 4.5   |
| Cobalt as link text on surface               | 7.8       | 7.9        | 4.5   |
| Cobalt button against ground (non-text)      | 6.2       | 8.9        | 3.0   |
| Ink on Yolk ("Soon", avatar)                 | 9.7       | 11.7       | 4.5   |
| Herb on ground / surface                     | 4.7 / 5.9 | 10.4 / 9.2 | 4.5   |
| Amber on ground / surface                    | 5.0 / 6.3 | 10.8 / 9.5 | 4.5   |
| Tomato on ground / surface                   | 5.2 / 6.5 | 8.5 / 7.5  | 4.5   |
| Edge against ground / surface (non-text)     | 3.3 / 4.2 | 4.4 / 3.8  | 3.0   |
| Focus ring against ground / surface          | 6.2 / 7.8 | 8.9 / 7.9  | 3.0   |
| Selected view toggle (Cobalt) against ground | 6.2       | 8.9        | 3.0   |
| Yolk star on stoneware (dark)                | none      | 10.9       | 3.0   |

**Usage notes:**

- Yolk is used for fills and for the rating star in dark mode. It is never used for words.
- The hob glow never sits behind text.
- In light mode the rating star is a darker gold, `#B07A00`. It is decoration next to the number, which is in Ink.

## Type

- **Bricolage Grotesque** 800 for screen and recipe titles (34 px and 30 px), and 700 for section heads (20 px).
  It is narrower than Syne, so "Miso-Glazed Salmon with Sesame Greens" wraps to two lines at 390 px.
- **Figtree** 400 to 700 for reading: 16 px body, 14 px meta, and tabular numbers for amounts and times.

## Open risks

- **Photos.** The look depends on overhead photos. A cook's photo taken at an angle will not match, so cropping and
  a soft round mask need testing on real uploads.
- **Illustrations.** The illustration rule for recipes with no photo needs writing. Today it is a small set chosen
  by cuisine.
- **Glow.** The warm glow in dark mode must stay faint on OLED screens, or it reads as an error state.
