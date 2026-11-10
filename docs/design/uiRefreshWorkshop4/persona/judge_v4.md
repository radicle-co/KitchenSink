# Judge review: persona v4 and its three probes

**Verdict: FAIL.** No score reaches 8.5, and the two scores that matter most went down.

v4 fixed the process faults that judge v3 named:

- Probe 3 rendered real HTML mockups at last, in both themes, at 390 and 320 px, at 200% text, with a contact sheet.
- Probe 1 now rules on the set: twins, on two observed axes.
- The data audit is real. Probe 3 checked the schema and the cook-mark hook, and it shows no invented reasons.
- The palette script now checks roles inside one palette. Hairline is filled. The light theme is light.
- No probe goes dark, and nobody names Apple TV.

That was the wrong thing to win. **The visual tier ran for the first time. It showed the owner's round-1 verdict.** Probe 3's picked Home is a large title "Home", a segmented control, a full-bleed photo and a list of 72 px rows.
Canon line 444 defines the tasteful default in almost those words: "a near-neutral page, one big headline, a
full-bleed photo and a strict list". The probe wrote in its own self-review, "A is close to the tasteful default",
and picked it anyway. The only fresh move is a yellow label-tape section heading. The owner will call it boring and
like every other app, which is the round-1 verdict.

The convergence moved again. v3's three probes all went dark. v4's three all reach one answer: a near-white neutral
ground, one grotesk, a real photo and one deep, warm accent. Two of the three Home ideas, and arguably the third, open
with "How long have you got tonight?". The persona's cure for drama and for named permissions killed every
expressive move. The only thing left was the house answer with a sticker on it.

## Scores

| Dimension           | v1  | v2  | v3  | v4      | One-line reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --- | --- | --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Originality         | 4   | 5.5 | 6   | **4.5** | The rendered pick is the tasteful default, by the canon's own definition. The signature is a yellow eyebrow badge, which the probe admits is close to web "eyebrow" badges. Both critique directions also land on the house answer: a neutral ground, a grotesk and photos.                                                                                                                                                                                                                                                                                                                                                                                      |
| Simplicity          | 7.5 | 7.5 | 7.5 | **7.5** | Conventional throughout: tab bar, large title, a segmented control, one target per row, no gestures, Coming soon reduced to one line. Lost: at 200% text the question fills the whole first screen, the FAB covers "RECENT RECIPES" and the row meta, and the tabs collide. The probe wrote fixes and shipped the renders without them. Option B's message bar clips to "Name a c".                                                                                                                                                                                                                                                                              |
| Psychology          | 6.5 | 7.5 | 7.5 | **6.5** | The ledger is correct and the lists are vertical. Lost: (1) The visual hierarchy is upside down. The most salient element on Home is a yellow section **label**, not the food and not the action. Von Restorff is spent on a heading. (2) Job and primary differ. The job is "show me a dish that fits my time", and the primary is "+ New recipe". The frame card covers this with "or". The persona says "fix one". (3) A three-way filter over 8 recents is a control that does almost nothing. It adds a decision (Hick) to cut a list the cook scans in two seconds.                                                                                        |
| Palette             | 6   | 5.5 | 7   | **7**   | Beetroot is complete, both themes, and the script's numbers reproduce (`out.txt`). Lost: Option B ships no role table. The critiques give only an action and a content hex. Dark action `#F7A6CA` is a pastel pink. As the FAB it is the loudest thing on the dark screen. It reads as candy. Across the blind probes, the palettes are one family. Copper `#A2461A` to Paprika `#B23A0C` is ΔE00 4.1 in light and 4.0 in dark. Aubergine `#6A2C5A` to Beetroot `#8C1D4F` is 9.6 and 5.6. Scale Room ground `#F3F5F4` and Counter `#F5F5F2` are both L 0.97 with chroma under 0.004.                                                                             |
| Distinct options    | 4   | 6   | 6.5 | **5**   | Inside probe 3, A (filter, hero, list) and B (portrait column, write bar) differ in structure. But B is a vertical list of photos plus ChatGPT's composer bar. That is the category median plus a shipping feature, which the strike list bans. B is labelled "Not ready", and the gate says a cut option is never shown. Across the three probes, all the directions are one family.                                                                                                                                                                                                                                                                            |
| Cooking context     | 5.5 | 7   | 7.5 | **6.5** | The time question is a real cook need. The tape comes from freezer-tub labels. The probe is honest that no cooking state can be drawn from stored data. But there is no cook mode, no recipe page, and nothing on Home that looks or feels like cooking. The photos are restaurant plating, which the probe flags.                                                                                                                                                                                                                                                                                                                                               |
| Critique judgement  | 5.5 | 7   | 6.5 | **6.5** | Both critiques now reach the owner's verdict with observed values, and probe 1 rules on the twins. That is real progress. But both proposed directions are _less_, not _better_. Probe 1's fix is steel-white, one grotesk, real photos and a big number: the house answer plus canon §2.1's "big type" lever. Probe 2's fix is a familiar large-title stack with a photo on top. It asks "How long have you got tonight?". That is probe 3's Home. Probe 2 says "No owner praise is on record". The owner said "I like the creativity, this is much better". The canon does not record it. So the critique lost the half of the verdict that says what to keep. |
| Impresses the owner | 4   | 5.5 | 6   | **4**   | He now has pictures. They show a generic recipe app with a pink button and a yellow sticker. An Apple reviewer flags the broken 200% renders first and the placeholder square tab icons next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Pass: false.**

## What I checked

- I read persona v4, the canon, judge v3 and the three v4 probes.
- I opened probe 3's renders in `scratchpad/home/`: `contact3.png`, `A_decide_light_390_x1_full.png` and
  `B_light_390_x1_full.png`.
    - The A screen matches the description.
    - The full-page capture shows the fixed FAB and tab bar over the first list row.
    - The contact sheet's 200% frames show the question taking the whole first screen, "R + New recipe" overprinting
      the tape heading, the tab labels running together ("HomeRecipesDiscoverProfile") and B's field clipped to
      "Name a c".
    - The tab icons are empty rounded squares.
- I read `out.txt`. Beetroot's figures reproduce the probe's claims: action 8.0:1 / Lc 83 light, smallest role gap
  17.38 dark.
- I recomputed the accents across probes with culori: Copper↔Paprika 4.1 / 4.0, Aubergine↔Beetroot 9.6 / 5.6,
  and grounds `#F3F5F4` / `#F5F5F2` at OKLCH L 0.968 / 0.969, C 0.0025 / 0.0040.
- The canon contains none of the owner's verbatim words of praise. "I like the creativity" appears only in
  `judge_v1.md`, which a probe does not read.
- Canon line 444 defines the tasteful default, and probe 3's A matches every clause of it.

## Probe by probe

### Probe 1: critique of round 1 "Still Life, Lit"

**Right:**

- A clear "do not ship, dated" verdict.
- **The set** heading is present. It rules B a twin on structure (the same 2×2 grid, Soon cards and page order)
  and on surface (cream, drawn covers, teal). That fixes judge v3's main critique fault.
- Faults are observed values: `#F3ECE1` with grain, Fraunces everywhere, vector food art, an earlier round's teal
  re-run (ΔE00 0), an overshooting tick, 36 px chips.
- The Toledo computing-scale reference is rare and comes from kitchen equipment.

**Wrong:**

1. **The direction is the house answer.** "Real photos, full-bleed, on a neutral steel-white ground, one grotesk"
   is canon line 444. The signature is a very large total time, which is the canon's "big type" lever used
   plainly. Judge v3 caught the same habit in v3's probe 1.
2. **One direction for a twin set.** The persona says "For twins, give one direction each, split on two axes".
   The probe gives one direction for both.
3. "Home leads with one dinner choice and its reasons" runs ahead of the data audit, which it admits it did not do.

### Probe 2: critique of round 2 "The Now Line"

**Right:**

- The verdict says the user must learn the line, which is the owner's "too creative".
- Sharp, observed faults: the signature encodes distance from now, "Now" marks yesterday's roast, a control
  appears only on scroll, and a gradient moves for 16 s at rest.
    - One colour has two meanings. Cook-mode steps are 21 px. The photo is a 200 px circle. The tabs collide at 200%.
- It keeps the type and the warm stroke.

**Wrong:**

1. **It misses the owner's praise.** "No owner praise is on record" is true of its sources. The persona
   asked for something that the canon does not hold.
2. **Bolder in the look did not happen.** It drops the line, keeps a 6 px bar under the title, and puts a familiar
   stack on top. The result is calmer in both layers, which is the round-1 problem again.
3. **It converged with probe 3.** It uses the same one-tap time question and the same "three recipes with reasons
   from time and servings". The persona's data-audit step names that remedy, so both took it.
4. Aubergine is a deep warm jewel tone, the same family as probe 3's Beetroot (ΔE00 9.6).

### Probe 3: design Home, with a second direction

**Right:**

- It built and rendered. Every earlier round failed to do this.
- An honest data audit: sort keys only, no per-user view history, cook marks in memory. So it labels the list
  "Last edited first" and draws no fake "Step 4 of 7".
- A complete Beetroot table, a script that exits non-zero, two fails caught and fixed, and a swatch strip.
- An honest self-review: "A is close to the tasteful default."

**Wrong:**

1. **It picked the option it had diagnosed as the tasteful default.** Nothing in the persona stops this. The
   delivery gate counts cells, not verdicts.
2. **The fresh move is decoration on a section label**, and it is now the page's focal point. A label-maker
   heading is a common editorial and web "eyebrow" device. The probe's prior-art search found that and then
   shipped it.
3. **Its own faults stay in the renders.** It writes "Fix: 88 px end padding" and "Fix: the platform's large-text tab
   bar", but the delivered renders still overlap. Step 9 says re-render.
4. **Job and primary differ** ("+ New recipe" on a choose-dinner screen).
5. **Option B is shown though "Not ready"**, and its core element is a chat composer bar from shipping apps.
6. Craft is not at the bar: placeholder square icons, a 72 px row whose meta sits under the FAB, and a pink FAB that
   outshouts the food.

## Root causes in the persona text

1. **The persona is almost all prohibition, so the only survivor is the house answer.**
    - v4 adds "Too dramatic" and bans a night-out mood.
    - Step 3 strikes medians, inversions, peer predictions, every named lever and example, every subtraction and every
      shipping feature.
    - The signature must "encode nothing" and is banned from cook mode, controls and rows.
    - With every expressive door shut, a cautious designer adds one sticker to the median and passes every check.
    - The page names four ways to miss and gives **no picture of what a hit looks and feels like**.
    - **Fix:** state the positive target as observable qualities. Examples:
        - A stranger at thumbnail size cannot sort it with the median.
        - The whole visual system carries the idea: type ramp, composition, image treatment and where colour lives.
          A single ornament does not.
        - Colour does more than fill one button.
        - The food and the primary are the two most salient things.
    - Move freshness out of the "signature" and into the system.

2. **The process is skipped in silence, and nothing makes the verdict bind.**
    - Probe 3's file has no four medians, no Step 0, no twelve concepts, no Nielsen pass, no pre-mortem and no
      delivery-gate table. The ceremony was not passed. It was skipped, and the persona has no way to notice.
    - The probe wrote "close to the tasteful default" and still made it the pick. No rule turns that sentence into a
      cut.
    - Every probe in every round lands near 500 or 900 words. That suggests a length cap in the probe briefs, which
      would force steps out. This is likely, not seen: I did not have the briefs.
    - **Fix:** make one rule bind above all process. An option that the self-review places in the same pile as the
      house answer or the category median is cut. The pick is the option that most clearly fails canon line 444's
      description. Drop the 13-cell table, which nobody fills, in favour of this one rule (see 6).

3. **"What your instructions name becomes your answer" The persona broke its own habit 2.**
    - The data audit prescribes the remedy: "ask the cook one question with a one-tap answer".
    - Two critiques and the Home probe all built "How long have you got tonight?".
    - This is a loop, and it repeats every round. Judge v3 wrote "ask the cook for one fact ('How long have you
      got?')" and the weeknight mood. Both went into persona v4 step 1 and canon line 329 almost word for word. All
      three probes then built them. v1's dish wash, v2's edge crop and v3's deep chrome took the same path: a judge's
      fix becomes a prescription, and the prescription becomes the answer.
    - **Fix:** the audit names only what is not shown. Decision support goes through the same twelve-concept
      divergence as everything else. A one-question filter is then one concept among many, and the peer prediction
      strikes it.

4. **The mood clause pushes toward plain.**
    - "A tired cook… Excitement comes from freshness, never from drama" says what to avoid.
    - Paired with "edit toward calm" and "Delete what serves neither the thesis nor a job", it licenses deletion.
    - "Never cut what carries the thesis" cannot stop it when the thesis is a label tape.
    - **Fix:** make calm a property of the controls and the motion, and make _energy in the look_ a requirement.
      Example: "Calm means no motion at rest, one action and quiet controls. It does not mean a quiet page. A Home that
      a stranger calls 'clean' and nothing else has failed."

5. **No craft bar.**
    - The persona specifies process in detail and says nothing about execution quality.
    - The renders have placeholder icons, overlaps at rest, broken 200% layouts and a clipped input.
    - Apple- or Netflix-level work is mostly craft. That means a deliberate type ramp, a spacing rhythm, real icons,
      nothing overlapping at rest and optical alignment.
    - **Fix:** add a craft checklist that the final renders must show:
        - Real icon set.
        - No element overlapping content at rest.
        - 200% layouts reflowed, not just measured.
        - A stated type ramp and spacing scale.
    - Add: "the delivered renders are the ones made after the fixes. A written fix with no new render is a fail."

6. **The process is too heavy for the time available.**
    - Nine steps, four medians, twelve concepts, prior-art search, scripts and a 13-cell table.
    - The designer's budget went to compliance, and the visual work came last and thin.
    - **Fix:** cut the written ceremony. Keep:
        - The medians and the peer prediction, as one short list.
        - The palette script.
        - The render.
        - Two rounds of render → critique → re-render.
    - Spend the saved effort on iteration on the picture.

7. **The shared prior moved to "neutral ground + one deep warm accent".**
    - The palette strike checks the distance to earlier _colours_, not to the house _palette family_.
    - So three blind probes picked copper, aubergine and beetroot on near-white. Copper and Paprika are 4 ΔE00 apart.
    - **Fix:** describe palette families by structure (ground temperature and chroma, number of accents, where colour
      lives: chrome, fields, food, controls) and strike "neutral ground with one saturated accent on the button" as the
      house palette.

8. **The owner's history is missing from the canon.**
    - The persona says "What must survive: what the owner praised", but no source the probe reads holds his words.
    - **Fix:** add a verbatim owner log, round by round, to the canon: what he rejected, what he praised and why.

9. **The critique directions are unbounded downward.**
    - "Bolder in the look, calmer in the controls" was written, and both directions were calmer in both layers.
    - **Fix:** a critique direction must pass the same house-answer cut as a design option, and it must give one
      concrete visual move per sibling that a stranger notices at thumbnail size.

10. **The "cut, never shown thin" rule is not enforced.** Option B appears as "Not ready".
    - **Fix:** a cut option appears only in the cut list, as one line.

**A warning on these fixes.** Causes 1 and 6 say that the persona is too prohibitive and too heavy. Fixes 2, 7, 9
and 10 add rules. The next persona must come out **net shorter** than v4. For each rule it adds, it deletes one, and
it names in the persona no remedy, example or reference that a judge has proposed. Otherwise v5 repeats v4.

## What the next persona must make happen

- A picked option that a stranger cannot sort with the tasteful default, judged on the rendered contact sheet.
- Freshness carried by the whole visual system, not by one ornament on a label.
- Three blind probes that differ in palette structure, not only in hue.
- No remedy named inside a working step, the one-tap question included.
- Delivered renders made after the fixes: no overlap at rest, a reflowed 200% layout and real icons.
- Critique directions that are _bolder in the look_, not merely calmer, and that keep what the owner praised.

_Evidence: heuristic judgement from reading the text, opening probe 3's renders and recomputing colours. I did not
re-render the old proposals or test on a device._
