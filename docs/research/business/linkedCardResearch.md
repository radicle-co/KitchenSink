# The linked recipe card: what Commise can show for a recipe from someone else's page

**For:** Commise. Follow-up to `recipeOwnershipResearch.md` in this folder (its section 4, row 3, and gap G1).
**Asked by:** the owner, via the coordinator, 2026-10-29.
**Prepared:** 2026-10-29, by the CLO agent.

> **This is research, not legal advice.** It is guidance for the owner and a brief for counsel. A licensed lawyer must
> confirm the card before launch. Items marked **[Unconfirmed]** have no source I was able to open, or rest on my
> reasoning only. Quotes keep their original wording and punctuation.

**The owner's direction (verbatim):** "double check what the public data we can put for these kinds of recipes - at
the very least and in the worst case we can hide the ingredients but note that users can still add the ingredients to
a list or cart because we have the data even if it's hidden (though we'd have better messaging). Ideally we show as
much as we legally can."

**The case.** A cook imports a recipe from another site's web page (`imported_public`). Other signed-in cooks see a
public "linked recipe card". The card must keep everything that runs on ingredient data: meal plans, grocery lists and
carts, nutrition, and AI features built on ingredients. 021 FR-014 already defines a signed-out "source card" (title,
source name, link, no ingredients). This research is about the signed-in card, and about whether the signed-out one can
show more.

---

## 1. Short answer

- **In the US, the card can show almost everything except the source's words and photos.** The ingredient list,
  servings, times, yield, step count and our own nutrition are facts. The Copyright Office and the courts say a list of
  ingredients and bare steps are not protected (`recipeOwnershipResearch.md` section 3.1).
- **Show the ingredients in our own normalized form,** not the source's lines word for word. It changes little in US
  copyright law, but it removes the last arguments about wording. In the EU it does not help, because the database
  right covers extraction "in any form".
- **Never show the source's method text, headnote or photo** to other cooks. Link to the source for those.
- **Hiding the ingredients while still letting other cooks add them to a list is not legally different from showing
  them.** In the US neither is infringement. In the EU, handing the data to another cook is a re-utilisation either
  way. Hiding only lowers the chance of a complaint. So show them.
- **The real limits are not copyright.** They are the EU database right (for sites made in the EU), website terms
  (mostly against our server, not our users), and goodwill with sites. A per-site opt-out and a cap on how much of
  one EU site's catalogue we show publicly handle both.

---

## 2. Element by element

Risk: **Low** means settled or near-settled law in our favour. **Medium** means arguable, or depends on facts we
control. **High** means likely a problem.

| Element                                                                      | May show                         | Basis                                                                                                                                                                                                                                                               | Risk (US) | Risk (EU/UK)                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Recipe title                                                                 | Yes                              | Circular 33 lists "Names, titles, and short phrases" as not protected. Do not use a brand in the title in a way that suggests the brand made or endorses the card.                                                                                                  | Low       | Low                                                                                                                  |
| Ingredient list, as written                                                  | Yes, with conditions             | 37 CFR 202.1(a): "mere listing of ingredients or contents". _Meredith_: "We do not view the functional listing of ingredients as original". Chatty wording in a line ("a generous glug, or more if you're brave") carries expression.                               | Low       | Medium (database right, 3.1)                                                                                         |
| Ingredient list, normalized by Commise (quantity, unit, our food)            | **Yes. Prefer this.**            | It restates facts in our own structure, so no wording of the source is left.                                                                                                                                                                                        | Low       | Medium. Art 7(2)(a) covers transfer "by any means or in any form", so normalizing does not avoid the database right. |
| Servings, prep time, cook time, total time, yield                            | Yes                              | Facts. Not original expression.                                                                                                                                                                                                                                     | Low       | Low to Medium (same database-right point, for a large EU catalogue)                                                  |
| Nutrition computed by Commise                                                | Yes                              | Our own computation from our own food data. Label it "Estimated by Commise", so it is never read as the source's figures.                                                                                                                                           | Low       | Low                                                                                                                  |
| The cook's own notes                                                         | Yes                              | The cook's own expression, licensed to us under 016 FR-010.                                                                                                                                                                                                         | Low       | Low                                                                                                                  |
| The cook's own photo                                                         | Yes                              | Same. 016 FR-027b already lets the cook replace a referenced photo with their own.                                                                                                                                                                                  | Low       | Low                                                                                                                  |
| Source name and link                                                         | Yes, always                      | Attribution and a path to the source. 004 FR-010 requires it. Copy Me That: "The website and link back is always included on any saved recipe."                                                                                                                     | Low       | Low                                                                                                                  |
| Short quote of the headnote                                                  | **No by default.** Counsel item. | Fair use (17 U.S.C. 107) can cover a short quote. But the headnote is the most expressive part of the page, and a quote on a card serves the same reader the source serves. I found no case on recipe headnote snippets. **[Unconfirmed]**                          | Medium    | Medium. The EU and UK quotation exceptions are narrower. **[Unconfirmed]**                                           |
| Source's own photo, stored copy or thumbnail                                 | No                               | 016 FR-027 and FR-027c already forbid it. _Perfect 10 v. Amazon_ found Google's thumbnails fair use because they were "highly transformative" for search. A thumbnail on a recipe card serves the photo's own purpose, so that reasoning is weak here.              | High      | High                                                                                                                 |
| Source's own photo, embedded by reference                                    | No, for other cooks              | 016 FR-027a allows it. The Ninth Circuit's server test favours it. _Goldman v. Breitbart_ (S.D.N.Y.) rejected that test. No home circuit ruling found **[Unconfirmed]**. See `recipeOwnershipResearch.md` 3.4a. The saving cook may still see it in their own copy. | Medium    | Medium                                                                                                               |
| Method text                                                                  | No                               | Can be protected (_Barbour_, _Meredith_ dicta). The card links to it instead.                                                                                                                                                                                       | High      | High                                                                                                                 |
| Step count ("8 steps")                                                       | Yes                              | A count is a fact.                                                                                                                                                                                                                                                  | Low       | Low                                                                                                                  |
| Step titles without text ("Blend", "Bake")                                   | Yes, with conditions             | Short phrases are not protected (Circular 33). Keep it to the source's short `HowToStep` "name" values, never a sentence. If a "title" is really a sentence, drop it.                                                                                               | Low       | Low                                                                                                                  |
| Ratings from the source                                                      | No                               | Not needed, and it presents the source's data as ours.                                                                                                                                                                                                              | Medium    | Medium                                                                                                               |
| "Add to list", "Add to cart", "Add to meal plan", AI features on ingredients | Yes                              | They use the same facts the card shows. Section 4 explains why hiding the list makes no legal difference.                                                                                                                                                           | Low       | Medium (same database-right point)                                                                                   |

---

## 3. The other rules that matter

### 3.1 EU sui generis database right (Directive 96/9/EC)

**What it protects.** Article 7(1): a right "for the maker of a database which shows that there has been qualitatively
and/or quantitatively a substantial investment in either the obtaining, verification or presentation of the contents to
prevent extraction and/or re-utilization of the whole or of a substantial part, evaluated qualitatively and/or
quantitatively, of the contents of that database." It applies "irrespective of the eligibility of that database for
protection by copyright" (Art 7(4)). So it can cover ingredient lists even though they are facts.

**Who has it.** Article 11(1): only makers who are "nationals of a Member State or who have their habitual residence in
the territory of the Community", or companies formed and based in the EU (Art 11(2)). **A US recipe site has no EU
database right.** The risk is limited to recipes from sites made in the EU (and, separately, the UK).

**A single blogger's site is weak.** _British Horseracing Board v William Hill_ (C-203/02, 9 November 2004): investment
in obtaining "does not cover the resources used for the creation of materials which make up the contents of a
database." A blogger who writes their own recipes creates them, so that cost does not count. A big site that collects
other people's recipes (an Allrecipes-style site in the EU) is the one that can claim the right.

**One recipe is an insubstantial part.** Article 8(1): a maker "may not prevent a lawful user of the database from
extracting and/or re-utilizing insubstantial parts of its contents ... for any purposes whatsoever." A cook importing
one recipe takes an insubstantial part.

**But the total can add up.** Article 7(5): "The repeated and systematic extraction and/or re-utilization of
insubstantial parts of the contents of the database implying acts which conflict with a normal exploitation of that
database or which unreasonably prejudice the legitimate interests of the maker of the database shall not be
permitted." _BHB_ reads this as acts "the cumulative effect of which is to reconstitute and/or make available to the
public, without the authorisation of the maker of the database, the whole or a substantial part of the contents".

**Indexing a site and letting users search it is extraction.** _CV-Online Latvia v Melons_ (C-762/19, 3 June 2021): a
search engine "which copies and indexes the whole or a substantial part of a database freely accessible on the Internet
and then allows its users to search that database on its own website according to criteria relevant to its content, is
‘extracting’ and ‘re-utilising’ that content", which the maker may prohibit "where those acts adversely affect its
investment". _Innoweb v Wegener_ (C-202/12, 19 December 2013) reached the same result for a meta search engine that
"essentially offers the same range of functionality as the search form on the database site".

**Does user-directed, one-at-a-time import change it?** Partly.

- Each cook's import is one insubstantial part, and the cook is a lawful user. That is the strongest position.
- The public card is Commise's act, not the cook's. Across thousands of cooks, Commise can end up holding and showing
  a large share of one site's catalogue. That is the Article 7(5) "cumulative" case, and it is ours.
- A public search over cards by source site looks like _CV-Online_ and _Innoweb_.
- So for EU-made sites: keep each card tied to a cook's own import, do not offer "browse all recipes from [site]", and
  watch the count of public cards per source host. A cap per EU host is a sensible control. The right number is a
  judgement for counsel. **[Unconfirmed]**

**UK.** The Copyright and Rights in Databases Regulations 1997 keep a parallel right. Reg 13(1): "A property right
(“database right”) subsists ... in a database if there has been a substantial investment in obtaining, verifying or
presenting the contents of the database." Reg 16(2): "the repeated and systematic extraction or re-utilisation of
insubstantial parts of the contents of a database may amount to the extraction or re-utilisation of a substantial part
of those contents." Who qualifies after Brexit sits in reg 18, which I did not read. **[Unconfirmed]**

### 3.2 Website terms of use

**Recipe sites' terms do forbid copying and scraping.**

- People Inc. (Allrecipes): "Company grants you a limited license to use the Services solely for your personal
  non-commercial purposes." Users may not "reproduce, distribute, host, or otherwise commercially exploit the Services
  or any portion of the Services". And: "you shall not use any manual or automated software, devices, or other
  processes (including but not limited to spiders, robots, scrapers, crawlers, avatars, data mining tools or the like)
  to "scrape," harvest, or download data from the Services".
- NYT: personal-use copies only, and no "robots, spiders, scripts, service, software or any manual or automatic device,
  tool, or process designed to data mine or scrape the Content".
- BuzzFeed (Tasty): content may be used "solely for the user’s personal use of the Services. Use, reproduction,
  modification, distribution or storage of any Content for any other purpose is expressly prohibited".

**Are they enforceable against our users?** Usually not, for a casual visitor. _Nguyen v. Barnes & Noble_ (9th Cir.
2014-08-18): "where a website makes its terms of use available via a conspicuous hyperlink on every page of the website
but otherwise provides no notice to users nor prompts them to take any affirmative action to demonstrate assent, even
close proximity of the hyperlink to relevant buttons users must click on— without more — is insufficient to give rise
to constructive notice." A cook with an account at the site (a paid NYT Cooking subscriber) did click to agree, and is
bound.

**Are they enforceable against us?** More likely. _Register.com v. Verio_ (2d Cir. 2004-01-23) bound a company that
returned daily with "full knowledge" of the terms: "Each day Verio repeatedly enters Register’s computers and takes that
day’s new WHOIS data." If Commise's server fetches pages (004 FR-008), Commise visits each big site over and over and
knows its terms, because we read them. That is the _Verio_ pattern. The fix is the one 016 finding 3 already prefers:
user-supplied bytes (paste, share sheet, the cook's own browser) over server-side fetching.

**Contract claims are not preempted.** _NBA v. Motorola_ notes that "the contract right claims were not preempted"
(citing _ProCD_). So a site can sue on its terms even where copyright gives it nothing.

**What the card changes.** The terms bind whoever agreed to them. The card is Commise's own display. If our server
took the data under terms we knowingly accepted, showing it publicly adds to the breach. If a cook brought it in from
their own browser, the site's claim against Commise is weak.

### 3.3 Hot news and unfair competition

- 17 U.S.C. 301(a) preempts state rights "equivalent to any of the exclusive rights within the general scope of
  copyright". _NBA_ says: "Copyrightable material often contains uncopyrightable elements within it, but Section 301 preemption
  bars state law misappropriation claims with respect to uncopyrightable as well as copyrightable elements." So a
  state claim over a recipe's facts is usually preempted.
- The narrow "hot news" claim survives only with all of _NBA_'s elements: "(i) the plaintiff generates or collects
  information at some cost or expense ... (ii) the value of the information is highly time-sensitive ... (iii) the
  defendant’s use of the information constitutes free-riding ... (iv) the defendant’s use of the information is in
  direct competition with a product or service offered by the pla[intiff]" and a threat to the product's existence.
- A recipe is not time-sensitive. This claim fails at element (ii). _Barclays v. Theflyonthewall_ (2d Cir. 2011-06-20)
  narrowed it further and held the claim there "preempted by federal copyright law".
- State consumer-protection law in the company's home state and the Lanham Act are the other routes. They matter only for a
  card that misleads, for example one that implies the site made or endorses it. Show "Saved from [site]", never "by
  [site]" without a link. I did not open Chapter 93A. **[Unconfirmed]**
- **Risk: Low.**

### 3.4 Does schema.org recipe markup imply a licence?

- Sites publish their recipe data as schema.org `Recipe` markup. It carries `recipeIngredient`, times, yield,
  nutrition and steps. Google's documentation says this lets Google "better understand your recipe and present it to
  users in interesting ways."
- schema.org also has an explicit `license` property: "A license document that applies to this content, typically
  indicated by URL." A site that wants to license its recipes can say so. Where a page states a licence (for example a
  Creative Commons one), follow it, including its attribution terms.
- Silence is weaker. _Field v. Google_ (D. Nev. 2006-01-19) found an implied licence where the owner knew how Google
  used pages and chose not to use the opt-out tag: "Consent to use the copyrighted work need not be manifested verbally
  and may be inferred based on silence where the copyright holder knows of the use and encourages it." That reasoning
  rests on an industry convention aimed at search engines. Markup aimed at Google and Pinterest is consent to Google
  and Pinterest showing it, not obviously to a recipe app republishing it. **[Unconfirmed]** whether a court extends it
  to Commise.
- **Conclusion:** markup is useful evidence of what the site chooses to make machine-readable, and it is the right
  source for the facts we show. It is not a licence to show the method or the photo.

---

## 4. Hidden but usable, against shown

| Question                | Hidden list, add-to-list allowed                                                                                                                                                             | Shown list                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| US copyright            | Not infringement. The list is facts.                                                                                                                                                         | Not infringement. Same reason. |
| EU database right       | Commise still stores the data and hands it to another cook's list. That is "making available to the public" by "on-line or other forms of transmission" (Art 7(2)(b)) once many cooks do it. | Same act, more visible.        |
| Website terms           | Same position. The terms bind whoever accepted them.                                                                                                                                         | Same.                          |
| Chance a site complains | Lower. Less is visible.                                                                                                                                                                      | Higher.                        |
| Honesty with cooks      | Odd. "Hidden" ingredients that appear in your cart.                                                                                                                                          | Clear.                         |

**Conclusion.** Hiding the list is not a legal shield. It only lowers visibility. If the owner wants a fallback for a
site that complains, use a per-site opt-out (gap G13 in the main report). For that site, the card shows only the title,
the source name and the link. Add-to-list then stays available only to the cook who saved it.

---

## 5. How others show other sites' recipes

| Service                      | What it shows publicly                                                                                                                                                                                                                                                                                              | Source                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Google                       | Rich results built from the site's own markup. The site opts in by adding markup. Google says it can "present it to users in interesting ways".                                                                                                                                                                     | Google Search Central, Recipe structured data (last updated 2026-09-08) |
| Pinterest (recipe rich Pins) | "add a title, serving size, cook time, ratings, diet preference and a list of ingredients to recipes that you save from your site." The site opts in: "add Schema.org or h-recipe markups ... for each page that you want to enable recipe rich Pins on."                                                           | Pinterest Help, Rich Pins. Pinterest Developers, rich Pins overview.    |
| Yummly (closed)              | A recipe search engine. Wikipedia: it "provided users recipes via recommendations and a search engine" and the app and website "were taken offline in December 2024." How its recipe pages displayed other sites' ingredients and steps is **[Unconfirmed]**. The Wayback Machine was offline during this research. | Wikipedia, "Yummly". The Spoon, 2024-04-03.                             |
| Samsung Food (Whisk)         | "Save any recipe from any website and make it your own" and "Discover over 240,000 public recipes". Whether a saved web recipe is shown publicly with its steps is **[Unconfirmed]**. The site blocks automated readers.                                                                                            | App Store listing                                                       |
| ReciMe                       | Nothing public. A saved recipe "is automatically marked as Private", and there is no central library.                                                                                                                                                                                                               | ReciMe help, 2026-08-09                                                 |
| Copy Me That                 | A shared web recipe shows without its steps: "If someone shares a saved recipe, then others cannot see the steps. Instead, they'll have to click to your website to see the full recipe." Saved copies keep "just the recipe itself", and "The website and link back is always included". Sites can opt out.        | Copy Me That, FAQ for bloggers (undated)                                |

**The pattern.** The big platforms that show ingredient lists publicly (Google, Pinterest) do it with the site's
opt-in markup. Copy Me That shows ingredients and hides steps, without opt-in, and offers an opt-out. That is the
closest model for Commise, and it supports showing the ingredient list.

---

## 6. Recommended linked recipe card

**Signed-in card (other cooks), for an `imported_public` recipe:**

1. Title.
2. "Saved from [site name]" and a prominent "Open the full recipe on [site]" link.
3. The cook's own photo, where there is one. Otherwise no photo (a neutral placeholder, never the source's photo).
4. Servings, prep time, cook time, total time, yield.
5. Ingredients in Commise's normalized form: quantity, unit, our food name. Not the source's lines word for word.
6. "Estimated nutrition by Commise", per serving.
7. Step count, for example "8 steps on [site]". Optional step titles only where they are the source's short names.
8. The cook's own notes, labelled as theirs.
9. Actions: add to grocery list, add to cart, add to meal plan, AI features on ingredients, save my own copy.
10. Not shown: method text, headnote or description, the source's photo, the source's ratings, a quote from the page.

**Signed-out source card (021 FR-014):** keep it as 021 specifies (title, source name, link, no ingredients). It is
open to search engines' readers and to anyone, and the cook's licence does not cover the source's content. Showing the
normalized ingredients there is also defensible in the US, but it turns Commise into a public recipe catalogue built
from other sites. That is where the EU database right and site goodwill bite hardest. Revisit after launch.

**Controls that make the card safe to scale:**

- A per-site opt-out list (main report G13). An opted-out site gets title, name and link only.
- Follow a page's schema.org `license`, where it states one.
- For EU-made sites, no "all recipes from [site]" browsing or search, and a watch on public cards per host
  (section 3.1).
- Prefer user-supplied bytes over server fetching (016 FR-029), so site terms bind the cook's own visit, not our
  server.
- The cook's statement and 020's checks still run. A recipe the cook typed and called their own is not a linked card.

**Messaging.** Draft, for `staff-ux-engineer`: "Saved from [site]. The full method and photos are on [site]." On the
add-to-list action no special wording is needed, because the ingredients are visible.

**Confidence: Medium.** High that the US allows the facts on the card. Medium on the EU database right at scale, and on
implied licence from markup, because no case decides them for recipe apps. Low on UK database-right eligibility and on
the home state's unfair-competition law, which I did not open.

**Note:** This is guidance only, not binding legal advice. Confirm with external counsel before acting.

**For counsel (add to 016 FR-050):**

1. The card as listed in section 6.
2. Whether a short headnote quote is fair use.
3. The per-host cap for EU-made sites under Art 7(5).
4. Whether server-side fetching binds Commise to site terms under _Register.com v. Verio_.
5. Whether schema.org markup implies a licence beyond search engines.

---

## Sources

All accessed 2026-10-29. "CAP" means the Caselaw Access Project copy at static.case.law. "EU PO" means the official text
from the EU Publications Office.

1. Directive 96/9/EC on the legal protection of databases. EU PO. https://publications.europa.eu/resource/celex/31996L0009
2. _CV-Online Latvia SIA v Melons SIA_, C-762/19, judgment of 3 June 2021. EU PO. https://publications.europa.eu/resource/celex/62019CJ0762
3. _The British Horseracing Board Ltd v William Hill Organization Ltd_, C-203/02, judgment of 9 November 2004. EU PO. https://publications.europa.eu/resource/celex/62002CJ0203
4. _Innoweb BV v Wegener ICT Media BV_, C-202/12, judgment of 19 December 2013. EU PO. https://publications.europa.eu/resource/celex/62012CJ0202
5. Copyright and Rights in Databases Regulations 1997, reg 13. Live. https://www.legislation.gov.uk/uksi/1997/3032/regulation/13
6. Same, reg 16. Live. https://www.legislation.gov.uk/uksi/1997/3032/regulation/16
7. 17 U.S.C. 301. Live. https://www.law.cornell.edu/uscode/text/17/301
8. _Nguyen v. Barnes & Noble Inc._, 763 F.3d 1171 (9th Cir. 2014-08-18). CAP. https://static.case.law/f3d/763/cases/
9. _Register.com, Inc. v. Verio, Inc._, 356 F.3d 393 (2d Cir. 2004-01-23). CAP. https://static.case.law/f3d/356/cases/
10. _National Basketball Ass'n v. Motorola, Inc._, 105 F.3d 841 (2d Cir. 1997-01-30). CAP. https://static.case.law/f3d/105/cases/
11. _Barclays Capital Inc. v. Theflyonthewall.com, Inc._, 650 F.3d 876 (2d Cir. 2011-06-20). CAP. https://static.case.law/f3d/650/cases/
12. _Field v. Google Inc._, 412 F. Supp. 2d 1106 (D. Nev. 2006-01-19). CAP. https://static.case.law/f-supp-2d/412/cases/
13. _Perfect 10, Inc. v. Amazon.com, Inc._, 508 F.3d 1146 (9th Cir. 2007-12-03). CAP. https://static.case.law/f3d/508/cases/1146-01.json
14. _Goldman v. Breitbart News Network, LLC_, 302 F. Supp. 3d 585 (S.D.N.Y. 2018-02-15). CAP. https://static.case.law/f-supp-3d/302/cases/0585-01.json
15. schema.org, Recipe. Live. https://schema.org/Recipe
16. schema.org, license. Live (usage figure dated August 2026). https://schema.org/license
17. Google Search Central, Recipe structured data. Last updated 2026-09-08. Live. https://developers.google.com/search/docs/appearance/structured-data/recipe
18. Pinterest Help, Rich Pins. Live. https://help.pinterest.com/en/business/article/rich-pins
19. Pinterest Developers, Rich Pins overview. Live. https://developers.pinterest.com/docs/web-features/rich-pins-overview/
20. Wikipedia, "Yummly". Live. https://en.wikipedia.org/wiki/Yummly
21. The Spoon, "Whirlpool Lays Off Entire Team for Cooking and Recipe App Yummly", April 3, 2024. Live. https://thespoon.tech/whirlpool-lays-off-entire-team-for-cooking-and-recipe-app-yummly/
22. People Inc. Brands Terms of Service (Allrecipes). Effective July 31, 2025. Wayback 20261020043935. https://web.archive.org/web/20261020043935/https://www.people.inc/brands-termsofservice
23. The New York Times, Terms of Service. Effective January 20, 2026. Live. https://help.nytimes.com/hc/en-us/articles/115014893428-Terms-of-Service
24. BuzzFeed User Agreement (Tasty). Live. https://www.buzzfeed.com/about/useragreement
25. Copy Me That, FAQ for bloggers. Undated. Live. https://www.copymethat.com/faqforbloggers/
26. ReciMe, "Recipe Saving on ReciMe and Copyright". August 9, 2026. Live. https://recime.app/help/en/articles/11596213-recipe-saving-on-recime-and-copyright
27. Samsung Food, App Store listing. Live. https://apps.apple.com/us/app/samsung-food-meal-planner/id1133637674
28. Also relied on, from the main report: Circular 33, 37 CFR 202.1, _Publications International v. Meredith_, _Barbour v. Head_, 17 U.S.C. 107. See `recipeOwnershipResearch.md` Sources.
29. Repo specs read: 021 FR-014, 016 FR-010 and FR-027 to FR-029, 004 FR-008 and FR-010.

**Not opened:** the home state's consumer-protection statute, UK database regulations reg 18, any Yummly recipe page, Samsung Food's
public recipe pages, and any case on headnote snippets.
