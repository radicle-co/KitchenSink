# Critique 2 — Designer 2 on Options 1 and 3

All contrast figures below were recomputed from the hex values (WCAG 2.2 relative luminance). Both options' own
tables check out. The problems are in the pairs they did not list.

## Option 1: Pilot Light

**Fresh?** Yes. Fog green-grey, cast iron at night and Funnel type are nowhere near paper and serif. The risk runs the
other way: an almost colourless UI can read as a settings app. The dish art is what keeps it warm, so it cannot be cut.

**Simple?** Nearly. The glow needs no learning because a word ("Cooked last", "Current step") always says the same
thing. Two things still need explaining:

- **"Tap any step to make it current."** Today's screen has an explicit "Mark step as current" control. When a plain
  paragraph changes state on a tap, nobody can see that it can. Keep a visible control on each step (a numbered button or
  radio), with the tap on the row as a shortcut.
- **"Cooked last"** has no signal behind it. If the app only knows "opened last", the label lies.

**Palette.** Well defined, with clear rules. One real defect: dark **Honey** (`#F2C14E`, rating stars and Draft) next
to dark **Saffron** (`#FFC04D`, "now") is **1.03:1**. They are the same colour. That breaks the option's one rule,
"saffron only means now", on every rated recipe at night. Move the stars to a neutral (Steam or Ash) or push Honey
toward amber-brown. Light Pewter edge on fog is 3.47 and on glow 3.49: it passes, with little margin.

**Keep:** one warm light per screen, and only where something is happening now. Cool room, one lamp.

**Fix:** the step control, the star colour collision, and drop the 9-second breathing glow on Home. Ambient motion on
a still screen is the first thing that reads as "flashy".

**One push:** sample the glow from the recipe's photo, when it has one. The light then belongs to the food, not to
the brand.

## Option 3: Enamelware

**Fresh?** Yes, and the most ownable of the two: one real object (enamel plate, cobalt rim) gives the whole palette.
The risk is cute Delftware, and a list of round plates that drifts back toward a card grid of food.

**Simple?** Mostly. Sheet over the dish, plain rows, one cobalt pill. But it **drops two existing features**: there is
no "Screen on" switch and no "Mark step as current" in the mockup. The flows are fixed, so both must come back.

**Palette.** Calm and distinctive. Doubtful pairs:

- Herb on light ground is **4.66**. It passes, with little margin. Keep it off small text on Enamel.
- The light star `#B07A00` is 3.73 on white but **2.97 on Enamel**. A star on the ground fails 3:1.
- Yolk on white is **1.88**. The avatar and "Soon" fills need an Edge outline on Plate.
- Dark **Yolk** `#FFC64D` against dark **Amber** `#F4B655` (warning) is **1.15**. They are the same hue, so "Soon"
  and a warning look alike.
- Hob glow is listed with alpha (`#FF96464D`). Give it a fixed role ("decoration, never behind text"), not a
  contrast row.

**Keep:** the button wears the plate's rim. One object gives the brand.

**Fix:** restore both features. Do not depend on overhead photos: most cooks shoot at an angle. Cuisine-chosen
illustrations show a dish that is not the cook's.

**One push:** make the rim the frame, not the camera angle. Any photo gets a round crop inside the cobalt rim, so
an angled snapshot still sits on the table.
