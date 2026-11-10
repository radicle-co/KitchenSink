# Round 2 / Designer 1: "The Now Line"

## The idea

Every screen in Commise is drawn across one line that never moves: the **now line**, a thin band of light at the
height where your eyes rest. Everything earlier sits above it and everything ahead sits below it. Time reads top
to bottom, like reading order. Content scrolls past the line, and whatever crosses it is lit: it grows, turns to
full ink, and can be read from the stove.

- **Home** is the river of your cooking. Recent recipes flow down a soft river of their own colours into the
  line. The past recedes, so older dishes are smaller and quieter, and yesterday's dish sits on the line. Below
  the line is what is ahead: today that is the real "Coming soon" copy (meal plans, grocery list, nutrition),
  drawn as dashed, not-yet-lit points on the river's dotted course.
- **Recipe detail** keeps every fixed part (hero, facts, ingredients with servings, steps, Start cooking), and
  its steps sit on the **same axis**. The line stays at eye height while the page moves, so the step crossing it
  is large and lit. Scrolling with a knuckle is the only control needed. Steps already read sit above it in
  muted ink.
- **Each dish is known by its colour.** A recipe with a photo shows the photo inside its orb. A recipe with no
  photo gets a flavour orb, mixed from its main ingredients. Both appear in one frame, so both ideas are tested.

## What changed from round 1, and why

| Round 1                                                             | Round 2                                                                                                      | Why                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Recipe drawn as a dial, steps as arcs                               | **No ring anywhere.** The line is the one device on every screen                                             | Both critics: a dial is an Activity ring. D2 or D3 keeps the ring        |
| Step colour = heat, arcs = step duration                            | Steps carry no heat or length. A timer shows only on a step that has `timerSeconds`                          | We have no heat or duration data. Drawing it misleads                    |
| Detail frame was really cooking mode                                | Real Recipe detail: hero, facts, ingredients, steps                                                          | Scope: flows are fixed                                                   |
| No photos                                                           | Photo inside its orb, and the orb is the fallback                                                            | Appetite is visual (both critics)                                        |
| Navy glass, blur auras, glass tab bar, gradient title, magenta glow | One light source: the line and the one pool of colour it throws. Solid tab bar. No gradient text, no magenta | "Least calm of the three", "crypto look"                                 |
| Bricolage Grotesque + Inter Tight                                   | **Funnel Display + Funnel Sans**                                                                             | Break the shared quirky-grotesque look                                   |
| Ahead above, past below                                             | Past above, ahead below                                                                                      | Matches reading order and the step list, so one rule covers both screens |

Kept, because both critics praised them: the "now" line, time as the layout axis of Home, and the flavour orbs.

## Why it is new, and still calm

- No app is built on a fixed reading line. A teleprompter has one. A recipe app has never used one. Here it is
  the brand mark, the navigation of time, and the hands-free reading aid, all in one stroke.
- The colour is not fenced into a picture. It flows: orb, then river, then line.
- Calm by rule: one light source, one slow motion at a time (the line's colour drifts over 16 s, the now point
  breathes over 5 s, the hero orb rises once). All of it stops under `prefers-reduced-motion`, and the layout
  still reads.

## Colour and the hour (the rule)

The **theme** drives colour: light or dark, by the person's setting. The **hour** drives only the line's label
("Friday evening", "Friday night") and what sits on the line. Colour does not change by the hour. We avoid the
Apple Weather sky, and light mode at 9 pm stays light. When meal plans ship, tonight's planned meal takes the
first slot below the line. That is how Home leans toward dinner at 5 pm. Until then, nothing is invented.

## Palette and type

- Light: ground `#EEF3F1` (cool celadon fog, not cream), ink `#0F1A17` (15.9:1), muted `#44524D` (7.3:1, and 6.2:1
  at the deepest point of the glow), action `#B3330E` (5.5:1, and 4.7:1 on the glow), white on action 6.2:1.
- Dark: cast-iron green-black `#0F1311` (not navy), ink `#ECF2EE` (16.5:1), muted `#A3B0AA` (8.3:1, and 5.9:1 on the
  glow), action `#FF8A5C` (8.1:1).
- Line colours: saffron `#E2961C` / `#FFC04D`, tomato `#C2401C` / `#FF7A4A`, leek `#3F8F55` / `#6FD38C`. The line
  is decorative. Its meaning is carried by the "Now" pill (15:1+), so the light line's 2.2:1 does not fail
  1.4.11. The lit step's number disc is `#1A1205` on saffron (7.6:1).
- Type: **Funnel Display** (titles, numbers, the lit step), **Funnel Sans** (body, labels, tabular amounts).
  Controls are at least 44 px. The Start cooking button is 56 px.

## Open risks

- The reading line needs a real scroll-linked build, plus a tap fallback ("next step") for cooks who cannot
  scroll with wet hands. This is a prototype question, not yet tested with users.
- Orb colours need a rule from ingredients to colour (food-family palette). That mapping is not specified yet.
