# Judge review: persona v3 and its three probes

**Verdict: FAIL.** No score reaches 8.5.

v3 fixed most of what judge v2 asked for:

- The signature now survives real content, and the review checks it.
- The deciding state now gives reasons.
- Home has no dead rows.
- Each option names its closest app.
- Each option takes a trajectory step.
- Palettes are complete and computed. None of them comes back as an earlier round's colour.

The persona did not remove convergence. It moved it. v2's three blind probes all reached "near-white with an edge-cropped
hero". v3's three probes all reach the **inversion** of that answer: a deep, dark planning chrome. Two of the three
reach the same concept, "one warm light pool behind the dish in a dark room". Both independently name **Apple TV** as
the closest app.

The persona told them to do this, in step 6: "Consider the one deep or coloured planning chrome that §3.2 allows". That
is the third round running in which a named permission became the answer. The critique of the dated proposal has also
regressed. It no longer rules on the twin sibling, which was half of the owner's verdict. And, for the third round,
there is no mockup. So no visual claim is tested.

## Scores

| Dimension           | v1  | v2  | v3  | One-line reason                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --- | --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Originality         | 4   | 5.5 | 6   | The moves are more specific: Pass lamp, ingredients set as type, a stencilled "Tonight". But every probe goes dark, and two reach the same lit-dish concept. YouTube's ambient mode (2022) and Apple TV already ship a glow behind content on dark.                                                                                |
| Simplicity          | 7.5 | 7.5 | 7.5 | Standard tabs and back, one fixed primary, vertical lists, no "Coming soon" rows, no gestures. Lost: Pass forces a dark app on users who chose light mode. B's radio cards hold a nested "Recipe ›" link, which gives one target two actions.                                                                                      |
| Psychology          | 6.5 | 7.5 | 7.5 | The ledger is correct and gives reasons, and the next group shows above the fold (y ≈ 620). The critiques catch a colour with two meanings and a quiet primary. Lost: Pass's signature hue is the warning colour (ΔE00 0.65), which breaks one-colour-one-meaning. Probes 1–2 make decisions from pantry data that does not exist. |
| Palette             | 6   | 5.5 | 7   | Two full, named role tables. All figures recomputed and correct. Lemon and Beet are far from every rejected colour. The swatch strips differ. Lost: Lamp equals Rind. Pass has no light theme. Hotel pan is grey + white + one accent and clears the Mise test by 1.2 L. Hairline is missing in both.                              |
| Distinct options    | 4   | 6   | 6.5 | Inside probe 3, A (one pick, lit, dark) and B (three-way chooser, light steel, stencil) differ in kind. B is again written to a thinner level. Across the three probes, the directions are one family.                                                                                                                             |
| Cooking context     | 5.5 | 7   | 7.5 | The state-driven primary ("Back to step 4" with a timer strip) holds. Cook mode is neutral and opaque. Steps lack quantities. Cook mode overlaps at 200% text. The heat-lamp and hotel-pan references come from the kitchen.                                                                                                       |
| Critique judgement  | 5.5 | 7   | 6.5 | Probe 2 is the best critique so far: the owner's verdict in both halves, with observed values. Probe 1 regressed. It never mentions proposal B ("Kitchen Press"), its twin, so it gives one direction for a twin set. The two fixes converge on dark chrome, and probe 2's fix is probe 3's Home.                                  |
| Impresses the owner | 4   | 5.5 | 6   | "Pass" is the most seductive idea yet, and the closest to "Netflix". It is still words only. In rendered form, I expect him to see three dark, moody kitchens as one idea, not as "fresh, calming, everyday".                                                                                                                      |

**Pass: false.**

## What I checked

- I read the persona v3, the canon, judge v2 and the three v3 probes.
- I checked the critiques' facts against the source files.
    - Round 1 proposal A has `#F3ECE1`, `#FFFCF7`, `#2A6B65`, Fraunces, "Edit recipe" and three "Coming soon".
      Probe 1's facts hold.
    - Round 1 proposal B ("Kitchen Press") also uses `#2A6B65` and "Edit recipe". It is the twin. Probe 1 never names it.
    - Round 2 proposal A ("The Now Line") has Funnel Display, "1:24:36", `16s` and `5s` animations, `#B3330E` and a 200 px
      disc. Probe 2's facts hold.
- I recomputed both of probe 3's palettes with culori (`/tmp/.../scratchpad/pal.mjs`).

| Check                     | Pass, light \| dark          | Hotel pan, light \| dark     |
| ------------------------- | ---------------------------- | ---------------------------- |
| Ink on ground, WCAG       | 12.8 \| 16.4                 | 14.1 \| 16.3                 |
| Ink on surface, WCAG      | 10.7 \| 14.9                 | 17.8 \| 14.4                 |
| Muted on surface, WCAG    | 6.17 \| 8.44                 | 8.06 \| 8.14                 |
| Ink to Muted              | 1.74 \| 1.77                 | 2.21 \| 1.77                 |
| On-action on action, WCAG | 12.4 \| 11.6                 | 7.72 \| 10.2                 |
| Rim, worst case           | 3.97                         | 3.65                         |
| Ground in OKLCH, L and C  | 0.30 / 0.011 \| 0.19 / 0.007 | 0.92 / 0.004 \| 0.21 / 0.006 |

- **ΔE00.**
    - Lemon to Beet: 73.4 light, 53.8 dark.
    - Lemon to the nearest earlier colour: 30.7–31.1 (`#8EDBBF`), and 17.2 to Mise Leaf dark.
    - Beet to the nearest earlier colour: 42.6.
    - Beet to Tomato: 23.2 light, 18.9 dark.
    - Every figure the probe reported is correct.
- **Not reported by the probe:**
    - Lamp `#FFB46B` (the content hue, the whole signature) and Rind warning `#FFB46E` are **ΔE00 0.65** apart in light
      and 3.4 in dark. They are the same colour.
    - Pass's "light" theme ground is OKLCH L 0.30. That is a dark theme.
    - Hotel pan's ground is 5.2 L below Mise and has no chroma. It clears the 4-L test by a small margin, and its Ink to
      Muted (2.21) is Mise's (2.26).
- **Leak check.** I searched the whole workshop tree and every earlier round for "uses the spinach" and "Apple TV".
  Neither appears in any source a probe can read.
    - Probes 1 and 2 both write the deciding reason "35 min, uses the spinach".
    - Probes 2 and 3 both name Apple TV.
    - These are not leaks. They are convergence from a shared prior, which is worse: no canon edit can remove it, so the
      persona has to force divergence itself.
- I did not render the old proposals again. Probe 2's render claims are taken on trust. The numbers did not lift any
  score.

## Probe by probe

### Probe 1: critique of round 1 "Still Life, Lit"

**Right:**

- It rendered and gave a dated verdict ("about 2021, a wellness app") from observed values: plaster grounds, soft
  Fraunces italic, flat vector food in rounded shadowed cards.
- It names what must survive, and the choice is good. A cover drawn from the recipe's own ingredients answers a real
  Commise problem: most recipes have no photo.
- New, specific faults:
    - The "unfinished study" encodes match progress, so the signature carries data.
    - Home is recall only.
    - The primary is wrong: **Edit recipe** on a page you open to cook.
    - Steps carry no quantities.
    - The tick overshoots.
    - The action colour is a rejected round's colour, at 4.67:1.
- It honestly flags the Spotify-covers risk and does not claim to pass it.

**Wrong:**

1. **It does not rule on the set.** The owner said this proposal is dated **and** "nearly identical" to its sibling.
   Proposal B ("Kitchen Press") sits in the same folder, with the same action colour and the same "Edit recipe"
   primary. The probe never mentions it. Persona critique steps 2 and 6 require a ruling on the set and one direction
   per twin. v2's probe did this, and v3's does not. I cannot see whether the probe's brief named B. The persona says
   "every time" either way.
2. **The fix is the new median.** It uses a "deep char ground, the one coloured planning chrome §3.2 allows". It quotes
   the permission as its reason. Huge condensed grotesque cropped at the card edge is also canon §2.3's named lever,
   "big type ... a crop at the screen edge", used plainly.
3. **It invents data.** "35 min, uses the spinach" needs pantry data, which Commise does not have. It does not say so.
4. **The palette is one hue.** "Saffron" has no hex, no role table and no contrast figure. The owner asked for a defined
   palette per option. A critique that proposes a direction owes at least the idea and the action hex.

### Probe 2: critique of round 2 "The Now Line"

**Right. This is the best critique in three rounds:**

- "The look has energy. The line under it makes the cook learn a rule." That is the owner's verdict, both halves, in two
  sentences.
- Must-survive is exact: Funnel Display at 48 px, the 68 px timer, the full-width tomato button, and the 64 px dock.
- Every fault is an observation with a number:
    - Items off the line shrink to 60–78%.
    - Home runs newest-at-bottom.
    - Controls appear on scroll and cover step 4.
    - Cook mode overprints at 200% text.
    - A 16 s loop and a 5 s pulse.
    - One colour has two meanings.
    - The photo is a 200 px circle, smaller than the title.
- It catches the wash as both a parchment ground and a signature that means "timer running" in cook mode. That is the
  "meaning" rule applied correctly.
- The fix moves energy into the look, and makes the controls standard.

**Wrong:**

1. **The fix is the same as probe 3's Home.** "Pilot Light" is a cast-iron chrome (`#141210`) with a warm pool of light
   behind the dish, and its closest app is Apple TV. Probe 3's "Pass" is a cast-iron ground with a lamp pool behind
   the dish, and its closest app is also Apple TV. Two blind designers reached one concept.
2. **The reference fails its own test.** Elíasson's _The weather project_ drew over two million visitors and is one
   of the most-photographed installations of the 2000s. It is a moodboard staple. "A room gives a rule for light" is a
   reason to use it, not a reason few pick it.
3. **The trajectory claim is wrong.** "Dark planning chrome read as night mode until OLED and P3 photos made a lit dish
   look physical". YouTube shipped ambient mode, a glow cast from the content onto a dark ground, in October 2022. So
   the excitement test fails, and the probe did not run it.
4. **No palette.** One hex, with "Not run: contrast numbers". The same invented "uses the spinach" reason.

### Probe 3: design Home, with a second direction

**Right:**

- It writes both medians and admits "my first instinct matched it".
- It surfaces two conflicts in the brief, and resolves them correctly.
- The primary follows the state: "Back to step 4", "Start cooking", "Write your first recipe".
- **It is honest about missing data.** "Cook history and pantry data do not exist yet. This is a gap". It is the only
  probe that says so.
- The ledger is correct, and so is the first screen: "Recent" shows at y ≈ 620, above the fixed primary. Every
  touch target is 44 px or larger, and the primary is fixed low.
- The signature encodes nothing, has no text, so it survives 320 px and 200%, and is banned from cook mode, lists,
  controls and behind text.
- The references are kitchen-specific and rare: the Hatco Glo-Ray heat lamp over a pass, and Jan Groover's kitchen
  still lifes. This is the best reference work so far.
- Two full palettes, with correct numbers.

**Wrong:**

1. **The signature is shipping.** A soft glow of light around content on a dark ground is YouTube's ambient mode and
   the art-glow in Apple Music and Apple TV. "One fixed, opaque light with no glass" is a subtraction from Liquid Glass,
   not a step past it. "Not in 2022, because dark UI was flat #121212" is false. The closest-app answer names Apple TV
   and then separates it by the very feature Apple TV has.
2. **The signature's only colour means warning.** Lamp `#FFB46B` and Rind `#FFB46E` are ΔE00 0.65 apart. On Home, a
   warning label sits in the signature's colour. Canon §3.4 rule 1 binds the action colour, and the same logic binds
   every role. The palette script reported ΔE00 between options and against earlier rounds, but not between roles
   inside one palette.
3. **There is no light theme.** Pass is "deep in both themes", and its light ground is L 0.30. A user who set light
   mode, perhaps for a bright kitchen in daylight, gets a dark app. That breaks a platform convention in the structure
   layer, which is the layer the canon says must stay familiar. "Light is raised for daylight" admits the cost and does
   not pay it.
4. **The deciding reason is weak.** "Not opened in 3 weeks" is the only extra fact. It is honest, but it is a
   novelty-seeking nudge, not help to choose. With no pantry or history data, the design must ask the cook for one
   fact ("How long have you got?") instead of guessing.
5. **Option B is thin, and its controls conflict.**
    - "Three pans" has no frame card, no states, no cook-mode note and no Hairline role.
    - Each radio card holds a "Recipe ›" link, so a tap on the card selects it and a tap on the link opens the recipe. That is
      two actions in one target, which a first-time user must work out.
    - The signature is one word in a display stencil face. It is a styled heading, and it will not be visible at
      thumbnail size.
    - The persona says a thin option is cut, not shown thin. The gate let it through again.
6. **Pass, Pilot Light and Prep list are one family.** Each is dark chrome, one warm light and a photo as hero. A
   stranger sorts them into one pile. Canon §0 says: "If three designers working blind each reach the same set of
   options, the set fails".
7. **No mockups**, for the third round. The brief asked for words, and the persona's words-only clause let steps 7–10
   go unrun. The stranger, year, contact-sheet and critique-and-re-render steps are the persona's main defence against
   convergence, and no probe has ever run them.

## Root causes in the persona text

1. **The named permission became the answer, for the third round.**
    - Persona step 6: "**Consider the one deep or coloured planning chrome that §3.2 allows.**"
    - Canon §3.1: "a deep or coloured ground can frame food better than white."
    - Canon §2.3 lists "material and light" as an axis.
    - Probe 1 quotes the permission as its reason. Probes 2 and 3 build their whole signature on "light".
    - The history:
        - v1: the canon's dish-colour wash.
        - v2: the persona's "edge crops" and the canon's lever list.
        - v3: the persona's deep chrome.
    - Rule 9 ("examples are permissions, not answers") cannot stop this, because the persona itself names the
      permission inside a working step. A permission written into a step is an instruction.
    - **Fix:** remove the "consider deep chrome" line from step 6. Move the permission into the canon only, and phrase
      it as a limit: "at most one option in a set uses a deep chrome". Never put it in a step.

2. **The house answer is described so exactly that its inversion is the cheapest escape.**
    - The persona and the canon tell the designer to write the house answer. All three probes write it the same way:
      "near-white, a grotesque, an edge-cropped hero, a strict list", which is judge v2's own phrasing.
    - The gate is "differ on two axes". Going dark changes ground and palette in one move. It satisfies the gate and
      takes no thought.
    - **Fix:** add a third median, **the inversion**: "the house answer with its ground and mood flipped: dark, moody,
      one warm light, premium-restaurant photography". Strike it like the others.
    - Also require that the two axes an option differs on are not ground plus palette. A dark mode of the house answer
      is still the house answer.

3. **Nothing forces divergence between designers who share a prior.**
    - "uses the spinach" and "Apple TV" appear in no source, yet two blind probes produced each.
    - The persona says "if you can predict your option, so can they", but it gives no tool to act on that.
    - **Fix:** in step 4, after striking the medians, the designer also writes the **three concepts another designer
      with this page is most likely to reach**, and strikes them too.
    - Draw each concept from a **different cook need** in the list (hands, distance, heat, timing, the dish, the shop,
      the week). At most one concept comes from "heat" or "light", since that is where all three probes went.

4. **The excitement and trajectory tests run from memory, so they pass where they must fail.**
    - Probe 3 wrote "Top charts checked from recall".
    - Probe 2 said dark chrome was not possible before 2023. YouTube's ambient mode shipped in 2022.
    - An adversarial test run from memory is not adversarial.
    - **Fix:** the closest-app and excitement tests must name the app **and the feature in it nearest to the
      signature**, then state the visible difference. "Apple TV, separated by the light pool" must fail, because Apple
      TV has a light pool.
    - Where search is available, the designer searches for the signature's description, for example "app glow behind
      artwork dark mode", before claiming it is new.

5. **The palette script does not check roles inside one palette.**
    - Step 6 asks for ΔE00 between options and against earlier rounds. It does not ask whether any two roles in one
      palette collide. Lamp and Rind came out at ΔE00 0.65.
    - **Fix:** add "ΔE00 ≥ 15 between the action, content hue, warning and danger of the same palette, in both themes.
      Report every pair."
    - Also require every role in the §3.3 table, Hairline included. Both of probe 3's palettes dropped it.

6. **"Deep chrome" has no rule for light mode.**
    - The canon allows a deep planning chrome but never says whether the light theme must stay light. Probe 3 made both
      themes dark.
    - **Fix:** "Light and dark themes follow the OS setting. A deep chrome is the dark theme's ground, or one coloured
      surface inside a light theme. It never replaces the light theme."

7. **The critique checklist lost its sibling step in practice.**
    - Critique step 2 says "Rule on the whole set, every time. Twins count as one option". Probe 1 still judged A alone.
    - The step is one line in a list of six, and its output is not named.
    - **Fix:** make it a required heading in every critique: "**The set:** each sibling named by file, and a ruling
      ('twins' or 'distinct') with the two observed axes". A critique without that heading is incomplete.
    - Also add: "A replacement direction does not use a permission the canon names. Quote no rule as the reason for a
      look."

8. **Decision support has no fallback for missing data.**
    - Step 1 says "deciding must help choose ... recall alone fails". Probes 1 and 2 met it by inventing pantry data.
      Probe 3 met it with "not opened in 3 weeks".
    - **Fix:** "List which of these facts Commise stores today: time, ingredients on hand, cook history. If a fact is
      not stored, do not show it. To help choose, ask one quick question the cook answers in one tap. Or use facts the
      recipe already holds."

9. **The words-only clause means the visual tier never runs.**
    - The persona allows a words-only delivery for a brief that "asks for words only". All three design probes used
      it.
    - Steps 7–10 are where the stranger, year and contact-sheet tests catch "three dark kitchens".
    - This is partly a problem in the **probe briefs**: the probe briefs ask for words.
    - **Fix, probe brief:** the next design probe must build Home in HTML at 390 px, in light and dark, and render it with
      Playwright.
    - **Fix, persona:** "For any design request, build at least the opening screen. Do this also for a brief that
      asks for words. A design that nobody saw is a design that nobody tested."

10. **Second options stay thin.**
    - The delivery gate says "an option missing any item is cut, not shown thin". Option B came in without a frame,
      states or cook mode, for the second round running.
    - **Fix:** give the gate a per-option table (frame, ledger, palette table with every role, states, signature tests,
      closest app). An empty cell cuts the option, and the delivery prints the table.

11. **Taste still has no picture of "calm and everyday".**
    - The persona defends hard against "too plain" and "too clever". It says nothing about the owner's other words:
      "calming", "easy", "never busy". So designers chased drama.
    - Dark, lamp-lit and moody reads as a restaurant at night. The owner's product is a weeknight kitchen.
    - **Fix:** in step 0, add **Mood**: "the feeling at 6 pm on a Tuesday, with a child asking what is for dinner".
      Every option's thesis must pass that mood as well as the 50 ms test. Excitement must come from freshness, not
      from drama.

## What the next persona must make happen

- Three blind probes that do not land in one family, whether light, dark, or the house answer's inversion.
- No permission named inside a working step.
- A closest-app test that names the nearest **feature**. The test fails on a signature that is that feature.
- Palettes with no colliding roles, a real light theme and every role filled.
- Every critique opens with a ruling on the set.
- Decision support built only on data Commise has, or on one question the cook answers.
- At least one rendered screen per design probe, so the visual tier finally runs.
- A thesis that is calm and fresh for a weeknight, not dramatic.

_Evidence: heuristic judgement from reading text, grepping sources and recomputing colours. No probe produced a mockup.
Nothing was judged at 320 px, at 200% text or at thumbnail size._
