# What makes today's best UI designers great

Research date: 2026-10-20. Every quote below was read from the linked page. Some pages did not open: Medium blocked every request, and some podcasts have no transcript. Where a claim comes from a summary, a reviewer or a profile, and not from the designer's own words, it is marked **(secondhand)** or **(unverified)**.

**Why this matters here.** The product owner calls the recipe app's design amateur, cartoony, dense and oversized ("designed for someone who wears reading glasses"). The team leaned on visual metaphors, and used worst-case accessibility rules as the default look. The lessons below are ordered by how directly they answer that.

---

## Part 1: The people

### Karri Saarinen and the Linear team

- **Background.** Grew up in Finland. Self-taught: he learned to build websites from library coding books. Then principal designer at Airbnb, head of design at Coinbase, and co-founder of Linear. Sequoia's profile mentions no degree ([Sequoia](https://sequoiacap.com/article/linear-spotlight/)).
- **Mentality.** "For me, work is serious." "If I'm building a house, I don't want my tools to be fun." He wants tools that are "professional", which he contrasts with the colourful, playful style common on web companies' sites. He calls good Scandinavian objects "honest": they do not draw attention to themselves ([Sequoia](https://sequoiacap.com/article/linear-spotlight/)). "If people are not raving about your product, then you probably don't have a good product" ([Figma blog](https://www.figma.com/blog/stripe-sessions-linear-figma/)).
- **2024 redesign goals.** "reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements." The team limited "how much chrome (blue in our case)" fed into the colour system, to "return to a more neutral and timeless appearance." They moved to the LCH colour space, where "a red and a yellow color with lightness 50 will appear roughly equally light". A single contrast variable gives "super high-contrast themes for users who need it for accessibility reasons." Headings use Inter Display and other text uses regular Inter. ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Process.** Yann-Edern Gillet's test: "How real could this concept car be?" They ran "stress tests (or crash tests…)" on each view type ("list, board, split, etc.") before writing code. Yann leaned on Apple standards "to get close to the feeling of a native app." On scope: "It's always better to do a redesign quickly." It took about six weeks ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **2026 refresh ("A calmer interface").** By Charlie Aufmann and Maxime Heckel. They wanted "a warmer gray that still feels crisp, but less saturated", and found that going too warm looked "muddy". The refresh "reduces icon usage, scales their sizes down", and removes decorative icon backgrounds. The sidebar is "a few notches dimmer", so the main content leads. The challenge was "preserving that rich density of information without letting the interface feel overwhelming." A dev toolbar switched between old and new designs in one click ([Linear](https://linear.app/now/behind-the-latest-design-refresh)).

### Emil Kowalski (Vercel, now Linear)

- **Background.** A design engineer. He was on Vercel's design team and now works on Linear's web team ([emilkowal.ski](https://emilkowal.ski/)). Education: not stated.
- **Taste.** Taste is "a trained instinct", not "personal preference". Build it like this: "Expose yourself to great work." Try to "rationalize why something feels great." And: "Your taste is good enough to tell that your work is not on par yet" ([Developing Taste](https://emilkowal.ski/ui/developing-taste)).
- **When to animate.** "How often users will see an animation is a key factor." ([You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations)). "Never animate keyboard initiated actions" ([Great Animations](https://emilkowal.ski/ui/great-animations)). In his published skill file: things seen 100+ times a day get "No animation. Ever." ([emil-design-eng SKILL.md](https://github.com/emilkowalski/skill/blob/main/skills/emil-design-eng/SKILL.md)).
- **Numbers.** "UI animations should generally stay under 300ms." "A 180ms dropdown animation feels more responsive than a 400ms one" ([source](https://emilkowal.ski/ui/you-dont-need-animations)). Use ease-out for things entering or leaving the screen. Use `scale(0.97)` on press. Never start from `scale(0)`; use "0.9+". Add `blur(2px)` to a crossfade that still feels off ([7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips)). His skill file adds:
    - curve `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.
    - press feedback 100–160ms, tooltips 125–200ms, dropdowns 150–250ms, modals 200–500ms.
    - "Never use ease-in for UI animations".
    - "Good defaults matter more than options" ([SKILL.md](https://github.com/emilkowalski/skill/blob/main/skills/emil-design-eng/SKILL.md)).

### Rauno Freiberg (The Browser Company, then Vercel)

- **Background.** Estonian. Studied economics but did not finish. Self-taught programmer. Worked on Arc at The Browser Company, then joined Vercel. Built cmdk **(secondhand profile, [yespress](https://yespress.io/rauno-freiberg.md))**.
- **Mentality.** Interaction design is "an artform to make experiences that fluidly respond to human intent." On repeated motion: "it does start to feel more like cognitive burden after seeing the same animation for the hundredth time." "I removed motion from core interactions and suddenly felt like I was moving much faster." Note: his line "Great interaction design rewards learning by reusing metaphors" is about _interaction_ metaphors, such as swiping like turning a page. It is not about decorative pictures ([Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design)).
- **Concrete rules** (his GitHub guidelines, [raunofreiberg/interfaces](https://github.com/raunofreiberg/interfaces)):
    - "Font weights below 400 should not be used."
    - "Medium sized headings generally look best with a font weight between 500-600."
    - "Animation duration should not be more than 200ms for interactions to feel immediate."
    - Dialogs: "fade opacity and scale from ~0.8". Buttons: "~0.96, ~0.9", not 0.8.
    - "Actions that are frequent and low in novelty should avoid extraneous animations."
    - Inputs at 16px or more, to stop iOS zooming in.
- **Vercel Web Interface Guidelines** (no author named) ([vercel.com](https://vercel.com/design/guidelines)):
    - "Every element aligns with something intentionally."
    - "Adjust ±1px when perception beats geometry."
    - "Child radius ≤ parent radius & concentric."
    - "Only animate when it clarifies cause & effect or when it adds deliberate delight."
    - "if the visual target is < 24px, expand its hit target to ≥ 24px. On mobile, the minimum size is 44px."

### Rasmus Andersson (Inter, Spotify, Facebook, Dropbox, Figma)

- **Background.** Swedish, lives in San Francisco. "Software is the medium through which I express myself" ([rsms.me/about](https://rsms.me/about/)). On Spotify's founding team **(secondhand podcast listing, [Changelog](https://changelog.com/person/rsms))**. Had made "a few display typefaces at Spotify" but "I'd never made a text typeface before" ([Figma blog](https://www.figma.com/blog/the-birth-of-inter/)).
- **Key idea.** "A lot of the Figma UI is typography based. We organize information in the UI largely through spacing and typography" ([Figma blog](https://www.figma.com/blog/the-birth-of-inter/)). In other words: hierarchy comes from type and space, not from boxes, colour or icons.
- **Craft details.** Inter's text cut "features a tall x-height to aid in legibility", with "ink traps". The display cut has "clean lines… for excellent rhythm of large text." ([rsms.me/inter](https://rsms.me/inter/)). His old tracking formula tightens letter-spacing as size grows: `tracking = -0.0223 + 0.185 × e^(-0.1745 × size)` ([dynmetrics archive](https://d.rsms.me/inter-website/v3/dynmetrics/)). That page gives no line-height formula. The "x-height = ¾ of cap height" figure is a Figma caption, not his words.

### Paul Stamatiou (Twitter, Limitless, Sesame)

- **Background.** Georgia Tech, BS in Computational Media (CS plus design). Nine years on Twitter's design team. Co-founded Limitless. Now head of design at Sesame ([paulstamatiou.com](https://paulstamatiou.com/)).
- **Mentality.** "Quality is the way you work." It is "the feeling that a lot of time and care went into creating the product: that someone has already thought of you." On small fixes: "One or two of them won't make a difference. But when you've fixed a dozen or so? It's noticeable." "Don't rely on a future release to clean up today's mess" ([Craft](https://paulstamatiou.com/craft)).
- **Process.** "Figma is where initial hunches live; a starting point. Not final designs." "it's not until I start building and really using it that I get more signal." Designers and engineers "could easily try 10 or more different values for a specific animation" in 30 minutes. ([Craft](https://paulstamatiou.com/craft)).

### Brian Lovin

- **Background.** Product designer and engineer, and co-host of the Design Details podcast **(secondhand, [Subtraction](https://subtraction.com/2014/04/13/brian-lovin-on-design-details))**.
- **Ideas.** "Visuals are inherently tied to usability, accessibility, copywriting, navigation, and hierarchy." Clients want help with the "something looks off" gap: "the tiny pixel bugs, the misalignments and misplaced typography" ([Design critique](https://brianlovin.com/writing/design-critique-for-fun-and-profit-7wDWkhw)). The post "Quality software" on his site (no byline, written as "we" after a talk with Marshall Bock) says: "Quality software knows when to stop adding features." "we notice quality more often by the presence of imperfections than by their absence" ([Quality software](https://brianlovin.com/writing/quality-software-YA7uK4E)).

### Julie Zhuo (Facebook)

- **Background.** Stanford computer science. Joined Facebook as an intern in 2006, later VP of product design. **(secondhand, [Wikipedia](https://en.wikipedia.org/wiki/Julie_Zhuo))**.
- **Ideas.** "Better design does not mean more design." "Do not judge a product's beauty by its aesthetics; judge it by how it made you feel" ([The Looking Glass](https://lg.substack.com/p/the-looking-glass-how-to-tell-if)). Her well-known Medium essays, such as "Junior designers vs. senior designers", did not open (Medium blocked access). **Nothing from them is quoted here (unverified).**

### Stripe: Katie Dill and Benjamin De Cock

- **Katie Dill.** Studied industrial design at Art Center. Was creative director at frog, then led design at Airbnb and Lyft, and now Stripe ([Webstock](https://www.webstock.org.nz/speakers/katie-dill/), [Creator Economy](https://creatoreconomy.so/p/how-stripe-crafts-quality-products-katie-dill)). She says:
    - "Craft is about the how." "You can have craft without quality, but rarely quality without craft."
    - "the problem with 'utility before beauty' is it can become an excuse to never get to the beauty part at all."
    - "It's those micro-decisions every day that slowly but surely will make your product mediocre."
    - In reviews: "just jump into the prototype or product, see it, and feel it." Teams "walk the store" and keep friction logs ([Creator Economy](https://creatoreconomy.so/p/how-stripe-crafts-quality-products-katie-dill)).
    - "The quality and details become the differentiation." "things that are beautiful are perceived to work better" ([Figma blog](https://www.figma.com/blog/stripe-sessions-linear-figma/)).
- **Benjamin De Cock.** Stripe UI designer ([Stripe blog](https://stripe.com/blog/connect-front-end-experience)), based in San Francisco ([Dribbble](https://dribbble.com/bdc/about)). Education: unverified. He says:
    - "You almost never want to use a built-in timing-function like ease-in, ease-out and linear." "in most cases you'll want to stay under 500 milliseconds." "Animations should never get in the way" ([Stripe blog](https://stripe.com/blog/connect-front-end-experience)).
    - "Actual speed barely matters. Perceived speed truly matters." ([Motionographer](https://motionographer.com/2015/07/06/user-interface-design-why-motion-matters/)). That article's "~300ms" and "only opacity and transform" are the writer's summary, not his words.
- **Stripe colour team (Daryl Koopersmith, Wilson Miner).** They wanted "vibrant colors that also met standards for accessibility." Their first accessible palette was "dark and muddy and it's difficult to tell the hues apart." So they used perceptual colour models, and the rule that colours "at least five levels apart" pass for small text ([Stripe blog](https://stripe.com/blog/accessible-color-systems)). This is the clearest proof that accessible and attractive are not opposites.

### Airbnb: Alex Schleifer and the DLS team

- **Alex Schleifer** (VP and later chief design officer): "Everyone sticking to a convention is far more important than finding the perfect convention." The DLS aims for designers and developers "to define new components together", and components "are called the same name and have the same core behaviors for everyone." "There are mechanics behind the magic" ([First Round](https://review.firstround.com/defining-product-design-a-dispatch-from-airbnbs-design-chief/)).
- **Karri Saarinen's "Building a Visual Language"** (the DLS essay): did not open. The often-quoted principles "unified, universal, iconic, conversational" are **unverified** here.

### Netflix: Navin Iyengar and Steve Johnson

- **Navin Iyengar.** Product designer on Netflix's mobile apps, website and interactive titles. His talk "Design like a Scientist: A/B Testing UX at Netflix" draws on "years of A/B testing on tens of millions of Netflix members" ([UX London](https://2018.uxlondon.com/speakers/navin-iyengar)). No primary quotes on visual craft were found.
- **Steve Johnson** (VP design). "Design without business is just decoration" ([GV](https://www.gv.com/news/netflix-design-steve-johnson)). His comments on the grid layout and "hundreds" of A/B tests are **secondhand** ([MobileSyrup](https://mobilesyrup.com/2019/03/20/reed-hastings-netflix-future-layout-magazine/)).
- **Reading (ours, not theirs).** At Netflix, taste is checked against real behaviour, not settled by opinion.

### Arc / The Browser Company

- Dustin Senos (design lead): "It felt like there was space to show up with a bit more of an opinion." "the room matters, too." ([Input](https://www.inverse.com/input/design/the-browser-company-arc-design-interview)).
- Nate Parrott's "fingerprints over consistency" is the podcast host's summary **(secondhand, [Dive Club](https://dive-club.beehiiv.com/p/fingerprints))**.
- **Reading (ours, not theirs).** Arc puts its personality in chosen places, on a conventional base.

### Things (Cultured Code) and Mela

- **Things.** Two Apple Design Awards ([culturedcode.com](https://culturedcode.com/things/)). All design praise on that page is from reviewers **(secondhand)**: "Things never feels messy or overbearing" (WIRED) and "Each animation is purposeful" (Craig Mod).
- **Mela** (by Silvio Rizzi, who made Reeder). It is the closest model for a recipe app. No interview with Rizzi on design was found. MacStories **(secondhand)** praises "clear, carefully laid out text", a "bright, yellow accent color", and a Cook mode that is "a sort of focus mode for cooking": one step at a time, with ingredients beside it. On iPhone a recipe is one column: image, description, ingredients, then steps ([MacStories](https://www.macstories.net/reviews/mela-an-elegant-and-innovative-recipe-and-cooking-app-for-iphone-ipad-and-mac/)).

### Jason Yuan (Mercury OS, Apple, New Computer)

- Northwestern student. He redesigned Apple Music on his own after being turned down for an internship ([Northwestern](https://design.northwestern.edu/news-events/articles/2017/student-redesigns-apple-music.html)). Claims of a RISD BFA, a theatre degree and Apple Human Interface work come from a profile site **(unverified, [me.sh](https://me.sh/profile/jason-yuan))**.
- His Mercury OS essay did not open (403). Its principles ("humane, fluid, focused, familiar") and his "work backward from the feeling" process are known only from summaries **(secondhand, [Beebom](https://beebom.com/mercury-os-operating-system-concept/amp/))**.

### Others the sources pointed to

- **Apple Human Interface Guidelines** (the standard Linear's Yann says he leaned on). Default body text on iOS is 17 pt, and the minimum is 11 pt. "avoid Ultralight, Thin, and Light font weights." "Minimize the number of typefaces." Dynamic Type "let[s] people choose the text size that works for them" ([Apple HIG, Typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

---

## Part 2: Across the group

**Background.** Few came through design school. Saarinen (no degree mentioned) and Freiberg largely taught themselves. Zhuo studied computer science, and Stamatiou studied CS plus design. Dill trained in industrial design. Most of them build in code, or work right next to it, so their taste is tested in the real material and not in static pictures.

**Knowledge.** Typography (weight, size, tracking, x-height). Perceptual colour (LCH at Linear, perceptual models at Stripe). Motion (easing, duration, interruption). Platform conventions (Linear "relied on Apple standards").

**Process.** Explore roughly in Figma, "where initial hunches live" (Stamatiou). Build a "concept car" and stress-test it on the hardest real screens (Linear). Prototype in code and live in it (Stamatiou, Dill). Compare old and new side by side (Linear 2026). Judge by using it end to end: "walk the store" and keep friction logs (Dill). At Netflix, test with real users.

**Mentality.**

- Restraint is the default. "Better design does not mean more design" (Zhuo). "Quality software knows when to stop adding features" (Lovin).
- Tools should be serious, not fun (Saarinen).
- Refuse "good enough" (Dill).
- Taste is trained by studying great work and explaining why it works (Kowalski).
- Quality is felt as many small fixes added together (Stamatiou, Lovin).

**What makes an interface feel calm and premium (quoted words are theirs):**

- less visual noise and chrome colour, and a "neutral and timeless" look (Linear).
- fewer and smaller icons, with no decorative backgrounds (Linear 2026).
- a dimmer frame so the content leads (Linear 2026).
- hierarchy made "through spacing and typography" (Andersson).
- objects that are "honest" and do not draw attention to themselves (Saarinen).
- fast, rare and purposeful motion (Kowalski, Rauno, De Cock).
- tidy alignment that "you'll feel after a few minutes" (Linear).

**What makes an interface feel busy, cartoony or amateur (quoted words are theirs):**

- tools that try to be "fun", with the playful look he contrasts with "professional" tools (Saarinen).
- too much colour in the chrome (Linear).
- decorative icon backgrounds (Linear 2026).
- "dark and muddy" colours from blunt accessibility fixes (Stripe).
- slow or ever-present animation, things growing from `scale(0)`, or ease-in (Kowalski, Rauno).
- light font weights (Apple, Rauno).
- too many typefaces (Apple).
- misalignments and "misplaced typography" (Lovin).

**The accessibility point (the key one for this team).** None of these designers trades accessibility away. But they meet it in ways that do not make the default screen look big or clumsy:

- **Make the hit area big, not the visible control.** Vercel: "expand its hit target", to 44px on mobile.
- **Let people scale text up themselves.** Apple sets 17 pt body as the default, and Dynamic Type lets each person "choose the text size that works for them".
- **Offer high contrast as an option.** Linear's high-contrast theme exists "for users who need it".
- **Fix colour with better colour science, not by darkening everything.** Stripe used perceptual colour models.

So accessibility is a floor plus a set of user controls. It is not a reason to make the default screen oversized.

---

## Part 3: The 15 most useful rules

1. **Meet accessibility through hit areas and user settings, not a giant default.** Keep text and controls at platform-normal size. Make each touch target at least 44px, even when the visible control is smaller. Support Dynamic Type and a high-contrast option. Never go below the standards. Sources: [Vercel](https://vercel.com/design/guidelines), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)
2. **Start body text at the platform default.** That is 17 pt on iOS, and 16px or more in web inputs. Size up only for a reason. Sources: [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography), [Rauno](https://github.com/raunofreiberg/interfaces)
3. **Build hierarchy from type and space first.** Use boxes, colour and icons only after that. Sources: [Andersson](https://www.figma.com/blog/the-birth-of-inter/), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)
4. **Use regular to semibold weights.** Nothing below 400. Use 500–600 for medium headings. Keep heavy weights rare. Sources: [Rauno](https://github.com/raunofreiberg/interfaces), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography)
5. **Use one type family, with a display cut for large sizes.** Tighten letter-spacing as the size grows. Use tabular numbers for quantities and timers. Sources: [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [rsms.me/inter](https://rsms.me/inter/), [dynmetrics](https://d.rsms.me/inter-website/v3/dynmetrics/)
6. **Keep the frame neutral, with one accent colour.** Take colour out of the chrome. Use slightly warm, low-saturation greys, but not so warm that they look muddy. Sources: [Linear 2024](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear 2026](https://linear.app/now/behind-the-latest-design-refresh), Mela's yellow accent ([MacStories, secondhand](https://www.macstories.net/reviews/mela-an-elegant-and-innovative-recipe-and-cooking-app-for-iphone-ipad-and-mac/))
7. **Pick colours in a perceptual colour space.** Then accessible contrast does not have to look "dark and muddy". Sources: [Stripe](https://stripe.com/blog/accessible-color-systems), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)
8. **Use fewer, smaller icons, and no decorative backgrounds behind them.** Dim the navigation so the content leads. Sources: [Linear 2026](https://linear.app/now/behind-the-latest-design-refresh)
9. **Be serious and honest, not "fun".** Skip illustration and decoration that draws attention to itself. Reuse _interaction_ metaphors, like swipe-to-turn, not visual ones. Sources: [Saarinen](https://sequoiacap.com/article/linear-spotlight/), [Zhuo](https://lg.substack.com/p/the-looking-glass-how-to-tell-if), [Rauno](https://rauno.me/craft/interaction-design)
10. **Decide whether to animate by how often people see it.** Do not animate actions people repeat many times a day. Animate only to explain a change. Sources: [Kowalski](https://emilkowal.ski/ui/you-dont-need-animations), [Rauno](https://github.com/raunofreiberg/interfaces), [Vercel](https://vercel.com/design/guidelines)
11. **Keep motion short, and use ease-out curves.** The sources give different ceilings: ≤200ms (Rauno), under 300ms (Kowalski), under 500ms (De Cock). Most controls land at 150–250ms. Use a custom ease-out such as `cubic-bezier(0.23, 1, 0.32, 1)`, never ease-in, and make motion interruptible. Sources: [Kowalski](https://github.com/emilkowalski/skill/blob/main/skills/emil-design-eng/SKILL.md), [Rauno](https://github.com/raunofreiberg/interfaces), [De Cock](https://stripe.com/blog/connect-front-end-experience)
12. **Keep motion small.** Scale to 0.95–0.98 on press. Enter from about 0.9 with a fade, never from 0. Keep blur to a small amount. Sources: [Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips), [Rauno](https://github.com/raunofreiberg/interfaces)
13. **Align everything to something, and correct by eye.** Shift by ±1px where it looks better. Child corners should be no rounder than their parent's. Sources: [Vercel](https://vercel.com/design/guidelines), [Lovin](https://brianlovin.com/writing/design-critique-for-fun-and-profit-7wDWkhw)
14. **Stress-test the design on the hardest real screens, in code.** Test a long recipe, many ingredients and dense lists. Compare old and new side by side. Sources: [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear 2026](https://linear.app/now/behind-the-latest-design-refresh), [Stamatiou](https://paulstamatiou.com/craft)
15. **Judge by using the product end to end, and refuse "good enough".** Keep a friction log, fix the dozen small things, and check choices against real behaviour. Sources: [Dill](https://creatoreconomy.so/p/how-stripe-crafts-quality-products-katie-dill), [Stamatiou](https://paulstamatiou.com/craft), [Iyengar](https://2018.uxlondon.com/speakers/navin-iyengar), [Kowalski](https://emilkowal.ski/ui/developing-taste)
