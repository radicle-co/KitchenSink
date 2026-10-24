# Apple's reinventors: how they made new interfaces feel simple

Research note, 2026-10-20. This note follows on from `appleTradition.md` and does not repeat it. That note already covers Rams, Ive's view of care, Kare, Kocienda, Ording's rubber band, the WWDC18 spring and damping rules, and the WWDC17 and WWDC20 type talks. This note goes deeper and later, from 2007 to WWDC26. It designs nothing.

**How to read the sources.**

- **Primary** means the designers' own words, from an Apple WWDC session transcript, an Apple Newsroom release or an Apple page.
- **Primary, third-party copy** means a transcript of a primary talk hosted by someone else (asciiwwdc.com, singjupost.com).
- **Secondary** means press coverage of an interview, or a page I was not able to open.
- **Unverified** means I did not find it in any source.
- My fetch tool returns text through a summarising model. I quote only words the tool put in quotation marks, and I keep the sources' own typos.

---

## 1. The original iPhone (2007) and "Purple"

**The problem.** Steve Jobs named it on stage: phones "all have these keyboards that are there whether or not you need them to be there," and "control buttons that are fixed in plastic and are the same for every application." His answer: "We solved it with a bit-mapped screen that could display anything we want." On the stylus: "Who wants a stylus?… Nobody wants a stylus." Then: "We're going to use our fingers." ([Macworld 2007 keynote, singjupost transcript](https://singjupost.com/steve-jobs-iphone-2007-presentation-full-transcript/), primary, third-party copy.)

**What was new.** The software became the controls. The keynote's demo of the feel was a single line: "I just take my finger, and I scroll. Isn't that cool? A little rubber banding up when I run off the edge." (Same source.) The physics did the explaining.

**The team.** A Cult of Mac photo of the 10th-anniversary reunion names Imran Chaudhri, Freddy Anzures, Bas Ording, Marcel van Os, Steve Lemay and Mike Matas. It says Scott Forstall "led the team that built iPhone OS." ([Cult of Mac](https://www.cultofmac.com/news/original-iphone-design-team-reunites-for-10th-anniversary), secondary.) Greg Christie led the Human Interface group ([HotHardware, reporting WSJ](https://hothardware.com/news/behind-the-birth-of-the-iphone), secondary).

**Process and pressure.** Everything here is secondary, from coverage of a 2014 WSJ interview with Christie:

- Jobs gave the team "two weeks or he would assign the project to another group."
- Christie: "Steve had pretty much had it," and "He wanted bigger ideas and bigger concepts."
- Early software ran on "a plastic touch-screen device" tethered to a Mac, set up to "simulate the slower speeds of a phone hardware." They tested on something that felt like the real, slower phone.
- His team is credited with "swiping to unlock the phone, placing calls from the address book, and a touch-based music player."

([iPhone in Canada, reporting WSJ](https://www.iphoneincanada.ca/news/apple-engineer-iphone-birth/), secondary.)

**Forstall at the Computer History Museum (2017).** Microsoft had told Jobs that pen tablets would "rule the world." Forstall recalled Jobs's reply: "let's show them how it's really done!" ([CHM, "Creating Magic"](http://www.computerhistory.org/blog/creating-magic-a-conversation-with-original-iphone-engineers-software-team-lead-scott-forstall/), primary words inside John Markoff's essay.) On the trade-off of an on-screen keyboard, Scott Herz said: "You can get spun up over those kind of problems and not notice that the overall picture is much, much better." (Same source.) That is a useful warning: a new idea will lose some small fights and still win overall.

**Backgrounds.**

- Freddy Anzures: BFA in Industrial Design, Carnegie Mellon, 1999, then six months interning at Frog Design. His aim: "you can make new technology not scary to people." ([The FilAm](https://thefilam.net/archives/24416), interview, secondary.)
- Imran Chaudhri, on restraint, said the user controls "exist for you… and yet it's incredibly hard to know how to use them." ([Fast Company via Big Medium](https://bigmedium.com/ideas/links/imran-chaudhri-apples-greatest-flaws.html), secondary.)
- The codename "Purple" and the "Purple Dorm" come from Brian Merchant's _The One Device_ (2017). The book drew on interviews with Ording, Christie and others ([Wikipedia: Brian Merchant](https://en.wikipedia.org/wiki/Brian_Merchant), secondary). I did not read its text, so any detail about Purple here is **secondary**.

---

## 2. iOS 7 (2013): flat, layered and deferential

**The problem.** Years of skeuomorphic texture had become ornament. Apple's release called the new interface "distinct, functional layers that make it feel more alive," and said "the use of translucency and motion makes even simple tasks more engaging." Ive: "There is a profound and enduring beauty in simplicity, in clarity, in efficiency," and the system "has a whole new structure that is coherent and applied across the entire system." This also confirms the "bringing order to complexity" line that the earlier note did not confirm. ([Apple Newsroom, June 2013](https://www.apple.com/newsroom/2013/06/10Apple-Unveils-iOS-7/), primary.)

**What the engineers said it meant.** These quotes come from WWDC13 session 201 (Jason Beaver and Andy Matuschak, UIKit team) ([asciiwwdc transcript](https://asciiwwdc.com/2013/sessions/201), primary, third-party copy):

- "a lot of what's new in iOS 7 is not aesthetic. It's structural."
- Apps "should strip away the irrelevant and unimportant information."
- "the content comes first and the ornamentation and the chrome of the system needs to get out of the way."
- "We stripped out a lot of ornamentation in this interface."
- Colour has one job: "we're using color to signify interactivity and selection."
- Blur styles are used "to communicate different materials."
- The type system became semantic: "Instead of specifying specific fonts and sizes, you specify fonts semantically." My inference: this semantic approach is the basis of Dynamic Type. The session does not name it.

Session 226 adds a rule for motion physics: "it's really effective when you use it in moderation." ([asciiwwdc](https://asciiwwdc.com/2013/sessions/226), primary, third-party copy.)

**Critics.** The main complaint was thin type and low contrast.

- Macworld's Christa Mrgan argued that using Helvetica Ultralight as the system font was a mistake (paraphrase). ([pxlnv link to Macworld](https://pxlnv.com/linklog/why-ios-7s-design-is-bold-but-flawed/), secondary.)
- Type designer Thomas Phinney said that low contrast and the lighter Helvetica weights were trending towards illegible (paraphrase). ([Typographica](https://typographica.org/?p=13125), secondary.)
- TidBITS wrote that "iOS 7 has markedly lower contrast" than iOS 6. ([TidBITS](https://tidbits.com/2013/09/19/peering-at-ios-7-for-the-vision-impaired/), secondary.)
- Parallax made some people dizzy ([Macworld](https://www.macworld.com/article/221987/make-ios-7-less-nausea-inducing.html), secondary).

**How Apple responded.** All of this is secondary, because I did not find an Apple release that lists the changes:

- iOS 7 already had Bold Text, Increase Contrast and Reduce Motion.
- iOS 7.1 split Increase Contrast into Reduce Transparency, Darken Colors and Reduce White Point. It brought back Button Shapes, and it extended Reduce Motion and Bold Text to more places. ([iMore](https://www.imore.com/ios-71-lets-you-take-some-magic-and-all-motion-sickness-out-your-iphone-and-ipad), [TidBITS](https://tidbits.com/2013/09/19/peering-at-ios-7-for-the-vision-impaired/).)
- In 2015, San Francisco replaced Helvetica Neue as the system font for iOS 9 ([Six Colors](https://sixcolors.com/link/2015/06/introducing-the-new-system-fonts/), [Typedrawers](https://typedrawers.com/discussion/comment/12816), secondary). See section 3.

The pattern was to keep the idea and to fix legibility with options and better type.

---

## 3. Apple Watch, the Digital Crown and San Francisco (2014–15)

**The problem.** On a tiny screen, a finger covers the content. Apple called the Crown "an innovative way to scroll, zoom and navigate fluidly, without obstructing the display." Ive said the watch "blurs the boundary between physical object and user interface." ([Apple Newsroom, Sept 2014](https://www.apple.com/newsroom/2014/09/09Apple-Unveils-Apple-Watch-Apples-Most-Personal-Device-Ever/), primary.)

**How it was made to feel inevitable.** They borrowed a watch's crown, but not its meaning. Ive, in Ian Parker's _New Yorker_ profile, warned that "if it's literally referencing what's happened in the past, the information about what it does is then wrong." His stated goal was "the strangely familiar." ([iDownloadBlog quoting the New Yorker, 2015](https://www.idownloadblog.com/2015/02/16/jony-ive-new-yorker-interview/), secondary. The New Yorker blocked my tool.) This is the clearest statement of the method: **a familiar form, with an honest new job**.

The same profile describes the studio's process for the iPhone 6. They made prototypes at "every point-one of an inch, from four all the way through to well over six," lived with them, and judged 5.7 inches "way too big." (Same source, secondary.)

**Rules for the small screen.** Mike Stern, WWDC15 session 802 ([transcript](https://developer.apple.com/videos/play/wwdc2015/802/), primary):

- "Our internal metric for interaction times is about five seconds or less."
- With a black background, "the bezel will provide visual padding," which lets the app "seamlessly blend into the watch itself."
- "Trying to show everything on screen at once is a sure fire recipe for having a really cramped looking interface with text that is too hard to read."
- "You should use them sparingly to draw people's attention to truly important events in your app."
- "Apple Watch is not a miniature iPhone."

**San Francisco.** Antonio Cavedoni, WWDC15 session 804 ([asciiwwdc transcript](https://asciiwwdc.com/2015/sessions/804), primary, third-party copy):

- "San Francisco unifies our platform with a consistent typographic voice."
- "fonts are there to serve the text, so legibility is our first concern."
- On the Watch cut: "In SF, they are round, and in SF Compact, they are actually slightly flat," because "these flat sides allow us to have more space between the letters."
- "the extreme weights of the family are really designed for titles."
- Detail at small sizes: "the dot on the i visually starts to collide with the stem at really small sizes."
- A Reading University blog describes him as an MA Typeface Design graduate (search snippet only, page 404). **Secondary.**

**What they threw away.** Stern presented Glances in 2015 as "scannable summaries." A year later, watchOS 3 replaced them with a Dock on the side button, and apps were made to launch faster. ([Macworld](https://www.macworld.com/article/228206/watchos-3-faq-glances-are-going-away-as-watch-apps-speed-up-and-move-to-a-dock.html), [MacStories](https://www.macstories.net/news/apple-announces-watchos-3/), secondary. The Apple release URL returned 404.) Apple cut its own launch feature once use showed what people needed.

---

## 4. iPhone X gestures (2017) and how they were built

**The problem.** The Home button went away. Craig Federighi later summed it up: "Five years ago, we lost the home button with the iPhone X." ([9to5Mac, reporting AXIS](https://9to5mac.com/2022/10/03/dynamic-island-ui/), secondary.)

**The layout rules.** The "Designing for iPhone X" video gives no speaker names ([transcript](https://developer.apple.com/videos/play/fall2017/801/), primary):

- "your app or game should always fill the display that it runs on."
- The Home indicator "should always be clearly visible."
- The screen "follows the design of the product around all four rounded corners for a symmetrical look." This is the seed of the concentric shapes that came back in 2025.

**How it was made to feel obvious.** These quotes are from WWDC18 session 803, and none of them repeats the earlier note's spring material. The transcript has no speaker labels, so attribution comes from the section each quote sits in ([transcript](https://developer.apple.com/videos/play/wwdc2018/803/), primary):

- One spatial model: "You go horizontally between apps. And, you go vertically to go home."
- "when it's redirectable, the thought and gesture happen in parallel."
- "It should have a consistent offscreen path as it enters and leaves."
- They admit the cost: "one downside to a gestural interface is that it's not immediately obvious what the gestures are." The cure is hinting, which "makes the gestures feel expected, and predictable."
- Nathan de Vries: "We should be leaning on that shared intuition that we have for the physical world around us."

**Process, in their words.** Chan Karunamuni's section of the same talk:

- "The interactive demo we think is really worth a million static designs."
- "this technique is actually how we built the iPhone 10 interface."
- "Hand it to others see how they play with it."

This is the same demo-first method Kocienda and Ording described in 2007, still in use ten years later.

---

## 5. Dynamic Island (2022)

**The problem.** The camera cut-out was dead space. Alan Dye's framing: "if the sensor area on the screen could be made smaller, what could be done with the surplus space?" He said "it's one of the topics that has been discussed for many years," and "It is an area where our hard work put into around a few pixels has a very big effect." Federighi called the job "a very exciting challenge for us to consolidate what is happening on our iPhone into this small interactive place." ([9to5Mac, reporting the AXIS interview](https://9to5mac.com/2022/10/03/dynamic-island-ui/), secondary. Original at [axismag.jp](https://www.axismag.jp/posts/2022/09/496756.html), not opened.)

**The breakthrough** was Dye's realisation that the animation "didn't have to be limited to the status bar area." ([Coverage summary](https://www.imore.com/apple/apple-execs-craig-federighi-and-alan-dye-discuss-dynamic-island-in-new-interview), secondary.) Apple described it as "a design that blends the line between hardware and software." ([Apple Newsroom, Sept 2022](https://www.apple.com/newsroom/2022/09/apple-debuts-iphone-14-pro-and-iphone-14-pro-max/), primary.)

**The craft rules.** Chan Karunamuni and Mac Tyler, WWDC23 session 10194 ([transcript](https://developer.apple.com/videos/play/wwdc2023/10194/), primary):

- "It's very sensitive to the shape and placement of things inside it."
- "A key aspect to making things fit nicely inside the Dynamic Island is for them to be concentric with its shape."
- "The visual mass or centroid of the shape should nestle inside the walls of the island nicely."
- "A key goal is for the encapsulation to be as narrow as possible with no wasted space."
- On buttons: use them "only… if they're controlling an essential part of the activity itself."

**The counterpoint that matters for us.** Jason Snell described the island's motion as "whimsical… sort of like a cartoon character, with sharp animations that make it feel elastic and alive." ([quoted in coverage](https://mjtsai.com/blog/2022/10/11/the-dynamic-island), secondary.) Playful motion shipped and was liked. But it is confined to one small spot, every animation reports something real (a timer, a call, Face ID), and the geometry around it is strict. The whimsy is earned by function and fenced by rules.

---

## 6. visionOS spatial design (2023)

**The problem.** There is no screen edge and no fixed distance, and a body is involved. The answer was to start from the familiar. Nathan Gitter: "With so many new possibilities, strike a balance with what's familiar." ([WWDC23 10072, "Principles of spatial design"](https://developer.apple.com/videos/play/wwdc2023/10072/), primary.)

**Restraint, stated plainly** (same session, Nathan Gitter and Amy DeDonato):

- "In most cases, prefer subtle depth. It's easy to overdo, making things look distracting or unrealistic."
- "Ideally, keep your app's interface in a single window."
- "Try to start your app in a window… This will give people control over how immersed they want to be."
- "You don't need to render all the details of a real theater to convey the feeling of being in one."

**Materials and type.** Miquel Estany Rodriguez and Lorena Pazmino, WWDC23 session 10076 ([transcript](https://developer.apple.com/videos/play/wwdc2023/10076/), primary):

- "Avoid using solid colors on windows."
- Vibrancy "brightens foreground content… by pulling light and color forward from what's behind it."
- "on iOS, we use regular weight for the body text style. On this platform, we use medium," because weight was made "slightly heavier" for contrast on glass.
- Targets need "at least 60 points of space."
- On toolbars: "avoid having more than six items."

The lesson is that when a material sits behind text, the type gets heavier to compensate. That rule matters for section 7.

---

## 7. Liquid Glass (2025) and what came after

**The problem and the idea.** A presenter introduced as Chan, "a designer on Apple's Human Interface design team", in WWDC25 session 219 ([transcript](https://developer.apple.com/videos/play/wwdc2025/219/), primary):

- "rather than trying to simply recreate a material from the physical world, Liquid Glass is a new digital meta-material that dynamically bends and shapes light."
- "Liquid Glass complements the evolution of Apple product design, as screens have gotten more rounded and immersive."
- "both the visuals AND motion of LiquidGlass were designed as one."
- Objects "materialize in and out by gradually modulating the light bending and lensing," rather than fading.

Federighi said "the most obvious inspiration was visionOS" ([TechRadar headline](https://www.techradar.com/phones/ios/we-did-all-this-work-with-physical-glass-simulating-as-closely-as-we-could-the-actual-properties-of-glass-for-liquid-glass-says-apples-craig-federighi-then-they-went-further), secondary, headline only). Dye described a kind of "sketching" with the industrial design studio, studying how glass prisms meet light ([Cultured](https://culturedmag.com/article/2025/09/15/culture-art-apple-liquid-glass-artists/), secondary). The phrase "99% of the work doesn't make it out" is a TechRadar headline credited to the VP of Human Interface Design. The part of the text that I was able to read did not name him. **Unverified attribution.**

**Its own restraint rules.** Bruno and Shubham, session 219:

- "You may be tempted to use Liquid Glass everywhere but it is best reserved for the navigation layer that floats above the content of your app."
- "always avoid glass on glass."
- "Regular is the most versatile and the one you will be using the most."
- Scroll edge effects dissolve content under the glass "allowing floating elements like titles to always remain clear."

Maria, WWDC25 session 356 ([transcript](https://developer.apple.com/videos/play/wwdc2025/356/), primary):

- "Instead of relying on decoration, hierarchy should be expressed through layout and grouping."
- "concentric shapes calculate their radius by subtracting padding from the parent's."
- "Elements using Liquid Glass require clear separation from content to maintain legibility."
- The type is "now bolder and left-aligned to improve readability in key moments like alerts and onboarding."

Dye called it "our broadest software design update ever." ([Apple Newsroom, June 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/), primary.)

**Critics.** Raluca Budiu of Nielsen Norman Group ([NN/g, Oct 2025](https://www.nngroup.com/articles/liquid-glass/), primary for the critique):

- "Text on top of text creates an illegible mess."
- "Motion for motion's sake is not usability."
- "It's like the interface is shouting 'look at me' when it should quietly step aside."
- Tab bars "feel cramped."
- "Apple is prioritizing spectacle over usability."
- "The interface is restless, needy, less predictable, less legible."

Her critique is Apple's own iOS 7 promise turned back against it. "Step aside" is the old "deference."

**How Apple responded, in three steps.**

1. **iOS 26.1 (October 2025)** added a Clear/Tinted choice. Apple's wording: "Tinted increases opacity and adds more contrast." ([9to5Mac](https://9to5mac.com/2025/10/20/ios-26-1-beta-4-adds-new-setting-to-tone-down-liquid-glass-transparency/), quoting Apple, secondary.)
2. **iOS 27 (June 2026).** Apple: "the design continues to evolve, with improvements to legibility, customizability, and consistency," plus "a new transparency slider in Settings." ([Apple Newsroom, June 2026](https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/), primary.) The iOS page says: "Updates to Liquid Glass ensure exceptional readability with more uniform refraction and improved contrast," with a slider "from ultraclear to fully tinted." ([apple.com/os/ios](https://www.apple.com/os/ios/), primary.)
3. **People.** Dye left for Meta at the end of 2025, and Stephen Lemay, a software designer at Apple since 1999, took over Human Interface design ([Bloomberg via MacStories](https://www.macstories.net/news/bloomberg-reports-that-alan-dye-is-leaving-apple/), secondary).

This is the iOS 7 pattern again: ship the bold idea, keep it, and pull it back towards legibility with user choice and better contrast. I did not find a WWDC26 session dedicated to Liquid Glass itself.

**WWDC26 restates the basics.** "Principles of great design", session 250, presented by design evangelists Linda and Doug. The transcript has no speaker labels ([transcript](https://developer.apple.com/videos/play/wwdc2026/250/), primary):

- "When we say simple, we don't mean minimal."
- "Clarity is built with hierarchy, using order, spacing, and contrast."
- "When your hierarchy is strong, the most important item on the screen is always the most obvious one."
- "In a simple interface, every element earns its place."
- "you'll know you've arrived at simplicity when you have exactly enough!"
- "familiarity doesn't mean recycling the same solution everywhere."
- "Craft comes from iteration."

Sarah, "Communicate your brand identity on iOS", session 251 ([transcript](https://developer.apple.com/videos/play/wwdc2026/251/), primary):

- Treat the app as "two distinct layers: the UI layer… and the content layer."
- "the content layer is the best opportunity to express your brand identity."
- "move color into the content area of your app, into the scroll view."
- "exercise restraint — use it sparingly and with intention."
- "Iconography doesn't need to be heavily stylized."

---

## 8. Other designers the sources point to

- **Chan Karunamuni** is the through-line. He presented the iPhone X gestures (WWDC18 803) and the Dynamic Island (WWDC23 10194). The Liquid Glass talk (WWDC25 219) is opened by a designer introduced only as "Chan". It is probably him, but I did not confirm the surname. Press reports also credit him with Liquid Glass work ([imagazine.pl](https://imagazine.pl/2025/12/08/chan-karunamuni-zastapi-alana-dyea/embed/), secondary). Press reports say he has spent about 15 years at Apple, always under Steve Lemay ([MacTech search snippet](https://www.mactech.com/2025/12/05/steve-lemays-colleagues-praise-him-as-the-new-head-of-apples-design-team/amp/), secondary). So one designer worked on at least two reinventions, and probably three, with one method: the interactive demo. His education is not stated in any source I found.
- **The WWDC14 prototyping team** was Jeff Bernstein, Linda Dong, Julian Missig and Mark Hauenstein ([WWDC14 223, "Prototyping: Fake It Till You Make It"](https://developer.apple.com/videos/play/wwdc2014/223/), primary). It is the most explicit Apple talk on process:
    - "The more prototypes we can put between our idea and our application, the better the result is going to be."
    - "Make fake apps, show people and learn from their feedback."
    - Linda Dong: "We want to start simple," and "You don't have to be an artist to do this."
    - Julian Missig: "it's so much easier to pare down and take away things when you don't have to throw away code."
    - Mark Hauenstein: "The idea is not to engineer it, just hack it together as quick as you can." And: "you make your prototype to make a better decision about whether you really want to spend the time engineering the real thing."
    - On feedback: "Don't argue, defend or dismiss."
- **Stephen Lemay** is in the original-iPhone reunion photo. He started in Apple interface design in 1999. I found no public talk by him. **Secondary.**

---

## How they reinvent without gimmicks

1. **Start from a real problem, and say it in one sentence.** Fixed plastic buttons ([Jobs 2007](https://singjupost.com/steve-jobs-iphone-2007-presentation-full-transcript/)). A finger covering a tiny screen ([Newsroom 2014](https://www.apple.com/newsroom/2014/09/09Apple-Unveils-Apple-Watch-Apples-Most-Personal-Device-Ever/)). Dead pixels around a camera ([Dye via 9to5Mac](https://9to5mac.com/2022/10/03/dynamic-island-ui/)). The novelty is the answer to that problem, never the starting point.
2. **Use a familiar form with an honest new job.** "the strangely familiar". A metaphor that copies the past makes "the information about what it does… wrong" ([Ive via New Yorker](https://www.idownloadblog.com/2015/02/16/jony-ive-new-yorker-interview/)). "strike a balance with what's familiar" ([WWDC23 10072](https://developer.apple.com/videos/play/wwdc2023/10072/)).
3. **Make the change structural, not decorative.** "not aesthetic. It's structural" ([WWDC13 201](https://asciiwwdc.com/2013/sessions/201)). "hierarchy should be expressed through layout and grouping" instead of decoration ([WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)).
4. **Give the new thing one simple spatial model.** "horizontally between apps… vertically to go home", with "a consistent offscreen path" ([WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)). People learn one rule, not many.
5. **Build interactive demos and hand them to others.** A demo "is really worth a million static designs" ([WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)). "Make fake apps, show people" ([WWDC14 223](https://developer.apple.com/videos/play/wwdc2014/223/)). Test on hardware that feels like the real thing ([Christie via WSJ](https://www.iphoneincanada.ca/news/apple-engineer-iphone-birth/)).
6. **Fence the new effect.** Glass belongs only on "the navigation layer", "avoid glass on glass" ([WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/)). "prefer subtle depth" ([WWDC23 10072](https://developer.apple.com/videos/play/wwdc2023/10072/)). Moderation in physics ([WWDC13 226](https://asciiwwdc.com/2013/sessions/226)). Playfulness lives in one functional spot, as in the Dynamic Island.
7. **Hold geometry to strict rules.** Concentric radii are the parent's radius minus the padding ([WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)). Content must "nestle" at its centroid, with "no wasted space" ([WWDC23 10194](https://developer.apple.com/videos/play/wwdc2023/10194/)). Precision is what makes a new shape feel inevitable rather than cute.
8. **Legibility outranks the effect, and type compensates for the material.** "legibility is our first concern" ([WWDC15 804](https://asciiwwdc.com/2015/sessions/804)). Body weight goes up to medium on glass ([WWDC23 10076](https://developer.apple.com/videos/play/wwdc2023/10076/)). Glass needs "clear separation from content" ([WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)).
9. **Cut your own launch feature when use proves it wrong.** Glances went after one year ([Macworld](https://www.macworld.com/article/228206/watchos-3-faq-glances-are-going-away-as-watch-apps-speed-up-and-move-to-a-dock.html)). Thin type gave way to San Francisco and Bold Text. Glass gained Tinted and then a slider ([Newsroom 2026](https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/)). Keep the idea and fix the excess.
10. **Simple means "exactly enough", not empty.** "simple, we don't mean minimal", and "every element earns its place" ([WWDC26 250](https://developer.apple.com/videos/play/wwdc2026/250/)). Don't show "everything on screen at once" ([WWDC15 802](https://developer.apple.com/videos/play/wwdc2015/802/)).

---

## What this means for a recipe app

These are constraints taken from the sources, not designs.

1. **Name the one problem a fresh look must solve before choosing a style.** For a cook, it is likely reading and following a recipe at a distance, with messy hands. Any new visual idea has to answer that problem, or it is the gimmick the owner fears (principle 1).
2. **Brand and colour belong in the content layer: food photos, the recipe itself.** Navigation and controls stay quiet and system-like. "move color into the content area" and use it "sparingly and with intention" ([WWDC26 251](https://developer.apple.com/videos/play/wwdc2026/251/)). This is the direct cure for "cartoony."
3. **Do not put text on busy food photos without a solid or strongly tinted separation.** That is exactly NN/g's complaint against Liquid Glass ([NN/g](https://www.nngroup.com/articles/liquid-glass/)). If a translucent material is used, make its text heavier and test it on the busiest photo in the catalogue.
4. **Allow at most one signature element, and fence it.** One functional, live spot, for example a running cooking timer, can have expressive motion, as the Dynamic Island does. All other motion stays quiet, with no overshoot (principle 6).
5. **Express hierarchy through order, spacing and grouping, not decoration.** The test is that "the most important item on the screen is always the most obvious one" ([WWDC26 250](https://developer.apple.com/videos/play/wwdc2026/250/)). On a recipe screen, that is the current step.
6. **Take corner radii and padding from one concentric rule, applied everywhere.** Strict, shared geometry reads as premium. Ad-hoc rounding reads as amateur ([WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/)).
7. **Judge directions as interactive prototypes on a real phone, held by someone else.** Static mock-ups are not enough. Cut the losers without arguing ([WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/), [WWDC14 223](https://developer.apple.com/videos/play/wwdc2014/223/)).
8. **Plan the fallback before shipping anything bold.** Every Apple reinvention needed a legibility retreat: Bold Text, Reduce Motion, Tinted, the slider. Design the high-contrast and reduced-motion states of the recipe app from day one. Do not add them after complaints.
