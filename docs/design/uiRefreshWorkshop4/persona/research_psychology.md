# The psychology of UX and UI: the canon, its evidence, and how to apply it

Research brief for the uiRefreshWorkshop4 designer persona. Each entry gives the claim, how strong the
evidence is, and what it means for a screen. Numbers are quoted from the source cited next to them. Where a
popular claim is weaker than its reputation, this brief says so. A designer who can tell a law from a
folk model is worth more than one who can recite both.

**Evidence grades used below**

- **A**: replicated lab or field research with a measured effect (Fitts, Hick, defaults, response time).
- **B**: one strong study, or a large practitioner study by a credible lab (NN/g, Baymard) on a defined task.
- **C**: expert framework or heuristic. Useful and widely agreed, but not a measured effect.
- **Folk**: often repeated, weakly sourced. Use only as a sketching aid.

---

## 1. The Laws of UX

The collection popularised by Jon Yablonski ([lawsofux.com](https://lawsofux.com/)) is a handy index. It is a
summary, not a source. The primary sources are below.

### Hick's law (A, with limits)

Decision time grows with the logarithm of the number of equally likely choices: RT = a + b·log₂(n+1)
([Hick 1952](https://doi.org/10.1080/17470215208416600), [Hyman 1953](https://doi.org/10.1037/h0056940)).
It holds for simple choice reactions among known, equally likely options. It holds less well in two cases. Users
scan an unfamiliar list, which is closer to linear. Or one option is far more likely than the rest.
**Apply:** cut and rank choices at decision points (the main action, a filter row, a sheet of actions). Do
not cite Hick to justify hiding a well-organised menu. A long, sorted, familiar list is fast because users
search it rather than weigh it.

### Fitts's law (A)

Time to hit a target grows with distance and shrinks with target width: MT = a + b·log₂(D/W + 1)
([Fitts 1954](https://doi.org/10.1037/h0055392), [MacKenzie 1992](https://doi.org/10.1207/s15327051hci0701_3)).
It is one of the best-replicated results in HCI. **Apply:** make frequent targets big and near the pointer or
thumb. Screen edges and corners are "infinitely deep" for a mouse but are the _least_ reachable areas for a
thumb (see section 9). Keep destructive actions small and away from common ones. Fitts helps you there by
making mistakes harder.

### Jakob's law (C)

"Users spend most of their time on other sites." So they expect yours to work the same way
([Nielsen 2000](https://www.nngroup.com/articles/end-of-web-design/)). It is the design form of mental-model
research (section 4). **Apply:** use platform conventions for navigation, back, search, sharing and forms.
Spend novelty on the content and the core task, not on how controls work.

### Miller's law and working memory (A, often misquoted)

[Miller (1956)](https://doi.org/10.1037/h0043158) wrote about limits on absolute judgement and memory span,
"seven, plus or minus two". Later work puts working memory nearer **four chunks**
([Cowan 2001](https://doi.org/10.1017/S0140525X01003922)). Miller does **not** say "menus must have at most
seven items". Menus are read, not memorised. **Apply:** do not ask users to _hold_ more than about four
things across screens (a code, a step count, values from the last page). Chunk long numbers. Keep what a
task needs visible.

### Tesler's law, the conservation of complexity (C)

Every system has complexity that cannot be removed. The question is who carries it: the user or the
system ([Saffer, _Designing for Interaction_, citing Larry Tesler](https://lawsofux.com/teslers-law/)).
**Apply:** move work to the system: parse pasted text, infer units, keep defaults, fill known values. Do not
"simplify" a screen by pushing the hard part to the user.

### Doherty threshold and response time (A)

[Doherty and Thadani (1982, IBM)](https://lawsofux.com/doherty-threshold/) argued that productivity rises
sharply below about 400 ms of system response. The older and stronger limits have three steps. At 0.1 s it
feels instant. At 1 s the flow of thought stays. At 10 s attention is lost
([Miller 1968](https://doi.org/10.1145/1476589.1476628), [Card, Robertson and Mackinlay 1991](https://doi.org/10.1145/108844.108874),
[Nielsen, "Response Times: The 3 Important Limits"](https://www.nngroup.com/articles/response-times-3-important-limits/)).
**Apply:** respond to every input within 100 ms (pressed state, optimistic update). Show a spinner or
skeleton after about 1 s. Show determinate progress and a way to cancel past about 10 s.

### Postel's law, the robustness principle (C)

"Be conservative in what you do, be liberal in what you accept from others."
([RFC 761](https://datatracker.ietf.org/doc/html/rfc761), [RFC 1122 §1.2.2](https://datatracker.ietf.org/doc/html/rfc1122)).
In UI it means forms accept the many ways people write things. **Apply:** accept "1/2", "½", "0.5",
"half". Accept spaces in phone numbers. Trim whitespace. Normalise case. Output one clean format.
**Caveat:** in protocols, too much tolerance is now a known security and drift risk
([RFC 9413](https://datatracker.ietf.org/doc/html/rfc9413)). Be liberal in input you _parse_, never
liberal in what you _authorise_.

### Peak-end rule (A)

People judge a past experience mostly by its most intense moment and its end. They largely ignore its
length ([Kahneman, Fredrickson, Schreiber and Redelmeier 1993](https://doi.org/10.1111/j.1467-9280.1993.tb00589.x),
[Redelmeier and Kahneman 1996](<https://doi.org/10.1016/0304-3959(96)02994-6>)). **Apply:** design the end of
a flow (save, publish, finished cooking) as carefully as the start. Find the worst moment (a lost draft, a
failed import) and fix it before polishing the average.

### Serial position effect (A)

Items at the start (primacy) and end (recency) of a list are best remembered
([Ebbinghaus 1885](https://psychclassics.yorku.ca/Ebbinghaus/index.htm), [Murdock 1962](https://doi.org/10.1037/h0045106)).
**Apply:** put the most important nav items at the ends of a tab bar. In a long list, the middle gets least
attention, so do not bury key options there.

### Von Restorff (isolation) effect (A)

A distinct item among similar ones is remembered and noticed more
([von Restorff 1933](https://doi.org/10.1007/BF02409636)). **Apply:** one primary button per view. If
everything is emphasised, nothing is. Do not rely on colour alone to make it distinct (WCAG 1.4.1).

### Zeigarnik effect (B, weak replication)

The claim: people remember unfinished tasks better than finished ones
([Zeigarnik 1927](https://psychclassics.yorku.ca/Zeigarnik/)). Replications are mixed. A meta-analysis found
no general memory advantage ([Ghibellini and Meier 2023](https://doi.org/10.1057/s41599-023-01694-7)). **Apply:** use it gently: show an unfinished draft as resumable. Do not build "streak anxiety" on
it. That turns a doubtful effect into a dark pattern.

### Goal-gradient effect (A)

Effort rises as people get closer to a goal ([Hull 1932](https://doi.org/10.1037/h0072640)). A field study used
coffee cards. A 12-stamp card with 2 pre-filled was completed faster than a 10-stamp card with none
([Kivetz, Urminsky and Zheng 2006](https://doi.org/10.1509/jmkr.43.1.39)). **Apply:** show progress in
multi-step flows ("Step 2 of 3"). Count steps already done. Never fake progress.

### Aesthetic-usability effect (B)

Users rate attractive interfaces as easier to use
([Kurosu and Kashimura 1995](https://doi.org/10.1145/223355.223680), [Tractinsky, Katz and Ikar 2000](<https://doi.org/10.1016/S0953-5438(00)00031-X>)). First impressions of
visual appeal form in about 50 ms and are stable ([Lindgaard et al. 2006](https://doi.org/10.1080/01449290500330448)).
Low visual complexity and high prototypicality (looks like its category) score best
([Tuch et al. 2012](https://doi.org/10.1016/j.ijhcs.2012.06.003)). **Apply:** polish earns tolerance, but it
also _hides_ usability problems in tests. Watch what users do, not what they say about how it looks.

## 2. Perception: Gestalt principles (A)

The Gestalt school ([Wertheimer 1923, trans.](https://psychclassics.yorku.ca/Wertheimer/Forms/forms.htm))
described how the eye groups things. A century of later research supports and extends it
([Wagemans et al. 2012](https://doi.org/10.1037/a0029333)).

- **Proximity**: close things belong together. The most-used grouping tool in UI. Space between groups must be
  clearly larger than space within them (at least about 2×).
- **Similarity**: same colour, shape or size reads as same kind. So a link style used for a non-link is a lie.
- **Common region**: things inside one border or background belong together, and this can beat proximity
  ([Palmer 1992](<https://doi.org/10.1016/0010-0285(92)90014-S>)). This is why cards work.
- **Uniform connectedness**: elements joined by a line or shape are the strongest grouping
  ([Palmer and Rock 1994](https://doi.org/10.3758/BF03200760)).
- **Continuity, closure, figure/ground, common fate**: a partly cut-off card implies more content to the
  side (closure and continuity). Things that move together are seen as one (common fate).

**Apply:** fix grouping with space first, then region, then lines. Most "this screen feels busy" complaints
are spacing that does not match the content's real structure.

## 3. Cognition: load, memory and disclosure

### Cognitive load (A)

Working memory is small. Load from bad presentation ("extraneous load") competes with the task
([Sweller 1988](https://doi.org/10.1207/s15516709cog1202_4), [Sweller, van Merriënboer and Paas 2019](https://doi.org/10.1007/s10648-019-09465-5)).
Also, split attention between two places costs more than reading one integrated place.
**Apply:** put information where it is used (the quantity _in_ the step, not only in a list at the top).
Remove decoration that carries no meaning. Keep one task per screen.

### Recognition over recall (A)

Recognising an option is easier than recalling it
([Nielsen heuristic 6](https://www.nngroup.com/articles/ten-usability-heuristics/)). The memory basis is
classic ([Shepard 1967](<https://doi.org/10.1016/S0022-5371(67)80067-7>)). **Apply:** show recent items,
suggestions and visible options. Do not make users remember a name, a code or a command.

### Progressive disclosure (B/C)

Show the common options first. Move rare or advanced ones one step away
([Nielsen 2006](https://www.nngroup.com/articles/progressive-disclosure/)). It works only with the right split
between common and rare. It fails as soon as a needed item is hidden. More than two levels usually fails.
**Apply:** decide the split from data or task analysis, label the door clearly ("More options"), and keep it
in the same place every time.

### Choice overload (B, moderated)

Shoppers offered 24 jams were less likely to buy than those offered 6
([Iyengar and Lepper 2000](https://doi.org/10.1037/0022-3514.79.6.995)). A meta-analysis then found a mean
effect near zero ([Scheibehenne, Greifeneder and Todd 2010](https://doi.org/10.1086/651235)). A later
meta-analysis found the effect _is_ real under four conditions ([Chernev, Böckenholt and Goodman 2015](https://doi.org/10.1016/j.jcps.2014.08.002)).
The four are complex choice sets, hard trade-offs, unclear preferences, and a goal of picking quickly.
**Apply:** large sets are fine with sort, filter and compare. Overload appears with no structure and no
clear best option. Offer a recommended default, not fewer real options.

### Defaults (A)

Defaults have a large effect. Organ donor consent was about 90% or more in opt-out countries. It was far
lower in opt-in ones ([Johnson and Goldstein 2003](https://doi.org/10.1126/science.1091721), [Thaler and Sunstein, _Nudge_](https://yalebooks.yale.edu/book/9780300262285/nudge/)).
A large meta-analysis shows a reliable default effect ([Jachimowicz et al. 2019](https://doi.org/10.1017/bpp.2018.43)).
**Apply:** choose the default that is best for the _user_, because most will keep it. A default that serves
the business against the user is a deceptive pattern. See [EU DSA Article 25](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
and the [FTC 2022 report](https://www.ftc.gov/reports/bringing-dark-patterns-light).

## 4. Interaction models: Norman, mental models, heuristics

### Affordances and signifiers (C, foundational)

Gibson defined affordances as what the environment offers an animal ([Gibson 1979](https://doi.org/10.4324/9781315740218)).
Norman brought the term to design ([_The Design of Everyday Things_, 1988, revised 2013](https://mitpress.mit.edu/9780262525671/the-design-of-everyday-things/))
and later insisted the designer's job is the **signifier**: the visible cue that says what can be done and
where ([Norman 2008, "Signifiers, not affordances"](https://jnd.org/signifiers-not-affordances/)). His other
core concepts: **mapping** (controls laid out like what they control), **constraints**, **feedback**, and the
two gulfs, **execution** (how do I do it?) and **evaluation** (did it work?).
**Apply:** flat design removed many signifiers. Users miss flat links and
buttons ([NN/g, "Flat UI elements attract less attention"](https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/)).
Every tappable thing needs a cue (shape, colour, chevron, underline) that does not depend on hover.

### Mental models and conventions (B)

Users act on their model of a system. They build that model from past systems
([NN/g, "Mental Models"](https://www.nngroup.com/articles/mental-models/), [Johnson-Laird 1983](https://www.hup.harvard.edu/books/9780674568822)).
A system with a different model must teach it or change. **Apply:** use the user's words for
things (card sorting and tree tests show them). Match platform conventions on each platform: iOS back swipe,
Android system back, web browser back.

### Nielsen's 10 usability heuristics (C, the standard checklist)

[Nielsen 1994, updated 2020](https://www.nngroup.com/articles/ten-usability-heuristics/):

1. Visibility of system status. 2. Match between system and the real world. 3. User control and freedom
   (undo, exit). 4. Consistency and standards. 5. Error prevention. 6. Recognition rather than recall.
2. Flexibility and efficiency of use. 8. Aesthetic and minimalist design. 9. Help users recognise, diagnose
   and recover from errors. 10. Help and documentation.
   Heuristic evaluation finds many problems cheaply but misses some and reports false ones. Three to five
   evaluators find most issues ([Nielsen and Molich 1990](https://doi.org/10.1145/97243.97281)). It is
   inspection, not user evidence.

### Feedback and system status (A/C)

Feedback closes Norman's gulf of evaluation and is heuristic 1. Timing follows the response-time limits in
section 1. **Apply:** every action gets visible acknowledgement. Every background job shows its state.
Screen readers announce status
changes ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).

### Error prevention and recovery (C, with strong field support)

Norman splits errors into **slips** (right goal, wrong action) and **mistakes** (wrong goal)
([Norman 1983](https://doi.org/10.1145/358061.358079)). Constraints, good defaults and spacing
prevent slips. Clear models and previews prevent mistakes ([NN/g on slips](https://www.nngroup.com/articles/slips/)).
**Apply:** prefer **undo** to "Are you sure?" dialogs, which people learn to click through. Check fields inline,
after the field is left, not on each keystroke. Keep the user's input after an error. Say what went wrong and
how to fix it, in plain words.

## 5. Scanning, reading and scrolling

### F-pattern and other scan patterns (B)

Eye-tracking shows an F-shaped scan in three conditions: a wall of plain text, a user who wants speed, and
low interest ([NN/g, Pernice 2017](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)).
The F is a _failure mode_, not a goal. Other observed patterns:

- **Layer-cake**: headings only. This is the good one.
- **Spotted**: hunting for a number or a word.
- **Marking**: eyes stay still while the page moves. Common on mobile.
- **Bypassing**: skipping repeated first words in lists.
- **Commitment**: reading everything. Rare.

**Apply:** front-load headings and list items with the key word. Make headings visually distinct so the
layer-cake pattern is possible.

### Z-pattern (Folk)

The Z-pattern and the "Gutenberg diagram" come from print layout lore, not from eye-tracking studies of
interfaces. It is fine as a sketch for sparse landing pages (logo, nav, hero, action). Do not cite it as
research.

### The fold and scroll depth (B)

People do scroll, but attention falls off fast. A 2018 study had 120 users and 130,000+ fixations. **57%**
of viewing time was in the first screenful, **74%** in the first two, and **81%** in the first three
([NN/g, "Scrolling and Attention"](https://www.nngroup.com/articles/scrolling-and-attention/)). In 2010 the
first screen got 80%. **Apply:** the first screen must show what the page is and the main action. With a reason
to scroll at the top, content further down still gets read. Avoid "false floors": a full-bleed image or
a strong horizontal line that looks like the end of the page.

### Horizontal scroll, carousels and rails (B)

Horizontal scrolling on desktop has high interaction cost and weak information scent. Sideways content is
often ignored ([NN/g, "Horizontal Scrolling"](https://www.nngroup.com/articles/horizontal-scrolling/)).
NN/g's rules: never put essential content in a horizontal scroll. Keep a peek of the next item. Show how much
is left. Give visible, clickable controls, not hover-only arrows. Support keyboard. Users ignore and dislike
auto-advancing carousels ([NN/g, "Auto-forwarding carousels"](https://www.nngroup.com/articles/auto-forwarding/)).
Any auto-moving content over 5 s must be pausable ([WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)).
On mobile, swiping sideways is natural. A rail works for **browsable, same-kind** content.
The vertical axis picks the category and the horizontal axis browses within it, as in streaming apps
([NN/g, "Designing Effective Carousels"](https://www.nngroup.com/articles/designing-effective-carousels/)).
**Apply:** a rail is for "more of the same, optional". A list is for things the user must see or compare.

### Infinite scroll versus "Load more" (B)

Infinite scroll suits feeds with no end and no goal. It hurts goal-directed search. Users lose their place
and cannot reach the footer. They cannot judge the size of the set
([NN/g, "Infinite Scrolling Is Not for Every Website"](https://www.nngroup.com/articles/infinite-scrolling/)).
Baymard's large e-commerce testing found a "Load more" button with lazy loading worked better than either
pagination or infinite scroll for product lists, and infinite scroll was harmful for search results and on
mobile ([Baymard, via Smashing Magazine 2016](https://www.smashingmagazine.com/2016/03/pagination-infinite-scrolling-load-more-buttons/)).
**Apply:** search results and collections the user manages get "Load more" and a visible count. On return,
keep the scroll position.

### Information scent (A)

Users follow links like animals forage. They pick the path whose cues best predict the goal. They leave as
the scent weakens ([Pirolli and Card 1999](https://doi.org/10.1037/0033-295X.106.4.643),
[NN/g, "Information Scent"](https://www.nngroup.com/articles/information-scent/)). **Apply:** a label
says what is behind it. "Learn more" and icon-only buttons have no scent. Preview what a link leads
to (counts, thumbnails, the first line).

## 6. Emotion and attention

### Emotional design (C)

Norman names three levels ([_Emotional Design_, 2004](https://jnd.org/emotional-design-why-we-love-or-hate-everyday-things/)):

- **Visceral**: the instant look and feel.
- **Behavioural**: the pleasure of use, control and feedback.
- **Reflective**: meaning, self-image, memory, the story users tell later.

The behavioural layer is the
foundation. Visceral beauty cannot rescue a broken task, and reflective value is built from repeated good
behavioural moments and good peaks and ends (section 1).

### Calm technology (C)

Calm technology informs without demanding attention. It moves between the edge (periphery) and the centre
of attention as needed ([Weiser and Brown 1995, "Designing Calm Technology"](https://calmtech.com/papers/designing-calm-technology.html),
[Case, _Calm Technology_, 2015](https://calmtech.com/)). **Apply:** use the least intrusive channel that
works (badge before banner, banner before modal, modal only to block a harmful action). Notifications must
earn their interruption.

### Colour psychology and appetite (B for food colour, Folk for general claims)

General colour-emotion claims ("blue builds trust") are weakly supported and culture-dependent
([Elliot and Maier 2014](https://doi.org/10.1146/annurev-psych-010213-115035)). Food colour is better studied.
Colour strongly shapes expected taste and flavour ([Spence 2015](https://doi.org/10.1186/s13411-015-0031-3)).
The same dessert was rated about 10% sweeter on a white plate than on a black one
([Piqueras-Fiszman et al. 2012](https://doi.org/10.1016/j.foodqual.2011.08.009)). Images of food trigger
"visual hunger" ([Spence et al. 2016, "Eating with our eyes"](https://doi.org/10.1016/j.bandc.2015.08.006)).
The popular claim that blue suppresses appetite has little direct evidence. Treat it as folk.
**Apply:** in a food product, the **photograph is the hero**. Keep the UI chrome neutral and low-chroma so it
does not shift how the food looks. Warm, accurate colour in photos. Avoid heavy tinted overlays on food.
About 1 in 12 men and 1 in 200 women have a colour-vision deficiency
([NEI](https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness)), so
colour never carries meaning alone.

### Motion psychology (B)

Motion is perceived before almost anything else and draws attention whether wanted or not (common fate, and
the motion sensitivity of peripheral vision). Good motion explains change: where something came from and
went ([NN/g, "Animation for Attention and Comprehension"](https://www.nngroup.com/articles/animation-usability/)).
Typical UI durations are about 100 to 500 ms. Small changes near the short end, large spatial moves longer
([NN/g, "Executing UX Animations: Duration and Motion"](https://www.nngroup.com/articles/animation-duration/),
[Material motion](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)). Large motion and
parallax can trigger vestibular symptoms. Honour `prefers-reduced-motion`
([WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)). Never flash
more than three times a second ([WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)).

## 7. Readability and legibility

- **Legibility** is whether characters can be told apart (type face, size, contrast). **Readability** is how
  easily text can be read and understood (line length, spacing, wording).
- **Line length**: classic typography advises 45 to 75 characters, about 66 ideal
  ([Bringhurst, _The Elements of Typographic Style_](https://typographica.org/typography-books/the-elements-of-typographic-style/)).
  Research is mixed. Longer lines can be read faster. Medium lines (about 55 characters) gave the best
  comprehension ([Dyson and Haselgrove 2001](https://doi.org/10.1006/ijhc.2001.0458)). WCAG AAA asks for at most
  80 ([WCAG 1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)).
- **Size**: reading speed is flat above a "critical print size" and falls fast below it
  ([Legge and Bigelow 2011](https://doi.org/10.1167/11.5.8)). Platform defaults are a sound floor: iOS body
  text 17 pt ([Apple HIG, Typography](https://developer.apple.com/design/human-interface-guidelines/typography)),
  web body text 16 px. Support user scaling: iOS Dynamic Type, Android sp units, and 200% zoom without loss
  ([WCAG 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)) and reflow at 320 CSS px
  ([WCAG 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
- **Distance reading**: legibility depends on the _visual angle_ of the letters, not their point size. A
  phone on a kitchen counter is often two to three times further away than a phone in the hand. So text must
  be two to three times larger to look the same size. A "cook mode" must scale type up, not just keep the
  screen awake.
- **Spacing**: content must survive user overrides of line height 1.5, paragraph spacing 2×, letter spacing
  0.12em and word spacing 0.16em ([WCAG 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)).
- **Plain language** is a readability tool: short sentences, common words, active voice
  ([plainlanguage.gov](https://www.plainlanguage.gov/guidelines/)).

## 8. Accessibility: WCAG 2.2 and APCA

WCAG 2.2 ([W3C Recommendation](https://www.w3.org/TR/WCAG22/)) at level AA is the legal bar in most
markets. One example is the [European Accessibility Act](https://eur-lex.europa.eu/eli/dir/2019/882/oj),
in force from June 2025. The criteria that most often fail in visual design:

- **1.4.3 Contrast (Minimum)**: 4.5:1 for normal text, 3:1 for large text (18 pt, or 14 pt bold).
- **1.4.11 Non-text Contrast**: 3:1 for control boundaries, focus indicators and meaningful icons.
- **1.4.1 Use of Colour**: colour is never the only cue.
- **2.4.7 / 2.4.11 Focus Visible / Focus Not Obscured**: focus is visible and not hidden by sticky bars.
- **2.5.8 Target Size (Minimum)**, new in 2.2: at least 24×24 CSS px, or enough spacing that a 24 px circle
  on each target does not overlap another, with inline, equivalent, user-agent and essential exceptions
  ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). 2.5.5 (AAA)
  asks for 44×44.
- **2.5.7 Dragging Movements**: anything done by dragging has a single-pointer alternative.
- **3.3.7 Redundant Entry** and **3.3.8 Accessible Authentication**: do not make users re-type data or solve
  memory tests to log in.

**APCA** (the Accessible Perceptual Contrast Algorithm) models contrast by perceived lightness. It adjusts
for text size and weight. It handles dark mode and coloured text better than the WCAG 2 ratio
([APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)). Its guide levels:
**Lc 90** preferred for body text. **Lc 75** minimum for body columns (for example 18 px at weight 400).
**Lc 60** minimum for other readable text (24 px/400 or 16 px/700). **Lc 45** for large headings and fine
icons. **Lc 30** absolute minimum for placeholder and disabled text. **Lc 15** for dividers and focus
outlines, below which treat as invisible. **Status:** APCA was developed for WCAG 3. But WCAG 3 is a
Working Draft, and APCA is **not** a conformance requirement ([WCAG 3 draft](https://www.w3.org/TR/wcag-3.0/)).
**Apply:** pass WCAG 2.2 ratios for conformance, and use APCA as a second, perceptual test, especially for
dark mode, thin fonts and coloured text, where the 2.x ratio is known to mislead.

## 9. Touch targets, thumb zones and reach

- **Platform sizes:** Apple 44×44 pt minimum ([Apple HIG, Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
  Material 48×48 dp, about 9 mm ([Material, Accessibility](https://m3.material.io/foundations/designing/structure)).
  WCAG 2.5.8 is the legal floor, not the target.
- **Evidence:** for one-handed thumb use, errors and ratings stopped improving at about 9.2 mm (single
  taps) and 9.6 mm (repeated taps) ([Parhi, Karlson and Bederson 2006](https://doi.org/10.1145/1152215.1152260)).
  NN/g rounds this to 1×1 cm ([NN/g, "Touch Targets on Touchscreens"](https://www.nngroup.com/articles/touch-target-size/)).
- **How phones are held:** in 780 observed touch users, 49% used one hand, 36% cradled the phone, and 15%
  used two hands. Grips change every few seconds. Many one-handed users use the left hand
  ([Hoober 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).
  Hoober later withdrew his early reach diagrams and found taps are most accurate in the centre of the screen
  and least accurate at the edges and corners, so targets near edges need to be larger
  ([Hoober 2017, "Design for Fingers, Touch, and People"](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php)).
- **Thumb reach** is a measurable area that depends on phone size and grip
  ([Bergstrom-Lehtovirta and Oulasvirta 2014](https://doi.org/10.1145/2556288.2557354)). On tall phones the
  top corners are out of one-thumb reach.
- **Apply:** put the primary and frequent actions in the lower and middle part of the screen (bottom bar,
  bottom sheet, floating action). Put rare and destructive ones up top. Space adjacent targets at least
  8 dp apart. Do not port a desktop layout that places the main action top-right. In a kitchen, assume wet or
  floury hands and a phone flat on a counter: larger targets, no precise gestures, no long-press-only actions.

---

## Rules a top designer applies

Each rule is short on purpose. The source is in the section named.

1. **Start from the task, not the screen.** Name the user's goal and context (hand, distance, light, mess)
   before any layout. (§4, §9)
2. **Respond in 100 ms, explain after 1 s, offer progress and cancel after 10 s.** (§1 Doherty, §4 feedback)
3. **One primary action per view, visibly distinct, in thumb reach.** (§1 von Restorff, Fitts, §9)
4. **Group with space first.** Gap between groups at least about twice the gap within. Then region, then
   lines. (§2)
5. **Every tappable thing has a signifier that does not need hover.** (§4 Norman)
6. **Use the platform's conventions on each platform.** Translate the job, not the layout, from web to
   mobile. (§1 Jakob, §4)
7. **Put information where it is used.** Do not make users hold more than about four things in mind. (§3)
8. **Show, do not make them remember.** Recents, suggestions, visible options. (§3)
9. **Rank and default, do not just cut.** Large sets are fine with sort, filter and a good default. The
   default serves the user. (§3 choice overload, defaults)
10. **Disclose in at most two levels, with a clearly labelled door that never moves.** (§3)
11. **Prevent slips with constraints and spacing. Recover mistakes with undo, not "Are you sure?" dialogs.** Keep the
    user's input on error and say how to fix it. (§4)
12. **Accept every reasonable way to write a value. Store one.** Be liberal in parsing, strict in
    authorising. (§1 Postel)
13. **Carry complexity in the system, not the user.** (§1 Tesler)
14. **The first screen says what this is and what to do.** Give a reason to scroll. Avoid false floors.
    (§5 fold)
15. **Lists for what must be seen or compared. Rails for optional, same-kind browsing.** Rails show a peek,
    have visible controls, and never auto-advance without pause. (§5)
16. **"Load more" with a count for goal-directed lists. Infinite scroll only for open-ended feeds.** Keep
    scroll position on return. (§5)
17. **Labels carry scent.** No "Learn more", no unlabelled icon for a key action. Front-load the key word.
    (§5)
18. **Design the worst moment and the last moment first.** (§1 peak-end)
19. **Show real progress, counting what is already done.** Never fake it, never weaponise unfinished tasks.
    (§1 goal-gradient, Zeigarnik)
20. **Interrupt as little as possible.** Badge before banner before modal. (§6 calm technology)
21. **In a food product, the photo is the hero and the chrome stays neutral.** Do not tint food. Do not trust
    "colour X means Y" claims without evidence. (§6)
22. **Motion explains change, 100–500 ms, and respects reduced-motion.** No decorative motion near content
    people are reading. (§6)
23. **Body text at platform size or larger, 45–75 characters per line, scalable to 200%, reflows at 320 px.**
    Scale up for distance reading. (§7)
24. **Pass WCAG 2.2 AA, then check APCA.** 4.5:1 text, 3:1 controls and focus, colour never alone, Lc 75+
    for body text in practice. (§8)
25. **Targets 44 pt / 48 dp with 8 dp gaps. Larger at screen edges. Never below 24 CSS px.** Single-pointer
    alternatives for every drag. (§8, §9)
26. **Know the evidence grade of every claim you cite.** Label an untested claim "heuristic judgement,
    untested". Inspection is not user evidence. (§4 heuristics)
27. **Beauty earns patience but hides problems.** Judge a design by what users do in testing, not what they
    say about how it looks. (§1 aesthetic-usability)
28. **Refuse deceptive patterns.** A default, a nag or a hidden cost that works against the user is not a
    trade-off to weigh. (§3 defaults)

## Sources

All sources are linked inline at the point of use. The main primary sources, grouped:

- **Motor and decision laws:** Fitts 1954, MacKenzie 1992, Hick 1952, Hyman 1953, Parhi, Karlson and Bederson 2006.
  Bergstrom-Lehtovirta and Oulasvirta 2014, Hoober 2013 and 2017.
- **Memory and cognition:** Miller 1956, Cowan 2001, Sweller 1988, Sweller et al. 2019, Ebbinghaus 1885, Murdock 1962.
  Von Restorff 1933, Zeigarnik 1927, Ghibellini and Meier 2023, Shepard 1967.
- **Judgement and choice:** Kahneman et al. 1993, Redelmeier and Kahneman 1996, Hull 1932, Kivetz, Urminsky and Zheng
  2006, Iyengar and Lepper 2000, Scheibehenne et al. 2010, Chernev et al. 2015, Johnson and Goldstein 2003.
  Jachimowicz et al. 2019.
- **Perception and aesthetics:** Wertheimer 1923, Palmer 1992, Palmer and Rock 1994, Wagemans et al. 2012, Kurosu and
  Kashimura 1995, Tractinsky et al. 2000, Lindgaard et al. 2006, Tuch et al. 2012.
- **Interaction design:** Gibson 1979, Norman 1983, 1988/2013, 2004, 2008, Nielsen 1994/2020, 2000, 2006, Nielsen and
  Molich 1990, Pirolli and Card 1999, Weiser and Brown 1995, Case 2015, Miller 1968, Card et al. 1991, Doherty and
  Thadani 1982, RFC 761, 1122, 9413.
- **Practitioner research:** Nielsen Norman Group (scrolling and attention, F-pattern, horizontal scrolling, carousels,
  infinite scrolling, information scent, touch targets, animation, flat UI, mental models, slips), Baymard Institute
  (load more vs pagination vs infinite scroll).
- **Colour and food:** Elliot and Maier 2014, Spence 2015, Piqueras-Fiszman et al. 2012, Spence et al. 2016, NEI.
- **Typography:** Bringhurst, Dyson and Haselgrove 2001, Legge and Bigelow 2011, Apple HIG, plainlanguage.gov.
- **Standards and law:** WCAG 2.2 (W3C) and its Understanding documents, WCAG 3 Working Draft, APCA documentation.
  Apple HIG, Material Design 3, EU Digital Services Act Art. 25, European Accessibility Act, FTC 2022 dark-patterns
  report.
