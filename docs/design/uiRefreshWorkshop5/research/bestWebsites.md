# Best-designed websites and web apps: what the evidence says

Researched 2026-10-20. This is a reference set for judging design work on a recipe app (web and mobile). The owner wants the app to feel fresh, clean, calm and premium. It is not a design.

## How to read this

- A **quote** in quotation marks was read on the source page itself. Anything I saw only in a search summary is written as a paraphrase ("X reports that…"), with no quotation marks.
- **Independent source** means a separate author or jury. The company's own blog counts as evidence of intent, not as outside praise.
- **Not counted.** Many sites now publish machine-built "DESIGN.md" copies of famous brands (opendesigner, open-design, hagicode, webdesignhot, shadcn.io/design, kombai), and some vendors sell "Notion-style" illustrations. These sites are reconstructions or sellers, so I count them as zero sources. I also dropped one AI-generated video summary.
- **Product vs marketing.** A marketing page is seen once, so it can afford spectacle. A product is used every day. Product evidence is weighted higher, because a recipe app is used every day.

## The main finding: awards and craft point in different directions

The big award shows mostly reward one-off spectacle. The sites designers cite as the standard for daily craft rarely win them.

**Awwwards Site of the Year, 2017–2025.** The listing at https://www.awwwards.com/websites/sites_of_the_year/ shows these winners:

- Lando Norris and Messenger (2025)
- Igloo Inc, Don't Board Me and Opal Tadpole (2024)
- Lusion v3, Noomo Agency and Mana Yerba Mate (2023)
- KPR, The Other Side of Truth and Persepolis Reimagined (2022)
- Pangram Pangram Foundry, Star Atlas, Prometheus Fuels, Umami Land and Chungi Folio (2021)
- Mammut, Kode Sports Club, Dark: Official Netflix Guide, Synchronized and Pioneer (2020)
- Bruno Simon Portfolio, MA, The Cool Club x FWA and Nomadic Tribe (2019)

Nearly all are portfolios, campaigns or agency showreels. **None is a tool people use every day.** The 2025 winners page (https://www.awwwards.com/annual-awards/winners) names Lando Norris as both the jury and the Users' Choice Site of the Year.

**Where the craft favourites stand at Awwwards.**

- stripe.com's Awwwards page shows only "Nominee - Apr 8, 2016" (https://www.awwwards.com/sites/stripe).
- I found no Awwwards page for linear.app, vercel.com, raycast.com or notion.so (each returned 404).
- An Awwwards listing shows a Stripe _event microsite_ (Stripe Sessions 2024) with an Honorable Mention. That is a campaign page, not the product.

**Webby "Best Visual Design" goes the same way.**

- 2020: Lusion won Aesthetic, and Google's Material Design Dark Theme guidelines won Function in apps (https://en.wikipedia.org/wiki/2020_Webby_Awards).
- 2019: "Your 2018 Wrapped" won Web Aesthetic, and Calm won App Aesthetic (https://en.wikipedia.org/wiki/2019_Webby_Awards).

**Practitioners explain why spectacle is wrong for daily use.**

- Emil Kowalski, design engineer, in "You Don't Need Animations" (https://emilkowal.ski/ui/you-dont-need-animations):
    - "How often users will see an animation is a key factor in deciding whether to animate or not."
    - On a component used "multiple times a day", motion "would quickly become irritating."
    - On Raycast: "there's no animation at all. That's the optimal experience."
    - "Unless you are working on marketing sites, your animations have to be fast… UI animations should generally stay under 300ms."
- Rauno Freiberg, "Invisible Details of Interaction Design", July 2023 (https://rauno.me/craft/interaction-design):
    - Repeated motion in a command menu "does start to feel more like cognitive burden after seeing the same animation for the hundredth time."
    - macOS context menus appear without animation, which suits their high frequency.

**What this means.** Use Awwwards, CSSDA and FWA winners as a source of ideas, never as the bar for a daily-use app. They reward the opposite of calm.

**Galleries.** Lapa Ninja, Land-book, SaaSFrame and SiteInspire blocked automated access (403/429), and godly.website now redirects to a different site (recent.design). I did not verify any gallery listing. Being listed in a gallery is not a ranking anyway, because each one holds thousands of sites. Refero and Nicelydone say they index screens from Linear, Notion and Stripe. Those are the vendors' own claims, and they show these apps are used as reference, not that they rank first.

## Agreement table

| Site                  | Independent sources found                                                               | Years     | Kind                      | Evidence strength                          |
| --------------------- | --------------------------------------------------------------------------------------- | --------- | ------------------------- | ------------------------------------------ |
| Linear                | 4: Hobday, Ginn, Coyier, Studio Maydit, plus Linear's own redesign notes                | 2023–2026 | Product **and** marketing | Strongest                                  |
| Stripe                | 4: Hobday, Eleken, UXPin, Studio Maydit (indirectly), plus Stripe's own blog            | 2016–2026 | Mostly marketing site     | Strong, but it is about the marketing page |
| Vercel                | 2: Studio Maydit, Kowalski/Rauno (Vercel staff), plus Vercel's own published guidelines | 2023–2026 | Product + marketing       | Medium                                     |
| Raycast               | 2: Kowalski, Studio Maydit                                                              | 2023–2026 | Product                   | Medium (praise is for the app's behaviour) |
| Arc                   | 3 app reviews: Inverse, TechRepublic, Cool Hunting                                      | 2022–2024 | Product (app, not a site) | Medium, but **Arc is discontinued**        |
| Apple                 | Blog-level only (UX Planet blocked, others are clones)                                  | n/a       | Marketing                 | **Weak / single-source**                   |
| Notion                | Clone sites and illustration sellers only                                               | n/a       | Product + marketing       | **No credible source found**               |
| Figma                 | Nothing found                                                                           | n/a       | n/a                       | **No evidence**                            |
| NYT Cooking           | 4: Webby 2017, It's Nice That 2014, Pratt 2023 and 2025                                 | 2014–2025 | Daily-use product         | Strongest food site                        |
| Bon Appétit           | 2: Webby 2020, The Pubcast 2015                                                         | 2015–2020 | Editorial                 | Medium                                     |
| Food52                | Awards are for writing, not design                                                      | 2012–2015 | Editorial + shop          | Not design evidence                        |
| Serious Eats, Kinfolk | 1 or 0 each                                                                             | 2015      | Editorial                 | **Single-source**                          |

## Product and craft sites

### 1. Linear (linear.app): product and marketing

**Who ranks it.**

- **Anthony Hobday** (designer), "A critique of the Linear website", January 2023 (Wayback copy of https://anthonyhobday.com/blog/20230119.html). He says: "Few companies have had as much impact on modern websites as Linear. In that sense, they have inherited Stripe's crown." He adds: "Linear deserves their crown as trend-setters."
- **Daryl Ginn**, "The Linear effect", Rectangle, 10 January 2023 (https://rectangle.substack.com/p/the-linear-effect). He says: "They've been setting the bar high for web design and product design", and that they "really polish their design work with beautiful interactions, gradients and subtle animation."
- **Chris Coyier**, Frontend Masters blog, 16 February 2024 (https://blog.master.dev/the-linear-look/). He says: "If there is any one web design style trend that is dominant right now, it's The Linear Look."
- **Studio Maydit**, Siddarth Ponangi, updated 5 July 2026 (https://studiomaydit.com/blog/linear-vercel-raycast-aesthetic). This piece covers Linear, Vercel and Raycast together.

**Why it feels premium, as reviewers describe it.**

- **Restraint.** Hobday: "Linear's lighting effects are unusually subtle… it doesn't draw attention to itself. The sign of an expert touch."
- **Time spent.** Hobday reports that the site took "four months", and that Linear named December 2022 "polishing season".
- **Type and colour.** Studio Maydit: "The look starts with type, not colour", "near-greyscale with a single, deliberate accent colour used sparingly", and "The confidence to leave things out is what reads as premium."

**The product, which is the part that matters most here.** Linear's own redesign post, 28 March 2024 (https://linear.app/now/how-we-redesigned-the-linear-ui), states these goals:

- "reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements"
- "return to a more neutral and timeless appearance"
- "making our text and neutral icons darker" to improve contrast
- theme colours built in LCH, "one of the closest color spaces to the human eye"
- "Inter Display to add more expression to our headings while maintaining their readability."

This is evidence of intent, not outside praise. It is still the most useful product-level description in this whole set.

**Warning.** The dark, glowing marketing look is the part people copy, and it does not fit everyone. Hobday: it "has unfortunately started a trend which many websites adopt even if it doesn't suit their brand." The light pulses and star fields are marketing spectacle. The lesson for a recipe app is the product's quietness, not the dark hero.

### 2. Stripe (stripe.com): mostly the marketing site

**Who ranks it.**

- **Hobday**, "A critique of the Stripe website", August 2022 (Wayback copy of https://anthonyhobday.com/blog/20220810). He says: "If you asked 100 designers to think of a website with good visual design, 'Stripe' would cross many of their minds."
- **UXPin**, 2026 list (https://www.uxpin.com/studio/blog/good-website-designs-examples/), which ranks it first. It says Stripe "consistently sets the standard for developer-focused web design. The site uses clean typography, generous white space, and subtle gradient animations."
- **Eleken**, Maksym Chervynskyi, updated June 2026 (https://www.eleken.co/blog-posts/making-it-like-stripe). He says: "Stripe's website is an example of good design."
- Hobday's Linear essay uses Stripe as the benchmark ("inherited Stripe's crown").

**Why it feels premium.**

- **Hobday's summary**: "Simple design, a few centrepieces, and impressive details." Text gets "a simple approach", because "If you try to be clever with text, you often get an unreadable mess."
- **Small details**, from Hobday:
    - In the menu, the grey area is inset so the white "acts as a border."
    - The grid is made "subtly explicit" with "faint grey lines."
    - Diagonal stripes mostly mark background transitions, so they "don't get in the way of the content."
- **Time spent.** Hobday quotes Stripe (via Designer Fund): "We would say we simply spend 20x more time on this than what anyone else would."

**Product or marketing.** Almost all of this praise is about the marketing page, including the moving gradient and the 3D globe. Even Hobday notes the site was "trending towards 'normal'" by 2022. Eleken's warning applies directly: "copying gradients without copying the obsession behind them gets you nowhere", and "People visit Stripe's site not to enjoy its gradients, but to get their job done." Take Stripe's text discipline and detail work. Leave the gradient.

### 3. Vercel (vercel.com, Geist): product and marketing

**Sources.**

- Studio Maydit groups Vercel with Linear and Raycast.
- Vercel's own published **Web Interface Guidelines** (https://github.com/vercel-labs/web-interface-guidelines) are the clearest public statement of what "smooth" means in practice:
    - "Honor `prefers-reduced-motion`"
    - "Interruptible. Animations are cancelable by user input."
    - "Never `transition: all`"
    - "Optical alignment. Adjust ±1px when perception beats geometry."
    - "Tabular numbers for comparisons"
    - "Avoid widows/orphans"
    - "Optimistic updates. Update the UI immediately when success is likely."
- Rauno Freiberg, a Vercel design engineer who previously worked on Arc, wrote the frequency essay quoted above.
- Vercel's v0 product won a 2025 Webby for Developer Tools, according to Vercel's own press page. That award is for the product, not for the site's design.

**Strength.** Medium. The guidelines are company-authored, so they count as intent. They are useful because they are rules a reviewer can check, not opinions.

### 4. Raycast: product

**Sources.**

- Kowalski points to Raycast as "the optimal experience", because its main action has no animation.
- Studio Maydit names it as one of the three reference brands.

**Strength.** Medium. The evidence is about how the app _behaves_ (it is instant), not how its website looks.

### 5. Arc (The Browser Company): product, now discontinued

**Sources.**

- Inverse, Raymond Wong, December 2022 (https://inverse.com/gear/arc-web-browser-the-browser-company-josh-miller). He calls Arc "prettier, more powerful, and actually fun to use", and quotes CEO Josh Miller: "We open our browsers today and we feel nothing."
- TechRepublic describes a decluttered, minimal design (https://www.techrepublic.com/article/arc-browser-review/). This is a paraphrase from a search summary.

**Status.** Wikipedia reports that a 2025 blog post "announced that Arc would be sunset and no longer be actively developed", and that the company was bought by Atlassian (https://en.wikipedia.org/wiki/Arc_(web_browser)). Arc is useful as history, not as a living reference.

### Apple, Notion, Figma: weaker than their reputation

- **Apple.** The only analyses I found were blog posts (one blocked) and clone sites. Their praise centres on scroll-driven product animation, which is marketing spectacle. **Single-source at best.** Apple's site is not a daily-use product.
- **Notion.** Every source I found was a machine-built design copy or an illustration seller. **No credible source.** Its reputation is possibly deserved, but this research cannot show it.
- **Figma.** **No evidence found.**

## Food and recipe sites

### 1. NYT Cooking: daily-use product, the strongest food reference

**Sources.**

- **Webby Awards 2017**, press release (https://www.webbyawards.com/press/press-releases/21st-annual-webby-award-winners-announced/): "NYT Cooking won the Webby Award for Best Food & Drink Website (Websites)."
- **It's Nice That**, 15 May 2014 (https://www.itsnicethat.com/articles/web-the-new-york-times-cooking): "easily navigable to the extent that it's really rather more-ish". It describes the site as "half way between a pretty lifestyle supplement… and a handy tool."
- **Pratt Institute IxD critique**, February 2025 (https://ixd.prattsi.org/2025/02/design-critique-nyt-cooking-mobile-app/): "high-quality images and clean design", and the interface is "logical and highly usable."
- **Pratt IxD critique**, February 2023 (https://ixd.prattsi.org/2023/02/design-critique-nyt-cooking-ios-app). According to a search summary, it criticised how hard the grocery list is to find. Paraphrase only.

**What reviewers point to.** Large food photography, clean layout, and a tool-like recipe page. The 2025 critique also lists failures worth learning from:

- servings changes force "mental math" that "can lead to mistakes"
- the Recipe Box sections add "clutter"
- Recently Viewed is "only an endless scroll."

### 2. Bon Appétit: editorial

**Sources.**

- **Webby 2020**, General Websites, Food & Drink (https://en.wikipedia.org/wiki/2020_Webby_Awards).
- **The Pubcast**, Tori Beringer, 6 October 2015 (https://www.thepubcast.org/2015/10/06/bon-appetits-site-marries-web-and-magazine-design/). She writes: "With a clean white background, bright high-definition photos, and contrasting font weights and styles, magazine Bon Appetit's online presence is balanced and neat." She adds: "The presentation of primarily black text on a white page draws back to the company's roots, mimicking traditional print." The author was a graduate student, so weigh this source lightly.

**Takeaway.** Print-style black type on white, strong photos, and a clear type hierarchy between section header, headline, subtitle and byline.

### 3. Others: weak or single-source

- **Food52.** Its awards are for writing and publishing, not design. Wikipedia lists the James Beard "Publication of the Year (2012)" and IACP website awards (https://en.wikipedia.org/wiki/Food52). Not design evidence.
- **Kinfolk.** One 2015 agency blog pick (StrategiQ, https://strategiq.co/hub/web-top-5-week-30/) praised its "simple but slick appearance, defined by light, airy colours." **Single-source.**
- **Serious Eats.** No design ranking found.
- **Webby 2019 food apps.** The winners were The Oh She Glows Plant-Based Recipe App and Nom Nom Paleo (https://en.wikipedia.org/wiki/2019_Webby_Awards). **Single-source**, and with no design reasons given.

## Gaps and residual risk

- The Webby winners database renders with JavaScript, so I did not read the 2021–2026 Food & Drink website winners. This research possibly missed newer food winners.
- The gallery sites blocked me, so the gallery evidence the brief asked for is missing.
- Many "best SaaS sites" lists published in 2026 copy one another. I used only the ones I could read and quote.
- Every "why" comes from critics and designers. None comes from user research. Treat it as expert judgement, not proof that users prefer these designs.

---

## 1. Ranked shortlist of reference sites (product sites first)

1. **Linear (app first, then site).** Sources: Hobday 2023, Ginn 2023, Coyier 2024, Studio Maydit 2026, and Linear's own redesign notes 2024. It is the only site praised for both its product and its marketing.
2. **Raycast (app behaviour).** Sources: Kowalski, Studio Maydit. It is the reference for "instant, no motion on frequent actions."
3. **Vercel (product + Web Interface Guidelines).** Sources: Studio Maydit, Freiberg, and Vercel's own guidelines. It is the best checklist for "smooth".
4. **Stripe (marketing site, for text discipline and detail only).** Sources: Hobday 2022, UXPin 2026, Eleken 2026, Hobday 2023 (as the benchmark). Do not take its gradient or globe.
5. **NYT Cooking (daily-use product, food).** Sources: Webby 2017, It's Nice That 2014, Pratt 2023 and 2025.
6. **Bon Appétit (editorial, food).** Sources: Webby 2020, The Pubcast 2015.
7. _Arc (history only)._ Sources: Inverse 2022, TechRepublic. Discontinued in 2025.

Left out for lack of evidence: Apple (single-source, and spectacle-led), Notion (no credible source), Figma (none found), and all Awwwards Site of the Year winners (spectacle, not daily use).

## 2. Best food or recipe sites by the same test

1. **NYT Cooking.** It is the only food site with a verified design award plus independent critiques across 11 years, and it is a daily-use product.
2. **Bon Appétit.** It has a Webby (2020) and one independent review. It is editorial rather than a tool.
3. _(No clear third.)_ Food52's awards are for writing. Kinfolk and Serious Eats have one source or none.

## 3. What the shortlisted sites have in common

1. **Type first.** The look "starts with type, not colour" (Studio Maydit). It uses a clear scale and readable headings (Linear's Inter Display, Bon Appétit's weight contrast).
2. **Near-neutral colour with one accent, used sparingly** (Studio Maydit, and Linear's "neutral and timeless" goal).
3. **Simple text, with spectacle kept to a few places.** "Simple design, a few centrepieces, and impressive details" (Hobday on Stripe). In a daily-use app, make the food photo the centrepiece, not motion.
4. **Less visual noise, more contrast.** Darker text and icons, and quieter chrome (Linear 2024).
5. **No motion on frequent actions. Any UI motion stays fast (under 300ms)** (Kowalski, Freiberg). Spectacle belongs to marketing pages only.
6. **Respect for reduced motion, and animations the user can interrupt** (Vercel guidelines).
7. **Small details resolved:** optical alignment, inset surfaces, tidy line breaks, tabular numbers (Hobday on Stripe, Vercel guidelines).
8. **Instant feel.** Optimistic updates, so the app answers before the server does (Vercel guidelines, Raycast per Kowalski).
9. **Large, high-quality photos on a clean, white, print-like page** (Pratt on NYT Cooking, Pubcast on Bon Appétit).
10. **Copy the care, not the costume.** "Copying gradients without copying the obsession behind them gets you nowhere" (Eleken). Dark mode copied without reason "doesn't suit their brand" (Hobday).
