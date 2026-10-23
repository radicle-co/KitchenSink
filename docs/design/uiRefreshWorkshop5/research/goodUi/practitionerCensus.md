# Which apps practitioners name for good UI: a census

Researched 2026-10-22. This file counts how often practitioners name an app for really good UI. Practitioners here are designers, developers and product people. The sources are open threads and articles from 2022 to 2026. It is a count of opinion, not of awards. Jury awards are in `../bestApps.md` and `../mainstreamReferences.md` and are not repeated here. Nothing here is a design proposal.

## How to read this

- **What counts as one place.** Each of these counts as one place: a Reddit thread, a Hacker News (HN) story, an article, a podcast episode, or an awards event. Ten comments in one thread still count once.
- **Praise only.** A mention must praise the app's UI or UX to count. Criticism is recorded separately and never adds to the count. I read every hit by hand. Many automatic matches were false: hiring posts, bots, and "Spotify has the worst" all matched a keyword.
- **Not counted.** Agency and vendor blogs (Lazarev, 925studios, Phable, Freenance, Whalesync) and an app maker's own pages. They are named where useful, marked **[vendor]**. A sponsored post is not independent either. John Gruber's Copilot Money piece is a sponsor note, so I excluded it. It says: "My thanks to Copilot Money for sponsoring last week at DF" ([Daring Fireball, 2025-12-28](https://daringfireball.net/linked/2025/12/28/copilot-money)).
- **Quotes.** Reddit and HN quotes come from the raw comment text: Reddit from the Arctic Shift archive, HN from the Algolia API. Mobbin quotes come from the raw page. Quotes from other articles came through a fetch tool that summarises pages. Short quotes match what the tool returned, but I did not read those pages in full. Medium pages did not open, so the Medium items are **search snippets only**.
- **Who is speaking.** The split is by venue, because Reddit and HN do not say who is a designer.
    - **Designer venues:** r/UXDesign, r/UI_Design, r/FigmaDesign and r/web_design. Also the Mobbin Awards (its voters and its curators) and articles by named designers.
    - **User and developer venues:** r/iphone, r/iOSProgramming, r/androiddev and HN. Also Lenny's Podcast, whose guests are product leaders, not designers.
- **What I searched.** Reddit post titles in 22 subreddits from 2022 on, and the full comments (about 900) of the 17 threads that asked "which app has good UI". About 3,100 HN comments, plus an HN search for each app. 172 Lenny's Podcast transcripts, at the "favourite product you recently discovered" question. Articles from web search.
- **What failed.**
    - Arctic Shift's full-text comment search failed on every query ("Too many requests", "Timeout"). So Reddit coverage covers only threads whose **title** asked the question.
    - Medium returned 403, and the archive has no copy of the owner's article.
    - I found nothing usable from Sidebar, Designer News, Fast Company Design, It's Nice That, Smashing, Refero or Apple's "Apps We Love". Search returned only vendor listicles for "apps every designer should study".
    - X/Twitter, where much designer talk happens, was not searchable.

## The places that carry the most weight

### The Mobbin Awards (2025 edition, voted Feb to Mar 2026)

This is the only open designer vote I found. Mobbin is a widely used library of app screens for designers. The winners were "Chosen by your votes as the best in craftsmanship across iOS, Web, Sites, Animation, and Innovation". The finalists were picked by named curators: "Our expert curators reviewed hundreds of entries". The curators include Andy Allen (Not Boring Software), Sara Vienna (Chief Design Officer, Metalab), Tobias van Schneider (mymind) and Rafael Conde (Retro) ([mobbin.com/awards](https://mobbin.com/awards)). Note: `../mainstreamReferences.md` says Mobbin publishes no ranking. This vote is the exception.

| Category  | Winner (vote share) | Other finalists                             | Mobbin's reason (word for word)                                                                                                                                                  |
| --------- | ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS App   | Headspace (28%)     | Open, Suno, Arc Search, Family, Tolan       | "Headspace is a masterclass in designing for calm without losing clarity. Its signature smiley mascot pairs with a punchy palette that cuts through the typical wellness space." |
| Web App   | Airbnb (29%)        | Sana AI, Firecrawl, Discord, Fey            | "Airbnb approaches motion as a product principle, applying it consistently across an app that has grown considerably in scope without losing coherence."                         |
| Animator  | Duolingo (29%)      | Airbnb, Luma AI, mymind, Cosmos, pillowtalk | "Duolingo is in its own right, a lesson in motion design. Every interaction is purposeful, making feedback and progress immediately felt."                                       |
| Innovator | Claude (43%)        | Doji, ElevenLabs, Cursor, PamPam, Sunlitt   | "Claude doesn't reduce itself for mobile. Its full suite of features lives inside a minimal interface."                                                                          |

This is the strongest single signal in favour of **personality with calm**. Designers made the mascot-led wellness app with a "punchy palette" their iOS App of the Year. The vote share was 28%, so this is a plurality, not a majority.

### The owner's article (Medium, search snippet only)

The article is "My favorite 5 mobile apps based on their UX design". It is on Design Bootcamp, on Medium ([link](https://bootcamp.uxdesign.cc/my-favorite-5-mobile-apps-based-their-ux-design-a219a238631)). The page returned 403, so the author and date are unknown. The search snippet put Lemonade first and Headspace second. It praised Lemonade's plain-language coverage, its sliders that show the price change as you adjust cover, and its pink, illustrated style. Per the snippet, the author says they never expected to have fun with an insurance app **(unverified snippet)**. An exact-phrase search found no match, so I do not quote it. It is one personal list. No other place in this census named Lemonade.

### Daryl Ginn, "The Linear effect" (Substack, 2023-01-10)

Ginn is a well-known product designer. He says Linear has "been setting the bar high for web design and product design". He says the team does "really polish their design work with beautiful interactions, gradients and subtle animation". He also warns about the copies: "Until everyone gets a little too inspired." He names Stripe as the earlier trend-setter ([rectangle.substack.com](https://rectangle.substack.com/p/the-linear-effect)).

### Daniel Schwarz, LogRocket, "Linear design" (2025-06-07)

He says the style is "clean, clutter-free, and high-contrast" and gives "just one direction for your eyes to scan". He names Linear, Reflect, Stripe, Wise, Raycast and GitHub as examples ([blog.logrocket.com](https://blog.logrocket.com/ux-design/linear-design)).

## App by app

Counts are praise places. "D" = designer venues, "U" = user and developer venues.

### Restrained and minimal

**Linear: 8 places (D 3, U 5).**

- Designer venues: Ginn and LogRocket (above), plus a bare link in r/UXDesign's "What are some best-designed apps currently?" ([2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky6qioo/)).
- HN, "Sanding UI" thread (2024-09):
    - "Linear has the best UI/UX of all the web apps I have used. After Gmail and Google Maps, I don't recall any other web app wowing me as much as Linear." ([HN 41618126, 2024-09](https://news.ycombinator.com/item?id=41618126))
    - "It is extremely polished and snappy" ([HN 41615289, 2024-09](https://news.ycombinator.com/item?id=41615289))
- HN, elsewhere:
    - "the slick and fast UI from Linear" ([HN 41835382, 2024-10](https://news.ycombinator.com/item?id=41835382))
    - "genuinely blown away by the polish and experience relative to their team si[ze]" ([HN 44803142, 2025-08](https://news.ycombinator.com/item?id=44803142))
    - "Linear away from its great UI, speed" ([HN 33157052, 2022-10](https://news.ycombinator.com/item?id=33157052))
- Lenny's Podcast, Gaurav Misra: "My favorite product, honestly, is Linear... just because it's so well-designed and it's so easy to use" ([YouTube, 2023-02-12](https://www.youtube.com/watch?v=dLku0AiGPVA)).
- **Reasons that recur:** polish, speed, subtle motion.
- **Criticism:** the same reasons are why it gets copied until everything "looks monotonous" **[vendor: 925studios, via search]**.

**Things 3: 6 places (U 6).**

- "Things, I think, still stands out as having an exceptional UI, that is clear and easy to use, with lots of great custom animations" ([r/iOSProgramming, 2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmiykel/)).
- It sits in favourites lists in r/iphone's "best designed iOS apps" thread ([2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0xofh8/)).
- HN:
    - "Things 3 has bar-none the best UI of any app" ([HN 33044005, 2022-10](https://news.ycombinator.com/item?id=33044005))
    - "A simple and very polished to-do app" ([HN 40628069, 2024-06](https://news.ycombinator.com/item?id=40628069))
    - "These apps are incredibly well designed", of Things, Bear, Mela and others ([HN 37552112, 2023-09](https://news.ycombinator.com/item?id=37552112))
    - A quoted blog verdict: "Beautiful. Expensive. Tricked me into thinking I had my life together" ([HN 44866796, 2025-08](https://news.ycombinator.com/item?id=44866796))
- No designer-venue mention in this window.

**Arc (and Arc Search): 4 places (D 1, U 3).**

- Mobbin iOS finalist (Arc Search).
- HN: "a browser built with craft" ([HN 38649996, 2023-12](https://news.ycombinator.com/item?id=38649996)). Also its "beautiful interface (which till this day is—after Apple's—the most crafted and beautiful one)", from a user who then left over bugs ([HN 45133104, 2025-09](https://news.ycombinator.com/item?id=45133104)).
- Lenny's Podcast, Noam Lovinsky (Chief Product Officer, Grammarly): "I love the animation when you download something. I mean just like all of the little things" ([YouTube, 2024-03-17](https://www.youtube.com/watch?v=a_W5Rn0bJWE)).
- **Criticism:** "the desktop was broken in so many different places" (same HN comment).

**Apollo for Reddit: 5 places (D 1, U 4).** It was shut down in 2023, but people still name it.

- "my favorite looking app on iOS. Clean, well labeled, intuitive" ([r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0y5pyv/)).
- "shows how to do an app that's all-business, not over imagy or animated, but clean design and functionality" ([r/iOSProgramming, 2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmjvpxz/)).
- "I miss Apollo" ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40ow8u/)).
- HN: "so many small details that make Apollo such a well designed app" ([HN 36547294, 2023-07](https://news.ycombinator.com/item?id=36547294)), and "well designed apps" ([HN 41717821, 2024-10](https://news.ycombinator.com/item?id=41717821)).
- **Criticism:** "i'll never understand the Apollo worshipping" ([r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j10iy0l/)).

**Mela (recipes): 3 places (U 3).** Three places name it: r/iphone's thread ([2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0yqkho/)), r/iOSProgramming's "most 'beautiful' UI" thread ([2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmk1nft/)), and the HN list above. These are bare mentions, with no reasons given. **Crouton** has 2 places: "Flighty and Crouton I think are beautiful apps, and genuinely a joy to use" ([r/iOSProgramming, 2024-08](https://www.reddit.com/r/iOSProgramming/comments/1ey100s/comment/ljays22/)), plus a bare link.

**Apple's own apps: 4 places (D 1, U 3), with real criticism.**

- Praise:
    - Apple Maps: "Both the UI and the cartography are excellent in terms of legibility, intuitiveness, and general smoothness and aesthetics" ([r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0zvs1a/)).
    - Apple Notes: "It's simple, intuitive, and always accessible" ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m425idj/)).
    - HN: "Notes and Preview. They are fantastically well designed" ([HN 33326735, 2022-10](https://news.ycombinator.com/item?id=33326735)), and "Apple's apps are usually well-designed, performant" ([HN 45604979, 2025-10](https://news.ycombinator.com/item?id=45604979)).
- Criticism of Apple Music: "the design is deceptively bad. It looks quite pretty on the surface... It's like the whole thing was designed to look nice in screenshots, not to actually be functional" ([r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j11jepf/)).
- An r/iphone post titled "iOS 26 genuinely ruined what used to be the best UI Apple ever made" ([2026-01](https://www.reddit.com/r/iphone/comments/1qkfoxi/)).

### Expressive and brand-led

**Duolingo: 9 places (D 5, U 4). The most-named app in designer venues.**

- Designer venues:
    - Mobbin Animator of the Year (above).
    - "Special mention to Duolingo, the king of gamification" ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40z4x7/)).
    - "Duolingo app signup and initial tutorials" ([r/UXDesign, 2025-05](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqphxhv/)).
    - "Duolingo is so good. Peak gamification. It's a thing of beauty." ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/netba2c/)).
    - "Duolingo still slaps, goated for gamification" ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/npux445/)).
- User and developer venues:
    - "industry gold standards like Duolingo, Airbnb" ([r/androiddev, 2026-05](https://www.reddit.com/r/androiddev/comments/1tdtcmg/comment/olzupjf/)).
    - "Duolingo has great haptics. Even when I use it without sound the haptics make the experience great" ([r/androiddev, 2026-06](https://www.reddit.com/r/androiddev/comments/1uj5irr/comment/oum2nrb/)).
    - Two HN posts use it as the benchmark: "A great designer is essential to build a brand with personality. Think of Duolingo" ([HN 41711042, 2024-10](https://news.ycombinator.com/item?id=41711042)), and an app pitched to "feel as intuitive and delightful as Instagram, Notion, or Duolingo" ([HN 46206645, 2025-12](https://news.ycombinator.com/item?id=46206645)).
- **Criticism (designers):**
    - "Duolingo is over gamified... 3-4 screens to click through for badges... This continually disrupted my concentration... I no longer use Duolingo." ([r/UXDesign, score 20, 2025-05](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqptv29/))
    - "A bit confusing" ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/o2l4acp/)).

**Headspace: 3 places (D 3, U 0).**

- Mobbin iOS App of the Year (above).
- In a designer's list of "really good" apps ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky5cag8/)).
- Second in the owner's Medium article (snippet).
- No user-venue mention at all, and none on HN.
- Its Webby 2023 Best Visual Design (Function) is a jury award, so it is not counted ([Webby](https://winners.webbyawards.com/2023/apps-dapps-and-software/app-features/best-visual-design-function/256532/headspace)).

**Monzo: 2 places.** "Monzo for onboarding. Just a standout case in my opinion. So seemless. Actually Monzo across the board." ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky5t232/)). And on HN: "I'm sure Monzo is slicker" ([HN 47349361, 2026-03](https://news.ycombinator.com/item?id=47349361), a weak mention).

**Revolut: 2 places.** "Revolut in my opinion is great" ([r/androiddev, 2024-10](https://www.reddit.com/r/androiddev/comments/1ggeix0/comment/lup0s9v/)), and "Revolut or Airbnb" ([r/iOSProgramming, 2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jml9bw0/)).

**Robinhood: 2 places, both thin.** "I like both Robinhood and Lyft" ([r/iOSProgramming, 2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmkb3lr/)), and "Uber, Airbnb, Robinhood all took off because they created easy to use beautiful apps" ([HN 46500986, 2026-01](https://news.ycombinator.com/item?id=46500986)). A designer pushed back on that canon: "Duolingo, Uber, Airbnb, Stripe, Robinhood, etc. were considered the 'best-designed' apps by whom?... Usually it just means 'trendiest UI,' not the best to use or the most accessible." ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky5zmwi/))

**CARROT Weather: 3 places (D 1, U 2).**

- "a gosh darn delight" ([r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0ylj1i/)).
- "It's simple, but makes a mundane task like checking the weather, fun and engaging" ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky6m0qh/)).
- Named with Craft and Flighty as "a generally superior experience" ([HN 32129900, 2022-07](https://news.ycombinator.com/item?id=32129900)).

**Partiful: 1 place.** A professor, quoted in the press: "It is using their language. It's using their aesthetic" ([Il Sole 24 Ore, 2024-11-26](https://en.ilsole24ore.com/art/partiful-cos-ha-special-best-app-according-to-google-2024-AGQOn2OB)). **Criticism:** "Partiful works but to me it lacks polish. It feels like MySpace when FB first came out." ([HN 42938396, 2025-02](https://news.ycombinator.com/item?id=42938396))

**Opal: 1 place.** "a pretty great UI and config setup" ([HN 45171766, 2025-09](https://news.ycombinator.com/item?id=45171766)).

**Calm: 0 places for UI.** Canva's Melanie Perkins loves it, but for content: "I just find it very calming" ([YouTube, 2025-11-02](https://www.youtube.com/watch?v=-LywX3T5Scc)).

**Lemonade: 1 place** (the owner's article, snippet only). **Cash App: 0** (one vendor blog: "Its design is praised for ultra-minimalism" **[vendor: Lazarev]**).

### Content and media-led

**Airbnb: 7 places (D 3, U 4).**

- Designer venues:
    - Mobbin Web App of the Year and an Animator finalist (above).
    - "Airbnb is an inspiration" ([r/FigmaDesign, score 14, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40m3ig/)).
    - "care for simplicity, deep user journey investigation and innovative experiments" ([same thread, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m46dy6p/)).
    - "Airbnb results - consistent card grids, easy to compare" ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/o2d77yj/)).
- User and developer venues:
    - "a tooon of really nice subtle (and also obvious) design elements. Worth checking it out from a design POV" ([r/androiddev, 2026-05](https://www.reddit.com/r/androiddev/comments/1tdtcmg/comment/om2v4wq/)).
    - Also named in r/androiddev ([2022-09](https://www.reddit.com/r/androiddev/comments/xb36v8/comment/io14s3y/)), r/iOSProgramming and HN 46500986.
- **Criticism:** "It's a beautiful app sure, but incredibly clunky. It's like a call center phone menu made into an art piece." ([HN 43588753, 2025-04](https://news.ycombinator.com/item?id=43588753))

**Spotify: 5 places (D 3, U 2), and the most criticised app in the census.**

- Praise:
    - "Aesthetic, does exactly what its supposed to do... one of the best dark modes" ([r/UXDesign, 2022-07](https://www.reddit.com/r/UXDesign/comments/wcpdwt/comment/iidwx4q/)).
    - Device switching as good UX ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/neqtv6u/)).
    - "minimalism = spotify" ([r/androiddev, 2026-05](https://www.reddit.com/r/androiddev/comments/1tdtcmg/comment/olzupjf/)).
    - "I do think Spotify has the best UI and user created playlists" ([HN 42862007, 2025-01](https://news.ycombinator.com/item?id=42862007)).
- Criticism (designers): "I've been completely astonished by how bad Spotify's UX is considering how widely it's used" ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/neubrhp/)). Also: "It prioritizes profit waaaaay above UX" ([same thread, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/neudhw8/)).
- Criticism (HN): "Spotify has the worst" ([HN 35872089, 2023-05](https://news.ycombinator.com/item?id=35872089)), and "Spotify had best UI in 2012" ([HN 42862896, 2025-01](https://news.ycombinator.com/item?id=42862896)).

**Telegram: 10 places (D 1, U 9).** This app came up on its own. Most of the count comes from developers and users.

- r/UI_Design ran a thread titled "Telegram has the best UI/UX and idk why more people dont talk about it" ([2026-07](https://www.reddit.com/r/UI_Design/comments/1uw4w98/)). Replies there:
    - "Telegram's animations feel smoother than any other chat app" ([comment, 2026-07](https://www.reddit.com/r/UI_Design/comments/1uw4w98/comment/oxggl7o/))
    - "amazing how many features Telegram has without feeling bloated" ([comment, 2026-07](https://www.reddit.com/r/UI_Design/comments/1uw4w98/comment/oxmazr3/))
- r/androiddev:
    - "Telegram hands down, some of the stuff they do with their UI is amazing" ([2022-09](https://www.reddit.com/r/androiddev/comments/xb36v8/comment/inxzpvm/))
    - "soo satisfying interaction and ux" ([2026-05](https://www.reddit.com/r/androiddev/comments/1tdtcmg/comment/olzupjf/))
- Seven HN stories praise it. For example:
    - "by far the best UI/UX of any internet chat app" ([HN 31803217, 2022-06](https://news.ycombinator.com/item?id=31803217))
    - "polished and simple UI which just works" ([HN 33894537, 2022-12](https://news.ycombinator.com/item?id=33894537))
    - Also HN [38117173, 2023-11](https://news.ycombinator.com/item?id=38117173), [39457238, 2024-02](https://news.ycombinator.com/item?id=39457238), [43396664, 2025-03](https://news.ycombinator.com/item?id=43396664), [46293701, 2025-12](https://news.ycombinator.com/item?id=46293701) and [47035352, 2026-02](https://news.ycombinator.com/item?id=47035352).
- **Criticism:** privacy, which is not a UI fault. Also: "I find Telegram a bit much in comparison" ([r/UI_Design, 2026-07](https://www.reddit.com/r/UI_Design/comments/1uw4w98/comment/oxpbigo/)).

**Uber: 4 places (D 3, U 1).**

- "Uber and Lyft apps are pretty good" ([r/FigmaDesign, score 28, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40n2zy/)).
- "I still think Uber do some solid UI UX work" ([r/UXDesign, 2025-05](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqvq2ha/)).
- Delivery tracking ([r/UXDesign, 2025-09](https://www.reddit.com/r/UXDesign/comments/1njk7fa/comment/neqtv6u/)).
- HN 46500986.

### Tools and utilities

**Flighty: 10 places (D 2, U 8).**

- Designer venues: "Flighty on iOS is incredibly well designed." ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40w20g/)). It is also in r/UXDesign's list.
- r/iOSProgramming: "Such a simple app concept, so beautifully designed and executed" ([2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmjtxqh/)), and "looks & works great, with mostly standard UI components and interactions" ([same thread, 2023-06](https://www.reddit.com/r/iOSProgramming/comments/13xs5o8/comment/jmiykel/)). It is also in two more r/iPhone and r/iOSProgramming threads.
- HN:
    - "Flighty is a good representation of what craft - compounded over time - gives you" ([HN 47511826, 2026-03](https://news.ycombinator.com/item?id=47511826))
    - "Beautifully designed" ([HN 47516641, 2026-03](https://news.ycombinator.com/item?id=47516641))
    - "delightfully made" ([HN 43790399, 2025-04](https://news.ycombinator.com/item?id=43790399))
    - "takes available data and presents it in the best possible wway" ([HN 46934398, 2026-02](https://news.ycombinator.com/item?id=46934398))
- Lenny's Podcast, Bangaly Kaba: "it goes two or three clicks deeper than the average travel app" ([YouTube, 2024-05-26](https://www.youtube.com/watch?v=Ub9UkWByFIQ)).
- **Criticism:** "Flighty is poorly designed. It's one of those slick apps designed to superficially look nice without actually being well-thought-out." ([HN 47512122, 2026-03](https://news.ycombinator.com/item?id=47512122))

**Figma: 5 places (D 2, U 3).**

- "Figma's UI is excellent... it made Figma feel like butter!" ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40non5/)).
- "realtime collaboration, it's intuitive and lightweight" ([r/UXDesign, 2025-05](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqr968k/)).
- HN: "Figma-level UI excellence" ([HN 42332038, 2024-12](https://news.ycombinator.com/item?id=42332038)), "fast, responsive, and slick" ([HN 32033791, 2022-07](https://news.ycombinator.com/item?id=32033791)), and "executed beautifully" ([HN 32895520, 2022-09](https://news.ycombinator.com/item?id=32895520)).
- **Criticism:** the newer "UI3" is weaker ("a little bit to catch up on").

**Raycast: 5 places (D 1, U 4).**

- LogRocket (above).
- HN:
    - "excellent UI/UX. It's a well-polished app" ([HN 49834138, 2026-09](https://news.ycombinator.com/item?id=49834138))
    - "Masterful application of a trend (Stripe, Raycast)" ([HN 48378428, 2026-06](https://news.ycombinator.com/item?id=48378428))
    - A maker who was "heavily inspired by Raycast and Craft... That's the level of craftsmanship we aim to achieve" ([HN 40716213, 2024-06](https://news.ycombinator.com/item?id=40716213))
- Lenny's Podcast, Jeff Weinstein (Stripe): "cracked the nut on automation, nerd complexity, but also UI ease and some nice touches and loads quickly" ([YouTube, 2024-07-11](https://www.youtube.com/watch?v=qbZQjprTnrU)).

**Stripe (a website, not an app): 3 places.** Ginn, LogRocket and HN 48378428. It is the web reference that the Linear style grew out of.

**Notion: 2 places, mixed.** "They have a clean and minimal UI" ([r/UI_Design, 2022-01](https://www.reddit.com/r/UI_Design/comments/s8bz2r/comment/htfomej/)). But: "I remember being wowed by Notion years ago, and now I'm feeling midly annoyed" ([r/UXDesign, score 40, 2025-05](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqpfl61/)).

**Discord: net negative.** Its top comment in r/FigmaDesign (score 140) is "Discord is a nightmare for me. Extremely unintuitive" ([link, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40f9iz/)). It still has 2 praise places: a Mobbin Web finalist spot, and "Discord is great!" ([r/androiddev, 2022-09](https://www.reddit.com/r/androiddev/comments/xb36v8/comment/inx95r4/)).

### Required apps with almost no practitioner mention

**Structured 0, Rise 1, Bevel 0, Copilot Money 0, Amie 0.**

- Rise: "rise sleep, gentler streak, flighty - all doing interesting stuff thats not just another boring minimalist app" ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/npux445/)).
- Amie: an HN post praising "one beautiful package" was flagged dead and reads like promotion ([HN 41481492, 2024-09](https://news.ycombinator.com/item?id=41481492)), so it is not counted. A startup list calls Amie's interface "sleek and intuitive" **[vendor: Whalesync, 2023-05-11]**.
- Copilot Money: its standing comes from Apple honours and its own sponsored copy ("Designed to feel calm and intuitive"), not from practitioners.
- Bevel: only App Store reviews.
- Gentler Streak has 2 places, both bare mentions.

These apps circulate among designers mostly on X and in screen libraries. Neither was searchable here, so a zero means "not found in open threads", not "not liked".

## (1) Ranked table of the most-named apps

Places = independent places that praise the UI, 2022 to 2026. D/U = designer venues / user and developer venues. The cut-off for the table is 3 places.

| Rank  | App                                                                                                                            | Places | D / U | Style group                 | Criticism found                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | ----- | --------------------------- | ----------------------------------- |
| 1=    | Flighty                                                                                                                        | 10     | 2 / 8 | Tool, restrained            | "superficially look nice" (one)     |
| 1=    | Telegram                                                                                                                       | 10     | 1 / 9 | Content (messaging)         | Privacy, and "a bit much"           |
| 3     | Duolingo                                                                                                                       | 9      | 5 / 4 | Expressive, brand-led       | Over-gamified, interrupts focus     |
| 4     | Linear                                                                                                                         | 8      | 3 / 5 | Restrained, minimal         | Copied until monotonous             |
| 5     | Airbnb                                                                                                                         | 7      | 3 / 4 | Content-led                 | "beautiful... but clunky"           |
| 6     | Things 3                                                                                                                       | 6      | 0 / 6 | Restrained, minimal         | Expensive                           |
| 7=    | Spotify                                                                                                                        | 5      | 3 / 2 | Content-led                 | Heavy: hierarchy, playlists, profit |
| 7=    | Apollo (closed 2023)                                                                                                           | 5      | 1 / 4 | Restrained                  | Fan-worship                         |
| 7=    | Figma                                                                                                                          | 5      | 2 / 3 | Tool                        | UI3 regressions                     |
| 7=    | Raycast                                                                                                                        | 5      | 1 / 4 | Tool, restrained            | None found                          |
| 11=   | Uber                                                                                                                           | 4      | 3 / 1 | Content-led (service)       | None found                          |
| 11=   | Arc / Arc Search                                                                                                               | 4      | 1 / 3 | Restrained, with flourishes | Bugs                                |
| 11=   | Apple's own apps                                                                                                               | 4      | 1 / 3 | Restrained                  | Apple Music, iOS 26                 |
| 14=   | Headspace                                                                                                                      | 3      | 3 / 0 | Expressive, calm            | None found                          |
| 14=   | Mela                                                                                                                           | 3      | 0 / 3 | Restrained (recipes)        | None found                          |
| 14=   | CARROT Weather                                                                                                                 | 3      | 1 / 2 | Expressive, playful         | None found                          |
| 14=   | Stripe (web)                                                                                                                   | 3      | 2 / 1 | Restrained (web)            | Widely copied                       |
| Lower | Monzo, Revolut, Robinhood, Crouton, Gentler Streak, Notion                                                                     | 2 each |       | mixed                       | Notion: "midly annoyed"             |
| Lower | Lemonade, Partiful, Opal, Rise, Netflix ([design system](https://www.reddit.com/r/UXDesign/comments/1kfbryi/comment/mqqd0xy/)) | 1 each |       |                             | Partiful: "lacks polish"            |
| Lower | Calm, Cash App, Copilot Money, Amie, Structured, Bevel                                                                         | 0      |       |                             |                                     |

Three things the table shows:

- **Designers and users name different apps.**
    - In designer venues, the leaders are Duolingo (5), Airbnb, Linear, Spotify, Uber and Headspace (3 each).
    - In user and developer venues, the leaders are Telegram, Flighty, Things, Apollo and Linear.
- **The fintech canon is thin in open practitioner talk.** Monzo, Revolut, Robinhood and Cash App have 0 to 2 places each. They are common on "best app design" agency lists **[vendor]**, but individual designers rarely name them unprompted.
- **Lemonade rests on a single source**, the owner's article. Headspace has three places, all from designers, and it holds the only designer-vote win.

## (2) Reasons that recur across the top apps

1. **Making something complex feel simple.**
    - "it's all about how they managed complex functionalities and made the product intuitive and clean" (said of Airbnb, Spotify, Figma and Uber, [r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m40z4x7/)).
    - "They simplify complex tasks really well" (said of Slack, Apollo and Fantastical, [r/iphone, score 65, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0xicvy/)).
    - Raycast handles "nerd complexity, but also UI ease". Telegram has many features "without feeling bloated".
2. **Polish and small details, built up over time.** Linear is "extremely polished and snappy". Flighty is "craft - compounded over time". Arc has "all of the little things". Airbnb has "a tooon of really nice subtle... design elements". Apollo has "so many small details".
3. **Speed.** Linear: "slick and fast UI". Raycast: "loads quickly". One HN user liked the 2012 Spotify for being "Native, clean, simple, ultra fast". Figma is "fast, responsive, and slick".
4. **Motion and feedback that mean something.** Duolingo, for its haptics and because "Every interaction is purposeful". Airbnb: "motion as a product principle". Telegram: "animations feel smoother". Things: "great custom animations".
5. **Clean and clearly labelled.** Apollo: "Clean, well labeled, intuitive". Things: "clear and easy to use". Apple Maps: "legibility, intuitiveness". Airbnb: "consistent card grids, easy to compare".
6. **Personality without chaos.** Headspace: "designing for calm without losing clarity" with a "smiley mascot" and "punchy palette". CARROT: "makes a mundane task... fun and engaging". Lemonade made insurance "fun" (snippet). One designer asked for "anything but material or minimalistic design" ([r/FigmaDesign, 2024-12](https://www.reddit.com/r/FigmaDesign/comments/1hnannt/comment/m457h87/)). Another praised apps "not just another boring minimalist app".
7. **One job, done deeply.** Flighty is "solely focused on my flights" ([HN 47513270, 2026-03](https://news.ycombinator.com/item?id=47513270)) and "goes two or three clicks deeper". Shazam "does 1 thing, does it well" ([r/UXDesign, 2024-04](https://www.reddit.com/r/UXDesign/comments/1bwd9c3/comment/ky8h4cu/)).

**The warning that recurs**, across three apps and both kinds of venue, is looks over function:

- Apple Music is "designed to look nice in screenshots".
- Flighty is called "slick... superficially look nice".
- Airbnb is "an art piece" that is "clunky".
- "Best-designed" can just mean "trendiest UI".

## (3) What designers praise versus what ordinary users praise

**Designers** (r/UXDesign, r/UI_Design, r/FigmaDesign, Mobbin, named designers):

- They name **brand-led consumer apps** more: Duolingo, Airbnb, Headspace, Uber, and Linear as the web-app benchmark.
- They give reasons in terms of **process and motion**. Examples are onboarding ("signup and initial tutorials", Monzo "for onboarding"), gamification, motion as a principle, coherence at scale, and "calm without losing clarity".
- They are also the **harshest critics** of the same apps. Duolingo's streak screens "disrupted my concentration". Spotify's UX "astonished" a researcher with how bad it was. One designer doubted the whole canon as "trendiest UI".
- The only designer vote rewarded **personality inside calm** (Headspace, Duolingo), not pure minimalism.

**Users and developers** (r/iphone, r/iOSProgramming, r/androiddev, HN, Lenny's guests):

This side is mostly developers and product leaders. Only r/iphone is a venue for ordinary users, so "ordinary user" taste is thinly sampled here.

- They name **daily-driver utilities**: Telegram, Flighty, Things, Apollo, Raycast, Apple Maps and Notes, CARROT, Mela.
- They give reasons in terms of **use**. They praise speed ("snappy", "loads quickly", "ultra fast"), cleanness ("Clean, well labeled") and depth ("clicks deeper"). They also praise apps with no ads or bloat ("not based on an ad-driven algorithmic feed", [HN 38117173, 2023-11](https://news.ycombinator.com/item?id=38117173)). Fair pricing matters too (Halide, [HN 40517853, 2024-05](https://news.ycombinator.com/item?id=40517853)).
- They rarely mention mascots, palettes or illustration. Fintech and wellness brands are almost absent from their lists.
- iOS users lean toward **native-feeling** apps. One was praised as "designed by Apple themselves" (Pixelmator, [r/iphone, 2022-12](https://www.reddit.com/r/iphone/comments/zqcrhs/comment/j0ypfvv/)), and Flighty for "mostly standard UI components".

**For a recipe app that wants calm, premium and exciting**, the practitioner record says this. The apps designers hold up for personality (Duolingo, Headspace) earn praise for purposeful motion and a calm, clear structure under the character. The criticism lands where the personality starts to interrupt the task. The apps users hold up (Flighty, Things, Mela, Apollo) earn praise for speed, clean labelling and depth in one job. The recipe apps that appear at all (Mela, Crouton) come from the user side, with no stated reasons.

**Limits.**

- Reddit coverage depends on thread titles, because comment search failed.
- X/Twitter and Dribbble were not searched.
- The per-app HN searches did not use one fixed query. Some added "UI" or "design" ("Telegram UI", "Spotify UI", "Figma UI"), and others used the bare name ("Flighty", "Headspace", "Partiful"). HN supplies most of Telegram's count, so its high rank is partly an effect of the query.
- Duolingo's r/web_design mention and one Headspace mention in r/iphone were dropped as listicle-style comments.
- Medium was snippet-only.
- Counts this small (3 to 10 places) show which apps come up, not a firm ranking. A one-place gap is noise.
