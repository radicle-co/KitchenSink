# Round 1 / Designer 1: "The Recipe Is a Clock"

## The idea

Every recipe app shows a recipe as a document: a photo, then a list, then another list. But nobody cooks a
document. A cook lives inside **time and heat**: what is on the stove now, what comes next, how long is left.
So Commise stops being a page and becomes an instrument. The recipe is drawn as a **dial**: each step is an arc
whose length is its real duration, cool mint for prep, warming to ember for heat. A single glowing point marks
_now_. The ingredients you need for this moment sit around the dial; the rest wait their turn.

Home follows the same idea: it is a **time river**, not a feed. A glowing "now" line runs through the screen.
What is coming sits above it, what you cooked lately flows below it. Each recipe has no stock photo. It has a
**flavour fingerprint**: a soft orb of light mixed from the colours of its main ingredients (saffron, leek,
tomato, miso). Your library becomes a set of glowing colour signatures you learn to recognise, like album art.

## Why it is new

- No card grid, no paper, no serif-on-beige. The ground is deep night-blue glass (dark) or cool porcelain
  light (light); colour lives in light itself, not inside a fenced picture.
- Time is the layout axis on both screens. Apps put time in a small "45 min" label; here it is the shape.
- Generated imagery (fingerprint orbs) means every recipe, even a typed one with no photo, looks beautiful
  and unique, and the colour carries real meaning.

## Why it fits cooking

- Hands busy, eyes away: the dial reads in a glance from a metre away. One big number, one step, one glow.
- Heat and time are the two things a cook tracks; the colour temperature of the UI _is_ the heat of the step.
- Mise en place: showing only "what you need now" cuts the scanning of a long list with wet hands.

## Why it stays calm

One accent family (mint to ember) and one moving thing on screen at a time (the slow breathing "now" point).
Large type, few words, generous space. Motion stops under `prefers-reduced-motion`; the dial still reads.

## Palette and type (brief)

- Dark (default at the stove): ground `#0B0E14` to `#121826`, text `#F2F4F8`, muted `#A6B0C0`,
  mint `#5EE0B5` (prep), amber `#FFB547`, ember `#FF7A45`, glow magenta `#FF4F7B` (high heat, decorative only).
- Light: porcelain `#EEF2F7` to `#FFFFFF`, text `#111622`, muted `#4A5568`, action text `#B23C0A`,
  mint text `#0B7A5A`. All text pairs meet WCAG 2.2 AA (4.5:1 body, 3:1 large and controls).
- Type: **Bricolage Grotesque** for display and the dial numerals (lively, optical-size, unbookish);
  **Inter Tight** for body and labels, tabular numbers for times and amounts.
