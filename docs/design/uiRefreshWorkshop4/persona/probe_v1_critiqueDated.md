# Proposal A, "Still Life, Lit": assessment

**Verdict: do not ship it.** It is careful work aimed at the wrong target: the exact look you called "dated, old,
tired" (canon F1). The polish hides that.

## Why it reads as dated (year each choice reads as)

- **Ground:** `#F3ECE1`, which the file itself calls "plaster", plus "linen" and "paper" roles. Three §6.1 warning
  signs. 2016–2019.
- **Voice:** Fraunces, SOFT 100, italic greeting and group labels. A soft bookish serif as the main voice. 2020–2022.
- **Surfaces:** a 2×2 grid of equal cards, each in a paper "mat" with a warm drop shadow. 2017.
- **Imagery:** drawn still lifes with a grain filter instead of food photos. 2016–2019. Fails §5A: the photo must
  be the biggest, most colourful thing on Home and the recipe page.
- **Controls:** a floating glass tab bar and glass discs. This copies this year's leader (§6.1), so it dates to 2026.

It "keeps today's layout, order and copy", so every change adds something: grain, mats, drawings, glass. Canon §2.3
says to freshen by removing things.

## Other problems

- **Wrong primary.** The one filled button on the recipe page is "Edit recipe". A cook opens a recipe to cook. The
  sample has no "Start cooking" and no cook mode (fails §4, §5F).
- **The signature carries meaning.** A drawing "fills in as the cook matches foods", so it shows progress. Miss it
  and you miss information (§2.2 rule 2). There are also four signatures: the light, the drawings, the check
  overshoot and the card-to-hero grow. Canon allows one.
- **Home's first screen** spends space on a greeting, a date and three "Coming soon" cards for features that do not
  exist (§1.4).
- **Targets:** timer and art chips are 24 px tall. §4.1 needs 44 pt.
- **Contrast**, computed: muted text on the ground is 4.97:1 but APCA Lc 68. Dark muted is Lc 56. Both are below
  Lc 75 for secondary text.

## What works

- **Colour from the dish, set by tone.** The washes fix OKLCH lightness, so contrast holds for any hue. This is
  §3.4 rule 5 done well, and it is the best idea here.
- One action colour, ticked selected chips, vertical ingredients and steps, and real long titles.

## What to do instead

Keep the dish-light wash as the **one** signature, on planning surfaces only. Replace the rest:

- A near-white ground with a slight cool tint.
- One sans family with a confident heavy display weight.
- Real photos, full-bleed on the recipe page, with the title on the ground below.
- Flat surfaces, used only to group.
- An opaque, standard tab bar.

Make "Start cooking" the one filled primary on the recipe page, and build cook mode to §4. Use a drawn still life
only for a recipe with no photo.

_Evidence: heuristic judgement, untested. I read the HTML and did not render it, check 320 px or 200% text, or test
it with users._
