# Domain research: cooking-app UX and the path of visual design, 2015 to 2026

Prepared 2026-10-20 as input to the designer persona for UI Refresh Workshop 4.

## How to read this report

Every claim carries an evidence grade. The grades are [study], [vendor], [review], [student], [anecdote] and [derived]. A note marks studies read from the abstract only. [vendor] is the maker's own claim and proves no effect. [derived] is my own calculation, with the steps shown. Three more tags appear. [secondary] is a summary of a primary source I did not read. [news] is press coverage. [commentary] is an essay or blog view.

The evidence on cooking UX is thin. I found no large field study of recipe-app use. Treat the kitchen findings as strong hypotheses that agree with each other, not as settled measurements.

---

## Part 1. How people actually use recipe apps

### 1.1 Two jobs, two postures: planning and cooking

Recipe apps serve two jobs, and the two jobs want opposite interfaces.

- **Planning**: choosing what to cook, saving, organising, and building a meal plan and a shopping list. The person sits or moves, holds the phone at 30 to 40 cm, and has both hands free. Density, search, filters and comparison help here.
- **Cooking**: following one recipe, or several, at the counter. The device sits propped 50 to 90 cm away. Hands are wet, floury or greasy. Attention is mostly on the food, and the screen gets glances. Density hurts here.

The evidence fits this split. In an LLM cooking-assistant study, people watched videos before cooking and used voice during it [study, arXiv 2310.05853]. In a 20-person AR study, tablet users "frequently shifted attention between the screen and their cooking" [study, small sample, arXiv 2412.00627]. Student work adds that messy hands stop touch use [student, InstaCook] and that a phone cannot show many steps at once [student, Stanford CS147 Simmr].

Design consequence: these are two modes, not one screen with a big-text toggle. The planning surfaces can be rich. The cooking surface must survive a glance from arm's length with dirty hands.

### 1.2 The kitchen context, constraint by constraint

**Hands**. Wet touch is unreliable at the hardware level. Water reads as touches and wet fingers create "ghost" signals, so controllers need special thresholds [vendor, patents US9921743B2 and US10754438B2]. People then tap with a knuckle or an elbow, which is less precise than a fingertip.

An ASSETS 2024 study of 20 visually impaired cooks found that recipe readers impose "the heavy burden of hand-washing" [study, abstract only, arXiv 2407.19065]. The cost applies to every cook. Each touch can cost a hand-wash, so the number of touches is the metric to cut.

**Distance and glancing**. A propped device is read at about 50 to 90 cm in short glances. No cooking legibility standard exists. The nearest anchor is the office standard ISO 9241-303. Secondary sources give its character height as 20 to 22 arcminutes, with 16 as a minimum [secondary, komnet.nrw.de, W3C css-fonts thread, arXiv 2312.12579]. Section 1.3 derives the kitchen case.

**Screen sleep**. Auto-lock in the middle of a step is the most-cited small failure, and a screen that stays awake is the most-valued fix. Betty Crocker users valued this feature most in its retired apps. After the web Wake Lock API went in, Google reports purchase-intent indicators about 300% higher among wake-lock users [vendor case study, web.dev].

The number is self-reported, and cook-mode users are already engaged, but the direction is clear. The API needs a user gesture to start [secondary, bootstrapped.ventures]. Paprika, NYT Cooking and Tasty all keep the screen on [vendor listings, fireart.studio].

**Timers and parallel work**. Real cooking runs several things at once: the pasta water, the sauce and the oven. The leading apps find durations in the recipe text and turn them into tappable timers.

- Paprika: "cook times are automatically detected in your directions" [vendor].
- Crouton: timers start from the step, and a floating "heads up display" keeps them visible [vendor]. A competitor says they also show on the Lock Screen, Apple Watch and Vision Pro [vendor, competitor's claim, recipesage.com].
- Pestle: green times start timers, and you can run unlimited timers at once [review, MacStories Pestle 1.2].
- Mela: timers in cook mode with Live Activities, and cook mode can hold several recipes [vendor].

A timer that stops in the background or on the lock screen is a defect. It is not a missing feature.

**Interruptions**. A child, the door or a pot boiling over interrupts cooking all the time. The interface must return the cook to the same place with nothing to remember: the step marked, ingredients crossed off, timers running. Paprika "highlights your current step" and lets you cross off ingredients [vendor, Cult of Mac review].

**Information needs while cooking**. Frummet, Elsweiler and Ludwig built a taxonomy of what people ask while they cook at home [study, abstract only, ACM TOIS 2022, arXiv 2112.04788]. The needs "require different amounts of context to be understood", and a single-turn classifier reached only about 40% F1.

In the follow-up (survey N=200, Wizard-of-Oz N=48), a proactive assistant got almost twice the conversation of a passive one [study, abstract only, ACM TOIS 2024]. It got 1.5 times the knowledge questions and passed on 1.7 times the knowledge. Younger keen cooks also wanted food history and science.

Design consequence: put the "why" and the "what it looks like" right beside the "what". Offered at the moment it applies, it gets used.

**Voice is not text read aloud**. In a 12-participant home study, steps read aloud caused nine problems [study, abstract only, arXiv 2306.09992]. Examples are "obscuring the bigger picture" and too much at once. Listeners cannot skim. The authors rewrite steps for speech by summarising, signposting, splitting, elaborating, volunteering, reordering, redistributing and visualising. Short steps, inline quantities and the action first also help glance reading.

### 1.3 Derived estimate: type size for a cook-mode step

[derived] The inputs are as follows.

- Character height of 16′ (the minimum) to 20′ (the requirement), from secondary sources on ISO 9241-303.
- Viewing distance of 600 to 900 mm, for a device propped at the back of the counter.
- Cap height of about 0.7 em. Real fonts range from about 0.65 to 0.75.
- One iOS point of about 0.156 mm (1/163 in). This varies by device. On phones one CSS px is close to one iOS pt.

The steps are as follows.

1. Character height h ≈ d × θ in radians. 16′ is 0.00465 rad, and 20′ is 0.00582 rad.
2. At 600 mm, h is 2.8 mm (16′) to 3.5 mm (20′). At 900 mm, h is 4.2 mm to 5.2 mm.
3. Font size in em is h / 0.7. That gives 4.0 to 5.0 mm at 600 mm, and 6.0 to 7.5 mm at 900 mm.
4. In points (÷ 0.156), that is **about 26 to 32 pt at 600 mm, and about 38 to 48 pt at 900 mm.**

Sanity check: the same method at a hand-held 400 mm and 16′ gives about 17 pt. That is the iOS default body size, so the method matches a known value.

Rule of thumb: **a cook-mode step needs about two to three times the body size**. So a phone fits one step, or one short step with its ingredients, which is why strong cook modes show one step at a time. Treat the numbers as a range to test on a real counter. The standard assumes office monitors, not steam and glances.

### 1.4 What leading apps do well

- **Clean import**. Recipe blogs pad pages for SEO and ads, hence "Jump to recipe" buttons [commentary, bootstrapped.ventures, jjpryor substack]. Recipeasly, which stripped the stories, shut down within hours after blogger backlash [news, today.com]. A Mac forum reports that on blogs "Paprika starts showing its age" and leaks the story into the steps [anecdote, macpowerusers]. Mela and Crouton stay clean.
- **Import from social video**. ReciMe "nailed the vast majority" of dozens of Instagram and TikTok videos in a month-long test [review, whistleout.com]. Mela added video import in 1.6 [review, MacStories]. Import is the front door, and a bad parse fails before design gets a chance.
- **One step at a time, with quantities inside the step**. Crouton lets you "tap on ingredients within a step to get the quantity" [vendor]. Pestle on iPad lists ingredients on the left and the step in large text on the right, with times in accent green [review, MacStories]. Its "Start Cooking" button is "easy to hit from an arm's length away". Mela's focus view shows one step with its ingredients [review, MacStories].
- **Touch-free step control**. Pestle takes "Next" and "Previous" by voice, with words you can change [review, MacStories]. Crouton has a hands-free mode [vendor].
- **Short video loops that wait for you**. Tasty's step mode plays a two-second overhead clip [review, stuff.tv, wgbh.org]. The clip loops until you move on, so the cook sets the pace.
- **Scaling**. Mela's slider recalculates quantities [review, MacStories]. A Pratt critique says NYT Cooking's fixed servings force error-prone mental arithmetic [student, Pratt 2025]. ReciMe converts metric and imperial units [vendor].
- **Cooking together**. Pestle syncs steps between people on a FaceTime call through SharePlay [news, 9to5mac 2022, launch-era].
- **The physical metaphor**. NYT Cooking's "Recipe Box" reads as intuitive because it echoes a real box [student, Pratt 2025].

### 1.5 What leading apps do badly

- **Paywalls on cook mode**. Samsung Food (formerly Whisk) puts photo scanning and cook mode behind Food+, at $59.99 a year [review, plantoeat.com, Jan 2026]. A charge for the kitchen safety net (screen awake, big step text) punishes the moment of use. The Pratt critique also calls NYT Cooking's $6 a month steep [student, Pratt 2025].
- **Unreliable headline features**. Samsung Food users report failed Instagram imports and shopping lists that changed after the shop [anecdote, unitq.com, early 2025]. Its AI planner ignores a dietitian's calorie target and the user's own recipes. A planner that does not learn from the user feels generic.
- **Search overload**. NYT Cooking puts search, sort, filters and suggestions on one screen, which causes information overload [student, Pratt 2023].
- **Endless lists in date order**. NYT's Recently Viewed is one long reverse-date scroll, so older items get lost [student, Pratt 2025].
- **Weak organisation**. Mela has no folders [review, iphone-ticker.de]. Pestle's category filtering was "hit or miss", and its meal plans do not sync with the calendar [review, MacStories].
- **Platform lock-in**. Mela, Crouton and Pestle are Apple-only. Paprika runs everywhere but uses its own sync [anecdote, macpowerusers]. Users who cook across devices pick reach first and polish second.

---

## Part 2. The path of visual interface design, 2015 to 2026

### 2.1 Phase one, about 2013 to 2019: flat, and what it cost

iOS 7 (2013) and Material Design (2014) made flatness the default. NN/g eye tracking (71 users, 9 site pairs) studied weak clickability cues [study, NN/g flat-UI eye tracking]. They cost about 22% more time and 25% more fixations. The extra effort was uncertainty, not engagement. Flat is not broken, but it usually means weaker cues [review, NN/g response to flat-design criticism].

### 2.2 Phase two, 2016 to 2021: the system becomes the medium

- **Variable fonts (OpenType 1.8, September 2016)**. Microsoft, Apple, Adobe and Google released one file format with continuous weight, width and optical-size axes [vendor, Google open-source blog, LWN]. Type became something an interface adjusts in real time, not a fixed set of files.
- **System dark mode (iOS 13, June 2019)**. It can follow a sunset schedule, and third-party apps can adopt it [vendor, apple.com.cn newsroom, and news, betanews]. From then on every palette needed two themes. Colour became a system of roles, not a list of hex values.
- **Fluent and Mica**. Fluent (2017) rests on "light, depth, motion, material, scale", and Windows 11's Mica (2021) tints windows from the wallpaper [secondary, Wikipedia, windowslatest]. Depth came back as material, not as imitation leather.
- **Neumorphism (2020)**. Its own namer warned that people with low vision can miss its buttons [commentary, uxdesign.cc, builtin.com]. Its edges fall far below WCAG's 3:1 non-text contrast. A style that hides what can be tapped does not last.
- **Glassmorphism (2021)**. Every practical guide says to use blur sparingly and protect contrast, citing Windows Aero's costs [anecdote, LogRocket, B12].

### 2.3 Phase three, 2021 to 2023: personal colour and spatial computing

- **Material You (2021)**. It takes the source colour from the user's wallpaper [vendor, material.io/blog/science-of-color-design, 9to5google]. Hue and chroma are dynamic, and tone carries contrast. Google built a perceptual colour space for this, HCT, to replace HSL. It released the engine as Material Color Utilities.
- **OKLCH on the web**. CSS Color 4 brought the same idea to the web [review, evilmartians.com]. Its L is perceived lightness, so a formula can generate a palette, and wide-gamut P3 is available. Some L/C/H combinations fall outside some displays. Since 2021, colour is something you derive, not something you pick.
- **visionOS (WWDC23)**. It set the rules Liquid Glass inherited [vendor, WWDC23 10076, wwdcnotes.com]. Put lighter elements on glass and add a darker backing for contrast. Do not stack light materials. Use heavier type, such as medium for body text. Use three levels of text vibrancy. Let the room light set the look.
- **Springs as the default motion model**. Apple's "Animate with springs" reduces a spring to duration and bounce, with smooth, snappy and bouncy presets [vendor, WWDC23 10158]. Motion continues from the current speed and can be interrupted.

### 2.4 Phase four, 2025: expressive and dimensional, and the backlash

- **Material 3 Expressive (2025-05)**. Google cites 46 studies with over 18,000 participants [vendor, its own research, not independently checked, design.google]. It reports key elements spotted up to 4× faster, preference across ages, and users over 45 as fast as younger users. Its tools are colour, shape, size, motion and containment.
- **Google's own caveats**. A playlist of loose album art tested worse and was not recognised as a playlist. **Removing text labels from email actions reduced usability**. Unfamiliar layouts lowered preference and usability, and a strong minority preferred calmer designs [same source].
- **Expressive motion**. Spatial and effects springs come in three speeds, and expressive springs are less damped. Third-party ports disagree on the values, so this report quotes none [secondary, pub.dev ports].
- **Liquid Glass (WWDC25)**. Apple's "broadest software design update ever" is a real-time translucent material that takes colour from the content behind it [vendor, apple.com/newsroom]. Controls form their own layer and "recede". Tab bars shrink on scroll.
- **Apple's materials guidance**. Glass belongs to the navigation layer, never the content layer. Use it sparingly and never stack it [secondary, WWDC25 group-lab summary, HIG mirror].
- **The backlash, measured**. NN/g's "Liquid Glass Is Cracked" (Budiu, 2025-10) lists controls that lose contrast over images and floating bars over text [review, NN/g Liquid Glass]. It calls the motion "distraction with a side of nausea". It also lists cramped targets (it cites 1 cm × 1 cm with 0.4 cm spacing), controls that move and back buttons without labels.
- **Apple's correction**. Within five months iOS 26.1 added a Clear/Tinted choice [news, techcrunch.com, tomsguide]. Tinted raises opacity and contrast, in third-party apps too.
- **Dimensional icons**. Airbnb's 2025 relaunch used animated 3D icons, and its CEO said "Flat design is over" [news, Bloomberg]. Critics call the copies "skeuo-pastiche" [anecdote, midstlabs], and AI tools flooded the field with lookalikes [anecdote, flarup.email].

### 2.5 The pattern under the decade

Each step swings between expressiveness and a clear sign of what can be tapped. A swing too far toward expressiveness gets corrected by research or by user pushback.

| Swing                                                 | Signal                                        | Correction                                               |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| Skeuomorphism → flat                                  | Clarity, scalable systems                     | NN/g: weak cues cost 22% more time                       |
| Flat → soft depth (neumorphism, glass)                | Demand for tactility                          | Contrast failures, and the style faded                   |
| Fixed palette → derived, personal colour (HCT, OKLCH) | Personal expression, contrast by construction | It lasted, because it solved a real problem              |
| Easing curves → springs                               | Interruptible, physical motion                | It lasted, but NN/g warns against motion without purpose |
| Flat → glass and dimension (2025)                     | Depth, delight, a premium feel                | NN/g critique, then Apple adds Tinted within months      |

The swings that last solve a structural problem: variable type, colour by tone, dark mode, interruptible motion, and layers for controls. The swings that fade are surfaces with no job, such as bevels, glass behind text and idle motion.

### 2.6 Credible signals of what comes next

1. **Material as a layer system, not as decoration**. Apple and Microsoft both use depth as the line between content and control. Expect it to stay and to calm down. Tinted is the first sign.
2. **Personal, derived colour**. Material You takes its palette from the wallpaper, and Liquid Glass takes its tint from the content. Both point to colour that comes from the user or the content, with tone guaranteeing contrast. For a recipe app the obvious source is the dish photo. Colour from the dish is a native next step, provided tone, not hue, keeps text contrast safe.
3. **Interfaces that adapt to context**. Liquid Glass controls change shape with context. Google's generative UI goes further: in "dynamic view", Gemini designs and codes a custom interface for each prompt [vendor, research.google/blog/generative-ui]. The NN/g critique sets the limit. Adaptation must not move the controls that people know. Adapt the content and the emphasis, and keep the controls in place.
4. **The interface matters less, and the whole experience matters more**. NN/g's State of UX 2026 says the UI "will gradually become less of a differentiator" [review, NN/g State of UX 2026]. It calls 2026 a year of AI fatigue and "AI slop". Authentic, human details and trust will set products apart.
5. **Spatial principles on flat screens**. visionOS rules reached phones through Liquid Glass. A kitchen with steam and glare is the nearest phone case to the visionOS "room".

### 2.7 How to go beyond the trend without copying it

To copy 2025 is to use glass everywhere, bouncy motion and 3D icons. To go beyond it, keep what each trend achieved and drop its surface.

- From Liquid Glass, take the separation of controls from content, not the refraction. In cook mode, a solid high-contrast bar gives that separation, and it works where glass fails.
- From M3 Expressive, take size, shape and containment that point to the primary action. Keep its own finding too: labels stay.
- From Material You, take colour derived by role and tone. Source it from the food, not the wallpaper.
- From springs, take interruptibility and continuity. Use motion only to explain a change the user caused.
- From the NN/g State of UX, take a human, specific voice. Show a cook's notes, not generic AI garnish.

---

## Part 3. Where the two halves meet: the kitchen is glass's worst case

Liquid Glass and similar materials work worst in exactly the conditions of cooking.

- **Busy backgrounds**. Glass takes colour from what sits behind it, and in a recipe app that is detailed, saturated food photography. NN/g shows this exact case failing.
- **Distance and glances**. Glass lowers contrast. At 60 to 90 cm the text is already near the legibility floor (see 1.3). A glance gives no time to decode low-contrast text.
- **Imprecise touch**. Wet knuckles need large targets in fixed places. NN/g found the Liquid Glass tab bars cramped and the controls in motion.
- **Steam, glare and changing light**. These lower the effective contrast further. The visionOS answer is a darker backing and heavier weights, so use it.
- **Interruptions**. Some controls shrink or move on scroll. A cook who comes back then does not find the "next" control in its old place.

Conclusion: cooking needs the opposite of the 2025 surface. It needs opaque, high-contrast controls in fixed places, heavy type, and motion only as feedback. It keeps the structural lessons: controls in their own layer, colour from content, size for emphasis. Planning mode, where the user is close and has dry hands, can carry more expression, such as dish-derived colour and depth on browse cards.

---

## Rules a top designer applies

Each rule can be checked and ties to a source above.

### Modes and structure

1. **Planning and cooking are separate modes with separate layouts**. Planning can be dense. Cooking shows one step at a time, or one step with its ingredients. Check: no cook-mode screen shows more than one step's instructions at full size (1.1, 1.3, Mela, Crouton, Pestle, Tasty).
2. **Cook-mode step text is sized for distance**. Start at about 26 to 32 pt for a propped phone, and test at 60 cm and 90 cm. Body size (17 pt) is the floor for a hand-held phone, not the size for the counter (1.3, derived).
3. **Quantities appear inside the step**. The cook never scrolls back to the ingredient list in the middle of a step (Crouton, Pestle).
4. **The current step is always marked, and ingredients can be crossed off**. A return after an interruption needs no memory (Paprika).
5. **Scaling and unit conversion recalculate every quantity, including those inside steps**. Nobody does mental arithmetic (Pratt 2025, Mela, ReciMe).

### Touch, hands and the device

6. **Cut the number of touches during cooking**. Each touch can cost a hand-wash (ASSETS 2024). Check: a cook can follow a whole recipe with only next and previous inputs.
7. **Cook-mode targets are at least 1 cm × 1 cm, with at least 0.4 cm between them**. The primary next and previous controls are much larger. They sit in fixed positions and work with a knuckle (NN/g, Pestle's "arm's length").
8. **Provide a touch-free path to the next step, and never make it the only path**. Voice "next" and "previous", with words the user can change, is one way (Pestle, Crouton, arXiv 2310.05853).
9. **The screen stays awake in cook mode**. The user's own gesture requests it, and leaving cook mode releases it. It is never behind a paywall (web.dev Betty Crocker, Samsung Food paywall criticism).

### Time

10. **Durations in the recipe text become tappable timers**. Several timers run at once, and each one shows the name of its step. They keep running in the background and show on the lock screen, through Live Activities, notifications or a watch (Paprika, Crouton, Pestle, Mela).
11. **A running timer is visible from every cook-mode screen** (Crouton's heads-up display).

### Content

12. **The import shows the steps, not the story**. Blog narrative never leaks into the instructions, and the source is credited and linked (macpowerusers, Recipeasly backlash).
13. **Steps are written to be heard as well as read**. Keep them short, put the action first, and add signposts such as "Step 3 of 7. Next you need the oven hot" (arXiv 2306.09992).
14. **Offer the "why" and the "what it looks like" at the step where it applies**. Never make it compulsory (Frummet 2024: proactive offers almost doubled the conversation).
15. **Personalisation learns from the user's own history first**. That history is saved recipes, cooked recipes, leftovers, and targets set by the user or a dietitian. Only then does it suggest anything generic (Samsung Food complaints, NN/g 2026).

### Visual language

16. **Glass and translucency live only in the navigation layer**. Never put glass behind body text or in a stack. Never put it over a food photo without a solid or tinted backing. Never use it in cook mode. Respect Reduce Transparency, Increase Contrast and the user's Tinted choice (Apple HIG materials, NN/g, iOS 26.1).
17. **Labels stay on actions**. Use an icon alone only for a universally known action. Never use one alone for the primary cook-mode controls (M3 Expressive caveat, NN/g on back buttons without labels).
18. **Colour is derived by role and tone (OKLCH or HCT), and tone guarantees contrast**. Text meets WCAG contrast in both themes, and non-text controls meet 3:1. Dish-derived accents stay within those limits (Material You, Evil Martians, the neumorphism failure).
19. **Use size, shape and containment, not ornament, to mark the main action on each screen** (M3 Expressive).
20. **Motion responds only to a user action or a state change**. It is interruptible, like a spring, and it explains what changed. It never runs idle, and it respects Reduce Motion (NN/g, WWDC23 springs).
21. **Controls do not move or change size during cooking**. Adapt the content and the emphasis, not the positions people know (NN/g, the limits of generative UI).
22. **Use heavier type on any material or photo**. Follow the visionOS medium-for-body rule. Test text through real steam and glare, not studio light (WWDC23 10076).
23. **Every screen is clearly this app and no other**. Specific, human details beat generic AI garnish and sparkle icons. Examples are a cook's notes, real photos and honest copy (NN/g State of UX 2026, the "skeuo-pastiche" critique).

## Sources

Cooking and recipe apps

- Chan et al., "Mango Mango, How to Let The Lettuce Dry Without A Spinner?": https://arxiv.org/pdf/2310.05853
- ARChef, AR cooking assistant: https://arxiv.org/pdf/2412.00627
- InstaCook poster (UW iSchool): https://ischool.uw.edu/sites/default/files/capstone/posters/InstaCook_Poster.pdf
- Stanford CS147 Simmr assignment: https://web.stanford.edu/class/cs147/projects/DesigningVoiceAIforEverydayValue/simmr/files/CS147SimmrAssignment5.pdf
- Li, Wang, Carrington, Kane, "A Recipe for Success?" (ASSETS 2024): https://arxiv.org/abs/2407.19065
- "Rewriting the Script: Adapting Text Instructions for Voice Interaction": https://arxiv.org/abs/2306.09992
- Frummet, Elsweiler, Ludwig, "What Can I Cook with these Ingredients?" (TOIS 2022): https://arxiv.org/abs/2112.04788v2
- Frummet et al., "Cooking with Conversation" (TOIS 2024): https://pred.uni-regensburg.de/id/eprint/64250/
- Wet-finger tracking patent US9921743B2: https://patents.google.com/patent/US9921743
- False touch and water detection patent US10754438B2: https://patents.google.com/patent/US10754438
- RainCheck (ICMI 2018): https://www.springerprofessional.de/doi/10.1145/3242969.3243028
- Wake Lock API case study, Betty Crocker: https://web.dev/case-studies/betty-crocker
- Cook mode and Wake Lock explainer: https://bootstrapped.ventures/cook-mode/
- Paprika Recipe Manager 3 listing: https://apps.apple.com/us/app/-/id1303222868
- Cult of Mac, Paprika review: https://www.cultofmac.com/558097/review-paprika-best-cooking-app/
- Crouton listing: https://apps.apple.com/app/id1461650987
- RecipeSage vs Crouton: https://recipesage.com/alternatives/crouton/
- MacStories, Pestle 1.2 review: https://www.macstories.net/reviews/pestle-1-2-the-macstories-review/
- 9to5Mac, Pestle launch: https://9to5mac.com/2022/01/21/pestle-cooking-app-for-ios-release/
- Mela listing: https://apps.apple.com/app/id1548466041
- MacStories, Mela review: https://www.macstories.net/reviews/mela-an-elegant-and-innovative-recipe-and-cooking-app-for-iphone-ipad-and-mac/
- MacStories, Mela 1.6: https://www.macstories.net/reviews/mela-1-6-adds-web-search-engine-and-recipe-import-from-youtube-instagram-and-tiktok-videos/
- iphone-ticker.de, Mela/Paprika/Crouton: https://www.iphone-ticker.de/mela-paprika-crouton-drei-rezept-verwaltungen-fuer-iphone-und-mac-225637
- MPU forum, general vs specialised recipe apps: https://talk.macpowerusers.com/t/general-app-vs-specialized-app-recipe-edition/21674
- NYT Cooking listing: https://apps.apple.com/au/app/nyt-cooking-quick-tasty-meals/id911422904
- Pratt IXD critique of NYT Cooking (2023): https://ixd.prattsi.org/2023/02/design-critique-nyt-cooking-ios-app
- Pratt IXD critique of NYT Cooking (2025): https://ixd.prattsi.org/2025/02/design-critique-nyt-cooking-mobile-app/
- Samsung Food / Whisk user feedback (unitQ): https://unitq.com/unitq-scorecards/whisk
- Plan to Eat on Samsung Food: https://www.plantoeat.com/?p=9210
- ReciMe listing: https://apps.apple.com/us/app/recime-recipes-meal-planner/id1593779280
- WhistleOut, ReciMe review: https://www.whistleout.com/CellPhones/Apps/recime-app-review
- Tasty review (Stuff): https://www.stuff.tv/?p=2348
- WGBH, recipe apps for beginners: https://www.wgbh.org/lifestyle/food/2018-12-14/the-best-recipe-apps-for-cooking-beginners
- Fireart, Tasty case: https://fireart.studio/cases/tasty/
- Why recipe blogs have stories: https://bootstrapped.ventures/why-do-recipe-blogs-have-stories/
- "Why Are Online Recipes Always So Damn Long-Winded?": https://jjpryor.substack.com/p/why-are-online-recipes-always-so
- Today, Recipeasly shutdown: https://www.today.com/today/amp/tdna210423
- ISO 9241-303 figures (secondary): https://www.komnet.nrw.de/_sitetools/dialog/13840 and https://lists.w3.org/Archives/Public/public-css-archive/2020Jun/0612.html
- ACORN HSI style guide: https://arxiv.org/pdf/2312.12579

Visual design trajectory

- NN/g, Flat UI elements attract less attention: https://nngroup.com/articles/flat-ui-less-attention-cause-uncertainty
- NN/g, Response to criticisms of flat design: https://www.nngroup.com/articles/response-criticisms-flat-design/
- Google, Introducing OpenType font variations: https://opensource.googleblog.com/2016/09/introducing-opentype-font-variations.html
- LWN, OpenType variable fonts: https://lwn.net/Articles/700783/bigpage
- Apple iOS 13 preview (newsroom mirror): https://www.apple.com.cn/newsroom/2019/06/apple-previews-ios-13/
- BetaNews, iOS 13 dark mode: https://betanews.com/2019/06/03/apple-previews-ios-13/
- Fluent Design System: https://en.wikipedia.org/wiki/Fluent_Design_System
- Windows Latest, Mica performance: https://windowslatest.com/2021/08/12/microsoft-windows-11s-new-design-will-not-affect-performance
- Neumorphism: https://en.wikipedia.org/wiki/Neumorphism
- Built In, Neumorphism and accessibility: https://builtin.com/design-ux/neumorphism-accessibility
- UX Collective, Neumorphism and accessibility: https://uxdesign.cc/neumorphism-visual-accessibility-and-empathy-d1c5ed2a1f03
- LogRocket, What is glassmorphism: https://blog.logrocket.com/ux-design/what-is-glassmorphism
- B12, Glassmorphism: https://www.b12.io/glossary-of-web-design-terms/glassmorphism/
- Material, The science of color & design: https://material.io/blog/science-of-color-design
- 9to5Google, Material dynamic color code: https://9to5google.com/2022/02/17/material-dynamic-color-code/
- Evil Martians, OKLCH in CSS: https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
- Apple WWDC23, Design for spatial user interfaces: https://developer.apple.com/videos/play/wwdc2023/10076/
- WWDC Notes, 10076: https://wwdcnotes.com/notes/wwdc23/10076
- Apple WWDC23, Animate with springs: https://developer.apple.com/videos/play/wwdc2023/10158
- Google Design, Expressive Material Design research: https://design.google/library/expressive-material-design-google-research
- Material Expressive motion port (third-party): https://pub.dev/packages/motor
- Apple Newsroom, new software design (Liquid Glass): https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- MacRumors, Liquid Glass: https://macrumors.com/2025/06/09/apple-announces-liquid-glass
- Apple Developer Forums, WWDC25 design group lab: https://developer.apple.com/forums/thread/791070
- HIG materials mirror: https://glama.ai/mcp/servers/@tmaasen/apple-dev-mcp/blob/b82f0efe2115dc4539c83a2374a714a84aeb350a/content/universal/materials.md
- NN/g, Liquid Glass Is Cracked: https://www.nngroup.com/articles/liquid-glass/
- TechCrunch, iOS 26.1 tones down Liquid Glass: https://techcrunch.com/2025/11/04/ios-26-1-lets-you-turn-down-liquid-glass-transparency
- Tom's Guide, iOS 26.1 transparency: https://www.tomsguide.com/phones/iphones/ios-26-1-lets-you-adjust-liquid-glass-transparency-on-your-iphone-heres-how-to-do-it
- Bloomberg, Big Tech deals flat design a death blow: https://www.bloomberg.com/news/articles/2025-06-13/apple-airbnb-ditch-flat-app-icons-for-new-3d-ui-design
- Midst Labs, Skin-deep human-centered design: https://midstlabs.substack.com/p/skin-deep-human-centered-design
- Flarup, The future is colourful and dimensional: https://www.flarup.email/p/the-future-is-colourful-and-dimensional
- Google Research, Generative UI: https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/
- NN/g, State of UX 2026: https://www.nngroup.com/articles/state-of-ux-2026/
