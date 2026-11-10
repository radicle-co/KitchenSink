# Proposal A, "The Now Line": assessment

**Verdict: do not ship it.** The signature is a control in disguise. The line tells you what is done and what is
next, and it resizes content as you scroll. This is the "line of light you must understand" from canon F3. Read from the
HTML, not rendered. Heuristic judgement, untested with users.

## Keep

- **The cook-mode dock:** 64 px labelled Back and "Next step", fixed and low, with "Screen on" shown (§4).
- A labelled timer button, a real servings stepper, standard tabs and back.

## Fails, by rule

1. **The signature carries meaning** (§2.2 rules 2–3, §6.2). Above the line means done and below means ahead. It
   also appears in cook mode.
2. **Content resizes on scroll.** A title off the line shrinks to 60% and fades. The recipe page acts as a
   teleprompter with a "Next step" button that appears and disappears. That merges two modes (§4), moves a
   control (§6.2) and adds a second filled button beside "Start cooking" (Von Restorff, §1.1).
3. **It moves without a touch.** A 16 s gradient loop, a breathing dot and glows (§5E).
4. **Colour has no single meaning.** The line has four colours. The tab marker is a gradient, quantities use the
   action colour as decoration, and the cook-mode wash encodes a running timer (§3.4 rule 1). The action
   `#B3330E` is **ΔE00 5.6** (computed) from the reference danger red `#B3261E`, so the primary looks like danger
   (§3.4 rule 3).
5. **The food is not the hero.** It has no photos, only 96 px drawn **circle crops** (§6.1, §5A). The greeting is
   bigger than any dish.
6. **Home has no main action.** Below four recipes, 470 px of padding and three dead "Soon" rows
   make a false floor (§1.4).
7. **Cook-mode step text is 21 px**, below the 26–32 pt rule, and the 68 px countdown outranks it (§4).

## Instead

Keep the question the line answers, "Where am I in the recipe?", and answer it with conventions.

- **Recipe page:** a static vertical list. The current step gets a Sprout ground, a tick and "Step 3 of 5". One
  filled "Start cooking" sits in thumb reach.
- **Cook mode:** its own layout. One step at 28 pt, quantities inline, a fixed timer strip and this dock. No line,
  no wash.
- **Look:** large dish photos, a 55% scrim under any text, a near-neutral ground and one accent at least ΔE00 15
  from danger.
- **One static signature with no meaning:** a hero wash set by tone from the dish photo (§3.4 rule 5). It is used
  only on planning screens and is banned in cook mode and in controls.
- **Home:** "Cook again" as a photo row with the next item peeking, then recents in a vertical list.

**Not checked:** rendering at 320 px and 200% text, APCA, and dark-mode pairs. Computed WCAG: action on ground
5.5:1, muted 7.3:1, saffron 2.2:1 (decoration only, so it must never carry text).
