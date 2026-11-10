> SUPERSEDED (2026-10-22). Do not use this for design work. The current design brief is docs/design/uiRefreshWorkshop5/brief.md, and the user needs are in docs/research/userNeeds/.

# The Commise design canon

Every designer on this project applies this page by reflex. Each rule gives its scope, its use in Commise and its
source in the research briefs here: `research_psychology.md` (Psy), `research_domain.md` (Dom) and
`research_teams.md` (Teams).

Evidence grades: **A** replicated research, **B** one strong or large practitioner study, **C** expert heuristic,
**Folk** lore, never cited as research. Your own review is inspection, not user evidence.

## 0. The bar in one paragraph

Commise must be **easy, simple, calm and never busy or flashy**. It must also be **immediately attractive, fresh and
exciting to look at**. These do not conflict. Appeal is judged in about 50 ms, and the best-scoring designs have low
visual complexity and look like their category (Tuch 2012, Psy §1). Read that finding with care: "looks like its
category" means a familiar **structure** (where things are, how controls work). It does not mean a familiar
**surface** (the same ground, type, crops and layout as every other app). A familiar structure is the goal. A
familiar surface is the "dated" and "boring" failure. Fresh lives in the look and feel. Simple lives in structure
and controls. A first-time user knows what every screen is and what to press **without learning anything**. They
also want to keep looking at it.

Both failures are real, and fixing one by falling into the other is still a failure. Too plain: the work
passes for the closest shipping app with the content swapped. Too clever: the user must learn something to use it.

Excitement comes from freshness, not drama. The product lives in an ordinary kitchen on a weeknight, with a tired
cook. A look that reads as a night out (a restaurant, a gallery, a cinema, a poster) is striking and wrong: it is
not calm, and it is not everyday.

There is a third failure, and it is the hardest to see from inside: **the tasteful default**. A designer removes
the dated look and applies the moves that every design-literate person knows. The result is clean and correct. It
is also the same as every other good designer's answer. It is not dated, and it is not fresh. If three designers
working blind each reach the same set of options, the set fails.

The owner's feedback gave five lessons that a designer at this level knows from the start:

- **F1** Dated and boring. A surface that the category wore out, or the tasteful default, reads as old on
  sight. The idea must come from needs only this product has. It extends where interface design is going, not
  where it was.
- **F2** Options that a stranger sees as the same are one option, however they differ in colour or font.
- **F3** Too creative. Anything the user must learn, decode or work out to operate the app is a failure of the
  barrier to entry, however good it looks.
- **F4** Every option ships its own complete, named palette that a stranger can tell apart from a swatch strip.
- **F5** The psychology is not optional: scroll direction, reach, load, recognition and convention.

These are lessons, not reasons. In a critique, the reason is what you observed in the work and the principle it
breaks. An F-number is at most a cross-reference, never the argument.

## 1. Psychology laws and heuristics

### 1.1 Decision, motor and memory laws (Psy §1)

| Rule                                                                     | When                                  | In Commise                                                                                                                       | Source                     |
| ------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Hick**: decision time grows with the log of equal choices.             | Decision points.                      | One primary action per screen. Rank the rest. A sorted, familiar list is searched, not weighed, so do not hide it.               | Hick 1952 (A)              |
| **Fitts**: bigger and nearer is faster.                                  | Frequent targets.                     | Primary actions large and low. Destructive actions small and apart.                                                              | Fitts 1954 (A)             |
| **Jakob**: users expect your app to work like the others.                | Navigation, back, search, forms.      | Tab bar, large title, standard back, sheets, switches, steppers. Novelty goes to content and look, never to how a control works. | Nielsen 2000 (C)           |
| **Working memory holds about four chunks.** Miller does not limit menus. | Anything held across screens.         | Never make a cook remember a quantity, a step or a timer. Show it where it is used.                                              | Cowan 2001 (A)             |
| **Tesler**: complexity moves, it does not vanish.                        | Import, entry, scaling.               | The system parses, infers units and fills known values. Never "simplify" by pushing work onto the user.                          | Saffer (C)                 |
| **Response limits**: 0.1 s, 1 s, 10 s.                                   | Every input.                          | Pressed state within 100 ms. Skeleton after 1 s. Progress and Cancel after 10 s.                                                 | Miller 1968, Card 1991 (A) |
| **Postel**: accept many forms.                                           | Quantities, times.                    | Accept "1/2", "½", "0.5", "half". Store one form.                                                                                | RFC 761 (C)                |
| **Peak-end**: the peak and the end are remembered.                       | Save, publish, finish, failed import. | Design the last moment and the worst moment before the average screen.                                                           | Kahneman 1993 (A)          |
| **Von Restorff**: the one different item stands out.                     | Every screen.                         | One filled primary. If everything is emphasised, nothing is.                                                                     | von Restorff 1933 (A)      |
| **Goal gradient**: effort rises near the goal.                           | Flows, cook mode.                     | "Step 3 of 7". Count what is done. Never fake progress.                                                                          | Kivetz 2006 (A)            |
| **Zeigarnik** did not replicate.                                         | Drafts.                               | A draft shows as resumable. No streaks, no nagging.                                                                              | Ghibellini 2023 (B)        |
| **Aesthetic-usability**: attractive feels easier.                        | Every review.                         | Beauty buys patience and hides problems. Judge what people do.                                                                   | Tractinsky 2000 (B)        |

### 1.2 Perception, cognition and interaction

| Rule                                                                  | When                           | In Commise                                                                                                                   | Source                        |
| --------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Proximity first.** Gaps between groups are at least 2× gaps within. | Every layout.                  | Group with space, then a shared surface, then a line. Most "busy" screens are wrong spacing.                                 | Wagemans 2012 (A), Psy §2     |
| **Common region** beats proximity.                                    | Cards, sections, sheets.       | A surface exists only to group. A card that groups nothing is decoration.                                                    | Palmer 1992 (A), Psy §2       |
| **Cognitive load, split attention.**                                  | Steps, forms.                  | The quantity sits inside the step. One task per screen.                                                                      | Sweller 1988 (A), Psy §3      |
| **Recognition over recall.**                                          | Search, add to plan.           | Show recents and suggestions.                                                                                                | Nielsen H6 (A), Psy §3        |
| **Progressive disclosure**, two levels at most.                       | Details, settings, editor.     | Rare options sit behind a labelled door ("More options") that never moves.                                                   | Nielsen 2006 (B), Psy §3      |
| **Choice overload** appears only without structure.                   | Library, Discover.             | Give sort, filter and a recommended default. Do not cut real options.                                                        | Chernev 2015 (B), Psy §3      |
| **Defaults** have a large effect.                                     | Servings, units, privacy.      | The default serves the cook. One that serves the business against the user is a deceptive pattern, and we refuse it.         | Johnson 2003 (A), DSA Art. 25 |
| **Signifiers.**                                                       | Every control.                 | Every tappable thing looks tappable without hover: shape, fill, chevron, underline. Weak flat cues cost about 22% more time. | Norman 2008, NN/g, Dom §2.1   |
| **Mental models.**                                                    | Navigation, editor, cook mode. | Use the cook's words. A change to a known model needs proof of a clear win.                                                  | Apple WWDC17 802, Teams §1.4  |
| **Orientation.**                                                      | Every screen.                  | Answer "Where am I? Where can I go? How do I get out?"                                                                       | Apple WWDC17 802              |
| **Feedback** for every action.                                        | Save, tick, timer.             | Visible acknowledgement, announced to screen readers.                                                                        | WCAG 4.1.3, Psy §4            |
| **Prevent slips, undo mistakes.**                                     | Delete, discard.               | Undo, not "Are you sure?". Keep input on error and say how to fix it.                                                        | Norman 1983 (C), Psy §4       |
| **Information scent.**                                                | Labels, links.                 | Labels say what is behind them. No "Learn more". Front-load the key word.                                                    | Pirolli 1999 (A), Psy §5      |
| **Calm technology.**                                                  | Notifications, errors.         | Badge before banner before modal. A modal only blocks a harmful action.                                                      | Weiser 1995 (C), Psy §6       |

Run Nielsen's 10 heuristics on your own work as part of §5.

### 1.3 Scrolling and list direction (exact)

The owner's rule, stated precisely:

- **Vertical** for anything that must be **read, scanned, compared or gone through fully**. This includes
  **sequences such as ingredients and steps**, and **large or open-ended collections**.
- **Horizontal rows** are only for **sampling an optional set of peers where the first few items carry the value**.
  A row always shows a **visible peek of the next item**.

In Commise:

- **Vertical**: ingredients, steps, nutrition, version history, the shopping list and the plan. You go through
  them fully.
- **Vertical with "Load more" and a count**: My recipes, the collections list, search results. You scan and compare
  them. Infinite scroll hurts goal-directed search. Keep the scroll position on return.
- **Horizontal row, next item peeking**: optional peers, such as filter chips or a small sampler of recent
  dishes. This says where a row is allowed. It is not a suggestion to put one on Home.
- **Horizontal rows stacked vertically**: cuisine shelves on Discover. The vertical axis picks the category and the
  horizontal axis browses within it.

Every row: no essential content, a visible peek, visible controls on web (never hover-only), keyboard support and no
auto-advance. Avoid "false floors", meaning a full-bleed image or heavy line that looks like the end of the page.

**Cook mode is not a horizontal list.** It is a one-step-at-a-time view driven by large Next and Previous buttons
(§4). A swipe can also move it, but a swipe is never the only way. On the recipe page, steps stay a vertical list.

Sources: NN/g and Baymard (B), WCAG 2.2.2, Psy §5.

### 1.4 The first screen and scan patterns

- The first screenful gets about **57%** of viewing time, and the first two get **74%** (NN/g 2018, B). The first
  screen says what this is and shows the main action. It gives a reason to scroll: the start of the next group is
  visible above the fixed bars. A hero that fills the whole first screen is a false floor.
- Distinct headings let people scan by heading. The F-pattern is a failure mode, not a target. Psy §5.
- **Do not cite** the Z-pattern, the Gutenberg diagram, "blue suppresses appetite" or "blue builds trust". These are
  Folk. Psy §5, §6.

## 2. Originality and simplicity together

### 2.1 The split

People judge a design by its look in 50 ms. They judge it by its use for the rest of their lives (Psy §1, §6).
So freshness goes where it costs no learning. Familiarity stays where learning has a cost.

**Creativity belongs in** the look (composition, scale, space, big type) and the feel of a press or a tick. It
belongs in light and material, one confident accent, colour from the dish, the food photo as hero, and motion that
explains change.

**Creativity does not belong in** navigation (tab bar, back, large title, search) or standard controls (buttons,
switches, steppers, chips, sheets). Keep conventions: a chevron opens, a filled button acts. No gesture-only actions.
Words stay on actions, controls stay put while cooking, and one colour has one meaning. One target does one
thing: no link or button nested inside a selectable card or row.

Google tested 18,000 people. Expression won where it **amplified hierarchy** (the key action bigger, higher in
contrast, better placed). It lost where it **replaced structure**: loose album art in place of a list, and email
actions without labels, both tested worse. Teams §3, Dom §2.4.

### 2.2 Rules for originality

1. **One signature, everywhere else quiet.** Each option has one expressive idea in the look layer, invented
   for it. Write down where it appears and where it is banned. Teams §5, §7,
   rule 10.
2. **The signature is never a control and never something to learn.** A signature that a user must understand to
   use the app is in the wrong layer (F3). **"Meaning" is exact here:** the signature must not encode information
   through a visual variable the user must decode (position, size, colour, motion, order). It can show content as
   type or image. The signature can show live data, such as a time or a step. That data then also appears in its
   normal place and form. A user who ignores the signature loses nothing.
3. **The signature never enters cook mode's controls or sits behind body text.** Teams rule 11, Dom rule 16.
4. **Take a trend's lesson, not its surface.** From Liquid Glass, controls in their own layer. From Material You,
   colour set by tone, taken from the food. From springs, interruptible motion. Dom §2.7.
5. **Do not borrow the leader's look.** It dates to its year. Find the idea in food, hands, heat and the counter.
   Teams rule 16.
6. **Write your constraints down at the start**: typefaces, shapes, colours, materials. Teams §7.
7. **Diverge for real.** Distinct options differ in **structure or concept**, not colour. Sketch many, cut to three,
   commit to one, and name your pick and why. Never present filler. Teams §1.3, §9.
8. **Use real content**: the longest real titles, real photos, real empty states. Teams rule 5.
9. **Examples here are permissions, not answers.** Any idea that this canon, the persona or a brief names as
   allowed can support an option. None of them is ever an option's signature or its main idea. Every designer who
   read the same page shares that idea, so it is the median. The same holds for a named idea with its ground or
   mood flipped. A signature is invented for its option, and you write where its idea came from.
10. **Every option states a visual thesis**: one sentence saying what a stranger sees in the first 50 ms and why
    only Commise looks like this. It also names one **outside reference** from outside recipe and food apps. The
    reference is one specific, named object, maker or work, never a category ("a 1970s Braun timer", not "kitchen
    equipment"). The reference feeds the look layer only. Rule 9 applies to it too: a reference this canon gives as
    an example is not yours. Teams §7. **Reference test:** a reference that appears in a standard design-history
    survey, or on most design moodboards, is the median. Say why few designers pick it, or replace it.
11. **The signature survives real content.** With the longest real title, at 320 px and at 200% text, it is still
    visibly the signature. If it falls back to a system default size or style, it does not exist.
12. **Each option takes one step on the current trajectory.** Name two or three apps shipped in the last 18
    months, and the direction they share in the look layer. Say what you take one step past them, and check that
    it changes no control. A look built only from references before 2015 has no trajectory.

### 2.3 What "fresh" looks like in practice

Fresh does not come from warm tinted grounds, ornament or new ways to operate things. It comes in two moves, and you
need both:

1. **Clear the ground.** Remove ornament, frames, textures and dead rows. This removes the dated look. On its
   own it gives a generic template, which is the "boring" failure.
2. **Make one positive, visible move in the look layer**, carried by the visual thesis. The axes are scale,
   composition, type, colour, material and light, and motion. These are axes, not answers. Big type, a full-bleed
   photo and a crop at the screen edge are what every good designer does already: used plainly, they are the
   tasteful default (§0). On whatever axis you move, the instance must be one that the closest shipping app does
   not use. Say what that is.

    The move is visible at thumbnail size and changes no control.

Then run three tests. Each one is adversarial: assume it fails until you show that it passes.

- **House-answer test.** Before you design, write the house answer: what a tasteful designer makes from this
  brief this year (ground, type genre, hero form, composition, palette). Also write its **inversion**: the same
  structure with the ground or mood flipped. The inversion is the house answer. Each option differs from both on
  at least two axes, and you say which two. Ground, palette and mood move together, so they count as one axis.
- **Closest-app test.** Name the shipping app that the option most looks like, **and the feature in it nearest
  the signature**. Name the one visible thing that separates them. If the answer is "the content" or "the colour",
  it fails. If the nearest feature is the signature, it fails.
- **Excitement test.** Name the one thing a viewer screenshots and sends to a friend. Search for it, described in
  plain words, and name any shipping app that already does it. If one does, it fails. A test run from recall is
  unverified, and an unverified test has not passed.

## 3. The palette standard

### 3.1 The logic in two sentences

Colour changes how food tastes (Spence 2015, Piqueras-Fiszman 2012, Psy §6), so chrome serves the photo and never
tints it. One accent marks what you can press, and tone sets every colour, so contrast is safe by construction
(Stripe, Linear, Dom §2.3, Teams §5). What is banned is warm, papery grounds and chrome that competes with the
food.

### 3.2 Every option ships its own palette (F4)

The table below is the **reference** palette. It shows the standard and is not for copying. Every option fills the
**same role table** with its own named colours, hex for light and dark, and measured contrast. Rules:

- The option's palette has a **name**, and every role has a name (for example "Leaf", not "green-700").
- The action colours of any two options are at least **ΔE00 15 apart** in both themes. Each action colour is also
  at least ΔE00 15 from every **action colour used in earlier rounds**: `#2A6B65`, `#6CC0B3`, `#7CC8BE`, `#0B4F3E`, `#8EDBBF`.
  Report every figure.
- Every pair passes the minimums in the "Use" column of §3.3. Report WCAG ratio and APCA Lc for each.
- **No cream, paper, plaster, linen or parchment grounds** (F1). Cook mode stays neutral and opaque in every
  option.
- **Light and dark follow the OS setting.** Every option has a real light theme and a real dark theme. In light, the
  Ground and Surface roles have OKLCH L of 0.85 or more. In dark, the Ground role has L of 0.25 or less. One deep
  or coloured panel can sit inside a light theme, but it never replaces the light theme. At most one option in a set has a
  planning chrome that is deep or strongly coloured.
- **Every role is filled**, Hairline included, in both themes.
- **Roles inside one palette never collide.** Action, content hue, Warning and Danger are at least ΔE00 15 apart
  from each other, in both themes. Report every pair.
- The palette has a **stated idea**: one sentence on what it evokes and why it flatters food photos. A palette that
  is the reference with a different accent hue is not a new palette. Show the difference with numbers. Meet one
  of three tests. The ground moves at least 4 in OKLCH L×100 or 0.02 in C. The Ink-to-Muted step is different. Or a
  content hue is visible at swatch size. Derive Warning and Danger for your own grounds. Do not copy them.
- The accent looks like something in a kitchen or market (an ingredient, a tool, a flame), not like a tech brand.
  **No violet, indigo or electric blue accent on a cool grey ground**: it reads as a SaaS or AI product. An accent
  that reads as a bank, an insurer or an office suite fails in the same way.
- An option can add **one content hue**: a supporting colour for imagery grounds, washes and category marks. It
  never appears on a control, a link, a tick or text, so it never competes with the action colour.
- **Hierarchy survives in dark mode.** Ink to Muted is at least **1.6:1** in both themes. Report it.
- **Swatch test.** Show each option's palette as a 32 px strip of its roles, with no photos. A stranger can tell
  the strips apart, and can say in a few words what each one evokes. Two strips that both read as "white with one
  dark accent" are one palette.

### 3.3 Reference palette: "Mise"

Mise (from _mise en place_) is crisp, near-white with a faint green tint, and a fresh leaf-green accent. It is the
standard, not a starting point: an option that keeps its ground, muted step and alerts is Mise.

| Role        | Name    | Use                                                                          | Light     | Dark      |
| ----------- | ------- | ---------------------------------------------------------------------------- | --------- | --------- |
| Ground      | Counter | The page behind everything                                                   | `#F5F6F4` | `#0D100E` |
| Surface     | Plate   | Lists, sheets, tab bar, fields                                               | `#FFFFFF` | `#171B18` |
| Sunken      | Well    | Inset strips, search field fill                                              | `#ECEEEA` | `#212622` |
| Edge        | Rim     | Control outlines, unticked boxes (≥ 3:1)                                     | `#767E78` | `#7E8780` |
| Ink         | Ink     | All body text and titles (≥ 4.5:1, Lc ≥ 75)                                  | `#141815` | `#EDF1EC` |
| Muted       | Ash     | Secondary text, 16 px and up only (≥ 4.5:1, Lc ≥ 60, ≥ 1.6:1 below Ink)      | `#4B534D` | `#B3BBB4` |
| Action      | Leaf    | The one filled button, short links, current tab, ticks, focus ring (Lc ≥ 60) | `#24690A` | `#B4E26E` |
| On action   | On leaf | Label on a Leaf fill                                                         | `#FFFFFF` | `#0F1A05` |
| Action wash | Sprout  | Selected chip, current step ground (decoration)                              | `#E6F2D6` | `#1E2B14` |
| Warning     | Amber   | Short labels with an icon only (Lc ≥ 60)                                     | `#8A4A00` | `#FFB868` |
| Danger      | Tomato  | Short labels with an icon only (Lc ≥ 60)                                     | `#B3261E` | `#FFA59D` |
| Hairline    | Seam    | Dividers, decoration only (no contrast duty)                                 | `#DCE0DC` | `#2D332F` |

**Measured contrast**, WCAG 2 ratio and APCA Lc, on Counter, Plate, Well and Sprout (light, then dark):

- Ink: 15.4–17.9, Lc 94–105. Dark 13.0–16.8, Lc 95–98.
- Ash: 6.8–7.9, Lc 77–88. Dark 7.6–9.7, Lc 61–64. Ink to Ash: 2.26 light, 1.72 dark.
- Leaf as a link: 5.8–6.8, Lc 72–83. Dark 10.0–12.8, Lc 77–80.
- On leaf on Leaf: 6.77, Lc 88. Dark 12.0, Lc 79.
- Amber: 5.9–6.9, Lc 73–83. Dark 8.7–11.2, Lc 69–72.
- Tomato: 5.6–6.5, Lc 70–81. Dark 7.9–10.1, Lc 63–66.
- Rim on Counter, Plate and Well: 3.6–4.2. Dark 4.2–5.2.

### 3.4 Palette rules

1. **One colour means one thing.** Leaf means "you can press this" or "you did this": buttons, short links, ticks.
   It is never decoration and never running text. Amber and Tomato are short labels beside an icon. Teams rule 23.
2. **Colour is never the only cue** (WCAG 1.4.1). About 1 in 12 men has a colour-vision deficiency (NEI, Psy §6).
   A ticked line gets a tick, muted text and a strike-through.
3. **Danger never looks like the action.** In light mode Tomato and Leaf have almost the same lightness (1.04:1), so
   many colour-blind users cannot tell them apart. A destructive control is a text button or row with an icon, never
   a filled pill and never in the primary's place.
4. **Food is never tinted.** No coloured overlay on a photo. Text never sits on a raw photo. Under text, a scrim
   reaches 55% black at the text row, which keeps white text at 4.7:1 over a white plate. Controls over a bright
   photo get a solid backing or a 35% dim (Teams §1.2).
5. **Colour from the dish is permitted, by tone.** On planning surfaces, a wash can take its hue from the dish
   photo, with its tone fixed so text contrast holds whatever the hue. Never in cook mode. This is a permission,
   not a recommended signature (§2.2 rule 9). Dom §2.6.
6. **Check every colour in light, dark and increased contrast.** Teams rule 24.
7. **Pass WCAG 2.2 AA first, then APCA.** Text 4.5:1, control edges, icons and focus 3:1. Then Lc 75 for body
   text, Lc 60 for short labels and for muted secondary text at 16 px and up, Lc 45 for large headings. Text below
   16 px uses Ink. Psy §8.

## 4. Cooking-context rules

Commise has **two modes with opposite needs** (Dom §1.1). **Planning**: seated, phone at 30–40 cm, dry hands, where
density helps. **Cooking**: phone propped 50–90 cm away, read in glances, wet hands, where density hurts. They are two
layouts, not one screen with a big-text switch.

Each rule names its place: cook mode, the recipe page or content.

| Rule                                                                                       | In Commise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Source                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Cook mode: one step at a time.**                                                         | No cook-mode screen shows more than one step's instruction at full size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Dom §1.4, rule 1         |
| **Cook mode: size step text for distance.**                                                | Step text about **26–32 pt** for a propped phone, roughly 2–3× body size. Test at 60 cm and 90 cm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Dom §1.3                 |
| **Recipe page and cook mode: quantities inside the step.**                                 | "Whisk **2 eggs** with **50 g sugar**." The cook never scrolls back to the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Dom rule 3, Psy §3       |
| **Recipe page and cook mode: the current step is marked, ingredients can be crossed off.** | A cook who walks away comes back to the same place with nothing to remember.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Dom rule 4               |
| **Recipe page: scaling recalculates every quantity**, including those in the steps.        | A servings stepper. No mental arithmetic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Dom rule 5               |
| **Cook mode: cut the touches.**                                                            | Each touch can cost a hand-wash. A whole recipe can be followed with Next and Previous alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Dom rule 6               |
| **Cook mode: big fixed targets.**                                                          | Targets at least 1 × 1 cm with 0.4 cm gaps. Next and Previous are much larger, in fixed places, near the bottom, and work with a knuckle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Dom rule 7               |
| **Cook mode: a touch-free path exists, never as the only path.**                           | Voice "Next" and "Back", plus the buttons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Dom rule 8               |
| **Cook mode: the screen stays awake**, never behind a paywall.                             | Turning on cook mode keeps the screen on, from the user's gesture. Leaving releases it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Dom rule 9               |
| **Recipe page and cook mode: durations become timers.**                                    | "Simmer **10 min**" is a tappable timer. Several run at once, each named for its step, and they keep running in the background.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dom rule 10              |
| **Cook mode: a running timer is always visible.**                                          | A fixed timer strip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Dom rule 11              |
| **Content: steps read well aloud.**                                                        | Short steps, with the action first and a signpost: "Step 3 of 7."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dom rule 13              |
| **Content: offer the why at the step**, never as a requirement.                            | A folded note beside the step shows the right look.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Dom rule 14              |
| **Import: show the steps, not the story**, and credit the source.                          | Blog chatter never reaches the steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Dom §1.4, rule 12        |
| **Cook mode: no glass or translucency.**                                                   | Opaque, high-contrast controls in fixed places, and heavier type. Steam and glare lower contrast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dom Part 3, rules 16, 22 |
| **Cook mode: controls never move or resize.**                                              | No bars that shrink on scroll.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dom rule 21              |
| **Cook mode: labels stay on the controls.**                                                | "Next step", never just an arrow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dom rule 17              |
| **The screen that opens the app shows the cook's state.**                                  | It shows what is happening now: a cook in progress ("Step 4 of 7"), a running timer, tonight's meal, or what needs using up. It changes between "I am cooking" and "I am deciding", and the one primary follows that state. **The deciding state helps choose.** It shows a short choice with reasons. "The last recipe opened" or a recency list alone is recall, not a decision aid. The reasons use only facts Commise stores today, or facts the recipe holds (its time, servings, ingredients). Check the specs and schemas for what is stored, and do not assume. Where a useful fact is not stored, ask the cook one question with a one-tap answer. A reason built on data that does not exist is a false promise. A nudge to novelty ("not opened lately") is not help to choose. Features not built yet get one line of text at most, below the first screen, never rows on Home. | Dom §1.1                 |

### 4.1 Touch, type and motion numbers

- **Targets**: 44 pt (iOS) and 48 dp (Android), with 8 dp gaps. Larger near edges, never below 24 CSS px. Every drag
  has a tap alternative. Psy §8–9.
- **Reach**: put primary and frequent actions in the lower middle of the screen. Put rare and destructive ones at
  the top. Never port a desktop top-right primary. Psy §9.
- **Type**: use one family, at most two. Body 17 pt (iOS) or 16 px (web), nothing below 11 pt, no Thin or
  Light text. Lines of 45–75 characters. Survives 200% text and 320 CSS px. Heavier weights over photos. Psy §7.
- **Motion**: only after a user action or a state change, to explain what changed. 100–500 ms. Springs at 100% damping
  by default. Always interruptible. Respects Reduce Motion. Teams §1.4, Psy §6.

## 5. Self-review checklist

Run every item on your own work **before you show it**. Every item is pass or fail. The tag shows which piece of
owner feedback it catches. One fail means the work is not ready.

### A. Fresh, not dated (F1, F4)

- For each main visual choice (ground, type, surfaces, imagery, accent), I wrote the year it reads as. None reads
  as 2015–2019, and at thumbnail size nobody can mistake it for a 2018 recipe blog or this year's Apple sample app.
- I wrote the house answer, and each option differs from it on two named axes (§2.3).
- I named each option's closest shipping app and the one visible difference that is not the content (§2.3).
- I named each option's trajectory step (§2.2 rule 12), and I wrote why its look did not ship before 2022.
- The food photo is the largest and most colourful thing on Home and on the recipe page.
- I can name the option's one signature in one sentence, and I wrote where it is banned.
- The signature comes from a specific Commise need (hands, distance, heat, timing, the dish photo), and I can name
  that need. A fresh look that fits any app fails (F1).
- Every screen is clearly Commise: real dishes, a cook's notes, honest copy, no AI sparkle (Dom rule 23).
- Each option has a visual thesis and a named outside reference (§2.2 rule 10). Its signature is not a canon
  example (§2.2 rule 9).
- It passes the closest-app and excitement tests (§2.3). I wrote what a viewer points at, and the top-chart apps I
  checked.
- The signature survives the longest real title at 320 px and 200% text (§2.2 rule 11).

### B. Distinct options (F2)

- I put all options side by side at thumbnail size. A stranger can name a **structural or conceptual**
  difference within 5 seconds. A colour or font swap does not count.
- Each option has its own palette name, role table, hex for both themes and measured contrast (§3.2).
- The action colours of any two options, and each against every action colour used in earlier rounds, are at least ΔE00 15
  apart. I reported every number.
- The palettes pass the swatch test, and none is the reference with a new accent (§3.2).
- Each palette has every role, a real light and dark theme that follow the OS, and no two of Action, content
  hue, Warning and Danger closer than ΔE00 15 (§3.2). I reported every pair.

### C. Simple, with a low barrier to entry (F3, F5)

- I listed every interaction that a first-time user has not seen in another popular app. **The list is empty
  for navigation and controls.** Novelty lives only in the look, feel, light, colour, imagery and motion.
- Every screen answers: where am I, where can I go, how do I get out.
- Every screen has **exactly one** filled primary action, in thumb reach, with a text label. That action is the
  job the screen exists for. If the primary and the stated job differ, one of them is wrong.
- The signature encodes nothing through position, size, colour, motion or order (§2.2 rule 2). Without it, no
  function and no information is lost.
- Every tappable thing looks tappable without hover. No action exists only as a gesture, long-press or drag.
- Every target does one thing. No link sits inside a selectable card.

### D. Psychology (F5)

- **Scrolling**: for every list I wrote its direction and its reason. Ingredients, steps, the library, search
  results, the shopping list and the plan are vertical. Horizontal rows are only optional samplers, each with a
  visible peek, and no essential content is in a row.
- Large collections use "Load more" with a count, not infinite scroll.
- Gaps between groups are at least twice the gaps within groups. Nothing is boxed without a reason.
- Nobody has to remember anything across screens. Quantities sit in the steps, and the current step is marked.
- The first screenful says what the screen is and shows its main action. There is no false floor.
- Every action gives feedback within 100 ms. Delete offers Undo, not "Are you sure?".
- I ran Nielsen's 10 heuristics and wrote down every violation, with its fix.

### E. Calm, never busy or flashy (F1, F3)

- I counted the accent-coloured elements on each screen. Leaf appears only on the primary action, the current
  tab, links and ticks.
- Nothing moves without a user action. There is no idle animation, parallax or auto-advance.
- Each ornament (shadow, border, gradient, texture, animation) has a stated job. Anything with no job is deleted.
- No more than two type families.
- Each option passes the weeknight test (§0): calm and fresh in an ordinary kitchen, not a night out.

### F. Cooking (F5)

- Cook mode shows one step at full size, at 26 pt or more, with quantities inline and timers tappable.
- Next and Previous are large, labelled, fixed and low. The whole recipe works with only those two.
- The screen-awake state is visible and switched on by the cook's own action.
- Cook mode has no glass, no moving controls and no text on a raw photo.
- The screen that opens the app shows the cook's state, and I showed it in both the cooking and the deciding case.
  The deciding state helps choose, not only recall, and every reason uses a fact Commise stores (§4).

### G. Accessibility and states

- Every text pair meets 4.5:1 and its Lc minimum in light and dark. Edges and icons meet 3:1. Ink to Muted is
  at least 1.6:1 in both themes. I reported the numbers.
- Colour is never the only cue. Danger is never styled like the primary.
- Targets meet 44 pt / 48 dp. The layout survives 200% text and 320 px width with no sideways page scroll.
- I designed the empty, loading, error, offline, first-run and success states, with real, localisable copy at
  its longest length.

## 6. Warning signs

### 6.1 Signs the work is generic or dated

- A cream, paper, plaster, linen or parchment ground.
- A soft bookish serif used as the main voice. A "cookbook" or "farmhouse" mood.
- A grid of equal cards with drop shadows and rounded corners, and small square thumbnails.
- A row of small grey icons with tiny labels. A hamburger menu.
- Small photos, circle crops or beige frames.
- It looks like any recipe app. Remove the logo and nothing says Commise.
- Copying this year's leader: glass everywhere, 3D icons, bouncy motion. It dates to this year (Teams §7).
- Muted earth tones everywhere, with no confident accent.
- Generic AI garnish: sparkle icons, purple-blue gradients, "✨ Smart suggestions". A violet or indigo accent on
  cool grey reads the same way.
- A screen built only from the platform's default components in their default order. Correct and forgettable.
- The tasteful default: a near-neutral page, one big headline, a full-bleed photo and a strict list, with nothing
  that the closest shipping app does not also do.
- A reference every design student names first, used as the idea rather than as a source.
- Several designers, working blind, reached the same look. This includes the inversion of a shared look.
- An option whose only change from the last design is subtraction.

### 6.2 Signs the work is too clever

- A user must learn a new idea to use a control, or decode a visual variable (position, size, colour, motion) to
  read information (F3).
- The signature carries meaning, so a user who misses it misses information.
- An essential list that scrolls sideways, or a sequence (ingredients, steps) in a row.
- Controls that move, shrink, hide or change place on scroll, especially while cooking.
- More than one signature, or the signature inside cook mode's controls.
- You cannot explain the screen to a new user in one sentence.

## Sources

Full citations with links are in `research_psychology.md`, `research_domain.md` and `research_teams.md` in this folder.
