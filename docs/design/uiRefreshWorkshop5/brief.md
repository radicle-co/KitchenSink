# What makes a great UI designer, and what changes for Commise

Brief for the owner, 2026-10-20. It draws on three research notes in `research/`: `appleTradition.md`,
`modernCraft.md` and `seniorVersusJunior.md`. Every claim below has a linked source in those notes.

## 1. What the great ones have in common

**Background.** Few of them trained as "UI designers". Rams and Ive came from craft and industrial design, and Kare
from fine art. Ording studied interaction design, and Brichter and Kocienda were engineers. Saarinen and Freiberg
taught themselves. Art schools (RISD, ArtCenter, the RCA) teach type, grids, systems and constant critique first, and none
puts illustration or decoration at the center. What they share is deep skill in one making discipline, years of
studying the best existing work, and the habit of building the real thing.

**What they know.** Typography above all: the system font, few sizes, hierarchy from weight and color, tracking that
changes with size. Perceptual color (Stripe, Linear). Motion as physics: short, interruptible, with no bounce unless
a gesture earned it. The platform's own conventions, which they follow closely.

**How they work.**

1. Start small, from one idea, and build a working demo early, not a document (Kocienda, Ording, Stamatiou).
2. Make several versions, force one choice, and throw away good work (Jobs: "we only need one of these").
3. Stress-test the design on the hardest real screens before trusting it (Linear's "crash tests").
4. Compare old and new side by side, and judge by using it end to end (Linear, Stripe's "walk the store").
5. Fix the dozen small things: alignment, spacing, one-pixel corrections. People "sense carelessness" (Ive).

**Mentality.** Restraint first: "less, but better" (Rams), "better design does not mean more design" (Zhuo). A tool
must be serious and honest, not "fun" (Saarinen). Be right rather than clever. Bierut says he grew out of
"cleverness". Paul Graham describes the path as imitation, then a try at being original, then the decision that being
right matters more. Taste is a trained judgement, not a vote.

## 1a. How the reinventors make something new and still simple

Sources: `research/appleReinventors.md` covers Apple from the first iPhone to Liquid Glass.
`research/otherReinventors.md` covers webOS, Material, Metro, Paper, Tinder, Snapchat, Things and Arc.

1. **Start from a real problem, never from a style.** Fixed plastic buttons, a finger that covers a tiny screen, dead
   pixels around the camera. The new look is the answer to that problem.
2. **Take something away.** The ideas that lasted removed chrome: the refresh button, Paper's "blue chrome", Metro's
   "Content, Not Chrome". A gimmick adds a layer.
3. **Extend a habit people already have on a screen.** Scrolling became refreshing, and sorting cards became the
   swipe. Ive calls it "the strangely familiar": a familiar form with an honest new job. A form that copies the past
   literally lies about what it does.
4. **Spend novelty in one place, and fence it.** Glass only on the navigation layer. Playful motion only in the
   Dynamic Island, where every animation reports something real. Arc spread novelty everywhere, and its CEO named the
   cost a "novelty tax": "too many new things to learn, for too little reward".
5. **Borrow visual discipline from a mature craft, not its objects.** Metro studied Swiss typography and wayfinding,
   and Material took the logic of layered paper. They borrowed rules of type, grid and hierarchy, not pictures of
   things. That is why the result reads as considered, not cartoony.
6. **Hold the geometry to strict rules.** Concentric corners, one spacing system, content that "nestles". Precision
   makes a new shape feel inevitable rather than cute.
7. **Keep the controls quiet and put personality in the content.** Apple's 2026 brand talk: "move color into the
   content area", and use it "sparingly and with intention". For Commise, the content is the food and the recipe.
8. **Judge with working demos on a real phone.** "The interactive demo we think is really worth a million static
   designs." Tinder's swipe took six months of tuning.
9. **Plan the retreat.** iOS 7's thin type and Liquid Glass's legibility both forced Apple to add contrast options
   later. Design the high-contrast and reduced-motion states from day one.

Apple's 2026 design talk sums it up: "When we say simple, we don't mean minimal", and "every element earns its place."

## 2. Why our four workshops failed

The research names our faults almost one for one.

| What you saw                                            | What we did                                                                                    | What the research says                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Comical", "cartoony", "a first-year designer built it" | I made every option invent a signature idea from food, hands and heat: a carton, a deli shelf. | Literal metaphor as styling is a named junior sign. Vignelli: "I don't believe that when you write dog the type should bark!" Apple abstracts metaphor or drops it.                                                                         |
| "Designed for someone who wears reading glasses"        | My canon said secondary text must be 16 px or more and the default view must hold 200% text.   | iOS body is 17 pt, footnote 13, caption 12. Larger text is the user's choice through Dynamic Type. Accessibility means the layout must scale, not that every screen starts large. "Everything is big" is the first junior sign on the list. |
| "Dense", "a blob"                                       | Big type in small phones, boxes and bands around everything, many colors with jobs.            | Separate groups with space, not boxes. At most three text sizes and two big elements per screen. Few colors, added last.                                                                                                                    |
| "Not smooth, sexy, clean"                               | Agents judged by checklists and contrast numbers, and a judge scored concept and originality.  | Quality comes from craft and editing, judged by looking and using, against the best existing work.                                                                                                                                          |

## 3. The defaults the next attempt starts from

- **Type.** One family. Body at the platform default (17 pt iOS, 16 sp Android, 16 px web). Secondary text at 13 to
  15, in regular weight and a softer color. Weights from 400 to 600, with heavy weights rare. At most three sizes on a
  screen. Hierarchy from weight and color before size. Big type only for the one title that earns it.
- **Accessibility.** Tap areas of 44 pt with smaller visible controls, Dynamic Type and `sp` honored, and a check at
  the largest sizes. The large sizes are a test the layout must pass, not the look everyone gets.
- **Color.** A calm base and one bold signature color with a job, such as the main action and the current step.
  It is confident, not muted: ordinary users prefer moderate colorfulness, and highly educated people (designers
  included) prefer less than average, so the team's sense of "calm" can sit below what users enjoy. Pick colors in a
  perceptual space, so contrast stays clean and not "dark and muddy". Food photos supply the rest of the color.
  Sources: `research/goodUi/perceptionScience.md` rules 12 and 13, `research/goodUi/personalityVersusRestraint.md`
  principle 2.
- **Layout.** Space instead of boxes, fewer and smaller icons, content first. The food photo is the hero, and the
  interface steps back from it.
- **Motion.** 150 to 250 ms, ease-out, interruptible, no overshoot by default, nothing animated that a cook repeats
  all day.
- **No visual metaphor as styling.** Cartons, shelves, recipe cards and illustrated food are not allowed. The fresh
  look comes from typographic and layout discipline, and from food photography as content.
- **Personality through voice and motion first.** Warm, plain, exact words. A short reward when a step or a recipe
  is done. Humor is dry and rare, and never near allergens, times, temperatures, errors or lost work. Motion explains
  or rewards, and stays short.
- **Illustration, only if fenced.** It is allowed only at a few moments: first run, empty lists, no results and
  finishing a recipe. It is custom, from one consistent system, never stock and never "flat people" art. It is never
  on recipe, cooking, list or settings screens, and never decoration. A character, if any, is one character with a
  job, and it is silent or rare.
- **Order and excitement are separate.** People judge "clean and orderly" and "original and exciting" as two
  qualities, so raise both. Order lives in the structure. Excitement lives in color, food photos, voice and motion.
  Look like a top app of this kind first: on a simple screen, typicality raises appeal more than novelty does.
- **App, not article (owner, 2026-10-22).** The pilot's round 3 read "too much like reading a Medium article". A
  screen must look like something to use, not something to read: content grouped into distinct units with a surface
  step, visible controls and affordances, short text blocks with "More", and compact app chrome. A serif over running
  text on a flat off-white page is the editorial look, so it is not the default.
- **Offer calm.** Some people prefer less intensity, so the signature color and the motion have a quieter setting.
- **One signature, fenced.** At most one new, expressive element, tied to a real need, such as how cook mode moves
  from step to step. Lists, forms and settings stay conventional.

## 3a. Design digital cooking from the need, not from the kitchen

Kitchens and cookbooks are the result of hundreds of years of people handling food and paper. Their forms fit hands,
heat and printed pages, not a phone or a browser. Recipe websites today are poor, so there is no good digital model
to copy either. Commise has the chance to define what cooking looks like in digital form.

The needs come from the user-needs database in `docs/research/userNeeds/`. Its `synthesis.md` ranks twelve needs
across cooking, finding recipes, grocery lists and meal planning, with the evidence for each.

1. **Start from the need.** Ask what the cook is trying to do at that moment: decide what to cook, check that they
   have the ingredients, follow the next step, keep track of time, change the amount. Design the best screen for that
   need, using what a phone and a browser do well.
2. **Mirror a physical action only if it translates.** Keep it when the action works better or equally well on a
   screen. Ticking an item off a list translates. A page turn, a recipe card or a stained cookbook does not.
3. **Use what paper cannot do.** Scale quantities, convert units, run several timers, search, remember where the cook
   stopped, and show only the step in progress.
4. **Do not copy recipe websites.** Long stories before the recipe, ads and crowded layouts are the problem to solve,
   not a pattern to follow.
5. **Cooking-specific design is a small part of the app.** Most screens are ordinary app screens: lists, search,
   forms and settings. They follow the mainstream references in section 5, not anything from a kitchen.

## 3b. The app grows with the cook (owner principle, 2026-10-21)

The baseline is the cook who struggles. Every helping feature is built for them first, and it must be comfortable,
out of the way, or only a little useful to an experienced cook. Never a step they must get past.

1. **Help is always there, and never in the way.** It is either already on screen and quiet, or one easy reach away.
   It never blocks, interrupts, or asks to be dismissed.
2. **A safety net matters even when nobody falls.** Knowing help is ready lowers the stress of cooking, even if the
   cook needs it once in a hundred times. Do not remove help because most people do not use it.
3. **The same screen serves both cooks.** A beginner leans on the help. An experienced cook reads past it without
   effort. There is no separate beginner mode to choose.
4. **The app follows the cook, quietly.** As a cook gains skill, help can step further back on its own. It does not
   lecture, and it does not vanish while they still need it.

This is an owner principle, not a research finding. The user-needs database supports the need behind it (CK-021,
CK-022, CK-023, CK-029), but no evidence in it tests this approach. Test it with real cooks.

## 3c. The owner's screen decisions bind every round

`ownerFeedback.md` lists the owner's 23 comments on the screens canvas as decisions, each with its general rule and
the user needs behind it. Every one stands (owner, 2026-10-23). The key example: the cook reaches the ingredients from
the step they are on, without scrolling back or changing tabs (R1, CK-001).

A designer does not only keep these decisions. They find the next ones of the same kind in the user-needs database
and propose them. Look and layout serve the needs, so a round may change layout where a need record supports it, and
it says which record.

## 4. The new method

1. **Start from the current UI.** You rate it above every option so far, so the job is to refine it, not to replace
   it.
2. **One designer, one direction at a time.** No persona score and no judge. The designer builds the real screens in
   HTML at true phone size.
3. **I art-direct from renders.** I look at every screen next to the reference set in section 5 and next to the current UI, and I send
   back specific, visual notes. This repeats until the screens are clearly better than the current UI.
4. **Several versions, one choice.** Within each round the designer tries a few versions of one decision, such as
   density or the type scale, and we keep one.
5. **Stress-test before you see it.** A long recipe title, twenty ingredients, a recipe with no photo, dark mode, and
   the largest text size.

## 5. The reference set every round is judged against

The owner asked for references chosen by evidence, not by taste, and for mainstream products first. Sources:
`research/mainstreamReferences.md`, `research/bestApps.md` and `research/bestWebsites.md`. Each reference is ranked by
independent juries, reviewers or design press, and the reasons are theirs. Few mainstream apps hold more than one
independent design honor, so the evidence for them is thinner than for the specialist apps. The notes mark this.

Mainstream references:

| Reference                             | Evidence                                                                      | What to take from it                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Airbnb (app, incl. the 2025 redesign) | Material Design Award 2016, Webby 2017, It's Nice That and MacStories in 2025 | Photography leads, ample white space, one warm type family, soft corners, subtle motion. |
| Headspace                             | Apple Design Award finalist 2022, winner 2023                                 | A calm tone kept for a decade, clearly labeled collections, few choices per screen.      |
| Threads                               | One source                                                                    | A single text-first column with almost no chrome.                                        |
| Uber (2019 redesign)                  | One source                                                                    | One clear question on the first screen, a minimal grid for the rest.                     |
| Google Material 3 Expressive          | Google's 46 studies, 9to5Google                                               | Test that people find the main action fast. Keep expressiveness out of serious tasks.    |
| Linear (app and site)                 | Several independent reviews                                                   | Neutral and timeless, type first, less chrome, motion only where it explains.            |
| Apple, principles only                | D&AD Black Pencil 2024, Webby 2025                                            | Content first, strong hierarchy, system type. Not glass over busy content.               |

Practitioner census (`research/goodUi/practitionerCensus.md`, 2022 to 2026): the apps named most often as having
great UI are Flighty and Telegram (10 independent places each), Duolingo (9), Linear (8), Airbnb (7) and Things 3 (6).
Designers lean to character with calm, purposeful motion (Duolingo, Airbnb, Headspace). Developers and users lean to
speed, clear labels and depth in one job (Flighty, Things, Telegram). Lemonade rests on a single source.

Specialist apps with the strongest design evidence: Halide (Apple Design Award 2022, App of the Year 2024 for Kino),
Flighty (Apple Design Award 2023) and Things 3 (Apple Design Awards 2009 and 2017). In the recipe category, Mela
(MacStories Best Design 2021) is the bar for cook mode. Crouton won an Apple Design Award in 2024, but the owner
does not like it (2026-10-22), so it is not a reference.

Faults to avoid, even in famous apps: Liquid Glass text over busy content, Spotify's crowded home feed, Netflix
autoplay previews, Robinhood's confetti, Duolingo's streak guilt, and Instagram and Revolut adding features until the
screens fill up.

The big web awards (Awwwards and the Webby visual-design prizes) go to showpiece sites with heavy animation, not to
products people use every day, so they are not references.

What the references share:

1. One job, done with focus. Content first, few visible controls, the rest hidden until it is needed.
2. A clear hierarchy, so the next thing to do is always easy to find.
3. Type first, with a near-neutral palette and one accent that has a meaning.
4. Large, high-quality food photos as the centerpiece, on a clean page.
5. Large text only where the setting needs it: Mela uses big step text in cook mode, read at arm's length.
   The rest of the app stays at normal sizes.
6. Quiet, fast motion and haptics that confirm an action. No motion on frequent actions.
7. Built for the platform: widgets, Live Activities and the system's own controls.
8. Small details resolved: alignment, tabular numbers, tidy line breaks. "Copy the care, not the costume."

How a round passes: the new screens sit beside the current Commise UI, Airbnb, Mela and Things 3 at true
phone size. The round passes only when the new screens are clearly better than the current UI and stand comfortably
beside those three. Headspace is not in the pass test: its look is led by illustration, which this brief rules out. It stays a
reference for calm tone only.
