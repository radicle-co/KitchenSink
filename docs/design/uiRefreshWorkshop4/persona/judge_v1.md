# Judge review: persona v1 and its three probes

**Verdict: FAIL.** No score reaches 8.5. The persona fixes the round-3 faults in structure: lists scroll the
right way, controls stay standard, the palette is measured, and cook mode is safe. But it swaps one owner
complaint for another. The work no longer looks like a 2018 food blog. It now looks like a 2024 iOS template with
a purple accent. The owner asked for "revolutionary" and "immediately attractive, fresh and exciting". He will
read the Home probe as "clean, safe, boring". That is F1 coming back in a different outfit.

## Scores

| Dimension           | Score | One-line reason                                                                                                                                                                                            |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Originality         | 4     | All three probes reach the same signature: a hue wash at chroma 0.03 that hardly shows. Home is the standard iOS layout.                                                                                   |
| Simplicity          | 7.5   | Conventions are right. No learned controls, standard tab bar, labelled pill. Some waste remains: a "Home" title and dead "Coming soon" rows.                                                               |
| Psychology          | 6.5   | Scroll ledger and peek are correct. The primary contradicts the framed job. Dark muted vs ink is 1.27:1, so hierarchy collapses.                                                                           |
| Palette             | 6     | Named, full role table, both themes, numbers check out. But the palette is the reference with the hue swapped. A purple accent edges toward the §6.1 AI-garnish sign. Direction B has no palette.          |
| Distinct options    | 4     | Direction B is half an option: no palette, no states, no ledger. Its signature carries meaning. It differs only in how the list is laid out, inside the same structure.                                    |
| Cooking context     | 5.5   | The critiques police cook mode well. Home, the one designed screen, has no cooking idea: no cook in progress, no running timer, no tonight's plan.                                                         |
| Critique judgement  | 5.5   | Both verdicts are right, but they were read from an answer key (canon F1/F3). Probe 1 ignores the sibling (F2). Probe 2 discards the creativity the owner praised. Both fixes are the same generic recipe. |
| Impresses the owner | 4     | Competent, correct and forgettable. Nothing here makes him want to keep looking.                                                                                                                           |

**Pass: false.**

## What I checked

- I read the persona, the canon and all three probes. I also checked the probes' factual claims against the
  earlier proposals: `#F3ECE1`, Fraunces and "Edit recipe" are in round 1 proposal A. `#B3330E` and "Next step" are
  in round 2 proposal A.
- I re-computed colour figures with culori.
    - ΔE00 `#B3330E`/`#B3261E` = 5.6 (the probe was right).
    - Aubergine vs Leaf ΔE00 = 72.6 light and 60.4 dark (right).
    - Steel `#F4F5F7` is OKLCH C 0.003 at hue 265. That is cool grey, ΔE00 2.3 from pure white.
    - Dark Ink `#EEF0F3` vs dark Slate `#D3D7DD` = **1.27:1**. Light Ink vs Slate = 2.23:1.
- The numbers are the easy part, and I did not let them lift any score.

## Probe-by-probe

### Probe 1: critique of round 1 proposal A ("dated, identical to its sibling")

**Right:**

- The verdict. It dates each choice by year.
- Its catches: the wrong primary ("Edit recipe" where "Start cooking" belongs), the four signatures, the 24 px
  targets and the computed muted Lc.

**Wrong:**

- **It never mentions proposal B.** The owner's second complaint was "the two mockups look nearly identical". A
  grep for "B", "sibling" or "identical" finds nothing. Half the owner's verdict was never reached.
- **It did not work out the verdict for itself.** It cites "canon F1", and F1 is the owner's own words. The probe
  matched an answer key. It did not show judgement.
- **Its "what to do instead" is a list of subtractions:** near-white cool ground, one sans, flat surfaces, opaque
  tab bar, the dish wash. That fixes "dated" by making it generic. No idea is offered that makes the owner say
  "fresh" or "exciting".

### Probe 2: critique of round 2 "The Now Line" ("creative but too hard to learn")

**Right:**

- The verdict. The signature is a control in disguise.
- Its catches: resize-on-scroll, idle motion, four meanings on one colour, the action at ΔE00 5.6 from danger,
  21 px cook-mode text, no photos.

**Wrong:**

- **It never says what the owner liked.** He said "I like the creativity, this is much better." A director keeps
  that energy and moves it into the look layer. Examples: a bold editorial composition, the line kept as a pure
  graphic with no meaning, the confidence of the type.
- **The probe kept only the conventional parts:** the dock, the stepper and the timer button. Its replacement is a
  static list with a Sprout ground. Sprout is copied from the reference palette, which canon §3.2 says is "not for
  copying". It adds the same dish wash as probe 1. The owner goes from "too creative" straight back to "boring".
- It also leans on canon F3 ("the line of light you must understand") as its source, so this is again matching
  against the key.

### Probe 3: design Home from scratch, plus a second direction

**Direction A, "Last on the counter":**

- **Structure:** large title "Home", a "Recent recipes" header with a "See all" link, one big photo, a row of 132 px
  squares, an extended pill button, a standard tab bar. This is the default iOS 17 layout, Netflix's "continue
  watching" with a recipe photo. Canon §5A says it must not be mistaken for "this year's Apple sample app", and it
  fails that test.
- **Square thumbnails** in the row are named in §6.1 as a dated sign.
- **The primary contradicts the frame.**
    - The frame card says the job is "get back to what I was making".
    - The one filled primary is "New recipe", an authoring action that most visits do not need.
    - The hero, the thing the job is about, is a plain link.
    - Von Restorff and Hick point the eye to the wrong place.
- **Nothing on Home comes from cooking.** Canon §5A requires the signature to come from "hands, distance, heat,
  timing". Missing:
    - a cook in progress ("Step 4 of 7, timer 06:12")
    - tonight's meal
    - what to use up
    - a short, time-boxed choice for tonight

    Home answers "what did I open last", which any content app asks.

- **The signature hardly shows.** The wash is OKLCH L 0.95 / C 0.03. On a ground at C 0.003 it is a faint tint, not
  something you notice in 50 ms. A signature nobody notices adds no freshness.
- **The palette** is cool grey plus near-black ink plus one saturated accent. The structure is the reference with
  the hue swapped. The purple accent on cool grey is the 2023–25 SaaS / AI-tool look that §6.1's "purple-blue" sign
  warns about. "Aubergine" names a food, but it does not look like one here.
- **Hierarchy in dark mode:** Slate on Ink is 1.27:1. Secondary text is almost as bright as titles. Hierarchy then
  depends on size alone. The cause is the canon's own Lc ≥ 75 floor on muted text (the reference Ash has the same
  fault).

**Direction B, "The index":**

- **Not distinct.**
    - It keeps the same tab bar, the same pill, the same ground and the same type, with a list where A had a hero.
    - A stranger at thumbnail size sees two plain lists of food.
    - It has no palette (fails F4), no states and no scroll ledger.
- **It breaks two rules:**
    - 72 px thumbnails ("small photos", §6.1, and the photo is no longer the largest thing, §5A).
    - Its signature, "large cook-time numerals", **carries meaning** (§2.2 rule 2).

**Process:**

- The persona requires ten concepts, a built mockup, the full §5 checklist, a Nielsen pass and a harshest-reaction
  critique log.
- None of these appears.
- The probe admits "words only, no mockup", and the persona did nothing to stop it.

## Root causes in the persona and canon text

1. **The designer has no identity.** The persona opens with `**Name:** {designer name} · **Taste:** {one or two
sentences…}`, an unfilled template.
    - With no point of view, the designer falls back to the safest neutral answer.
    - "Apple and Netflix level" is stated as a title, not as taste.
    - Nothing names a distinct look the designer believes in, such as a type voice, a way of photographing food, or
      a compositional habit.
    - This is the main cause of the low originality and wouldImpressOwner scores.

2. **Originality gets only negative tools.**
    - The persona's failure 1 says "your first idea is the category median", but its only remedies are ban lists
      (§6.1) and "freshen by subtracting" (persona step 5, canon §2.3).
    - Subtraction removes the dated look but does not create a fresh one. Taken alone, it gives the iOS template.
    - Canon §0 also praises designs that "look like their category" (Tuch 2012) without separating two things:
        - familiar **structure**, which is good
        - a familiar **surface**, which is F1
    - Taken together, the text pushes toward the median it warns against.
    - What is missing: a positive engine.
        - Each option must state a **visual thesis** (what you see in 50 ms and why only Commise looks like this).
        - It must name the **reference outside recipe apps** it draws on (kitchen equipment, restaurant pass tickets,
          editorial food photography, signage).
        - It must pass an "**excitement test**" as well as the dated test: does the owner want to screenshot this and send it
          to someone?

3. **The canon gives away the answer, so everyone converges.**
    - Canon §3.4 rule 5 (colour from the dish, by tone) and §1.3's "Cook again" row are written as ready-made
      solutions.
    - All three probes chose the dish wash. Two of the three Home layouts are the Cook-again row.
    - The persona names the "fourth failure" (team convergence), yet its own canon causes it.
    - Fix: present those as _allowed_, not _suggested_. Ban any designer from using a canon example as their
      signature. Require the signature to be invented for this option and checked against the canon's examples.

4. **The owner's verdicts are in the canon word for word, so a critique can look up the answer.**
    - F1–F5 quote the owner, and both critiques cite them ("canon F1", "the line of light … canon F3").
    - We cannot tell whether the persona has judgement or just recall.
    - The persona needs a **critique mode** that requires the critic to:
        - (a) compare every sibling and rule on distinctness, every time
        - (b) say first what is good and must survive, especially anything the owner praised
        - (c) propose a fix that is _bolder_ in the look layer than what it replaces, never only smaller
        - (d) ground each point in observed reasons, not F-numbers.
    - For future probes, hold F1–F5 back from the canon copy the critics receive.

5. **"Simple" ends up as "plain", because no one asked for both at once.**
    - Persona failure 2 (boldness in the wrong place) is described in detail, with counters.
    - The other side, "too timid, generic", gets one line in failure 1 and no step.
    - The probes over-corrected for F3 and paid for it with F1.
    - Add a failure mode: "**Fear of F3 makes you plain.** You fail F1 when your option can ship as a UI kit demo." Pair it with a required
      "boldest acceptable" version of each option's look layer before editing down.

6. **The primary is not tied to the job.**
    - Step 1 writes "The job" and step 6 checks "one filled primary in thumb reach", but nothing links the two.
    - Result: the job is "get back to what I was making", the primary is "New recipe".
    - Add: "The filled primary _is_ the job named on the frame card. If they differ, one of them is wrong."

7. **The cooking-specific need is optional on Home.**
    - Step 4 asks concepts to start from "hands, distance, heat, timing…", but planning screens drift back to a
      generic library.
    - Add: Home must show a **cooking state**, meaning in progress, tonight, or a timer still running, and must say
      how Home changes between "I'm cooking right now" and "I'm deciding".
    - This is the most "designed for our unique needs" surface, and v1 leaves it out.

8. **The palette rules give safe but sameish palettes, and one rule flattens hierarchy.**
    - §3.2 requires a near-neutral ground, one accent and the same role table. The probe kept the reference structure
      and swapped the hue: a different palette on paper, the same one by eye.
    - Nothing asks a palette to have character: a temperature, a second supporting hue for content (not actions),
      or a reason tied to food.
    - Muted Lc ≥ 75 in dark mode puts muted within 1.3:1 of ink.
    - Fix:
        - Require a stated **palette idea** (what it evokes, why it flatters food photos).
        - Allow one non-action **content hue** for imagery, washes and category marks, never on controls.
        - Set muted to Lc ≥ 60 for secondary text of 16 px and up, plus a minimum ink-to-muted step (for example at
          least 1.6:1) so hierarchy survives in dark mode.

9. **Equal finish for every option is not enforced, and the process can be skipped.**
    - Direction B shipped with no palette, states or ledger, and steps 4, 8, 9 and 10 were skipped.
    - "A step with no output was not done" is stated, but nothing refuses a delivery that lacks the output.
    - Add a delivery gate: list the required artefacts per option, and say that a delivery missing one is returned,
      not shown.
    - Also: "Every option is finished to the same level. A thin second option is filler (§2.2 rule 7)."

10. **Purple and AI aesthetics are not addressed directly.**
    - §6.1 bans "purple-blue gradients" but not a purple accent on cool grey, which reads the same.
    - Add: "No accent that reads as a tech or AI brand (violet or indigo on cool grey). The accent should look like
      something in a kitchen."

## What the next persona must make happen

- A designer with a stated taste and a named outside reference for each option.
- One invented signature per option, visible in 50 ms, with no meaning, never borrowed from the canon's examples.
- Home built around cooking state, with the primary equal to the framed job.
- Two options that differ in structure **and** in look, each with a full palette, states and ledger.
- Critiques that compare siblings, keep what the owner praised, and propose something bolder in the look layer and
  calmer in the controls.

_Evidence: heuristic judgement from reading text; no probe produced a rendered mockup, so nothing was judged at
320 px, 200% text or thumbnail size._
