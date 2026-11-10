# Proposal A, "The Now Line": assessment

**Verdict: do not ship it.** Keep its look. Remove the line as the thing that organises each screen.

I rendered A and B with Playwright at 1400, 390 and 320 px and judged the screenshots. A and B are distinct options:
A is a type-led list read against a fixed line, and B is plates seen from above.

## What must survive

- **The type.** Funnel Display at 48 px for the recipe title, and the 68 px timer "1:24:36". No recipe app looks like
  this.
- **The edge crop.** On the recipe page the dish is a 200 px disc cut by the right edge.
- **The tomato "Start cooking" button**, the one filled, labelled control.
- **Cook mode's dock:** two labelled 64 px buttons, fixed at the bottom.

## What fails, from the render

1. **Position carries meaning.** Items off the line are drawn at 60–78% size in muted ink. To read a step at full
   size, you scroll it to a line nobody told you about.
2. **Home reads backwards and has no job.** Oldest is at the top, newest at the line. The greeting starts out of
   view. No primary action. Half the first screen is "Coming soon". It does not show tonight's meal or a
   cook in progress.
3. **Constant motion.** The line's gradient moves on a 16-second loop and the "Now" dot pulses. Nothing may move
   unless the user acts.
4. **The signature appears four times:** the line, the river behind the orbs, the glowing tab marker and the
   saffron wash. It also sits in cook mode.
5. **Cook mode text is too small.** The step is 21 px. A propped phone needs 26–32 pt. "Back" must say "Previous
   step".
6. **One colour, two meanings.** Tomato marks the button and also every ingredient quantity, which you cannot press.
7. **At 320 px it breaks.** The "Now" pill covers the title, and the roast's title takes five lines.

## What I would do instead

**Thesis:** the dish cut by the screen edge, set against one huge Funnel Display figure for what matters now: the
time left or the step number. Reference: the Solari di Udine split-flap departure board (Gino Valle) (quiet, one large number). That figure is the signature. It appears once per screen, is never a control,
and stays out of cook mode's controls. "Now" becomes content, not a mechanism to work out.

- **Controls:** a standard tab bar and back button. Vertical lists at full size, newest first. All steps at one
  size, the current one marked with a tick and a tinted background.
- **Home, cooking state:** it shows "Step 4 of 5 · 1:24:36". The primary button is "Back to step 4".
- **Home, deciding state:** it shows tonight's dish, full-bleed. The primary button is "Start cooking".
- **Cook mode:** step text at 28 pt, with no glow and no wash.
- **"Coming soon":** one line of text.

Not run: 200% text and dark-theme contrast. This is heuristic judgement, untested with
users.
