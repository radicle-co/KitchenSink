# The Apple tradition: what makes these designers great

Research note, 2026-10-20. It covers the Apple school of interface design and its main influence, Dieter Rams.

**Why this note exists.** The product owner calls our recipe app's design amateur, cartoony, dense and oversized ("designed for someone who wears reading glasses"). The team leaned on visual metaphors, and it used worst-case accessibility sizes as the default look. That complaint decided which lessons this note puts first. This note designs nothing.

**How to read the sources.**

- **Primary** means the person's own words, from a talk, interview, book, oral history or official Apple guideline that I opened myself.
- **Secondary** means a quote reported by someone else, or a page I was not able to open.
- **Unverified** means I did not find it in to a primary source.
- Many quotes came back cut short by the fetch tool. Where words are missing, the quote shows "…". I have not joined separate fragments into one sentence.

---

## 1. The most important finding

Apple's own rules do not use the largest sizes as the default look.

- iOS body text defaults to **17 pt**, and the minimum is **11 pt**. ([HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography). I read the text from the page's JSON data, because the page itself did not render for the tool.)
- Larger text comes from **Dynamic Type**, and the _person_ chooses it.
- The HIG says that when someone picks a larger size, "they typically want to make the content they care about easier to read; they don't always want to increase the size of every word on the screen." ([HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography))

So accessibility is a promise that the layout will scale on request. It is not a reason to draw every screen at the largest size. The default sizes, at the Large setting, are:

| Style       | Size / leading (pt) | Weight   |
| ----------- | ------------------- | -------- |
| Large Title | 34 / 41             | Regular  |
| Title 1     | 28 / 34             | Regular  |
| Title 2     | 22 / 28             | Regular  |
| Title 3     | 20 / 25             | Regular  |
| Headline    | 17 / 22             | Semibold |
| Body        | 17 / 22             | Regular  |
| Callout     | 16 / 21             | Regular  |
| Subhead     | 15 / 20             | Regular  |
| Footnote    | 13 / 18             | Regular  |
| Caption 1   | 12 / 16             | Regular  |
| Caption 2   | 11 / 13             | Regular  |

Notice two things in that table:

- Headline and Body are the **same size**. Only the weight differs.
- Every title is Regular weight.

Apple builds hierarchy mostly with weight, small steps in size, and colour. It does not use big jumps. The HIG says: "Adjust font weight, size, and color as needed to emphasize important information." It also warns that too many typefaces make an interface "feel internally inconsistent or poorly designed." ([HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography))

---

## 2. The people

### Dieter Rams (the main influence)

**Background.** Born in 1932 in Wiesbaden. His grandfather was a carpenter. He studied interior design at the Wiesbaden School of Arts and Crafts, then trained as an architect. He joined Braun in 1955, became head of design in 1961, and stayed until 1997. ([Vitsœ: Dieter Rams](https://www.vitsoe.com/us/about/dieter-rams))

**Mentality.** His ten principles are primary, published by Vitsœ ([Vitsœ: Good design](https://www.vitsoe.com/us/about/good-design)):

- **Unobtrusive.** Products are "like tools", so their design should be "both neutral and restrained, to leave room for the user's self-expression."
- **Honest.** Good design "does not make a product more innovative, powerful or valuable than it really is."
- **Long-lasting.** "It avoids being fashionable and therefore never appears antiquated."
- **Thorough.** "Nothing must be arbitrary or left to chance."
- **As little design as possible.** "Less, but better – because it concentrates on the essential aspects… Back to purity, back to simplicity."

He described the world he was reacting against as "An impenetrable confusion of forms, colours and noises." ([Vitsœ: Dieter Rams](https://www.vitsoe.com/us/about/dieter-rams))

### Jony Ive

**Background.** His father was a silversmith. Ive took a first-class BA in industrial design at Newcastle Polytechnic in 1989, worked at the agency Tangerine, and joined Apple in 1992. ([Wikipedia](https://en.wikipedia.org/wiki/Jony_Ive), secondary.) In his own words: "My father was a really good craftsman – he was a silversmith – so I grew up understanding how things were made." (_Vogue_, 2018, via [Wikiquote](https://en.wikiquote.org/wiki/Jonathan_Ive), secondary.)

**Skills.** Materials, making things by hand, and finish. "…it is only when you personally work with a material with your hands, that you come to understand its true nature…" (Dezeen, 2016, via [Wikiquote](https://en.wikiquote.org/wiki/Jonathan_Ive), secondary.)

**Process.** Ideas start fragile and need protection. At Stripe Sessions 2025 he said "these ethereal thoughts, these fragile concepts, are precarious", and that "it always starts off as a thought, and then a tentative discussion." He also said: "I know that I've missed really amazing ideas that came from a quiet place, from a quiet person." ([Stripe Sessions 2025 transcript](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary.)

**Care.** These lines are all from the same Stripe transcript ([Stripe Sessions 2025](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary):

- "I do believe that we have this ability to sense care."
- "you sense carelessness. You know carelessness."
- Care is "what we do when no one sees."
- "we designed everything, and we cared about everything."

**What he refuses.**

- Hollow minimalism. In the Stripe talk he rejected "desiccated, soulless" minimalism. Simplicity, for him, "is trying to succinctly express the essence of something, and its purpose, and its role in our life." ([Stripe](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary.)
- Style as a goal. "There's an applied style of being minimal and simple, and then there's real simplicity." (_Wired News_, 2003, via [Wikiquote](https://en.wikiquote.org/wiki/Jonathan_Ive), secondary.)
- Change for its own sake: "I have no interest in breaking stuff for the sake of breaking stuff." ([Stripe](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary.)

**Judging work.**

- "if something doesn't work, it's ugly." ([Stripe](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary.)
- "it's very easy for everybody to have an opinion—everybody does—it just doesn't mean every opinion has the same weight." ([Stripe](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), primary.)

**"Inevitable."**

- "We try to develop products that seem somehow inevitable." This comes from a 2012 _Telegraph_ interview, as reported by [iMore](https://www.imore.com/jonathan-ive-apples-designs-inevitable-important). The original is [here](https://www.telegraph.co.uk/technology/apple/9283706/Jonathan-Ive-interview-simplicity-isnt-simple.html), but the site blocked my tool, so I count this as secondary.
- The same report has: "Our products are tools and we don't want design to get in the way."
- The longer line, "you think 'of course it's that way, why would it be any other way?'", appears on [Wikiquote](https://en.wikiquote.org/wiki/Jonathan_Ive). Its sources conflict (_Icon_, 2003, or _Wired_, 2003), and it is marked "citation needed". **Secondary, source uncertain.**

**On the move away from metaphor (iOS 7, 2013).**

- "True simplicity is derived from so much more than just the absence of clutter and ornamentation… It's about bringing order to complexity." This is from the iOS 7 film, reported by [TechCrunch](https://techcrunch.com/2013/06/11/jony-ives-debutes-ios-7-bringing-order-to-complexity/amp/) and [Wikiquote](https://en.wikiquote.org/wiki/Jonathan_Ive). The wording differs a little between them, and I did not check it against the video.
- A TechRadar headline quotes him: "There was an incredible liberty in not referencing the physical world." ([TechRadar](https://www.techradar.com/news/phone-and-communications/mobile-phones/jony-ive-on-ios-7-there-was-an-incredible-liberty-in-not-referencing-the-physical-world-1182592).) I was able to read only the headline, so this is **secondary**.

### Alan Dye

**Background.** He studied at Syracuse University (graduated 1997, and no degree is named). He worked at Ogilvy & Mather's Brand Integration Group and at Kate Spade. He joined Apple in 2006 on packaging, worked on the iOS 7 design language, led Human Interface design from 2015, and led Liquid Glass in 2025. He left for Meta in December 2025. ([Wikipedia](https://en.wikipedia.org/wiki/Alan_Dye), secondary.)

**Skills and views.**

- On Liquid Glass: it "combines the optical qualities of glass with a fluidity only Apple can achieve," and "transforms depending on your content or context." ([Apple Newsroom, June 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/), primary.)
- The same release says controls "give way to content", and that tab bars shrink as you scroll.
- On how it is meant to land: "Most users probably won't be able to describe it, but I hope they can feel it." ([Cultured](https://culturedmag.com/article/2025/09/15/culture-art-apple-liquid-glass-artists/), secondary.)
- On Apple Watch: legibility on a tiny screen led to the San Francisco typeface. (Monocle, as summarised by [iMore](https://www.imore.com/apples-vp-human-interface-reveals-how-apple-made-its-hand-washing-app), secondary.)

**Counter-evidence to note.** Liquid Glass was criticised for legibility, and Apple added a toned-down "Tinted" option in iOS 26.1 ([Cultured coverage summary](https://culturedmag.com/article/2025/09/15/culture-art-apple-liquid-glass-artists/), secondary). Even Apple's best people can ship a material effect that competes with the content.

### Bas Ording

**Background.** He studied interaction design in the Netherlands and graduated in 1998. He chose Apple over MetaCreations after being "personally courted by Steve Jobs". He worked on Aqua animations in Mac OS X, then on the multitouch prototypes that became the iPhone. ([Computer History Museum oral history, 2017](https://www.computerhistory.org/collections/catalog/102738559). This is the museum's summary. I did not watch the recording.)

**Process.** He built working, interactive demos fast. These quotes come from Leander Kahney's ebook, excerpted at [Cult of Mac](https://www.cultofmac.com/news/bas-ording-rubber-band-effect-iphone). That makes them **secondary**.

- Jobs asked: "Can you build a demo that you can scroll through a list of names, so you could choose someone to call?"
- Ording: "I'm like, 'Ooh this is kind of fun,' and then, 'Oh wait, now it needs to move back,'"
- "I had to work on all these details, and it took actually quite a while to get it right."
- The test he used was feel: "it feels good, it's fun".

The rubber-band bounce at the end of a list came from this work.

### Ken Kocienda (_Creative Selection_, 2018)

**Background.** He was an Apple software engineer on Safari and on the iPhone keyboard and autocorrect. His education was not found in the sources I checked.

**Process.**

- "we tried to make demos and prototypes as opposed to writing design documents." ([Wharton interview transcript](https://mackinstitute.wharton.upenn.edu/2018/creative-selection-ken-kocienda/), primary.)
- From the book: "We always started small, with some inspiration. We made demos." and "Round after round of creative selection moved us step by step from the spark of an idea to a finished product." (Book text via [Goodreads](https://www.goodreads.com/work/quotes/59225508), secondary copy.)
- Leaders forced a choice. Jobs looked at two keyboard layouts and said "we only need one of these" ([9to5Mac](https://9to5mac.com/2018/09/04/creative-selection-book-available-now-the-creation-of-the-iphone-keyboard-apples-design-process-and-demoing-to-steve-jobs/), secondary). Kocienda: "he demanded that I choose one… I realized in the moment that I knew which one I liked better." ([Wharton](https://mackinstitute.wharton.upenn.edu/2018/creative-selection-ken-kocienda/), primary.)

**Taste.**

- "Taste is developing a refined sense of judgment and finding the balance that produces a pleasing and integrated whole." ([Goodreads](https://www.goodreads.com/work/quotes/59225508), book text.)
- His seven elements are inspiration, collaboration, craft, diligence, decisiveness, taste and empathy ([review](https://www.sachinrekhi.com/creative-selection-by-ken-kocienda), secondary).
- On editing: "Seeing good work wind up on the cutting room floor was part of the job." ([Goodreads](https://www.goodreads.com/work/quotes/59225508).)
- On judgement calls: "Heuristics are like this. They're subjective." ([Goodreads](https://www.goodreads.com/work/quotes/59225508).)

### Imran Chaudhri

**Background.** Born in London in 1973. He worked on Apple interfaces from 1995 to 2017, was on the original iPhone interface team, and co-created the home screen. ([Wikipedia](https://en.wikipedia.org/wiki/Imran_Chaudhri), secondary.) His own account: "I came to Apple in 95 as an intern in the Advanced Technologies Group." ([Input / Inverse iPad interview](https://www.inverse.com/input/tech/the-ipads-original-software-designer-and-program-lead-look-back-on-the-devices-first-10-years), primary.) His formal education was not found in the sources I checked.

**Mentality.** All from the same [Inverse interview](https://www.inverse.com/input/tech/the-ipads-original-software-designer-and-program-lead-look-back-on-the-devices-first-10-years), primary:

- He disliked research that never ships: "He wasn't a huge fan of research for research sake and I wasn't either."
- "There's a craftsmanship that goes into building compute devices."
- "We always need to look at what the real customer needs, even if the customer doesn't understand where things are going."

On restraint and calm, he said a phone needed "something to act as a gatekeeper". He meant Do Not Disturb, an early answer to notification noise. (Fast Company, 2018, via [Loop Insight](https://loopinsight.com/2018/08/27/the-iphones-original-ui-designer-on-apples-greatest-flaws). Fast Company blocked my tool, so this is secondary.)

### Greg Christie

**Background.** He joined Apple in 1996 to work on the Newton. He led the Human Interface group, and Scott Forstall brought him onto the iPhone project in 2004. He is named on the slide-to-unlock patent, and he retired in 2014. ([HotHardware](https://hothardware.com/news/behind-the-birth-of-the-iphone), reporting a WSJ interview, and [TechCrunch](https://techcrunch.com/?p=985884).) His education was not found in the sources I checked.

**Views.** Everything I found is press coverage of a 2014 WSJ interview I did not read, so all of it is **secondary**. He called the team "shockingly small" ([MacTrast](https://www.mactrast.com/2014/03/top-apple-engineer-greg-christie-gives-behind-scenes-look-development-original-iphone/)). Kahney's ebook credits him with "It was magic paper" ([Cult of Mac](https://www.cultofmac.com/news/bas-ording-rubber-band-effect-iphone)). **Unverified.**

### Susan Kare

**Background.** BA in art from Mount Holyoke, then an MA and PhD in fine arts from NYU (1978). She was a sculptor before Andy Hertzfeld recruited her for the Macintosh. She designed Chicago, Geneva and Monaco and the first Mac icons. ([Wikipedia](https://en.wikipedia.org/wiki/Susan_Kare), secondary.)

**Process.** All from the [Stanford oral history, 2000](https://web.stanford.edu/dept/SUL/sites/mac/primary/interviews/kare/mac.html), primary:

- She worked on screen in a basic icon editor. Hertzfeld later built a better one.
- She offered options rather than one answer: "to provide a rich selection of choices, and see what works."
- She was wary of metaphor. For the Command key, after literal ideas failed: "So I said, 'Let's try something abstract.'" The result "lent itself to being digital without being jagged."
- On what feels easy: "I think you get an overall perception that something's easy to use when the design is sparse, when it's refined."
- On cleaning up: "I like to make things regular, and remove extraneous rectangles."
- Her test of an icon: "good icons are instantly recognizable."

Elsewhere she said the best icons work more like signage than illustrations ([MacTech, citing the Guardian](https://www.mactech.com/2003/06/12/original-mac-icon-designer-interviewed), secondary).

### Mike Matas

**Background.** Born in 1986. He worked at the Omni Group and Delicious Monster, then at Apple from 2005 on Mac OS X, iPhone and iPad interfaces. After that came Nest, Push Pop Press (_Our Choice_), Facebook Paper, Lobe and LoveFrom. ([Wikipedia](https://en.wikipedia.org/wiki/Mike_Matas), secondary, and [mikematas.com](https://mikematas.com).) His education was not found in the sources I checked.

**Skills.**

- Physics-driven touch interfaces, with no conventional buttons or menus in _Our Choice_ ([AppleInsider forum summary](https://forums.appleinsider.com/discussion/156932), secondary).
- Prototyping in Origami, a tool for physics-driven interface prototypes without code ([mikematas.com](https://mikematas.com), via a mirror, secondary).
- That he named "emotion" as the most important element of design is a paraphrase with no source ([gapingvoid](https://www.gapingvoid.com/the-balance-of-all-things/)). **Unverified.**
- I was not able to open his [TED 2011 talk](https://www.ted.com/talks/mike_matas_a_next_generation_digital_book) transcript.

### Loren Brichter

**Background.** BS in electrical engineering, with a minor in computer science, from Tufts. From 2006 to 2007 he was on the five-person iPhone graphics team. He then made Tweetie (where pull-to-refresh began) and Letterpress, and won an Apple Design Award in 2009. ([Wikipedia](https://en.wikipedia.org/wiki/Loren_Brichter), secondary.) He is an engineer who designs: the same person decides how it looks and makes it fast.

**Views.**

- On mobile screen space: corner toolbar space was "the most valuable real estate for navigation and action UI, so using it up for something as mundane as a refresh button just seemed wasteful." ([Wikipedia](https://en.wikipedia.org/wiki/Pull-to-refresh), quoting him, secondary.)
- His fix: "why not just make refreshing part of the scroll gesture itself? So it was kind of an obvious extension of a simple idea." ([MacStories](https://www.macstories.net/news/loren-brichter-talks-about-pull-to-refresh-patent-and-design-process/), reporting the [One More Thing podcast](http://onemorething.com.au/one-more-thing-podcast-5-loren-brichter/).)
- On balance: "It had to be fast, full-featured without being complicated." He said Tweetie "struck the perfect balance between power and simplicity." ([Macworld](https://www.macworld.com/article/196311/tweetie_brichter_interview.html), primary.)
- His well-known 2008 post on fast scrolling in Tweetie was not found. **Unverified.**

### Marcos Weskamp

I found **no source tying Weskamp to Apple**, so this note does not claim one. He was Flipboard's design head from 2010. He described caring about how the eye moves between headlines, images and stories, and wanted reading to feel like flipping a magazine ([ifanr, Chinese-language, reporting Mashable](https://www.ifanr.com/96471), secondary). Zeldman praised Flipboard's "typographic excellence" ([zeldman.com](https://zeldman.com/2010/12/16/flipboard-update-preview), secondary).

### Others the sources point to: Apple's own interface teams

The WWDC sessions are first-hand statements by Apple's interface designers.

**"Designing Fluid Interfaces", WWDC18 session 803** (Chan Karunamuni, Nathan de Vries, Marcos Alonso). All quotes are from the [session transcript](https://developer.apple.com/videos/play/wwdc2018/803/), primary:

- A fluid interface is "when the tool feels like an extension of your mind."
- "it's not just about framerate. It's what's in the frames."
- On lag: "people are really, really sensitive to latency."
- Motion must be interruptible, so that people can "layer gestures at the speed of thought."
- Springs are described by damping and response, not by duration.
- "we recommend starting with 100% damping, or no overshoot."
- "A spring doesn't need to overshoot. You don't need to use springy springs."
- Overshoot is earned only "if the gesture that's driving the motion itself has momentum, then you should reward that momentum with a little bit of overshoot."
- "bounciness needs to be purposeful."
- "we need to respect that tools, when they're used with purpose, require us to not be in the way… not get in the way with introducing unnecessary motion."
- On flicks: "remember to project momentum." In other words, aim for where the user's flick is heading, not where the finger stopped.

**"The details of UI typography", WWDC20 session 10175** (Loïc Sander, Jiang Jiang). All quotes are from the [session transcript](https://developer.apple.com/videos/play/wwdc2020/10175/), primary:

- "When type becomes smaller, letters tend to need more space between them."
- Tracking "should be size specific."
- SF has a Text cut for sizes under 20 pt and a Display cut for 20 pt and up.
- Tight leading takes two points off the line height, and loose leading adds two. Tight leading can "increase the information density", but long text needs "a bit more breathing room."
- "there is such a thing as too much tracking."
- "You should only override the default system behavior in exceptional cases, and let the system do the right thing for you for the rest of them."

**"Essential Design Principles", WWDC17 session 802** (Apple. I did not confirm the speaker's name.). All quotes are from the [session transcript](https://developer.apple.com/videos/play/wwdc2017/802/), primary:

- "Text in your app should have a limited number of font faces and sizes and colors and so forth."
- "Being consistent takes self-control and restraint."
- "Too much feedback is annoying. Too much visibility is distracting."
- On metaphor: "The button, after all, is just a highly abstracted version of a physical, real-world button." The rounding of the corners is enough to make that link.

**iOS 7 Human Interface Guidelines, 2013–14.** I read these from a university-hosted copy that came up in search ([PDF](https://www.evl.uic.edu/datsoupi/420_14/docs/MobileHIG.pdf). The link now returns 404, and the text was confirmed by the search snippet):

- "Deference. The UI helps users understand and interact with the content, but never competes with it."
- "Clarity. Text is legible at every size, icons are precise and lucid, adornments are subtle and appropriate…"

---

## 3. Across the group

**Backgrounds.** Few of them trained as "UI designers". They came from:

- craft and industrial design (Ive, Rams)
- fine art and sculpture (Kare)
- interaction design (Ording)
- engineering (Brichter, Kocienda)
- advertising and brand (Dye)

What they share is deep skill in one making discipline, plus the habit of building the real thing.

**Skills they rely on.**

- **Type:** the system font, small steps in size, hierarchy from weight, and tracking that depends on size.
- **Motion and physics:** springs, momentum and interruption.
- **Materials:** Ive and Dye on glass and finish.
- **Engineering:** Brichter, Ording and Kocienda built what they designed.

**Process.**

- Start small, with one idea.
- Build a working demo early, not a document (Kocienda, Ording, Matas).
- Make several options (Kare), then force a choice (Jobs's "we only need one of these").
- Throw away good work (Kocienda's cutting-room floor).
- Judge by touching it ("it feels good").

**Mentality.**

- Care that shows even where nobody looks (Ive).
- Restraint: "less, but better" (Rams), and "self-control and restraint" (WWDC17).
- Honesty: never make a thing look grander than it is (Rams).
- Taste as weighted judgement, not a vote (Ive, Kocienda).
- Function first: "if something doesn't work, it's ugly."

**Smooth, calm, refined, inevitable** looks like this:

- The UI defers to the content.
- There is little ornament.
- The type is regular-weight, with a narrow size range.
- Motion follows the finger, can be interrupted, and does not overshoot unless the gesture earned it.
- The solution looks obvious afterwards: Brichter's "obvious extension of a simple idea", Ive's "inevitable".

**Busy, cartoony, gimmicky or amateur** looks like this:

- Many fonts, sizes and colours.
- Bouncy springs with no momentum behind them.
- Ornament that competes with the content.
- Literal pictures where an abstract sign would do.
- Change for its own sake.
- Every word blown up.

**A caution on metaphor.** The Apple line is not "never use metaphor." Apple shipped heavy skeuomorphism before iOS 7. It still uses a folder for Files, and it calls Liquid Glass a "material". The consistent lesson is that metaphor must be **abstracted and must serve function**: a button is "a highly abstracted" real button, an icon is a sign rather than an illustration, and decoration is "subtle and appropriate". Literal, illustrative metaphor used as decoration is what the tradition moved away from.

---

## 4. Fifteen rules a designer can follow

1. **Design at the default size. Let people scale up.** iOS body text is 17 pt (11 pt minimum), and larger sizes are a user choice. Make the layout survive the largest size, but do not draw every screen at it. [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
2. **When text grows, grow what matters.** People "don't always want to increase the size of every word on the screen." [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
3. **Build hierarchy with weight before size.** Headline and Body are both 17 pt, and differ only in weight. Use few faces, sizes and colours. [HIG](https://developer.apple.com/design/human-interface-guidelines/typography), [WWDC17 802](https://developer.apple.com/videos/play/wwdc2017/802/)
4. **Keep weights in the middle.** Prefer Regular to Bold, and avoid Ultralight, Thin and Light for UI text. Heavy type everywhere reads as shouting. [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
5. **Respect the system's type details.** Use tracking that depends on size, use the right optical size, and override the defaults "only… in exceptional cases". [WWDC20 10175](https://developer.apple.com/videos/play/wwdc2020/10175/)
6. **Choose density on purpose.** Tight leading for compact lists, more "breathing room" for long reading such as recipe steps. [WWDC20 10175](https://developer.apple.com/videos/play/wwdc2020/10175/)
7. **The interface defers to the content.** Controls "give way to content", and the UI "never competes with it". For a recipe app, the food and the words are the content. [iOS 7 HIG](https://www.evl.uic.edu/datsoupi/420_14/docs/MobileHIG.pdf), [Apple Newsroom 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
8. **Abstract the metaphor, or drop it.** Use a sign, not an illustration. Try "something abstract", and keep adornments "subtle and appropriate". [Kare, Stanford](https://web.stanford.edu/dept/SUL/sites/mac/primary/interviews/kare/mac.html), [WWDC17 802](https://developer.apple.com/videos/play/wwdc2017/802/)
9. **Remove until it is sparse and regular.** "Remove extraneous rectangles", because sparse and refined reads as easy. Make it "as little design as possible". [Kare](https://web.stanford.edu/dept/SUL/sites/mac/primary/interviews/kare/mac.html), [Rams](https://www.vitsoe.com/us/about/good-design)
10. **Start motion at 100% damping.** Add overshoot only when a gesture with momentum earns it, because "bounciness needs to be purposeful." This is the cure for "cartoony". [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)
11. **Never make people wait on the interface.** People are "really, really sensitive to latency". Motion must be interruptible, and the design is judged by "what's in the frames", not the frame rate. [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)
12. **Prototype the real thing, early, and judge it by use.** Make demos, not documents, then ask whether "it feels good". [Kocienda, Wharton](https://mackinstitute.wharton.upenn.edu/2018/creative-selection-ken-kocienda/), [Ording, Cult of Mac](https://www.cultofmac.com/news/bas-ording-rubber-band-effect-iphone)
13. **Make several options, then force one choice, and cut the rest.** "we only need one of these", and good work ends up "on the cutting room floor". [9to5Mac](https://9to5mac.com/2018/09/04/creative-selection-book-available-now-the-creation-of-the-iphone-keyboard-apples-design-process-and-demoing-to-steve-jobs/), [Kocienda via Goodreads](https://www.goodreads.com/work/quotes/59225508), [Kare](https://web.stanford.edu/dept/SUL/sites/mac/primary/interviews/kare/mac.html)
14. **Fold features into the gesture instead of adding chrome.** Do not spend prime space on "something as mundane as a refresh button". Aim for the "obvious extension of a simple idea". [Brichter via MacStories](https://www.macstories.net/news/loren-brichter-talks-about-pull-to-refresh-patent-and-design-process/), [Wikipedia](https://en.wikipedia.org/wiki/Pull-to-refresh)
15. **Hold the finish to the standard of care.** People "sense carelessness". "Nothing must be arbitrary", and "if something doesn't work, it's ugly". Be honest: never dress a thing up as more than it is. [Ive, Stripe 2025](https://stripe.com/sessions/2025/a-conversation-with-sir-jony-ive), [Rams](https://www.vitsoe.com/us/about/good-design)
