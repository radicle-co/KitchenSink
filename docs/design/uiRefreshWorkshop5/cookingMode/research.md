# Cooking mode: research brief

This is the research behind the cooking-mode redesign. It ranks the problems cooks have while they cook from a
screen. It also gives the patterns that address each one, what earlier products tried, and questions for the
designers. Desk research, 2026-10-25. Nobody was interviewed or watched.

- **Where the evidence lives.** Every claim points to a record in `docs/research/userNeeds/cooking.md` (CK-001 to
  CK-036). The record has the full quote, date and link.
- **Evidence codes.** `S` is a study, `M` a commercial survey, `V` people's own words (reviews, forums), and `X` expert,
  vendor or press writing, or theory from outside the kitchen.
- **How the problems are ranked.** By impact (how often it shows up, and what it costs: a burnt dish, a wrong amount, a
  lost place) times the strength of the evidence. A problem with `S` evidence ranks above one with only reviews.
- **Why "what is next" ranks above amounts.** Amount questions are more frequent (about 42% of needs against 28.7%,
  Frummet 2022). But amounts in the step cut effort, not errors (Buykx). Not seeing ahead leads to missed steps and
  burnt food (Hwang et al. 2023, CK-021). Harm decides the order.

## The short version

1. **Cooks do not follow a recipe one step at a time.** They look one or two steps ahead, mostly while something
   cooks, to find work to do in the gap (Buykx 2013, `S`, CK-033). A screen that shows only the current step works
   against what cooks already do.
2. **Timers fail in two ways.** Some make no sound on a locked or muted phone. Others hide the recipe while they
   run, reset, or vanish on the next step. When either happens, people go back to a kitchen timer (CK-030, CK-031,
   `V` from five apps, `X` Apple and Android).
3. **Let the cook choose the order.** Software that planned two dishes in parallel got cooks through both, but the
   cooks rated its order 3.5 out of 10, and advanced cooks rated it 2.0 (Hamada et al. 2006, `S`, CK-003). With a voice
   helper, 9 of 12 cooks did steps out of order, and "these mistakes did not impact the final dish’s outcome" (Chan et
   al., `S`).
4. **Amounts inside the step are preferred, not proven.** Cooks rated it clearer and easier. In the one measured
   study, errors and time did not change significantly (Buykx 2013, `S`, CK-001).
5. **Tablets in the kitchen sit sideways in a stand,** away from splatter. This is one of the most repeated tablet
   complaints. No reviewer in about 26,700 asked to turn a phone sideways (CK-032).

## Ranked problems

| Rank | Problem                                                        | Records                        | Evidence      |
| ---- | -------------------------------------------------------------- | ------------------------------ | ------------- |
| 1    | I do not see what is next, or what to do while something cooks | CK-033, CK-003, CK-021, CK-007 | `S` strong    |
| 2    | I hunt between the ingredient list and the step for the amount | CK-001                         | `S` strong    |
| 3    | The timer is silent, or it fights the recipe                   | CK-030, CK-031                 | `V` wide, `X` |
| 4    | I lose my place after an interruption or a look away           | CK-008, CK-020                 | `S`, `V`      |
| 5    | Things move too fast and I panic in the time-critical stretch  | CK-021, CK-022                 | `S`, `V`      |
| 6    | The device is in the wrong place, at the wrong angle, or locks | CK-032, CK-016, CK-002         | `V` wide      |
| 7    | One step crams several actions together                        | CK-034                         | reported      |
| 8    | Help arrives at the wrong moment, and voice helpers mishear    | CK-036, CK-008                 | `S`, small    |

### 1. I do not see what is next, or what to do while something cooks

**What the evidence says.**

- The next step is the most common thing cooks need. "What's next" questions were 28.7% of needs in real home cooking (Frummet et al.
  2022, `S`) and 32.8% of requests to a voice helper (Vtyurina and Fourney 2018, `S`).
- In a kitchen study, cooks looked ahead in most sessions, one or two steps at a time. The most common reason was "to
  find a task to perform in parallel" (Buykx 2013, `S`, CK-033).
- Cooks who were not able to see ahead found "everything was a suprise", and 5 of 11 missed the last step (Hwang et al. 2023,
  `S`, CK-021).
- Reading the whole recipe first is the standard advice, and it is not enough on its own: "Reading the recipe ahead of
  time is just not enough, especially when the kitchen is heated up" (HelloFresh review, `V`, CK-033).

**Patterns that address it.**

- **A "next up" preview.** Show the next action, one or two steps ahead, with what it needs. Evidence: Buykx's look-ahead
  span. A Mela user praises it: "see the previous/next steps (as opposed to only being able to view one step at a
  time)" (`V`).
- **Separate "do now" from "while you wait".** At the start of each wait, show the work that fits in the gap. Evidence:
  look-ahead happens "most commonly when they were waiting for something to cook" (Buykx, `S`). A HelloFresh user asks
  for simultaneous actions "at the same level ... so that I may better prepare" (`V`, CK-003).
- **Suggest, do not schedule.** Offer the parallel task and let the cook choose. Do not reorder the recipe for them.
  Evidence: Hamada's 3.5 out of 10 rating, and Chan et al.'s cooks who "could figure out my own path" (`S`).

**Counter-evidence.** Some cooks praise one step at a time ("breaks down the recipe one step at a time to make it
easier to cook", Pestle review, `V`). Shorter steps alone did not cut errors (Buykx). So the preview must stay
secondary to the current step.

### 2. I hunt between the ingredient list and the step for the amount

**What the evidence says.**

- Ingredient and amount questions were about 42% of needs in real cooking (Frummet 2022, `S`).
- Cooks switched between step and list about 5 times per recipe (Buykx, `S`, CK-001).
- Hiding amounts behind a tap is called "counterproductive" (Pestle review, `V`).

**Patterns.**

- **Amounts written into the step** (Mealime, Kitchen Stories, both praised in reviews, `V`).
- **Ingredients marked in the step text** so they can be found at a glance: "Ingredients should be bolded in every step"
  (HelloFresh review, `V`, CK-034). Mela's reviewers praise amounts "bolded and highlighted" (`V`).
- **A list of this step's ingredients**, checked off as they go in: "I have ADHD and this feature also helps me not
  forget ingredients" (Paprika review, 2026, `V`, CK-020). Blue Apron removed its checklist, and a user said "The old app made cooking
  stress-free" (`V`, CK-020).

**Limit.** This pattern reduces effort, not proven errors (Buykx). Do not claim it prevents mistakes.

### 3. The timer is silent, or it fights the recipe

**What the evidence says.**

- Timers that make no sound: HelloFresh on both platforms, and Pestle ("much too subtle now. For timing I still use my
  OXO") (`V`, CK-030).
- The platform cause. Before iOS 26, an app's timer on an iPhone posted a normal notification, and silent mode mutes it
  (`V` MultiTimer reviews). Apple's AlarmKit (iOS 26) lets an app's timer break "through the silent mode and the
  current focus", and Apple names "countdown timers in your recipe app" (`X`). Each app needs the person's permission.
  Android 14 limits full-screen alerts to calling and alarm apps (`X`).
- Timers that fight the recipe: "while you have a timer on, you can't read anything else". Others reset as soon as the
  cook goes back to the steps, or are "lost" on the next step. And: "I'll have to switch to the timer app, then
  come back and search for the recipe again" (HelloFresh, Mealime, NYT Cooking reviews, `V`, CK-031).
- With several timers, cooks lose track of which one finished (`V`, CK-031).

**Patterns.**

- **A timer born from the step.** The step's own time becomes a start button: Paprika makes every time in the text
  tappable, and Samsung Food "has a timer on the step you need" (`V`, `X` Paprika help).
- **Offer it at the right moment.** A helper that asked "should I start a timer?" right after a timed step was received
  well (Jaber et al. 2024, `S`).
- **A dock that survives every screen.** Running timers stay in view while the cook reads on, and carry on through
  every step and every app switch.
- **Named by task and step,** not only by time. Voice platforms made naming standard: Alexa in 2017, and HomePod in 2018
  ("a timer for the cake, another one for lasagna", `X`).
- **An alarm that cannot be missed.** It sounds through silent mode and repeats until stopped. Counting on past zero
  is something users ask for (Pestle review, `V`).

### 4. I lose my place after an interruption or a look away

**What the evidence says.**

- Voice helpers lose "the current stage" (Li et al. 2024, `S`).
- Ads and pop-ups cause "ruined a few recipes because I lose my place" (`V`, CK-005, CK-008).
- Apps drop the recipe if the cook switches to another app (NYT Cooking reviews, `V`, CK-031).
- Echo Show skills were praised or faulted on one thing: keeping the step after the screen slept (TechRadar 2018,
  `X`).
- Interruptions are common: children, other people, other pans (CK-020).

**Patterns.**

- **Keep the place always:** after sleep, an app switch or a call.
- **Show what is done.** Done steps and checked ingredients act as a record ("If I get everything out and put it away as
  I add it, everything actually ends up in the dish", Reddit, `V`, CK-020).
- **A cue for the goal that was left.** Memory-for-goals theory says a goal that was interrupted is found again through a
  cue in view (Altmann and Trafton 2002, `X`, not kitchen research). So the resume screen needs to show the step's goal and
  anything still running, not only a step number.

### 5. Things move too fast and I panic in the time-critical stretch

**What the evidence says.** Beginners and anxious cooks describe panic: pots boil over, garlic burns (CK-021). Prepping
everything first helps but costs time and dishes, and many cooks prep during waits instead (CK-022). Interrupted people
keep their speed by working faster, at the cost of "more stress, higher frustration, time pressure and effort" (Mark et
al. 2008, office work, `X`).

**Patterns.** Warn before the fast stretch: "the next three steps go fast, have these ready". Show what must be ready
before the heat goes on (spec P3 "Do first"). This connects to problem 1: the warning is a kind of "next up".

### 6. The device is in the wrong place, at the wrong angle, or locks

**What the evidence says.**

- Tablets: "When cooking, I use a tablet in a stand. Like most normal people, my tablet is in landscape mode" (NYT
  Cooking review). The same complaint comes from eight or more apps (`V`, CK-032). A tablet app fixed sideways fails too
  (Mealime review).
- Distance: with the iPad away from the stove, small text "looks like ants dancing under a cute picture" (HelloFresh
  review, `V`, CK-016).
- The size trade-off: "the screen is too tiny to display enough of the recipe at once to be useful if the font is big
  enough to see when it's sitting on the counter out of reach of splatters" (Reddit, `V`).
- Touch: the screen locks mid-step (CK-002). Wet fingers make screens jump ("random jumps and pans... when scrolling with
  a wet finger", Android Authority, `X`). Hand gestures in the air fire by accident (Majil et al. 2022, `S`).

**Patterns.** Both tablet orientations, with a layout made for each. The screen stays awake. Controls that work with a
knuckle. No action that fires from a stray touch on the step text. Size the text for the distance, then decide what
moves to a second view, rather than shrinking it.

### 7. One step crams several actions together

**What the evidence says.** "Each step should allow for reading and advancing one bullet at a time within the step"
(HelloFresh review, `V`). A voice helper listing salt and pepper together made a cook forget one (Chan et al., `S`, read
aloud). The status is reported, not validated (CK-034). Too much splitting also hurts. Hwang et al. record
"Fragmentation": a garnish came in three steps (CK-003).

**Pattern.** Keep one goal per step, with its actions as short lines in order, each with its amount.

### 8. Help arrives at the wrong moment, and voice helpers mishear

**What the evidence says.**

- Unprompted tips were missed or met with "what is it?". Cooks acted only on tips that were critical or cheap,
  like turning down the heat (Jaber et al. 2024, `S`, CK-036).
- Waits with no help felt like "frustrating dead air" to older cooks. But one cook said "I wouldn't like him to chat more
  while I'm cooking" (Esteve et al. 2026, n = 6, `S`).
- 23% of voice questions failed through speech errors (Chan et al., `S`).

**Pattern.** Prompts tied to the step just done, and only for something critical or cheap. During waits, offer the next useful
task (problem 1), not chatter.

## What failed before, and why

| Product or study                               | What it did                                     | What went wrong                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Google Nest Hub recipes                        | Step-by-step recipes on a kitchen display       | Removed in 2024. Users: "the whole reason I bought this thing" (CK-035)                                                         |
| Alexa recipe skills (Echo Show)                | Read steps aloud, step list on screen           | Long steps "whizzed through ... with no pause", skills lost the step after an idle spell, skills ended (CK-008, CK-034, CK-035) |
| HappyCooking / Cooking Navi (Hamada et al.)    | Planned two dishes in parallel, with video      | Everyone finished, but the planned order felt unnatural: 3.5 out of 10 (CK-003)                                                 |
| Voice-only guides (Hwang et al. 2023)          | One step at a time, by voice                    | "everything was a suprise", 4 repeats a session, 5 of 11 missed the last step (CK-021)                                          |
| HelloFresh app timers                          | Timer per step                                  | Silent, hides the steps, resets (CK-030, CK-031)                                                                                |
| Mealime hands-free mode                        | Wave a hand to go to the next step              | Praised often, but crashes for some, and moves one step at a time even for steps in tandem (CK-002, CK-003)                     |
| Kitchen Stories 2023 redesign, Cookidoo 2025   | Removed the ingredient column, or the full view | Users noticed at once (CK-001, CK-007)                                                                                          |
| Projected and headset aids (Majil et al. 2022) | Video and gestures in a headset                 | Gestures fired by accident, the headset overheated, glasses did not fit (CK-002)                                                |

The common thread: products failed in two ways. They **took control away from the cook** (fixed order, fixed pace,
one step only). Or they **lost the cook's state** (place, timers, the whole feature).

## Where the evidence pushes against the current spec

Decision numbers refer to `spec.md`.

- **Decision 3, one step at a time.** This is the strongest conflict. No board, at any size, shows any part of the
  next step, and there is no "while you wait" state. Even during the 1 h 30 roast timer, the step shows only the roast. Buykx (`S`), Frummet (`S`) and Hwang (`S`) all point to a need for
  the next action in view, most of all during waits (CK-033, CK-003, CK-021). Keeping place on screen (the bar, "Step 4
  of 5") does not meet it.
- **Decision 6, the sound "comes from the platform".** This is not enough as written. On iOS before 26, an app timer is
  a normal notification and silent mode mutes it (CK-030). The spec needs to name the mechanism: AlarmKit on iOS 26 and
  later, with its permission prompt, and the matching alarm path on Android. It also needs a plan for a person who
  says no, and to say that the alarm repeats until "Stop alarm". This evidence covers phones only. Alarm behaviour in
  a web browser (the 1280 boards) was not researched. The dock and the "what it is for" label are well supported
  (CK-031).
- **Gestures: a swipe moves between steps.** Wet fingers cause stray scrolls, and air gestures fire by accident (`X`,
  `S`, small). A swipe that changes the step by mistake costs the cook their place. With Back and Next always on screen, ask whether the
  swipe earns its risk.
- **Decision 4, the 34 pt step text.** The research supports large text for distance, and it shows the cost. Big text
  shrinks what fits (Reddit, CK-016). Adding a next-up preview, as decision 3's conflict asks, makes this trade-off
  sharper on a 390 phone. Still no measured reading distance.
- **Supported:** decision 13 (no sideways phone board, and a sideways tablet board), decision 12 (voice deferred,
  given the failure evidence), decision 10 (resume), decision 5 (amounts in the step, as a preference), and decision 8
  (before you start). Decision 8 alone does not replace an in-flow preview, because cooks say reading ahead is "not
  enough" once the heat is on.
- **Phone ingredients in a sheet (decision 7).** This is acceptable because the amounts are inline. One Mela user still asks for "Some
  easy way to refer back to the ingredients and their measurements" from the steps (`V`, 2024, CK-001).

## How might we

1. How might we show the next action without pulling the cook's eye off the current one?
2. How might we turn every wait into a short, optional "while you wait" list, drawn from later steps, that the cook can
   take or ignore?
3. How might we warn the cook before a fast stretch, so everything for it is ready before the heat goes on?
4. How might we suggest parallel work across two parts of a meal while leaving the order to the cook?
5. How might we make a timer that the cook cannot miss, even with the phone on silent, locked, or across the room?
6. How might we keep every running timer, and what it is for, visible on every screen without crowding the step?
7. How might we show what is already done (steps, ingredients added) so a cook coming back from an interruption knows
   where they are in one glance?
8. How might we mark the ingredients inside a step so they can be found at a glance and checked off as they go in?
9. How might we break a dense step into its actions without splitting one goal across several screens?
10. How might we size text for reading from across the counter and still fit the step, its amounts and what comes next?
11. How might we design the sideways tablet as its own layout, not a stretched phone?
12. How might we serve the cook who wants one step at a time and the cook who scans ahead, from the same screen?

## Not known

- Whether a next-up preview or inline amounts reduce real errors. No study measured it.
- Reading distance and device position in real kitchens. No study here measured them.
- How older cooks, low-vision cooks and cooks with ADHD use these patterns. The evidence on them is thin (CK-016, CK-020).
- Every study here is small (6 to 48 cooks). The review evidence comes from people who already use apps.
