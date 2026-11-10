# How the best product design teams work, and what sets their principal designers apart

Research input for the uiRefreshWorkshop4 design persona. Date: 2026-10-20.

## How to read this report

Each claim carries a source tag, because a persona will treat what it reads as fact.

- **[P]**: primary source, read directly. Quotes are verbatim.
- **[S]**: secondary source. A primary page could not be read (blocked or not found), so the claim comes from a mirror, press coverage or a summary. Treat these as "reported", not quoted.

Section 10 lists claims that were checked and not confirmed.

---

## 1. Apple

### 1.1 The stated principles, then and now

Apple's current framing comes with Liquid Glass. Interfaces should "establish hierarchy, create harmony, and maintain consistency across devices and platforms" [P: Apple, _Liquid Glass_ overview]. Its design-principles list is concrete:

- "Define a layout and choose a navigation structure that puts the most important content in focus."
- "Be judicious with your use of color in controls and navigation so they stay legible and allow your content to infuse them and shine through."
- "Adopt standard iconography and predictable action placement across platforms." [P: same]

The earlier framing, from the iOS 7 era (2013), was **Clarity, Deference, Depth**. Deference meant that the UI supports the content rather than competing with it. That guidance warned that bezels, gradients and drop shadows "sometimes lead to heavier UI elements that can overpower or compete with the content" [S: unofficial copies of the iOS 7 HIG, such as the EVL/UIC mirror]. Liquid Glass is the same idea in a new material. Controls sit in their own layer and give way to content, and tab bars shrink as you scroll. Alan Dye called it "our broadest software design update ever" [P: Apple Newsroom, June 2025].

### 1.2 Liquid Glass: restraint written down as rules

What Apple says about its own new material is mostly about **when not to use it**. This is the clearest public example of a top team writing restraint into its guidance:

- "Don't use Liquid Glass in the content layer." Using it there "can result in unnecessary complexity and a confusing visual hierarchy." [P: HIG _Materials_]
- "Use Liquid Glass effects sparingly ... Limit these effects to the most important functional elements in your app." [P: HIG _Materials_]
- "Always avoid glass on glass. Stacking Liquid Glass elements on top of each other can quickly make the interface feel cluttered and confusing." For elements on top of glass, use "fills, transparency, and vibrancy" instead. [P: WWDC25 session 219, _Meet Liquid Glass_]
- "Tinting should only be used to bring emphasis to primary elements and actions ... When every element is tinted, nothing stands out." [P: WWDC25/219]
- Regular and Clear variants "should never be mixed." Use Clear only when three things are all true: the element sits over media-rich content, a dimming layer will not hurt that content, and the content on top is bold and bright. [P: WWDC25/219] If the content underneath is bright, "consider adding a dark dimming layer of 35% opacity." [P: HIG _Materials_]
- "Both the visuals AND motion of Liquid Glass were designed as one." The resting state stays "visually quiet" and "comes to life on touch." [P: WWDC25/219]

**Published criticism.** Liquid Glass has drawn criticism for legibility and hierarchy. One critic argues that "harmony and beauty override hierarchy at every turn" [S: kirby.pika.page, _Quibble: Hierarchical Chaos_]. Another critique calls the concentricity guidance poorly worded [S: search summary of critiques, including morrick.me]. Apple's own guidance also points to settings that "reduce transparency or increase contrast" [P: HIG _Materials_]. The lesson is not "copy glass". **A signature material is a liability unless its legibility fallbacks are designed as carefully as its hero state.**

### 1.3 Process (reported)

Apple does not publish its internal process. The most cited account is a 2008 BusinessWeek blog summary of Michael Lopp's SXSW talk. All three items rest on that one reporter's notes [S: BusinessWeek via Auburn mirror and Konigi]:

- **Pixel-perfect mockups.** Designers make an exact image of every screen, with no lorem ipsum, to remove ambiguity before engineering starts.
- **10 to 3 to 1.** Ten genuinely different mockups of a new feature, then three, then one. Lopp contrasted this with the common habit of making seven options so that three look good.
- **Paired design meetings.** Each week there is one brainstorm meeting where constraints are set aside, and one production meeting that works out how the idea will actually ship.

### 1.4 Craft rules Apple publishes

**Interaction principles** [P: WWDC17 session 802, _Essential Design Principles_]:

- Every screen should answer "where am I? Where can I go? What will I find when I get there? What's nearby? And how do I get out?"
- "Every action taken in your app should provide some form of confirmation feedback."
- "Trying to get people to change their mental model of how your app works is risky."
- Progressive disclosure has a cost: it "can bury information or functionality."
- Before a big change to an existing app, "you have to be 100 percent positive that those changes will lead to clear wins for the people who currently use your app."
- On judgment over rules: it is "possible to have too much of a good thing ... exercise judgment and discretion."

**Motion** [P: WWDC18 session 803, _Designing Fluid Interfaces_, HIG _Motion_]: "Everything needs to respond instantly." Motion must be redirectable mid-gesture, and paths must be symmetric. Springs are described by damping and response, not duration: start at "100% damping, or no overshoot", and use about 80% only when the gesture carries momentum. "Don't add motion for the sake of adding motion."

**Colour and type** [P: HIG _Color_, HIG _Typography_]: stated as rules 17 to 24 at the end.

---

## 2. Netflix

### 2.1 The design problem is decision time

Netflix frames its UI around one fact: a member gives up quickly. The 2015 paper by Gomez-Uribe and Hunt reports that a typical member loses interest after about **60 to 90 seconds** of searching, having looked at 10 to 20 titles on one or two screens. After that, "the risk of the user abandoning our service increases substantially" [S: reported by NBC News and TechTimes, citing ACM TMIS, DOI 10.1145/2843948]. The brief: **put the right thing in front of this person within a glance.**

### 2.2 Artwork is the product surface

The fetch of Netflix's own blog posts failed (HTTP 403). The points below are therefore reported [S: _Selecting the best artwork for videos through A/B testing_, 2016, via a mirror. _Artwork Personalization_, 2017, via press summaries]:

- Members "look at the artwork first and then decide whether to look at additional details."
- Artwork was judged on take rate (plays per impression, excluding very short plays), total play duration, the share of short plays, and the share of content viewed. A fast click followed by a quick abandon counts against the image.
- One stated goal was to "ensure that we don't misrepresent titles."
- Images with "expressive facial emotion that conveys the tone of the title" did well, as did "recognizable or polarizing characters."
- Personalisation uses contextual bandits: the member is the context. The often-quoted example is _Good Will Hunting_: a romance fan sees the couple, a comedy fan sees Robin Williams.

### 2.3 Experimentation as culture

Netflix product designers have described treating every idea as an experiment that reaches a small group first. Each member sits in exactly one cell of a given test [S: InVision, _How Netflix does A/B testing_, a talk by product designers Anna Blaylock and Navin Iyengar]. The 2025 TV homepage, which CPO Eunice Kim called "simpler, more intuitive", rolled out gradually [S: Good Morning America coverage].

**What to take from Netflix.** Define the success metric before the design, and include a metric that punishes a misleading design (short plays). Let the content, not the chrome, carry the emotion. Treat evidence as the right tool for high-traffic surfaces where small changes add up.

---

## 3. Google Material 3 Expressive

The best public evidence on expression versus usability [P: design.google, _Expressive design: Google's UX research_]:

- **Scale.** 46 studies, "hundreds of designs, and more than 18,000 participants." Methods ranged from eye tracking to single-component tests.
- **Gains.** Key elements were found up to four times faster. Users aged 45 and over found them as fast as younger users. Larger buttons and high-contrast containment helped people with motor and vision differences. Some tap-target and contrast standards were **deliberately exceeded**.
- **Levers.** Five: colour, shape, size, motion, containment. Examples: a secondary colour plus a bigger button for the key action. The key action placed where the hand already is (near the keyboard). High-contrast containers that group related elements.
- **Limits, which matter as much as the gains:**
    - "No amount of expressive design will beat basic functionality."
    - A playlist that replaced the vertical song list with loose album art felt modern, but its usability scores fell.
    - Removing text labels from email actions hurt usability.
    - Banking-style apps need established patterns.
    - A strong minority preferred calmer designs.

**Takeaway.** Expression works when it **amplifies hierarchy**: the key action becomes bigger, more contrasting and better placed. It fails when it **replaces structure or labels**.

---

## 4. Linear

Linear is the clearest public voice for taste over process. All points are primary.

- **Why quality is rare** [P: _Why is quality so rare?_]:
    - "Optimizing for a process replaced craft."
    - "Experiments and A/B testing replaced judgment."
    - "3-5 people with good taste make better decisions than large committees."
    - Decisions are tested with "does this improve quality?", not only "will this ship faster?"
    - Work trials look for "evidence of taste and attention to detail."
    - One team owns a project end to end, with no assembly-line handoffs. Incomplete work is tested internally, never shipped.
    - Zero-bugs policy: bugs are fixed within 7 days.
- **Redesign case study** [P: _How we redesigned the Linear UI_]:
    - Saarinen explored alone first and produced "hundreds of screens" before narrowing to a few directions.
    - The goal: "reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements."
    - Theme setup went from "98 specific variables for each theme" to **three** inputs: base colour, accent colour and contrast. These are generated in **LCH**, which is perceptually uniform.
    - Navigation was taken out of scope once its problems proved "no longer solely a design issue." This is editing the scope, not only the pixels.
    - "A redesign should not completely disassemble the product to its atomic parts."
    - Alignment work on a "tiny surface" is something users "feel after a few minutes."
    - About six weeks in five milestones. Staff tested it behind a feature flag with a feedback channel, then it rolled out to a percentage of workspaces each day.
- **Exploration is not optional** [P: _Design is more than code_]:
    - Do not "devalue conceptual and divergent thinking just because new tools make execution easier."
    - Without chosen intent, a team ends up "iterating toward a direction, but not one that was chosen intentionally."
    - Design means "finding the right problem, the right intent, the right vision," in whatever medium.

---

## 5. Stripe

- **Colour as a system, not a swatch** [P: Stripe, _Designing accessible color systems_]:
    - Darkening or lightening brand colours in HSL made them muddy, and contrast became unpredictable across hues.
    - Stripe moved to CIELAB, where lightness is "designed to be perceptually uniform."
    - The result is a pairing rule anyone can apply: "Any two colors are guaranteed to have sufficient contrast for small text if they are at least five levels apart." Four levels apart works for icons and large text.
- **Quality as a business lever.** Katie Dill, Stripe's Head of Design, has discussed Stripe's focus on quality and growth, "operationalizing quality", a set of "15 Essential Journeys", and a "PQR quality review" [S: episode chapter titles on Lenny's Podcast, Oct 2023]. Only the titles are confirmed.
- **Brand craft** [S: third-party brand analyses]: a signature mesh gradient rendered in WebGL, one typeface (Söhne), and "no flourish, no noise" everywhere else. One expressive signature, set against quiet type and layout.

---

## 6. Airbnb

- **Design Language System (2016).** Built because a growing team shipping across platforms was producing drift. The four principles are Unified ("each piece is part of a greater whole"), Universal, Iconic, and Conversational (motion that helps the product speak). The app favours text over ambiguous icons because it ships in many languages [S: summaries of Karri Saarinen's _Building a Visual Language_, the original URL now redirects].
- **Snow White storyboarding (2012).** Brian Chesky borrowed Disney's storyboard method. The team listed the emotional moments of the whole host and guest journey, then had an animator illustrate them frame by frame. The **whole story** is designed before any screen [S: Fast Company as cited by Inc. and others].
- **2025 direction.** Chesky said flat design "stripped the soul" out of products, and the app moved back toward depth [S: Octet Design]. The craft test: depth must carry **meaning** (layering, hierarchy), not decoration.

---

## 7. Teenage Engineering and Nothing: original work through constraint

**Teenage Engineering** [P: SFMOMA interview with Jesper Kouthoofd]:

- "I set up restrictions when I design."
- "I stick to rules and try to understand them, because then I can become free again."
- "I always work with simple geometric shapes." He still sketches everything in 2D first.
- The studio rule is "stay curious, stay naïve, and try new things."

Reported elsewhere [S: ThoughtEconomics, search excerpt only]: Kouthoofd avoids design magazines and Pinterest, on the grounds that people who read the same things make the same work. The studio also holds no presentations, so that ideas win rather than presenters.

**Nothing** [P: Dezeen interview with Adam Bates, 2024]:

- "data is going to lead us to the same place as everyone else."
- "There's a bit of trusting our gut instinct of what excites us."
- "challenge everything, don't take anything for granted."
- The language is described as "driven by processes, materials and technology", not a rigid document, so it grows product by product while staying recognisable [S: Domus, 2026].
- Carl Pei on copying the leader: if you copy Apple, your design is easy to date to that period [S: Design Week].

**Takeaway.** Originality here comes from **self-imposed constraints and private inputs**, not from adding more. Simple geometry, one material idea, one signature behaviour (the Glyph lights).

---

## 8. The central tension: judgment or evidence

Linear, Nothing and Teenage Engineering say data leads to sameness. Netflix and Google rely on evidence, and Google's evidence shows expressive ideas failing usability. Each camp is right about different decisions:

| Decision                                                                   | Best tool                                                 | Why                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| What problem to solve, which concept, the signature idea                   | Judgment from a small group with taste                    | Tests cannot produce a new concept. They pick among what you already made.  |
| Legibility, contrast, tap reach, label versus icon, finding the key action | Evidence (heuristics, then testing)                       | Google's playlist and label results show that taste alone gets these wrong. |
| High-traffic choices with real metrics (artwork, homepage ranking)         | Experiment, with a metric that punishes misleading design | Small effects add up at scale. Netflix tracks short plays, not only clicks. |
| Change to an existing mental model                                         | A high bar of proof                                       | "100 percent positive ... clear wins" [Apple WWDC17].                       |

**Rule: never test your way to originality, and never rely on taste alone for legibility.**

---

## 9. What separates principal and senior staff designers from good designers

The GitLab design ladder states the differences openly [P: GitLab Handbook, _Product Designer_ job family]:

- **Senior:** "Lead with vision for your area." "Advocate for quality with data by establishing clear success criteria."
- **Staff:**
    - "Drive product strategy in your area by defining problems worth solving."
    - "identify systemic gaps spanning multiple teams."
    - "set quality standards, provide constructive critiques that elevate others' work."
- **Principal:**
    - "Reduce scope, complexity, and ambiguity of the most challenging initiatives."
    - "act as connective tissue at company level."
    - "create frameworks that embed design quality throughout organization."
    - "Lead research that challenges conventional thinking."

Combined with the team practices above, the gap shows up as behaviours:

1. **They frame before they draw.** A good designer solves the stated brief. A principal tests whether it is the right brief, and cuts scope when part of the problem is not a design problem, as Linear did with navigation.
2. **They diverge for real, then edit hard.** Many genuinely different directions (Apple's reported 10, Linear's "hundreds of screens"), then a ruthless cut. A good designer shows three variants of one idea. A principal shows three different ideas and names the one they bet on, and why.
3. **They write restraint as rules.** Apple's Liquid Glass guidance is mostly prohibitions. A principal says where the signature element is _not_ allowed.
4. **They build systems that make good choices automatic.** Stripe's "five levels apart" and Linear's 3-input themes turn taste into a rule a junior designer cannot get wrong. That is "frameworks that embed design quality."
5. **They design every state and the whole journey.** Airbnb's storyboards, Stripe's "essential journeys", Apple's "every action ... confirmation feedback". The happy-path screen is the smallest part of the work.
6. **They know which tool fits each decision.** Judgment for concept, evidence for legibility and reach (Section 8). They do not hide behind data, and they do not wave it away.
7. **Their critique raises the work.** They name the specific failure and the principle behind it ("two tints compete, so nothing reads as primary"), not a preference.
8. **They sweat surfaces users only feel.** Linear's sidebar alignment, Apple's symmetric motion paths, interruptible springs. These are invisible in a screenshot and obvious after five minutes of use.

---

## 10. What this report does not claim

- No Material 3 Expressive spring values. The only figures found came from a third-party Flutter package.
- No content for Stripe's "PQR" review or "15 Essential Journeys", and no Stripe checkout revenue figure. Only chapter titles and an AI summary were found.
- No Linear "Quality Wednesday" or "feature roast" rituals. Not confirmed.

---

## Rules a top designer applies

Each rule is a check a reviewer can fail. The source is in brackets.

### Framing and process

1. **Write the problem, the user and the success measure before drawing.** Include one measure that punishes a misleading design, as Netflix does with short plays. [Netflix, GitLab Staff]
2. **Cut what is not a design problem.** Some parts of a brief depend on unsolved product or engineering questions. Take those parts out of scope, in writing. [Linear redesign]
3. **Diverge for real.** Produce at least ten distinct directions for a new surface, where distinct means a different structure or concept, not a colour swap. Narrow to three. Develop those. Commit to one. [Apple via Lopp (reported), Linear]
4. **Never present filler options.** Show only options you are ready to defend. Name your pick and the reason. [Apple via Lopp, reported]
5. **Use real content, never lorem ipsum.** Use the longest real string, the real image and the real empty state. [Apple via Lopp, reported]
6. **Storyboard the journey before the screens.** List the emotional moments from first contact to finish, then design the frames between them. [Airbnb Snow White]
7. **Keep the decision group small.** Three to five people with taste decide. A committee does not. [Linear]
8. **Do not dismantle what works.** A refresh keeps the product's working structure and mental model unless there is strong proof of a clear win for current users. [Linear, Apple WWDC17]
9. **Ship internally first, then in steps.** Feature flag, staff use with one feedback channel, then a percentage rollout. [Linear, Netflix]

### Restraint and editing

10. **One signature, everywhere else quiet.** Pick one expressive idea (a material, a gradient, a light behaviour). Write where it is allowed and where it is banned. [Apple Liquid Glass, Stripe, Nothing]
11. **The signature layer never enters the content layer, and never stacks on itself.** No glass on glass. Put fills and vibrancy on top, not a second layer of the material. [HIG Materials, WWDC25/219]
12. **Tint or colour only the primary action.** If everything is emphasised, nothing is. [WWDC25/219, HIG Color]
13. **Every remaining element must earn its place.** For each ornament (shadow, border, gradient, animation), state what it communicates. If the answer is "nothing", delete it. [Apple deference, HIG Motion]
14. **Expression must amplify hierarchy, never replace structure.** Make the key action bigger, higher-contrast and better placed. Do not drop labels, lists or familiar patterns to look new. [Google M3 Expressive research]
15. **Set your own constraints at the start.** Limit shapes, typefaces, colours or materials on purpose, and write the limits down. [Teenage Engineering]
16. **Do not borrow the leader's look.** If a design reads as "the current Apple" or "the current Linear", it will date to that period. Find the idea in this product's own material, which for a cooking app means food, hands and kitchens. [Nothing, Teenage Engineering]

### Type

17. **One typeface family, at most two.** Build hierarchy from size, weight and colour, not new faces. [HIG Typography]
18. **Body text at 17 pt (or the platform equivalent), nothing below 11 pt, no Ultralight, Thin or Light weights at text sizes.** [HIG Typography]
19. **The layout survives the largest accessibility text size.** Check it, do not assume it. [HIG Typography]

### Colour

20. **Build the palette in a perceptual space (LCH or Lab), not HSL.** [Stripe, Linear]
21. **Encode contrast in the scale.** Text pairs are at least five levels apart and icon or large-text pairs at least four, so correct pairings are automatic. [Stripe]
22. **Generate themes from few inputs.** A base colour, an accent and a contrast level, not dozens of hand-tuned variables. [Linear]
23. **One colour means one thing.** The interactive colour is never used on plain text. Colour never carries meaning alone; pair it with a label or a shape. [HIG Color]
24. **Every colour is checked in light, dark and increased-contrast modes.** Over bright media, put a dim (around 35%) behind translucent controls. [HIG Color, HIG Materials]

### Motion

25. **Response is instant.** No added timers before feedback. [WWDC18/803]
26. **Every animation can be interrupted and redirected.** The user never waits for one to finish. [WWDC18/803, HIG Motion]
27. **Springs, not durations.** Default to no overshoot (100% damping). Allow a little (about 80%) only when the user's gesture carries momentum. [WWDC18/803]
28. **Spatial consistency.** What leaves the screen comes back the same way. A thrown object lands where its momentum points. [WWDC18/803]
29. **No motion on frequent actions, and none that carries meaning alone.** Respect Reduce Motion. [HIG Motion]

### Detail and states

30. **Every screen answers: where am I, where can I go, how do I get out.** [WWDC17/802]
31. **Every action gets confirmation feedback.** Every state (empty, loading, error, offline, success) is designed, with real copy. [WWDC17/802, Airbnb journeys]
32. **Put the key action where the hand already is.** [Google M3 Expressive research]
33. **Align the small surfaces.** Sidebar, tab and header edges line up to the same grid. A screenshot hides misalignment. A user feels it within minutes. [Linear redesign]
34. **Use text labels when an icon has two possible readings.** Icon-only actions hurt usability in Google's tests, and labels translate. [Google M3 Expressive research, Airbnb DLS]

### Evidence and critique

35. **Judgment for the concept, evidence for legibility and reach.** Do not A/B test toward a new idea. Do not trust taste alone on contrast, tap size or comprehension. [Linear, Nothing, Google, Netflix]
36. **Critique names the failure and the principle.** For example: "two tinted controls compete, so the primary action is unclear (rule 12)". Never just "I don't like it". [GitLab Staff, WWDC25/219]
37. **Quality is a gate, not a phase.** Ask "does this improve quality?" at every decision. Fix shipped defects within a week. [Linear]

---

## Sources

**Apple**

- Apple Developer, _Liquid Glass_ technology overview. https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Apple HIG, _Materials_. https://developer.apple.com/design/human-interface-guidelines/materials
- Apple HIG, _Motion_. https://developer.apple.com/design/human-interface-guidelines/motion
- Apple HIG, _Color_. https://developer.apple.com/design/human-interface-guidelines/color
- Apple HIG, _Typography_. https://developer.apple.com/design/human-interface-guidelines/typography
- Apple Newsroom, _Apple introduces a delightful and elegant new software design_ (June 2025). https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- WWDC25 session 219, _Meet Liquid Glass_. https://developer.apple.com/videos/play/wwdc2025/219/
- WWDC17 session 802, _Essential Design Principles_. https://developer.apple.com/videos/play/wwdc2017/802/
- WWDC18 session 803, _Designing Fluid Interfaces_. https://developer.apple.com/videos/play/wwdc2018/803/
- iOS 7-era HIG (Clarity, Deference, Depth), unofficial copy. https://www.evl.uic.edu/datsoupi/420_14/docs/MobileHIG.pdf
- Liquid Glass critiques: https://kirby.pika.page/posts/quibble-hierarchical-chaos and https://morrick.me/archives/10068
- Lopp / BusinessWeek account of Apple's design process (secondary): https://eng.auburn.edu/~troppel/Apple-design-process.htm and https://mac.konigi.com/blog/apples-design-process

**Netflix**

- _Selecting the best artwork for videos through A/B testing_ (original, not readable: 403). https://netflixtechblog.com/selecting-the-best-artwork-for-videos-through-a-b-testing-f6155c4595f6 Read via mirror: https://international.binus.ac.id/graphic-design/2021/07/25/selecting-the-best-artwork-for-videos-through-a-b-testing/
- _Artwork Personalization at Netflix_ (original, not readable: 403). https://netflixtechblog.com/artwork-personalization-c589f074ad76 Read via summaries such as https://www.dezeen.com/2017/12/20/netflix-targets-film-artwork-depending-users-viewing-habits-design-technology/
- Gomez-Uribe and Hunt, _The Netflix Recommender System_, ACM TMIS 2015, DOI 10.1145/2843948, as reported by https://www.nbcnews.com/business/business-news/netflix-knows-how-long-you-ll-search-they-lose-you-n521766 and https://www.techtimes.com/articles/136332/20160224/netflix-finds-takes-long-before-users-give-up-browsing.htm
- InVision, _How Netflix does A/B testing_. https://invisionapp.com/inside-design/how-netflix-does-ab-testing
- 2025 TV homepage: https://www.goodmorningamerica.com/culture/story/netflix-unveils-new-tv-experience-what-to-know-about-the-fresh-design-121555744 and https://www.tomsguide.com/entertainment/netflix/netflix-is-making-a-massive-change-to-its-homepage-for-the-first-time-in-years

**Google**

- Google Design, _Expressive design: Google's UX research_. https://design.google/library/expressive-material-design-google-research

**Linear**

- _How we redesigned the Linear UI_. https://linear.app/now/how-we-redesigned-the-linear-ui
- _Why is quality so rare?_ https://linear.app/now/why-is-quality-so-rare
- _Design is more than code_. https://linear.app/now/design-is-more-than-code

**Stripe**

- _Designing accessible color systems_. https://stripe.com/blog/accessible-color-systems
- Lenny's Podcast, _Building beautiful products with Katie Dill_ (chapter titles only). https://www.lennysnewsletter.com/p/building-beautiful-products-with
- Third-party brand analysis (secondary). https://madegooddesigns.com/stripe-brand-guidelines/

**Airbnb**

- Summaries of _Building a Visual Language_ (original redirects): https://www.designprinciplesftw.com/collections/airbnbs-design-principles and https://www.superdesign.dev/blog/airbnb-design-system
- Snow White storyboarding: https://inc.com/yazin-akkawi/the-surprising-technique-airbnb-uses-to-better-sell-an-experience.html
- 2025 redesign coverage: https://octet.design/journal/airbnb-ceo-brian-chesky-build-everything-app

**Teenage Engineering and Nothing**

- SFMOMA, _Stay Curious, Stay Naïve: an interview with Jesper Kouthoofd_. https://www.sfmoma.org/read/stay-curious-stay-naive-an-interview-with-teenage-engineering-jesper-kouthoofd/
- ThoughtEconomics, Jesper Kouthoofd (search excerpt only). https://thoughteconomics.com/jesper-kouthoofd/
- Dezeen, interview with Nothing design director Adam Bates (2024). https://www.dezeen.com/2024/02/20/nothing-tech-smartphone-design-adam-bates-interview/
- Domus (2026). https://www.domusweb.it/en/news/2026/03/05/nothing-phone-4a-headphone-a-design-tech-carl-pei.html
- Design Week, _How Nothing is hoping to build an ecosystem_. https://www.designweek.co.uk/issues/1-7-august-2022/nothing-in-house-team/

**Career levels**

- GitLab Handbook, _Product Designer_ job family. https://handbook.gitlab.com/job-families/product/product-designer
