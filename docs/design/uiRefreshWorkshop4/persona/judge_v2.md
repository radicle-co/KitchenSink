# Judge review: persona v2 and its three probes

**Verdict: FAIL.** No score reaches 8.5. v2 is a real step up from v1. Both critiques now reach the owner's
verdicts from things they saw. They keep what the owner praised and rule on the sibling. Home is built around
the cook's state, and the primary is the job. But the look has not moved far enough. All three probes reach the
same answer: a near-white ground, one grotesque typeface, and a dish photo cut by the screen edge. v1 converged on
a colour wash. v2 converges on the persona's own examples. The palettes are still grey plus one accent, and option
B's accent is the teal the owner already rejected in round 1. I expect the owner to call this "better, cleaner".
I do not expect him to call it "revolutionary" or "exciting".

## Scores

| Dimension           | v1  | v2  | One-line reason                                                                                                                                                                                                                                        |
| ------------------- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Originality         | 4   | 5.5 | A real positive move (poster-scale name, edge crop). But it is the familiar editorial look of Apple News and Fitness, and B is Pinterest with Bodoni. All three probes reach the same look.                                                            |
| Simplicity          | 7.5 | 7.5 | Standard tab bar, one fixed labelled primary, vertical lists. Waste: three dead "Coming soon" rows on Home, and one dish fills the whole first screen.                                                                                                 |
| Psychology          | 6.5 | 7.5 | Correct scroll ledger with reasons, Von Restorff, Fitts, a state-driven primary, ink-to-muted held. Gaps: the deciding state is recall, not decision support, and probe 2's signature encodes data.                                                    |
| Palette             | 6   | 5.5 | Enamel is named, complete and accurately computed. It is also Mise with a navy accent. Rosemary is half a palette, and its action sits ΔE00 4.1–6.2 from round 1's rejected teal.                                                                      |
| Distinct options    | 4   | 6   | A and B now differ in structure and type. B is still thin (no palette table, no ledger, "states match A"), and both are white pages of food at thumbnail size.                                                                                         |
| Cooking context     | 5.5 | 7   | Home has cooking, deciding and empty states with "Back to step 4" and a timer strip. Cook-mode critique is precise. The deciding state shows the last recipe opened.                                                                                   |
| Critique judgement  | 5.5 | 7   | Both verdicts reached with observed values, must-survive lists, a sibling ruling, and bolder-look/calmer-controls fixes. But the fixes converge across probes, probe 1 never says how A and B must split, and the canon still contains the answer key. |
| Impresses the owner | 4   | 5.5 | The Poster is the best Home so far. It is still a tasteful 2020s layout with a 1960s reference, and there are no mockups to look at.                                                                                                                   |

**Pass: false.**

## What I checked

- I read the persona, the canon, judge v1 and all three v2 probes.
- I checked the critiques' facts against the source files.
    - Round 1 proposal A: `#F3ECE1`, `#FAF0DC`, `#FEE2CD`, Fraunces and "Edit recipe" are all there. The title is
      "Still Life, Lit".
    - Round 2 proposal A: Funnel Display, "1:24:36", a `16s` animation and `#B3330E` are there. The facts hold.
    - I did not re-render the proposals. The probes' render claims are taken on trust.
- I recomputed the palette numbers with culori.
    - Enamel light: Ink 17.2 on Glaze, 18.6 on Plate. Ash 7.37 on Glaze, 6.79 on Well. Navy 7.91 on Glaze. Rim 4.21.
    - Enamel dark: Ink 17.3, Ash 10.1 / 8.25, Navy 11.0.
    - Ink to Ash: 2.33 light, 1.71 dark. All of these match the probe.
    - ΔE00 Navy to Rosemary: 26.9 light, 24.1 dark. This matches.
    - **Not reported by the probe:** Rosemary `#145E57` / `#86D8CA` against round 1's action teal (`#2A6B65`,
      `#6CC0B3`, `#7CC8BE`) is **ΔE00 4.8 light and 4.1–6.2 dark**. Against round 3's Spruce (`#0B4F3E` /
      `#8EDBBF`) it is **6.9 light and 4.9 dark**. Option B brings back the colour of two rejected rounds.
    - Glaze `#F6F6F5` is OKLCH C 0.001. Amber and Tomato are the reference values copied. Dark ink-to-muted is 1.71,
      and Mise's is 1.72. Apart from the accent, Enamel is Mise.
- The numbers are the easy part. I did not let them lift any score.

## Probe by probe

### Probe 1: critique of round 1 "Still Life, Lit"

**Right, and new since v1:**

- It rendered, and it said what it did not run (200% text).
- The verdict comes with dated, observed reasons: the cream ground hexes, Fraunces italics, a 2×2 grid of equal
  cards about 165 px wide, flat clip art from about 2017, and a "light" that is `#FAF0DC` on `#F3ECE1`.
- It names what must survive: the ingredient pictures for photo-less recipes, and the current-step highlight.
- It catches the wrong primary ("Edit recipe" on a page you open to cook).
- **It rules on the sibling** (point 7): same layouts, grounds, action and tiles. v1 missed this.

**Wrong:**

- **The fix is the house answer.** Near-white with no tint, one grotesque, large numerals, a crop at the screen
  edge, one large dish, a vertical list below. Probe 2's fix and probe 3's Home are the same picture. The persona
  says "a fix that turns every option into the same safe answer is a failure". Across three blind probes, that is
  what happened.
- **It proposes one direction for a two-option set.** The owner's complaint was that A and B are twins. A
  director says how the two must split. The probe gives one replacement.
- **Irving Penn's still lifes** are a strong, specific reference. They are also one of the most-quoted references in
  food photography, so they do not move the work out of the category.

### Probe 2: critique of round 2 "The Now Line"

**Right. This is the strongest of the three:**

- "Keep its look. Remove the line as the thing that organises each screen". That is the owner's verdict, in both
  halves, with the praise kept.
- Must-survive is specific: Funnel Display at 48 px, the 68 px timer, the 200 px disc cut by the edge, the tomato
  button, the 64 px dock.
- Every fault has an observed value: items at 60–78% size off the line, oldest-first Home, a 16 s loop and a
  pulsing dot, four signatures, 21 px cook-mode text, one colour with two meanings, a five-line title at 320 px.
- It rules A and B distinct, and says why.
- The fix keeps the energy in the look and makes the controls standard. Home has a cooking and a deciding state.

**Wrong:**

- **Its new signature carries data.** "One huge figure for what matters now: the time left or the step number".
  That is information at signature scale. v1's Home B made the same mistake ("large cook-time numerals"), and
  judge v1 flagged it. The persona's ban on "a signature that carries meaning" did not stop it, because the
  persona never says what "meaning" is.
- **The Solari board is a design-history greatest hit.** Flighty already ships it as its look. It is specific, but
  it is the first reference a design-literate person reaches for.
- "The dish cut by the screen edge" again: the same move as probes 1 and 3.

### Probe 3: design Home from scratch, plus a second direction

**Right, and new since v1:**

- It writes a point of view. It cuts the obvious three: serif on cream, an iOS grid with a Netflix row, and black
  and gold.
- The job, success and "pretty only" signs are written.
- **The primary is the job and follows state:** "Back to step 4" with a timer strip, "Start cooking", "Write your
  first recipe". This fixes v1's worst fault.
- The scroll ledger gives the right reason ("the cook finds a dish by its name").
- The signature is placed and banned in cook mode, on controls and in lists.
- Enamel is a real palette idea tied to a kitchen object. It is complete and accurately computed.
- It has an honest "Not done" section.

**Wrong:**

1. **The signature collapses on real content.** The dish name is 44 pt and "a name over 28 characters drops to
   34 pt". 34 pt is the iOS large title. Many real recipe names are over 28 characters, for example "Slow-roasted
   pork shoulder with fennel". For them the signature becomes the system default. At 390 px, 44 pt is not poster
   scale either. Nothing in the persona asks whether the signature survives the longest real title.
2. **The signature's reason contradicts its ban.** It is justified as "you can tell the dish from 60–90 cm". That
   is cook-mode distance, yet it is banned in cook mode. Either the reason is decoration or the ban is wrong.
3. **The first screen is one dish.** Status bar, top bar, a 312 px photo and up to three lines of 44 pt name use
   most of the space above the fixed primary and tab bar. "Recent" barely shows. That is a weak reason to scroll,
   and it is close to the false floor §1.3 warns about.
4. **The deciding state is recall.** "The last recipe opened" with "Start cooking" assumes the last thing you looked
   at is what you want to cook tonight. The canon says a recency list alone answers a question any content app
   asks. There is no help to decide: time you have, what is in the fridge, what you cooked recently.
5. **Dead rows on Home.** Three "Coming soon" rows that cannot be tapped sit on Home. Probe 2 itself said this must
   be one line. Clearing the ground (§2.3) means they go.
6. **The look is the editorial default.** A full-bleed photo, a big bold grotesque headline, a strict list: this is
   Apple News, Apple Fitness+ and every Swiss-revival portfolio of 2020–25. It passes the UI-kit test. It does
   not pass a "closest shipping app" test. Müller-Brockmann is the first name in any design history course.
7. **Option B is Pinterest.** A two-column, edge-to-edge grid of photos at their own aspect ratios is Pinterest's
   home feed. Bodoni names on food is the magazine voice (Bon Appétit, the NYT Cooking serif). The probe names this
   risk itself, then ships it.
8. **Option B is thin, and the gate let it through.** Its palette is three colours, not a role table. It has no
   scroll ledger. It says the primary and states "match A". Its signature, "2 px white gutters and square corners", is a
   subtraction, not a move you see in 50 ms. The persona says a thin option is cut, not shown thin.
9. **Palettes.** Enamel is Mise with a navy accent: the same near-white ground, the same muted step, Amber and
   Tomato copied. Navy is the bank-and-insurance blue. The enamel story makes it defensible, not fresh. Rosemary's
   action is the round 1 teal (ΔE00 4.1–6.2). Its content hue only shows while a photo loads. The owner asked for
   "a more defined colour palette for each option". At swatch size, these two are both "white with one dark
   accent".
10. **No mockups.** The probe's brief said "words in one file", and the persona's rule ("a words-only delivery is
    returned") gave way. So no visual claim here is tested.

## Root causes in the persona text

1. **The persona's own examples became the answer.**
    - Step 0 says "Composition: one habit, **such as scale contrast, edge crops or a strict grid**". Canon §2.3
      lists the same levers: "extreme scale contrast", "cut by the edge", "a confident display face".
    - All three probes chose exactly these. Probe 3 says "extreme scale contrast, on a strict grid" and "the plate
      cut by the screen edge". Probes 1 and 2 both say "crop it at the screen edge".
    - v2 added rule 9 ("examples are permissions, not answers"), but it covers only the canon's named ideas. It does
      not cover the §2.3 lever list or the persona's own examples. Convergence moved from the dish wash to the edge
      crop.
    - **Fix:** remove the examples from step 0. Make the lever list a list of _kinds_, not instances. Add: "If your
      main move is one of the levers named in §2.3, say what in it no shipping app already does".

2. **The "cut the obvious" step only cuts the food-app median.**
    - Step 0 asks for "the two or three points of view that anyone writes for this brief". The designer cut serif on
      cream, iOS grid and black and gold. Those are the _food-app_ medians.
    - The _designer_ medians survived: Swiss grotesque on white, the Didone magazine voice, Penn, Magnum, Solari,
      Müller-Brockmann. These are the references any design-literate person names first.
    - **Fix:** also cut the tasteful-designer default. Name it in the persona: Swiss/International style on white,
      an edge-cropped hero with a big grotesque, a Didone magazine voice, and the canonical references (Penn, Braun,
      Rams, Vignelli, Solari, Müller-Brockmann, Magnum). A reference must be one the designer can say why few others
      pick it.

3. **Nothing asks for the trajectory.** The owner said "extend and extrapolate UI design from the trajectory it is
   on". The persona asks only for references from the past, and every reference given is from 1950–2011. Nothing
   asks: where is UI going, and what is the next step?
    - **Fix:** each option names one current trajectory it extends in the look layer and takes one step past where
      shipping apps are. Examples of kinds: layered material and light, layouts that adapt to state and time, colour
      taken live from content, variable type, motion that behaves like a material. It must still change no control.

4. **The kit test is too easy to pass.** "Does it pass for a UI-kit demo?" Almost any designed screen passes. The
   self-run excitement test always passes too ("the dish name").
    - **Fix:** replace it with a **closest-app test**. For each option, name the closest shipping app (Apple News,
      Pinterest, NYT Cooking, Flighty) and the one visible thing that separates it. If the answer is "the content",
      it fails. Make the excitement thing something no app in the top charts already does.

5. **The palette rules turn every palette into grey plus one accent.**
    - Canon §3.2 makes grounds near-neutral, keeps the role table, and confines the content hue to non-text use.
      That correctly bans cream, but it also bans every coloured chrome. F1 was about _warm, papery_ grounds, not all
      colour.
    - The rule "the reference with a different accent hue is not a new palette" exists, yet Enamel is exactly that
      and the probe did not notice. There is no check that measures it.
    - The ΔE00 ≥ 15 gate is only between options in one set. Nothing compares against rejected rounds, so round 1's
      teal came back.
    - **Fix:**
        - ΔE00 ≥ 15 from every rejected round's action colour, and report it.
        - A **swatch test**: show each option's palette as a 32 px strip with no photos. A stranger must tell them
          apart and say what each evokes.
        - Allow one option per set a coloured chrome (a deep or saturated planning surface, photos framed on it),
          with contrast held. Keep cook mode neutral.
        - A palette must differ from Mise in more than the accent: ground temperature, muted step or a content hue
          that is actually seen.

6. **"Carries no meaning" is undefined.** Probe 2's huge time-left figure and v1's cook-time numerals both broke it.
    - **Fix:** define it. A signature can show content as type. It must not encode meaning through a visual variable
      the user must decode (position, size change, colour, motion). If the signature shows live data, the data must
      also be shown in the normal way.

7. **Nothing tests the signature against real content.** Step 7 asks for the longest real titles, but no rule says
   the signature must survive them. Probe 3's falls back to iOS large title size.
    - **Fix:** "The signature must still be visibly the signature with the longest real title at 320 px and at 200%
      text. A fallback to a system default size means the signature does not exist".

8. **The deciding state is allowed to be recall.** The frame card asks what Home shows "deciding", but not that it
   helps decide.
    - **Fix:** "The deciding state helps choose: time available, what is on hand, what was cooked recently. 'The
      last recipe opened' alone is recall, not a decision aid".

9. **The delivery gate gives way to the brief.** Probe 3's brief said "words only", the persona yielded, and B
   shipped without a role table, ledger or states.
    - **Fix:** in a words-only delivery, the gate still applies to each option's written artefacts (full role table,
      ledger, states, signature rules). An option without them is cut, and the delivery says so. Also, rule on
      unbuilt features: "Coming soon" is one line, never rows on Home.

10. **The canon still holds the answer key.** Canon §0 still quotes F1–F5, including "a line of light you must
    understand, or a rim you turn" and "cream paper, soft serif". Judge v1 asked for these to be held back from
    critique probes. They were not. The probes did not cite them, so v2 looks better, but we still cannot tell
    judgement from recall.
    - **Fix:** probe critics get a canon copy without F1–F5 or the named failing artefacts.

11. **The emphasis is process, not taste.** About 90% of the persona is steps, gates and checks. The taste section
    (step 0) is six bullets with examples. Process got the work correct. It cannot make the work exciting.
    - **Fix:** give taste the same weight as the gates. Require the designer to argue, in a paragraph per option,
      why this look did not exist in 2022, and what a viewer feels in the first second.

## What the next persona must make happen

- Three blind probes that do **not** reach the same look. If they do, the persona is still handing out the answer.
- A signature that survives the longest real title at 320 px, encodes no data, and is not one of the §2.3 levers
  used plainly.
- Palettes a stranger can tell apart from a swatch strip, each ΔE00 ≥ 15 from every rejected round, and not Mise
  with a new accent.
- A named closest shipping app for each option, with the visible difference.
- A trajectory step for each option: what it takes one step past current shipping UI.
- A deciding state that helps choose. No dead rows on Home.
- Every option shown finished to the same level, or cut.

_Evidence: heuristic judgement from reading text and recomputing colours. No probe produced a mockup, so nothing was
judged at 320 px, 200% text or thumbnail size._
