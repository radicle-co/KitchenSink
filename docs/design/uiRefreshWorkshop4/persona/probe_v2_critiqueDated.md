# Proposal A, "Still Life, Lit": assessment

**Method.** I rendered it in Playwright at 1440, 390 and 320 px, light and dark, beside Proposal B.
No 200% text run. Heuristic judgement, untested.

## Verdict: do not ship it as built

It is careful and accessible, but it reads as 2018–2020.

## What must survive

- **For a recipe with no photo, a picture of its own ingredients.** This is the real energy. My recipes becomes a
  wall of food.
- **The highlight on the current step** (`#FEE2CD`), so a cook comes back to the right place.
- One filled teal action, vertical ingredients and steps, timers inside steps, and the contrast work.

## What fails, and why

1. **Cream ground.** Canvas `#F3ECE1`, paper `#FFFCF7`, linen `#ECE4D7`, plus butter, oat and terra washes. That is
   the food-blog ground, and it warms every dish.
2. **Soft serif voice.** Fraunces sets the greeting, titles and every card title, with italics on the name and on
   "_Chicken_" and "_Vegetables_". That is a cookbook voice.
3. **No scale contrast.** Home is a 2×2 grid of equal rounded cards with pictures about 165 px wide. Three grey
   "Soon" cards fill the rest of the first screen. At thumbnail size it
   passes for a UI-kit demo.
4. **Flat clip art.** Flat fills, lemon wheels with spokes and small sprigs: the spot-illustration style of about 2017. The hero sits inside a framed tin, so the dish does not fill the screen.
5. **The idea is invisible.** Home's "light" is `#FAF0DC` on `#F3ECE1`. I can barely tell them apart.
6. **The primary is not the job.** On the recipe page the only filled action is **Edit recipe**, but a cook opens
   that page to cook. On Home, "Resume cooking" is a placeholder, so the first screen cannot show what the cook is
   doing now.
7. **A and B are one option.** They share layouts, cream grounds, a green action and illustrated tiles. Only the
   drawing style and the typeface change.

## What I would do instead

**Thesis: "The ingredients, lit hard and cut by the edge."** Reference: Irving Penn's still lifes, with hard light,
close crops and objects cut off by the frame.

- **Look (bolder).**
    - Use a near-white ground with no warm tint, and one grotesque typeface with large numerals.
    - Draw the generated picture with a real cast shadow, and crop it at the screen edge.
    - Home shows one dish very large. Recent recipes go below it as a vertical list.
    - The signature is the picture's hard light. It is banned in cook mode.
- **Controls (calmer).**
    - The recipe page's one filled action is **Start cooking**, low on the screen. Edit becomes a text button at the
      top.
    - Opening cook mode keeps the screen on.
    - Home's primary follows the cook: "Resume: step 4 of 7" while cooking, and "Cook this" while deciding.
    - The Soon placeholders move below the first screen. The tab bar stays standard.
