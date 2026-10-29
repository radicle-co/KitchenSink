# Recipe ownership: who owns what, what rivals say, and how to spot copies

**For:** Commise (recipes, meal plans, grocery lists on web, iOS and Android). Pre-launch. Solo US founder.
**Asked by:** the owner, 2026-10-29.
**Prepared:** 2026-10-29, by the CLO agent.

> **This is research, not legal advice.** It is guidance to help the owner decide and to brief counsel. Nothing here is
> a legal opinion. Law changes and differs by country. A licensed lawyer must confirm any wording or policy before
> launch. Items marked **[Unconfirmed]** have no source that I was able to open, or rest on my reasoning only.

**How sources were read.** I opened every page cited here and read the quoted words myself, unless the source list
says otherwise. Some sites block automated readers. For those I read a dated Wayback Machine copy, or the Caselaw
Access Project copy of a court opinion, and I say so. Four pages did not open at all (Instagram's terms,
BuzzFeed's DMCA page, Allrecipes' own pages, and Pestle's live site). Claims that depend on them are marked.

**Quotes keep their original wording and punctuation.** Semicolons, dashes and long sentences inside quote marks are
the source's, not mine.

**The owner's direction (2026-10-29, verbatim):** "So the research. For public recipes, we'll need to make sure that
we're very, very clear about what chefs own for public recipes and don't and who owns the recipes they don't to cover
the cases where they copy a public recipe on another site without changes. The automated review process needs to check
for this as well. Then we can make the messaging a little more precise and also make it very clear on if a chef
actually owns a recipe. The same goes for a private recipe that a chef copied from a public source and either a public
or private recipe copied verbatim from a copyrighted or private source."

---

## CLO Analysis: Recipe ownership, copies and detection

### Context

- **Jurisdiction.** US first (C-016-001: US at v1, global as the target). EU and UK briefly.
- **Activity.** Cooks save, write, import, clone and publish recipes. Public recipes show to signed-in users, and a
  cook's own public recipes can be open to the web (021).
- **Decision this informs.** (1) What Commise tells a cook about who owns each recipe. (2) What the 020 source check
  must look for. (3) Which spec rules need an owner ruling.

### Risk Assessment

| Risk                                                                                                                                   | Severity | Likelihood | Exposure                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cook imports a blog recipe word for word and it shows publicly (`imported_public` is "Always public with source attribution", C-004) | High     | High       | Public display of someone's method prose, headnote and photo. Attribution does not cure it (016 says so). No check compares the text with the source (020 FR-012).                                                          |
| A cook types a cookbook or blog recipe and says "I wrote this"                                                                         | High     | Medium     | Most typed copies carry no ISBN, publisher, page number or copyright line. No check compares the text with an outside source. The copy goes public whenever 020's rules, its model and its database lookup all stay silent. |
| The licence panel says "The cook keeps ownership" for every public recipe (021 FR-040)                                                 | Medium   | High       | False for clones and false statements. A promise we cannot back, shown to every publisher.                                                                                                                                  |
| Employee pre-publication review is broader than a rights check                                                                         | Medium   | Medium     | Under _Mavrix_, review that selects posts on substance can make the post ours, not the user's. That can cost the 512(c) safe harbour for that content.                                                                      |
| The DMCA agent filing lists the founder's home address                                                                                 | Low      | High       | The address is public. A PO box needs an approved request (37 CFR 201.38).                                                                                                                                                  |
| A family card is labelled `imported_paid` and can never be public                                                                      | Low      | High       | Wrong label. Blocks a legitimate share the family agreed to. Confuses the messaging.                                                                                                                                        |
| A blogger imports their own posts and is flagged as a copier                                                                           | Medium   | Medium     | False positive on our best creators. No "I am the author of this page" path exists.                                                                                                                                         |
| Server-side fetching of social video pages                                                                                             | Medium   | Low        | TikTok's terms forbid automated extraction. 017 already limits retrieval to user-directed actions.                                                                                                                          |

### Recommendation

1. **Stop showing verbatim web copies publicly in full.** Pick one of three, by owner ruling:
   (a) the Copy Me That model: others see the title, the source, a link and the ingredients, never the copied method
   text, the headnote or the source's photo. (b) Publish only after the cook rewrites the method in their own words. (c) The ReciMe model:
   imported recipes are private only. I recommend (a) for `imported_public` and its clones. It keeps sharing, and it
   is how the most-used clipper already treats bloggers.
2. **Show a rights line on every recipe**, from one derived rule. Eight states, listed in section 4. The line says who
   owns the words and photos, in plain words, and never claims more than we know.
3. **Replace the blanket "The cook keeps ownership"** with "You keep ownership of what you wrote" and show it only for
   recipes the cook says they wrote. Clones get "Adapted from [cook]. Their words stay theirs."
4. **Add two statement choices** to the import and publish flows: "I adapted this in my own words, from [credit]" and
   "From a private source (a family card, a friend)". Today there are only "I wrote this" and "From a source".
5. **Teach the source check to look for copies outside our database.** Go in order of cost. First, compare the recipe
   with the import source page. This is free, because we already hold the page for a moment at import. Second, search
   the web for two or three rare sentences. That costs about $0.015 a recipe on Brave. Third, check uploaded photos by
   reverse image search. All of this needs 020 FR-012 and ADR-0074 amended, a privacy-notice line, and a budget
   outside ADR-0024's Bedrock pool.
6. **Write a review guideline** that limits staff review to a rights check. No quality, taste or "is this good enough"
   decisions before publication.
7. **For private sources, rely on the cook's statement and on takedown.** No detector can see a family card. Say so in
   the specs and to counsel.

### Trade-offs

- Option (a) above protects bloggers but makes saved web recipes less useful to other cooks. Option (b) adds friction.
  Option (c) is safest and kills public sharing of imports.
- Web search finds more copies and sends each cook's text to a search vendor. It also costs money per recipe and adds
  a vendor that ADR-0024's ceiling does not cover.
- A stricter review finds more copies and moves us closer to the "curator" side of _Mavrix_. Keep it a rights check.

---

## 1. Headline findings

1. **The dish is free. The words and photos are not.** A list of ingredients and the bare steps are not protected in
   the US. Headnotes, stories, tips, "the secret to the unique taste" asides and photos can be. A whole cookbook is
   protected as a compilation, but only its selection and arrangement. (Copyright Office, _Meredith_, _Barbour_.)
2. **No rival takes ownership of user recipes.** All that address it say the user keeps ownership and grants a
   licence. Copy Me That has the narrowest licence. It is limited to running its service. ReciMe, People Inc. and
   BuzzFeed have the broadest. Each lets the company "exploit" the content.
3. **The safest rivals keep imports private.** ReciMe says a saved recipe "is automatically marked as Private" and it
   has no central library. Copy Me That lets cooks share saved web recipes, but others "cannot see the steps" and must
   click through. Plan to Eat is the outlier: saved recipes "can be shared publicly and viewable by all unless marked as
   private".
4. **ReciMe's "private on every plan" is only partly confirmed.** Its help page says saved recipes are private and that
   it offers no sharing. Its App Store page says "Share recipes with your friends and family". No page mentions plans.
5. **Publishing an exact copy is where risk starts.** Keeping a copy for yourself is the normal, widely accepted use.
   Showing it to the public is the act most rights holders object to. A household is closer to the private side. US
   law defines "publicly" by reference to "a normal circle of a family and its social acquaintances".
6. **The new Supreme Court case helps hosts, but not copiers.** _Cox v. Sony_ (March 25, 2026) sets a narrow test for
   contributory liability. Either the service induced the infringement, or it offered a service "tailored to" it.
   That lowers our secondary risk. It gives no help where Commise itself fetches, copies or chooses what to publish.
7. **Detection is good at web copies and blind to private sources.** Text fingerprints catch word-for-word and
   near-word-for-word copies of pages we can see. Ingredient lists and short methods match by nature, so they must be
   excluded or down-weighted. A family card cannot be detected. The honest control there is the cook's statement plus
   takedown.

---

## 2. Competitor terms

Quotes are exact. Where a clause type is missing, the table says "None found". "None found" means I read the whole
page and the clause is not there. It does not mean the company has no such practice.

### 2.1 ReciMe (first, as asked)

**Pages read.** Terms and Conditions (last updated 18 November 2024). DMCA Policy (last updated 18 November 2024).
Help article "Recipe Saving on ReciMe and Copyright" (last updated August 9, 2026). Privacy Policy (last updated
18 November 2024). App Store listing (read 2026-10-29). ReciMe Pty Ltd is an Australian company with offices in
Melbourne and New York.

| Clause                             | Exact words                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owns user content              | No express statement. Clause 2.5 says: "Excluding any User Content, you acknowledge that all the intellectual property rights, including copyrights, patents, trademarks, and trade secrets, in the Services and its content are owned by us or our suppliers." Clause 3.1: "You are solely responsible for your User Content."                                                                                                                                                                   |
| Licence the user grants            | Clause 3.2: "You hereby grant to us and our affiliates an irrevocable, nonexclusive, royalty-free and fully paid, worldwide license to reproduce, distribute, publicly display and perform, prepare derivative works of, incorporate into other works, and otherwise use and exploit your User Content."                                                                                                                                                                                          |
| User's promise of rights           | Clause 3.3: "You promise that you will not: infringe intellectual property rights of third parties." Clause 3.4: "You agree not to use the Services to collect, upload, transmit, display, or distribute any User Content that violates any third-party right or is unlawful, harassing, abusive, or harmful."                                                                                                                                                                                    |
| Importing and clipping             | Help article: "When a user saves a recipe to ReciMe, they are doing so manually and individually, just like they might copy and paste online text into a notes app, or print it out for their own cookbook at home. Recipes cannot be saved by users in bulk." And: "ReciMe does not use bots or automated tools to scrape or collect recipes from other websites." App Store: "Save Recipes from Instagram, Facebook, TikTok, YouTube and Pinterest - Download recipes from social media sites." |
| Private or public                  | Help article: "When a user saves a recipe using ReciMe, it is automatically marked as Private. That means it is only visible to the individual user who saved it. It is not shared publicly within the app or with other users. For example, we do not have a central library of recipes available based on what its users choose to individually store. We do not offer any “sharing” functionality within ReciMe and do not encourage sharing of recipes amongst individual users."             |
| Attribution                        | None found in the terms. The privacy policy says: "you may cite recipes located on other websites."                                                                                                                                                                                                                                                                                                                                                                                               |
| Takedown, agent, repeat infringers | DMCA Policy: "Our designated copyright agent to receive DMCA Notices is: Attn: ReciMe Legal Department, Suite 12/3 Albert Coates Ln, Melbourne VIC 3000, Australia; support@recime.app." And: "We will endeavour to reach our determination within 30 business days of receiving a complete takedown notice." And: "Where applicable, we may rely upon section 260 of the Communications Decency Act (47 U.S.C. 230)." No counter-notice section. No repeat-infringer policy found.               |

**Is every saved recipe private on every plan?** Partly confirmed.

- Confirmed: the help article says saved recipes are private and there is no central library of user recipes.
- Not confirmed: no ReciMe page I read mentions plans at all. So "on every plan" is not stated, though nothing
  suggests a plan changes it.
- Contradicted in part: the help article says ReciMe does "not offer any “sharing” functionality". But the App Store
  listing says "Share - Share recipes with your friends and family. Or send via email, SMS, WhatsApp, Messenger, or
  AirDrop." So private means "no public library". It does not mean "never leaves the account".

**How ReciMe avoids risk.** It frames itself as a notes app ("a digital notebook or folder"). It keeps saved recipes
out of any public library. It says it never scrapes in bulk. That keeps it closer to "personal copy" than "publisher".

**Where ReciMe carries risk.**

- Its licence takes rights it does not need for private notes ("irrevocable", "incorporate into other works",
  "exploit"). That sits oddly with "personal notes". Whether consumer law in its markets cuts it back is
  **[Unconfirmed]**.
- A 30-business-day target is slow. 17 U.S.C. 512(c) asks a host to act "expeditiously".
- It cites "section 260 of the Communications Decency Act (47 U.S.C. 230)". The section number is a typo. Section 230
  also does not cover copyright. 47 U.S.C. 230(e)(2) says: "Nothing in this section shall be construed to limit or
  expand any law pertaining to intellectual property."
- No repeat-infringer policy is published. 512(i)(1)(A) makes one a condition of every safe harbour.
- Whether ReciMe's agent is in the Copyright Office directory is **[Unconfirmed]**. I did not search the directory.

### 2.2 Samsung Food (formerly Whisk)

**Pages read.** Terms of Use, "Effective 12th December, 2024" (Wayback snapshot 2026-04-21, because the live site
returns 403 to automated readers). Copyright policy, "Updated 30 August 2023" (Wayback snapshot 2025-11-18). App Store
listing (read 2026-10-29).

| Clause                      | Exact words                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owns                    | 5.3.1: "We will not own Your Content". The plain-English box: "you own all content you upload, but we do need to be able to display it and allow it to be shared by our users in the various ways Samsung Food allows."                                                                                                                                                                                           |
| Licence                     | 5.3.1: "in uploading Your Content to the Samsung Food Services you hereby grant us and other users of the Samsung Food Services an irrevocable, perpetual, non-exclusive, royalty-free, transferable, sub-licensable license to use, copy, modify, change, edit, amend, store, display, reproduce and distribute Your Content". 5.3.2: the licence "will continue even if you deactivate Your Account".           |
| User's promise              | 5.2.1: "This includes ensuring you have sufficient permission from the content originator (e.g. the person originally responsible for producing the content or from whom you have obtained the content) to upload and use Your Content on the Samsung Food Services."                                                                                                                                             |
| Importing                   | App Store: "Save any recipe from any website and make it your own." Whether a saved web recipe is public by default is **[Unconfirmed]**.                                                                                                                                                                                                                                                                         |
| Public content              | App Store: "Discover over 240,000 public recipes" and "Join over 5,400 public food communities with 4.5 million members".                                                                                                                                                                                                                                                                                         |
| Attribution                 | None found.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Takedown, repeat infringers | Copyright policy: "We reserve the right to withdraw access to an account, either temporarily or permanently, if a user is found to have infringed copyright on more than one occasion." And: "If Samsung Food upholds your objection, it will reinstate the content and the complaint will not be counted against your account." Notices go to an address in London. No US designated agent is named on the page. |

**Risk.** Large public communities plus "save any recipe from any website" is the profile that attracts notices. Its
repeat-infringer rule is stated, which helps. Its plain-English box is a good model for our messaging.

### 2.3 Paprika

**Page read.** Terms of Use and End User License Agreement, "Last Modified: October 15, 2026". Privacy Policy (read
2026-10-29). Company: Hindsight Labs LLC.

| Clause         | Exact words                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owns       | "You retain any and all of your rights to any User Content you submit, post or display on or through the Software and you are responsible for protecting those rights."                                             |
| Licence        | "by posting User Content using the Software you grant us the right and license to use, modify, perform, display, reproduce, and distribute such User Content on and through the Software."                          |
| User's promise | "(i) the User Content is yours (you own it) and/or you have the right to use it and the right to grant us the rights and license as provided in these Terms"                                                        |
| Importing      | None specific. "COMPANY IS NOT RESPONSIBLE FOR THIRD-PARTY MATERIALS, INCLUDING THEIR ACCURACY, COMPLETENESS, TIMELINESS, VALIDITY, COPYRIGHT COMPLIANCE, LEGALITY, DECENCY, QUALITY, OR ANY OTHER ASPECT THEREOF." |
| Takedown       | Agent: "Attn: Legal, Hindsight Labs LLC, 1050 Queen St #100, Honolulu, HI 96814 legal@paprikaapp.com". A full counter-notice section is included. No repeat-infringer clause found.                                 |

**Risk.** Low. Paprika has no public library. The licence is scoped "on and through the Software".

### 2.4 Copy Me That

**Pages read.** Terms of Use, Copyright Policy, FAQ for bloggers. None shows a date. Read 2026-10-29.

| Clause                                  | Exact words                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who owns                                | "You retain ownership of Your Content and are solely responsible for it. Copy Me That does not own Your Content."                                                                                                                                                                                                                                                                                                                                                                                                              |
| Licence                                 | "By saving Your Content to Copy Me That, you grant Copy Me That and its users a non-exclusive, worldwide, royalty-free, irrevocable, sub-licensable, perpetual license to use, display, edit, modify, reproduce, distribute, store, and prepare derivative works of Your Content. The rights you grant in this license are for the limited purpose of operating, developing, providing, and using our Services."                                                                                                               |
| User's promise                          | "You represent that you have all necessary rights to Your Content and that you’re not infringing or violating any third party’s rights."                                                                                                                                                                                                                                                                                                                                                                                       |
| Private or public                       | "You choose whether to share Your Content (make visible to others). Your recipes and other content are, by default, private."                                                                                                                                                                                                                                                                                                                                                                                                  |
| Importing and sharing saved web recipes | Blogger FAQ: "If someone shares a saved recipe, then others cannot see the steps. Instead, they'll have to click to your website to see the full recipe. You can always choose that your recipes shouldn't be shareable." And: "Yes, just the recipe itself is saved. This means that people have to click back to your website in order to see the extra info on your page — any extra photos, personal story, fuller explanations, reviews, and comments. The website and link back is always included on any saved recipe." |
| Site opt-out                            | Terms: "Websites can opt out of having recipes from their websites shared in the Community."                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Known gap                               | Blogger FAQ: "People do occasionally thwart the restrictions that we put on recipe sharing. For example, someone might type in a website recipe as if it's their own or say that they've altered a recipe to make it their own, even if they haven't."                                                                                                                                                                                                                                                                         |
| Printed cookbooks                       | "people can only include recipes that they themselves created in Copy Me That, not recipes that they saved using our tool. Images must be uploaded from a person's own computer."                                                                                                                                                                                                                                                                                                                                              |
| Takedown, repeat infringers             | "It is our policy to disable or terminate the accounts of people who repeatedly infringe or are repeatedly charged with infringing copyrights or other intellectual property rights." Agent: "Tine Bak 28 West 3rd st South Orange NJ 07079 USA Email: dmca@copymethat.com". Counter-notice: material "may be replaced, or access to it may be restored, 10 business days after the counter notice is processed".                                                                                                              |

**Why it matters most.** Copy Me That is the closest model for the owner's case. It separates a saved copy (private,
link back always kept) from a shared copy (steps hidden, click through to the source). It also names the owner's exact
worry: a cook who types a site's recipe and calls it their own. Its answer is DMCA takedown, not detection.

### 2.5 Pestle

**Pages read.** Terms and Privacy at pestlechef.app (Wayback snapshots 2026-09-05, because the live site returns 403).
The terms page shows "© 2021-2026 Pestle".

| Clause            | Exact words                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owns, licence | None found.                                                                                                                                                                                   |
| User's promise    | "You accept resposibility for all content posted to your account, including all descriptions, photos, and titles associated with any recipe." (spelling as on the page)                       |
| Sharing           | Privacy page: recipe data leaves the device "so that it can be stored, synchronised, restored, and made available on your other devices or to household members you choose to share it with." |
| Takedown          | None found.                                                                                                                                                                                   |

**Risk.** Low today, because nothing is public. The terms grant no licence and name no agent. A public feature added
later starts with no protection.

### 2.6 Plan to Eat

**Page read.** Terms of Use at plantoeat.com/legal/terms. The page shows no date. Its JSON-LD metadata gives
dateModified 2025-04-07.

| Clause                      | Exact words                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who owns                    | "Your profile and all Content (recipes, images, feedback, and other information) added to your account remain yours. We claim no intellectual property rights over the Content you provide."                                                                 |
| Licence                     | None found.                                                                                                                                                                                                                                                  |
| Private or public           | "(C) Recipes or other content saved by a member can be shared publicly and viewable by all unless marked as private. Private recipes including weblinks, references and custom recipes entered by the member will remain private until unmarked as private." |
| User's promise              | Users must not "Upload, e-mail, transmit, or otherwise make available any Material that might infringe any patent, trademark, trade secret, copyright, or other intellectual or proprietary right of any party".                                             |
| Takedown, repeat infringers | Agent: "Plan to Eat, LLC , 789 W 10th Street, Loveland, CO 80537 USA". "Plan to Eat may, within its sole discretion, terminate authorization of users to its Web site who are repeat infringer’s."                                                           |

**Risk.** The highest of the private-first apps. Saved recipes, including web clips, are public unless marked private,
and the terms take no licence to display them.

### 2.7 Deglaze

**Page read.** Terms of Service, "Effective: October 21, 2026". Company: Deglazed LLC.

| Clause         | Exact words                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who owns       | "You retain ownership rights to User Content when you submit or post it to the Deglaze Service."                                                                                                                                                                                                     |
| Licence        | "you grant Deglaze a nonexclusive, worldwide, royalty-free, perpetual, transferable, sublicensable, fully paid, irrevocable license to reproduce, make available, use, display, translate, modify, distribute, create derivative works from, and otherwise use such User Content through any medium" |
| User's promise | "You promise that, with respect to any User Content you post on Deglaze (1) you own or have the right to post such User Content"                                                                                                                                                                     |
| Public         | "please keep in mind that content and other information will be publicly accessible, and may be used and re-shared by others on the Deglaze Service and across the web"                                                                                                                              |
| Takedown       | "To report copyright infringement, send notices to help@deglaze.app". No postal agent address and no repeat-infringer policy found.                                                                                                                                                                  |

### 2.8 AnyList

**Page read.** Terms of Service, "Last Revised: July 18, 2019". Purple Cover, Inc.

No user-content ownership clause, no licence, no rights promise, no takedown or agent, and no repeat-infringer policy
found. AnyList shares lists and recipes with chosen people, not the public. **Risk:** low exposure, thin paperwork.

### 2.9 Mela

**Page read.** Help page with its "Privacy Policy" section (no date). No terms of service found.

"Mela does not collect any data. If iCloud Sync is enabled, your data is stored securely in a private container in
your iCloud account. Mela does not depend on or use any third-party service." Sharing works through iCloud: "Mela lets
you share your recipe library with other iCloud users." **Risk:** very low. Mela never holds the recipes, so it is
barely a host at all.

### 2.10 Public recipe platforms

**Allrecipes (People Inc., formerly Dotdash Meredith).** I read the People Inc. brands Terms of Service ("Effective
Date: July 31, 2025", Wayback snapshot 2026-10-20). The Allrecipes home page footer links to it (Wayback snapshot
2026-10-19). Allrecipes' own submission guidelines did not open, so any Allrecipes-only rule is **[Unconfirmed]**.

- Ownership: "Company does not claim ownership of any User Content you make available on the Services".
- Promise: "when you as a User post or publish Your Content on or in the Services, you represent that you have all of
  the necessary rights to grant Company the license set forth in Section 2.3."
- Licence: "an irrevocable, non-exclusive, perpetual, worldwide, royalty-free right and license to use, copy, display,
  publicly perform, transmit, modify, publish, distribute, make derivative works of, sublicense, and otherwise
  commercially and non-commercially exploit and use Your Content (in whole or in part) in any manner or medium now
  existing or hereafter developed (including print and electronic storage) and for any purpose."
- Repeat infringers: "Company maintains a policy to terminate in appropriate circumstances the Service use privileges
  of all repeat infringers of copyright rights."

**Food52.** I read the Terms and Conditions, "F52, LLC dba Food52 Effective Date: March 18, 2026" (Wayback snapshot
2026-05-01, because the live site returns 429).

- Licence: "By submitting any content to the F52 Websites, including but not limited to recipes, comments, videos, and
  photos (“User Content”), you grant Food52 a worldwide, perpetual, irrevocable, royalty-free, non-exclusive,
  transferable, sublicensable right to use, reproduce, modify, adapt, publish, translate, create derivative works
  from, distribute, perform, and display such User Content in any media." It adds use "which may include offline
  print materials such as cookbooks."
- Promise: "You represent and warrant that you own or have the necessary rights to use and authorize Food52 to use all
  intellectual property rights in and to any User Content that you submit."
- No DMCA agent or repeat-infringer policy found in the terms.

**Cookpad.** Terms of Service ("Valid from November 1st, 2018", Wayback snapshot 2026-09-07) and Community Guidelines
("Valid from September 28, 2026", Wayback snapshot 2026-10-01). I checked every quote below against the archived text. Operated by "the UK registered branch of Cookpad Inc."

- Ownership: "We do not claim ownership of any recipes, photographs, graphics, comments, information, data, text or
  other materials you upload or post on our Site or App ("Content")."
- Licence: "you grant us a worldwide, royalty-free, on-going and transferable right and licence (which we may also
  grant to affiliates and a third party(ies), including other users) to use, copy, reproduce, process, adapt, modify,
  translate, publish, transmit, display and distribute (including via third parties) that Content or derivatives of
  it, in any and all media or distribution methods (now known or later developed) for any and all of our business
  activities."
- Promise: "you have the right to use, upload, post or publish Contents to our App or Site and grant the licences to
  us as set out in Section 10"
- **Attribution and copying, the best rules found anywhere:** "If there is a recipe you have referred to, please
  include the information of the reference source (recipe name, book, recipe ID, etc.) in the recipe intro." And: "You
  may be inspired by a TV programme, cookbook, blog, website or another user's recipe. Be sure to state this clearly as
  a sign of respect and appreciation for that person." And: "If you wish to introduce a recipe that has already been
  published by someone else in its entirety, be sure to ask permission from that person before publishing it." And:
  "Cookpad may contact you to confirm the circumstances of publication if it seems to be reproduced from a different
  source."
- Takedown: "please notify our designated agent at the following address: cookpad-legal@cookpad.com." No
  counter-notice or repeat-infringer policy found.

**NYT Cooking (notes and other submissions).** New York Times Terms of Service, "Effective on January 20, 2026". They
cover Cooking.

- Promise: "you represent to us that you have all the necessary legal rights to upload, post or submit such content
  and it will not violate any law or the rights of any person."
- Licence: "You grant NYT a perpetual, nonexclusive, world-wide, royalty-free, sub-licensable license to the
  Submissions" with a long list of uses.
- Personal-use rule for NYT's own recipes: "You may download or copy certain Content and other downloadable items
  displayed on the Services for your personal use only, provided that you maintain all copyright and other notices
  contained in the Content and other downloadable items. Copying or storing of any Content for other than personal use
  is expressly prohibited without prior written permission". This matters for the paid-site case in section 4.
- Agent: "The New York Times Company 620 Eighth Avenue New York, NY 10018 Attention: Copyright Agent" and
  "copyrights@nytimes.com". No repeat-infringer clause found.

**Tasty (BuzzFeed).** The tasty.co footer links to the BuzzFeed User Agreement. The top of that page says "Effective
Date: July 16, 2026". The bottom says "Effective Date of User Agreement: October 30, 2023". The two dates conflict.

- Licence: "you grant us a worldwide, non-exclusive, perpetual, royalty-free, fully paid, sublicensable and
  transferable, license to use, edit, modify, truncate, aggregate, reproduce, distribute, prepare derivative works of,
  display, perform, and otherwise fully exploit the User Content".
- It also waives moral rights and appoints "BuzzFeed as your irrevocable attorney-in-fact with respect to the User
  Content".
- The BuzzFeed DMCA page returned an error, so its agent and repeat-infringer terms are **[Unconfirmed]**.

### 2.11 What the competitor set teaches

| Pattern                                                          | Who                                                  | Lesson for Commise                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| User keeps ownership, grants a licence                           | Everyone who addresses it                            | Matches 016 FR-010. Keep it.                                                                                                      |
| Licence scoped to running the service                            | Copy Me That, Paprika                                | Better for trust than "exploit". 016 FR-010 already scopes ours.                                                                  |
| Imports private by default or always                             | ReciMe, Copy Me That, Paprika, Mela, Pestle          | The private copy is the industry norm and the low-risk zone.                                                                      |
| Shared web clips hide the steps and link back                    | Copy Me That                                         | The best answer to the owner's verbatim-copy case.                                                                                |
| Sites can opt out                                                | Copy Me That                                         | Cheap goodwill with bloggers. Commise has no such channel.                                                                        |
| Ask before publishing someone's whole recipe, credit inspiration | Cookpad                                              | Plain rules a cook can follow. Good source for our copy.                                                                          |
| Public by default, no licence                                    | Plan to Eat                                          | The pattern to avoid.                                                                                                             |
| Published repeat-infringer policy                                | Copy Me That, Samsung Food, People Inc., Plan to Eat | Matches 016 FR-020 and FR-021. ReciMe, Paprika, Deglaze, AnyList, Pestle, Food52, Cookpad and NYT publish none on the pages read. |

---

## 3. The law

### 3.1 United States: what in a recipe is protected

**The Copyright Office says the list and the plain steps are not protected.**

- Circular 33, "Works Not Protected by Copyright" (revised 03/2021): "A mere listing of ingredients or contents, or a
  simple set of directions, is uncopyrightable. As a result, the Office cannot register recipes consisting of a set of
  ingredients and a process for preparing a dish. In contrast, a recipe that creatively explains or depicts how or why
  to perform a particular activity may be copyrightable. A registration for a recipe may cover the written description
  or explanation of a process that appears in the work, as well as any photographs or illustrations that are owned by
  the applicant. However, the registration will not cover the list of ingredients that appear in each recipe, the
  underlying process for making the dish, or the resulting dish itself."
- Copyright Office FAQ, "How do I protect my recipe?" (read 2026-10-29): "A mere listing of ingredients is not
  protected under copyright law. However, where a recipe or formula is accompanied by substantial literary expression
  in the form of an explanation or directions, or when there is a collection of recipes as in a cookbook, there may be
  a basis for copyright protection."
- 37 CFR 202.1(a) lists, among works not subject to copyright, "mere listing of ingredients or contents".
- Compendium (Third), chapter 300, §313.4(F) "Mere Listing of Ingredients or Contents" (page dated 01/28/2021): "A
  mere listing of ingredients or contents is not copyrightable and cannot be registered with the U.S. Copyright
  Office." Its first example is "A list of ingredients for a recipe." It adds: "The Office may register a work that
  explains how to perform a particular activity, such as a cookbook or user manual, provided that the work contains a
  sufficient amount of text, photographs, artwork, or other copyrightable expression. However, the registration does
  not extend to any list of ingredients or contents that may be included in the work."

**The leading case agrees, and says where protection can start.** _Publications International, Ltd. v. Meredith
Corp._, 88 F.3d 473 (7th Cir. decided 1996-07-08), read through the Caselaw Access Project.

- On the list: "We do not view the functional listing of ingredients as original within the meaning of the Copyright
  Act."
- On the steps: "The recipes at issue here describe a procedure by which the reader may produce many dishes featuring
  Dannon yogurt. As such, they are excluded from copyright protection as either a “procedure, process, [or] system.”
  17 U.S.C. § 102(b)."
- On what can be protected: "There are cookbooks in which the authors lace their directions for producing dishes with
  musings about the spiritual nature of cooking or reminiscences they associate with the wafting odors of certain
  dishes in various stages of preparation. Cooking experts may include in a recipe suggestions for presentation, advice
  on wines to go with the meal, or hints on place settings and appropriate music. In other cases, recipes may be
  accompanied by tales of their historical or ethnic origin."
- On the cookbook as a whole: "Meredith’s compilation copyright in Discover Dannon therefore may not extend to cover
  the individual recipes themselves, only the manner and order in which they are presented."

**Later cases.**

- _Barbour v. Head_, 178 F. Supp. 2d 758 (S.D. Tex. decided 2001-12-26). This is the closest case to the owner's
  worry. An internet magazine "began publishing virtually verbatim recipes from Cowboy Chow" without consent. The court
  refused to dismiss: "the recipes in Cowboy Chow are infused with light-hearted or helpful commentary, some of which
  also appears verbatim in License to Cook Texas Style." Its example was a step reading "(This is the secret to the
  unique taste!)". So a word-for-word copy of a recipe with chatty method text can raise a real claim.
- _Tomaydo-Tomahhdo, LLC v. Vozary_, 629 F. App'x 658 (6th Cir. decided 2015-10-20). A restaurant's recipe book did
  not protect its menu. "As a matter of law, Tomaydo has not shown that any aspect of their recipe book is original".
  Compilation protection needs a creative selection or arrangement that the owner can point to.

**What this means, element by element.**

| Element                              | Protected?                                    | Basis                                                                                 |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ingredient list                      | No                                            | Circular 33, 37 CFR 202.1(a), Compendium 313.4(F), _Meredith_                         |
| Bare steps ("mix, bake 30 minutes")  | No, as a procedure                            | 17 U.S.C. 102(b) as applied in _Meredith_                                             |
| Method text with voice, tips, asides | Can be                                        | _Meredith_ dicta, _Barbour_, Circular 33 "creatively explains"                        |
| Headnote, story, history             | Yes, usually                                  | Ordinary literary expression. _Meredith_ "tales of their historical or ethnic origin" |
| Photos                               | Yes, usually                                  | Circular 33 covers "any photographs or illustrations that are owned by the applicant" |
| Title                                | No                                            | Circular 33 lists "Names, titles, and short phrases" as not protected                 |
| A cookbook or collection             | Thin protection for selection and arrangement | 17 U.S.C. 101 defines a "compilation". _Meredith_, _Tomaydo_                          |
| The dish itself                      | No                                            | Circular 33: not "the resulting dish itself"                                          |

So two cooks can publish the same dish. What one cook cannot do is publish another's words or photos.

### 3.2 Personal-use copies and fair use

- There is no US court case on a recipe app's private copies that I found. The answer rests on fair use, and that is
  a judgement for counsel. **[Unconfirmed]**
- 17 U.S.C. 107 lists four factors: "(1) the purpose and character of the use, including whether such use is of a
  commercial nature or is for nonprofit educational purposes; (2) the nature of the copyrighted work; (3) the amount and
  substantiality of the portion used in relation to the copyrighted work as a whole; and (4) the effect of the use upon
  the potential market for or value of the copyrighted work."
- A private copy of a free web recipe, kept to cook from, scores well on factor 4. The cook still visits the site,
  and can print the page anyway. The industry treats it as normal. ReciMe compares itself to "Microsoft OneNote, Google
  Keep, Evernote, Instapaper, or Pocket". Copy Me That cites the 1984 Supreme Court time-shifting case.
- A private copy of a paid recipe is weaker on factor 4. It can stand in for a subscription. Check the paid site's own
  terms. NYT allows copies "for your personal use only".
- Unpublished works (a family card) get fair use too: "The fact that a work is unpublished shall not itself bar a
  finding of fair use if such finding is made upon consideration of all the above factors."

### 3.3 Verbatim copies, by source

| Source                                | What the copy takes                                                     | Main risk                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Free website                          | Possibly protected method text, headnote, photo                         | Public display of the prose and photo. The ingredients alone are fine.                                   |
| Cookbook or magazine                  | The same. A run of many recipes also takes the publisher's arrangement. | Public display. A run of recipes copies the compilation too.                                             |
| Paid site                             | The same, plus a contract                                               | The site's terms (NYT: "personal use only"). Publishing breaks the contract as well as copyright.        |
| Family card                           | Any expressive wording on the card                                      | Low money risk. Real family disputes. The card's author or heirs own any expression.                     |
| Another cook's private Commise recipe | That cook's words and photos                                            | Breach of our terms and of the other cook's trust. 001 FR-005c already makes private recipes unclonable. |

### 3.4 What changes when a copy is made public

- Copyright gives the owner the right to display a work publicly. 17 U.S.C. 101: "To perform or display a work
  “publicly” means— (1) to perform or display it at a place open to the public or at any place where a substantial
  number of persons outside of a normal circle of a family and its social acquaintances is gathered; or (2) to transmit
  or otherwise communicate a performance or display of the work to a place specified by clause (1) or to the public".
- A private recipe is shown only to its owner. It is not "public".
- A household share is shown to a small named group. If that group is a family and its friends, it fits the "normal
  circle" words. Our household (017) holds up to six accounts and need not be a family, so this is a fair reading,
  not a sure one. **[Unconfirmed]**
- A public recipe on Commise is shown to every signed-in user. That is "to the public". A recipe open to the web (021)
  is shown to anyone.
- Practical effect: almost all claims start with something public. Rights holders find copies by searching the web,
  and private copies do not show up.

### 3.4a Photos shown by reference (embedding)

016 FR-027a shows an imported recipe's photo "by reference to the original host". Commise never stores it. On a public
`imported_public` recipe, other cooks then see the blogger's photo inside Commise. Whether that is a "display" by
Commise is not settled.

- _Perfect 10, Inc. v. Amazon.com, Inc._, 508 F.3d 1146 (9th Cir. decided 2007-12-03), read through CAP, adopted the
  "server test": "the owner of a computer that does not store and serve the electronic information to a user is not
  displaying that information, even if such owner in-line links to or frames the electronic information." And:
  "Because Google’s computers do not store the photographic images, Google does not have a copy of the images for
  purposes of the Copyright Act."
- _Goldman v. Breitbart News Network, LLC_, 302 F. Supp. 3d 585 (S.D.N.Y. decided 2018-02-15), read through CAP,
  refused it: "The Court declines defendants' invitation to apply Perfect 10's Server Test for two reasons. First, this
  Court is skeptical that Perfect 10 correctly interprets the display right of the Copyright Act." It held that
  embedding "violated plaintiff's exclusive display right".
- Massachusetts is in the First Circuit. I found no First Circuit ruling on embedding. **[Unconfirmed]**
- So 016's "by reference" rule lowers the risk (no stored copy, a strong answer in the Ninth Circuit), but it does not
  remove it. The safest version of recommendation (a) shows other cooks no third-party photo at all, only a link.
  The saving cook still sees the photo in their own private copy.

### 3.5 The DMCA 512(c) safe harbour

**The conditions, in the statute's words** (17 U.S.C. 512, read at law.cornell.edu):

- Storage must be "at the direction of a user".
- No knowledge: the provider "(i) does not have actual knowledge that the material or an activity using the material
  on the system or network is infringing; (ii) in the absence of such actual knowledge, is not aware of facts or
  circumstances from which infringing activity is apparent; or (iii) upon obtaining such knowledge or awareness, acts
  expeditiously to remove, or disable access to, the material".
- No profit with control: it "does not receive a financial benefit directly attributable to the infringing activity, in
  a case in which the service provider has the right and ability to control such activity".
- Takedown: "upon notification of claimed infringement as described in paragraph (3), responds expeditiously to
  remove, or disable access to, the material".
- A registered agent: the safe harbour applies "only if the service provider has designated an agent to receive
  notifications of claimed infringement" both on its own site and with the Copyright Office.
- A repeat-infringer policy, 512(i)(1)(A): the provider "has adopted and reasonably implemented, and informs subscribers
  and account holders of the service provider’s system or network of, a policy that provides for the termination in
  appropriate circumstances of subscribers and account holders of the service provider’s system or network who are
  repeat infringers".
- No duty to monitor, 512(m): the safe harbour is not conditioned on "a service provider monitoring its service or
  affirmatively seeking facts indicating infringing activity".

**The agent filing.**

- The Copyright Office's fee schedule lists "Designation of agent under 17 U.S.C. 512(c)(2) to receive notification of
  claimed infringement, or amendment or resubmission of designation" at **$6**.
- 37 CFR 201.38, under "Periodic renewal": "A service provider's designation will expire and become invalid three years after it is
  registered with the Office, unless the service provider renews such designation". 016 FR-025 already tracks this.
- A solo founder's problem: the agent's address is public. 37 CFR 201.38 allows a post office box only after a request
  that gives "a detailed statement providing the reasons supporting the request, with explanation of the specific
  threat(s) to an individual's personal safety or security". So plan for a registered-agent service or a business
  address, not a home address. **[Unconfirmed]** whether a commercial registered-agent address meets the rule. Ask
  counsel.

**How curating or reviewing content can cost the safe harbour.** _Mavrix Photographs, LLC v. LiveJournal, Inc._, No.
14-56596 (9th Cir. filed April 7, 2017).

- Volunteer moderators led by an employee approved posts before they went up. The court held "that the common law of
  agency applied to the defendant’s safe harbor defense". If the moderators are the company's agents, the posts may be
  the company's, not "at the direction of the user".
- Screening for infringement is fine: "activities that screen for infringement or other harmful material like
  pornography can also be accessibility-enhancing." The court cites 512(m).
- Choosing on substance is the danger: "The moderators review the substance of posts; only those posts relevant to new
  and exciting celebrity gossip are approved. The question for the fact finder is whether the moderators’ acts were
  merely accessibility-enhancing activities or whether instead their extensive, manual, and substantive activities"
  went further. It also notes that "YouTube manually selected videos for front page syndication on the basis of
  substance" was "a close call".
- On control, _Mavrix_ quotes _UMG v. Shelter Capital_, which quotes the Second Circuit's _Viacom v. YouTube_:
  "“Right and ability to control” involves “something more than the ability to remove or block access to materials
  posted on a service provider’s website.”" I read _Viacom_ only through _Mavrix_.
- For examples of "high levels of control", _Mavrix_ quotes _Perfect 10, Inc. v. Cybernet Ventures, Inc._ (C.D. Cal.
  2002): the provider "“prescreens sites, gives them extensive advice, prohibits the proliferation of identical sites,”
  provides “detailed instructions regard[ing] issues of layout, appearance, and content,”". Note the word
  "prescreens". 020's hold prescreens every flagged public recipe. That is fine for a rights check. Editorial advice
  on top of it is the risk.

**What this means for Commise.**

- **Owning user content makes it worse.** An assignment of recipes makes them our material. The safe harbour covers
  material stored "at the direction of a user". 016 Layer 1 and FR-010 already refuse an
  assignment. Keep that.
- **Keep 020's staff review to a rights check.** ADR-0076 has the founder and an employee review flagged
  recipes before they go public. Employees are agents. A review that asks only "is this someone else's work?" is the
  screening _Mavrix_ calls accessibility-enhancing. A review that also asks "is this good enough, on brand, featured?"
  moves toward selection on substance. Write the review guideline to forbid the second.
- **Featuring and ranking.** Rule-based indexing (021) is automatic. Hand-picked "featured" recipes are the
  _Viacom_ "close call". Keep curation away from imported content.
- **Financial benefit.** 016 FR-029a already forbids pricing a tier on imported content. Watch two places. 015 rewards
  publication, and 017 sells household sharing of "shared collections" as part of Pro. A paid-source recipe shared to
  a household is the case to rule on. **[Unconfirmed]** whether it counts as a "financial benefit directly
  attributable".

**Secondary liability after _Cox v. Sony_.** _Cox Communications, Inc. v. Sony Music Entertainment_, 607 U.S. 583
(decided 2026-03-25). The Court held: "The provider of a service is contributorily liable for a user's infringement
only if it intended that the provided service be used for infringement, which can be shown only if the party induced
the infringement or the provided service is tailored to that infringement". It added that "mere knowledge that a
service will be used to infringe is insufficient to establish the required intent to infringe."

- This lowers Commise's risk from what cooks do on their own.
- It does not touch direct liability. If our server fetches a page and keeps a copy, or our staff choose to publish
  a copy, that is our own act. 016 finding 3 ("Where the bytes come from decides whether we are a host or a copier")
  still stands.
- The Court took only contributory liability. Vicarious liability was not decided.
- 016's research section predates this case and does not cite it. Update it.

**The 2020 Copyright Office report.** The report is _Section 512 of Title 17_, dated May 2020. It warns against "an
unwritten policy, the specifics of which are never shared with the OSP’s users". It also describes the "willful blindness" rule: an OSP that
"deliberately blinded itself to knowledge of infringing activity by its users" is "charged with the equivalent of
actual knowledge and lose its safe harbor". So once the source check finds a likely copy, Commise must act on it. It
cannot look away.

### 3.6 European Union, briefly

**Digital Services Act (Regulation (EU) 2022/2065)**, read from the EU Publications Office.

- Art 6(1), hosting: no liability for stored information if the provider "(a) does not have actual knowledge of illegal
  activity or illegal content and, as regards claims for damages, is not aware of facts or circumstances from which the
  illegal activity or illegal content is apparent; or (b) upon obtaining such knowledge or awareness, acts expeditiously
  to remove or to disable access to the illegal content."
- Art 6(2): "Paragraph 1 shall not apply where the recipient of the service is acting under the authority or the
  control of the provider."
- Art 7 protects good-faith checking: providers "shall not be deemed ineligible for the exemptions from liability ...
  solely because they, in good faith and in a diligent manner, carry out voluntary own-initiative investigations into,
  or take other measures aimed at detecting, identifying and removing, or disabling access to, illegal content".
- Art 8: "No general obligation to monitor the information which providers of intermediary services transmit or store,
  nor actively to seek facts or circumstances indicating illegal activity shall be imposed on those providers."
- Art 16(1): "Providers of hosting services shall put mechanisms in place to allow any individual or entity to notify
  them of the presence on their service of specific items of information that the individual or entity considers to be
  illegal content." Art 16(3): a notice gives "actual knowledge or awareness" where it lets "a diligent provider of
  hosting services to identify the illegality of the relevant activity or information without a detailed legal
  examination."
- Art 17(1): hosts "shall provide a clear and specific statement of reasons to any affected recipients" for removals,
  demotions, suspensions and account closures.
- Art 19(1): "This Section, with the exception of Article 24(3) thereof, shall not apply to providers of online
  platforms that qualify as micro or small enterprises". **Careful:** "This Section" is the online-platform section.
  Articles 16 and 17 sit in the hosting section, so they still apply to a micro company. 016 FR-016 to FR-018 already
  meet them.

**DSM Directive Article 17 (Directive (EU) 2019/790).** My reading, for counsel to confirm:

- It applies to an "online content-sharing service provider". Art 2(6): a service "of which the main or one of the
  main purposes is to store and give the public access to a large amount of copyright-protected works or other
  protected subject matter uploaded by its users, which it organises and promotes for profit-making purposes."
- The same article excludes "cloud services that allow users to upload content for their own use". Commise's private
  recipes fit that exclusion.
- Public recipes are the open question. Most are the cooks' own, and the core of a recipe is not protected. Recital
  63 says the "large amount" test "should be made on a case-by-case basis and should take account of a combination of
  elements, such as the audience of the service and the number of files of copyright-protected content uploaded by the
  users of the service." At launch scale this is unlikely to bite. **[Unconfirmed]**
- Art 17(6) is the fallback. It gives new services a lighter regime: services "available to the public in the Union for
  less than three years and which have an annual turnover below EUR 10 million" need only best efforts to get a licence
  and fast takedown. Above "5 million" average monthly unique visitors they must also block re-uploads of notified
  works.
- C-016-001 serves the US at v1. The EU rules bite once Commise offers itself to EU users.

### 3.7 United Kingdom, briefly

- Hosting: the Electronic Commerce (EC Directive) Regulations 2002, reg 19. No damages if the host "does not have actual
  knowledge of unlawful activity or information" or "upon obtaining such knowledge or awareness, acts expeditiously to
  remove or to disable access to the information", and "(b) the recipient of the service was not acting under the
  authority or the control of the service provider." That last limb mirrors _Mavrix_ and DSA Art 6(2).
- The UK did not adopt DSM Article 17.
- Copyright, Designs and Patents Act 1988 s.3 defines a "literary work" to include "a table or compilation [other than
  a database]". How UK courts treat recipe text is **[Unconfirmed]**. I did not open a UK recipe case.
- The UK Online Safety Act applies to user-to-user services. It is outside this question.

### 3.8 Social video

- **TikTok** Terms of Service ("Last updated: July 15, 2026"). Users must not "scrape, crawl, export or otherwise extract
  any data or content in any form, for any purpose, from the Platform using any automated system or software, including
  automated “bots,” except as approved in writing by TikTok USDS Joint Venture". They also must not "use TikTok Content
  (as defined in Section 3.5), another user's content or generative AI-enabled features for commercial purposes unless
  permitted by TikTok USDS Joint Venture or the user".
- **Instagram:** its terms page did not open (live or archived). That Instagram restricts automated collection is
  **[Unconfirmed]** here.
- **Who owns what.** The creator owns the video, the voice-over and any caption text. The ingredients and steps
  pulled out of the video are facts. A word-for-word transcript of the narration is the creator's expression.
- **Commise already handles the method.** 016 FR-027f allows transient extraction and keeps only the extracted facts.
  FR-027g forbids using a frame as the recipe photo. 017 keeps retrieval "user-directed only". That is the right shape.
  Add one rule: never store or show a verbatim transcript of the narration as the method.

---

## 4. A rights taxonomy for every recipe

Every recipe has two layers.

- **The dish:** the ingredient list and the bare steps. Nobody owns these, so anyone may cook from them and write them
  down in their own words.
- **The expression:** the words someone wrote (method prose, headnote, tips, story) and the photos. These have an owner.

The rights line tells the cook who owns the expression. It says what Commise lets them do. It never says "this is
legal". The table below is my proposal, based on section 3 and on the competitor norms in section 2. The columns on what a cook can do
are product rules Commise can choose. Where a column rests on a legal judgement, it says so.

| #   | Case                                                        | Commise label today                                           | Who owns the words and photos                                                          | Keep private                                                       | Share with household                                  | Publish                                                                                                                                                                                           | Export                                                                       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Written by the cook                                         | `user_created`                                                | The cook                                                                               | Yes                                                                | Yes                                                   | Yes. Cook grants Commise the 016 licence.                                                                                                                                                         | Yes                                                                          |
| 2   | Adapted by the cook, own words, source credited             | `user_created` (no credit field for it today)                 | The cook owns their new words. The source owns its own words and photos.               | Yes                                                                | Yes                                                   | Yes, with "Adapted from [source]".                                                                                                                                                                | Yes                                                                          |
| 3   | Copied word for word from a public web page                 | `imported_public`                                             | The page's author or site                                                              | Yes. Industry norm, personal use.                                  | Yes, within a family-like household **[Unconfirmed]** | Not in full. Show title, source link and ingredients only, or the cook rewrites the method (see 5.3).                                                                                             | Yes, as the cook's own copy                                                  |
| 4   | Copied word for word from a cookbook, magazine or paid site | `imported_physical` or `imported_paid`                        | The author or publisher                                                                | Yes. For a paid site, within its terms (NYT: "personal use only"). | Yes, within a family-like household **[Unconfirmed]** | Never                                                                                                                                                                                             | Yes, as the cook's own copy                                                  |
| 5   | From a private source: a family card, a friend              | `imported_paid` (wrong label, see 7.3)                        | Whoever wrote the card, or their heirs. The bare recipe is free.                       | Yes                                                                | Yes                                                   | Only in the cook's own words, with the giver's consent and credit. The Guild of Food Writers warns: "there is always a possibility that the giver has taken the recipe from someone else’s book". | Yes                                                                          |
| 5b  | Copied from another Commise cook's private recipe           | Any (Commise cannot see a retyped copy unless 020 matches it) | The other cook                                                                         | Only a copy the other cook shared with them                        | Only with the other cook's consent                    | Never                                                                                                                                                                                             | Own copy only                                                                |
| 6   | Cloned from another Commise cook's public recipe            | Same label as the source, plus `cloned_from_id`               | The original cook owns their words and photos. The cloner owns only their own changes. | Yes                                                                | Yes                                                   | Only after a substantive edit (001 FR-005b), always with "Adapted from [cook]" (021 FR-005).                                                                                                      | Inside Commise yes. Outside Commise is a licence-scope question for counsel. |
| 7   | Public domain (for example a 1919 cookbook)                 | `imported_public` via the curator grant (ADR-0023)            | Nobody owns the 1919 text. Any new photo, edit or note has its own owner.              | Yes                                                                | Yes                                                   | Yes. 021 FR-006 keeps these off the open web for now.                                                                                                                                             | Yes                                                                          |
| 8   | Pulled from a social video                                  | `imported_public`                                             | The creator owns the video, voice-over and caption text. The extracted facts are free. | Yes                                                                | Yes                                                   | Not as a transcript. Facts in the cook's own words, with credit and a link.                                                                                                                       | Yes                                                                          |

**Notes on the table.**

- **Row 1 depends on the cook telling the truth.** The rights line says "You told us you wrote this". If a notice
  proves otherwise, the line changes and the notice process runs (016 C).
- **Row 2 is not a defence by itself.** 016 FR-015b is right: a light edit of someone's prose is still their prose.
  "Adapted" must mean the method is rewritten, not trimmed. The Guild of Food Writers' tiers fit here: "Slightly
  modified equals change of measurement or change of method" (credit "adapted from"), "Considerably modified indicates
  major changes" (credit "inspired by").
- **Rows 3 and 4 are the owner's main cases.** The cook does not own the copied words, and never did. The source does.
  Commise lets the cook keep a private copy, as every rival does.
- **Row 5b is already partly covered.** 020 FR-046 searches private recipes for matches and never tells either cook
  (ADR-0074 §7).
- **Row 6:** 016 FR-011 makes the licence cover "other users to copy published content into their own collections".
  Whether it covers export outside Commise is for counsel.
- **Row 7:** Cornell's public domain chart (updated January 1, 2026) lists US works published "Before 1931" as "In the
  public domain due to copyright expiration". Project Gutenberg's own header and trademark text is not part of the 1919
  book. ADR-0023 already treats the file as operator-downloaded.
- **Household sharing:** 016 FR-029a forbids gating a tier on imported content. 017 sells household "shared
  collections" with Pro. Decide whether paid-source recipes (row 4) can sit in a household collection.

---

## 5. Messaging principles

### 5.1 Principles

1. **Separate the dish from the words.** "Anyone can cook this dish. The words and photos belong to [owner]." This is
   true, short, and calms people down.
2. **Say what we know and how we know it.** "You told us you wrote this." "Saved from [site]." "Cloned from [cook]."
   Never "You own this" unless the cook said they wrote it, and even then, scope it: "You keep ownership of what you
   wrote."
3. **Describe our rule, not the law.** "Commise keeps recipes from books private." Not "Publishing this is illegal".
   A product rule is something we can back. A legal conclusion is not (016 FR-031 forbids ownership claims we cannot
   back).
4. **Treat saving as normal.** Saving a copy for yourself is what every recipe app does. No warnings, no red badges on
   private saves. ReciMe's framing ("a digital notebook or folder") is a good tone.
5. **Explain limits with a reason people accept.** "Out of respect for the people who wrote them, recipes from books
   and paid sites stay private."
6. **Credit by default.** Show the source line on every non-original recipe, on every surface (004 FR-010 already
   requires it for imports). Use the Guild tiers: "From", "Adapted from", "Inspired by".
7. **Offer the honest way forward.** For a copy that cannot be published, offer "Rewrite the method in your own words" and
   "Keep it private".
8. **One generic message while in review.** 020 FR-016c already sets it. Keep it.

### 5.2 Good wording from the competitors

- Samsung Food's plain box: "you own all content you upload, but we do need to be able to display it and allow it to
  be shared by our users in the various ways Samsung Food allows." Simple, honest about the licence.
- Copy Me That to bloggers: "If someone shares a saved recipe, then others cannot see the steps. Instead, they'll have
  to click to your website to see the full recipe." A clear, checkable promise.
- Copy Me That on printing: "people can only include recipes that they themselves created in Copy Me That, not recipes
  that they saved using our tool."
- Cookpad: "You may be inspired by a TV programme, cookbook, blog, website or another user's recipe. Be sure to state
  this clearly as a sign of respect and appreciation for that person." Warm, and frames credit as respect.
- ReciMe: "we treat all individually saved recipes as private, personal content — intending that they remain for the
  user’s eyes only."

### 5.3 Draft rights lines, one per case

These are drafts for `staff-ux-engineer` (SPECIFY) and for counsel. Each needs a localisation key. Keep each under two
short sentences.

| #   | Case                      | Rights line on the recipe                                                                  | When the cook tries to publish                                                                                      |
| --- | ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Written by the cook       | "You told us you wrote this. You keep ownership of what you wrote."                        | Licence panel (021 FR-040), with "You keep ownership of what you wrote."                                            |
| 2   | Adapted, own words        | "Your version, adapted from [source]. Your words are yours. [Source]'s words stay theirs." | Publish, with the credit line shown.                                                                                |
| 3   | Web copy                  | "Saved from [site]. The words and photos belong to [site]. Kept for you."                  | "Other cooks will see the ingredients and a link to [site]. To share the full method, write it in your own words."  |
| 4   | Book, magazine, paid site | "From [book or site]. The words belong to [author or publisher]. This stays private."      | "Recipes from books and paid sites stay private, out of respect for the people who wrote them."                     |
| 5   | Private source            | "From [giver]. Kept private."                                                              | "To share it, write the method in your own words and credit [giver]. Make sure they are happy for you to share it." |
| 6   | Clone                     | "Adapted from [cook]'s recipe. Their words stay theirs."                                   | "Change the ingredients or steps to make it your version first." (001 FR-005b)                                      |
| 7   | Public domain             | "From [title, year]. This text is in the public domain."                                   | Publish as usual.                                                                                                   |
| 8   | Social video              | "From [creator]'s video on [platform]. The video belongs to them."                         | Same as row 3.                                                                                                      |

**Follow-up (2026-10-29):** the public "linked recipe card" for row 3 is worked out element by element in
`linkedCardResearch.md` in this folder. It recommends showing normalized ingredients, times, servings and our nutrition,
and never the source's method, headnote or photo.

Avoid these phrases: "copyright-free", "royalty-free recipe", "legally yours", "safe to publish", "we checked this".
The source check is a filter, not a clearance (ADR-0074: "This feature is not a legal shield").

---

## 6. Detection: how an automated review can spot a copy

### 6.1 What 020 does today, and what it cannot do

020's rule detectors look for six things (020 FR-007). They are an ISBN, a listed publisher, a copyright notice, a
page reference, a paid-site template and a paid-site link. Its model detector reads the text and photos and only ever sends a recipe to a
person. Its database lookup finds the same or nearly the same recipe in our own tables (020 FR-046, `pg_trgm` plus
word-shingle Jaccard). But 020 FR-012 says: "The check MUST NOT fetch any link, search the web, or compare the recipe
or its photos with any outside source." So nothing compares a recipe with the page it came from. A word-for-word blog copy, typed in as "I wrote this", goes
public whenever the rules find no marker, the model returns no evidence (020 FR-013a's all-green rule), and no other
cook saved the same page. The owner's new ask needs FR-012 changed.

### 6.2 Methods, cheapest first

**A. Compare with the import's own source page.** Free. 016 allows it, done the right way.

- When a recipe comes in by URL, share sheet or paste-with-link, we hold the source page for a moment. Fingerprint it
  then. Keep only hashes (shingle hashes or a MinHash signature), never the page. 016 FR-027f already allows a
  transient copy that keeps "the extracted result" and nothing else. A fingerprint is that kind of result.
  **[Unconfirmed]**: confirm with counsel that a stored hash is not a "copy".
- Use **containment**, not resemblance. Broder's paper defines both: "their resemblance r(A,B) and their containment
  c(A,B) that seem to capture well the informal notions of “roughly the same” and “roughly contained.”" A recipe is
  roughly contained in its page (the page adds ads, comments, a story). Containment measures that.
- Build word shingles (Broder: "A contiguous subsequence contained in D is called a shingle") of 5 to 8 words over the
  method and headnote only.
- If the cook later edits the method, re-score against the stored fingerprint. A high score means "still the site's
  words" (row 3). A low score means "rewritten" (row 2).
- Also read the page's schema.org Recipe data. Google's own example markup carries `"author": { "@type": "Person",
"name": "Mary Stone" }`. That names the owner for the rights line.

**B. Search the web for rare sentences.** Needs an owner ruling, because it breaks 020 FR-012.

- Pick two or three long method or headnote sentences with rare words. Skip stock phrases ("Preheat the oven to 350").
  Search each as an exact phrase. A hit on a page we did not import from is "for a person".
- Run it only on `user_created` recipes headed public. That is where a false "I wrote this" does harm.
- Vendors, as of 2026-10-29:
    - Google Custom Search JSON API: "The Custom Search JSON API is closed to new customers." It runs "until the service
      discontinuation on January 1, 2027". Not an option.
    - Bing Search APIs: "Bing Search APIs will be retired on August 11, 2025." Not an option.
    - Brave Search API: "$5 per 1,000 requests", and it "Includes $5 in free credits every month". At three queries a
      recipe that is about $0.015 a recipe, so the free credit covers about 333 recipes a month. Whether Brave's terms
      let us store results for evidence is **[Unconfirmed]**. I did not read its API terms.
- Costs beyond money: each query sends a few sentences of a cook's recipe to a vendor. The privacy notice must say
  so (016 F). It is a new vendor outside ADR-0024's Bedrock-only pool, so it needs its own budget and kill switch.
  That design is a `staff-architect` question.

**C. Spot cookbook pages and paid sites.**

- 020 already covers the strongest signals (ISBN with checksum, publisher list, copyright line, page references,
  paid-site templates). 004 FR-014 already blocks known paywalled hosts before fetching.
- Add photo-layout signals for uploaded pages, as "for a person" only: a printed page number, a running head, two
  columns, a printed nutrition panel. These are my suggestions, not tested. **[Unconfirmed]**
- Add cross-references ("see page 112", "Basic Pie Dough, page 210"). 020 already flags page references.

**D. Reverse image search on photos the cook uploads.**

- 016 FR-027 shows imported photos by reference and never stores them. So only cook-uploaded photos need this.
  The risk is a cook uploading a cookbook or blog photo as their own.
- Google Cloud Vision Web Detection: first 1,000 units a month free, then "$3.50" per 1,000 (pricing page read
  2026-10-29). It sends the photo to Google, a new subprocessor.
- TinEye API: bundles from about $0.01 to $0.06 a search. TinEye's help page and blog list different bundle prices,
  so the current price is **[Unconfirmed]**. Its help page says auto top-up "will automatically buy the same search
  bundle using the same credit card when only 25% of your current bundle remains."
- A match on a stock or press photo is common and often harmless. Treat it as "for a person".

**E. Model judgement, within ADR-0024.**

- 020 already has a model detector that never blocks and never sees the cook's statement (020 FR-008, by analogy with
  ADR-0026). Keep that.
- Cost: ADR-0024 records Nova Micro at "$0.035/1M input and $0.14/1M output in us-east-1, read from the Pricing API on
  2026-08-20". A 1,500-token recipe with a 300-token answer costs about $0.0001. A $100 month covers about a million
  text checks. Photos cost more. I did not read today's live Bedrock price.
- A model cannot tell that text is copied unless it sees the source. It can only say "this reads like published
  cookbook prose". That is weak evidence. Keep it "for a person", as 020 FR-010 does.
- ADR-0024's ceiling is prod-only. CLAUDE.md records that, as of 2026-09-19, it had never executed. Do not count on
  it as the only brake.

### 6.3 False positives that matter

| Cause                                      | Why it fools a detector                                    | Fix                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ingredient lists                           | Two recipes for the same dish share most lines by nature   | Drop ingredient lines before shingling, or score them separately with low weight                                                       |
| Short methods                              | "Mix. Bake 30 minutes." matches thousands of pages         | Require a minimum method length before a match counts. Ignore stock phrases.                                                           |
| Classic recipes                            | The back-of-the-bag cookie recipe is on thousands of pages | A web hit on many unrelated pages means "common", not "copied from X".                                                                 |
| The source is itself a copy                | Blogs copy cookbooks                                       | A person confirms the earliest source before we name it.                                                                               |
| A blogger importing their own posts        | Looks exactly like a verbatim web copy                     | Give creators a way to prove a domain is theirs (012 creator profile, or a domain-verification token on the page). Then row 1 applies. |
| A cook's own earlier recipe on another app | Same as above                                              | Let the cook say "this is my own recipe from [site/app]" and treat it as a claim a notice can test.                                    |
| OCR noise                                  | Scanned pages break shingles                               | Normalise case, punctuation and numbers first.                                                                                         |
| Translations and paraphrase                | Different words, same recipe                               | Not detectable by shingles. That is acceptable, because rewritten words are not a copy of the words.                                   |

### 6.4 Realistic limits

- **Private sources cannot be detected.** A family card, a friend's email, a photocopy from a book that is not online.
  No search finds them. The honest controls are the cook's statement (004 FR-014a, 016 FR-014), the rights line, and
  fast takedown with strikes (016 C).
- **Paywalled text is mostly not in search indexes.** A copy from a paid site often finds no web match. 020's template
  strings and the paid-host list are the better signal there.
- **Thresholds must be measured, not guessed.** 020 FR-046 and SC-015 already say this for the database lookup. Do the
  same for source-page containment and web hits. Build a labelled set: real copies, rewrites, classics, and the cooks'
  own recipes.
- **A pass is not a clearance.** Say "no copy found", never "checked and cleared", in any surface or record.

---

## 7. Where the specs already cover this, and where they fall short

I read the specs in the `ingredient-matching` worktree on 2026-10-29. I did not edit them. They are 016, 020, 021,
004 (FR-010 to FR-028), 001 (FR-004, FR-005 to FR-005d, C-004), ADR-0023, ADR-0074 and ADR-0076.

### 7.1 Already covered well

| Topic                                                                                     | Where                             | Note                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Licence, not ownership                                                                    | 016 FR-010, FR-031                | Matches every rival. Refuses an assignment, which protects the safe harbour. |
| Rights promise, per account and per item                                                  | 016 FR-013, FR-014, 004 FR-014a   | The per-item statement with a citation is stronger than any rival's terms.   |
| Modifying a clone is not a defence                                                        | 016 FR-015b                       | Correct.                                                                     |
| Notice without an account, 24-hour copyright target, statement of reasons, counter-notice | 016 FR-016 to FR-019              | Meets DSA Art 16 and 17 and the 512(c) takedown limb.                        |
| Three-strike repeat-infringer policy, published                                           | 016 FR-020, FR-021                | Meets 512(i). Better than ReciMe, Paprika, Food52, Cookpad.                  |
| Agent registration and renewal alert                                                      | 016 FR-025                        | Meets 37 CFR 201.38.                                                         |
| Takedown reaches clones                                                                   | 016 FR-022                        | Rivals do not address this.                                                  |
| Third-party photos shown by reference, frames never become the photo                      | 016 FR-027 to FR-027h             | Avoids the most common recipe-photo claim.                                   |
| No tier priced on imported content                                                        | 016 FR-029a                       | Answers the 512(c)(1)(B) financial-benefit limb.                             |
| Paid hosts blocked before fetching                                                        | 004 FR-014                        | Good.                                                                        |
| Attribution shown on imports                                                              | 004 FR-010                        | Good.                                                                        |
| Book and paid-site recipes never public                                                   | C-004, 004 FR-014a, 021 FR-004    | Rows 4 and 5 of the taxonomy.                                                |
| Imported recipes never open to the web                                                    | 021 FR-003, FR-006                | Keeps the worst cases off search engines.                                    |
| Clones show "adapted from"                                                                | 021 FR-005                        | Row 6.                                                                       |
| Copies of another cook's recipe, public or private, found without disclosure              | 020 FR-045 to FR-047, ADR-0074 §7 | Row 5b. Better than any rival.                                               |
| Only rules block, the model only refers                                                   | 020 FR-007, FR-010                | Keeps false positives from blocking a cook.                                  |

### 7.2 Gaps, ordered by risk

**G1. Word-for-word web copies are shown publicly in full. (High.)** The owner's main case. Three rules combine:

- C-004: "Imported from public source (website/Instagram): Always public with source attribution."
- 020 FR-013a greens the source reference for a recipe "stated to be from a public web page", with a valid link
  that is not on the rightsholder list.
- 020 FR-012: "The check MUST NOT fetch any link, search the web, or compare the recipe or its photos with any outside
  source."

So a blog's headnote and method go to every signed-in user, and no check compares them with the blog. The blog's
photo shows too, by reference (016 FR-027a), and embedding is not settled law (section 3.4a). _Barbour_ shows
that chatty method text can be protected. 016 finding 1 says "attribution is not a defence to reproduction". 001 FR-005
then lets clones of these default to public after "any modification to ingredients or instructions", which a one-word
edit meets. **Fix:** owner ruling on section 5.3 row 3. I recommend the Copy Me That model for `imported_public` and
its clones. Others see the title, the ingredients and a source link. They never see the copied method text, the
headnote or the source's photo.

**G2. "The cook keeps ownership" is a blanket claim. (Medium.)** 021 FR-040 shows it on every route to Public,
including "publishing a clone". A clone of a `user_created` recipe is still `user_created`, so the cloner is told
they keep ownership of another cook's words. **Fix:** "You keep ownership of what you wrote", shown only for row 1 and
row 2. Clones get the row 6 line. Add to 021 FR-095's counsel list.

**G3. The source check cannot see outside our database. (High for the owner's ask.)** The owner now wants the
automated review to check for verbatim copies of other sites. 020 FR-012 forbids it, and ADR-0074 is built on it.
**Fix:** amend 020 FR-012 and ADR-0074 by dated owner ruling. Allow three checks, in this order. First, source-page
containment at import (section 6.2 A). Second, exact-phrase web search for `user_created` recipes headed public (6.2 B).
Third, reverse image search on uploaded photos (6.2 D). Each is "for a person", never blocking, in line with 020 FR-010. Add a privacy-notice line
and a separate vendor budget. `staff-architect` to design.

**G4. No rights line on recipes. (Medium.)** No spec tells the cook, per recipe, who owns the words. The label
(`imported_paid` and so on) is internal and partly misleading. **Fix:** one derived rule, computed from source type,
clone link, the cook's statement and the 020 outcome, used by every surface. This fits the house pattern of a pure
policy module (like `provenancePolicy.ts`). `staff-architect` and `staff-ux-engineer` to specify.

**G5. Only two statement choices. (Medium.)** 004 FR-014a and ADR-0072 §9 offer "I wrote this" or "From a source"
(a public web page, a book or a paid site). There is no choice for row 2 (adapted, own words, credited) and none for
row 5 (a private source). A cook who adapted a recipe must either claim sole authorship or label it as a copy.
**Fix:** add "I adapted this in my own words" (stays `user_created`, adds a credit) and "From a private source".

**G6. A family card is labelled `imported_paid`. (Low risk, high confusion.)** 004 FR-014a: "Where the cited source is
not a publicly reachable web page, the recipe MUST be classified `imported_paid` and MUST NOT be made public." That
catches a grandmother's card and a public-domain book typed by a cook (outside the curator grant). Both become private
forever under a "paid" label. **Fix:** owner decision. Either a new label for private sources, or a display label that
differs from the stored one. Keep "never public as copied". Allow publication of a rewritten version with credit.

**G7. No path for a creator to prove a page is theirs. (Medium.)** Bloggers importing their own posts look like
copiers. **Fix:** a domain or account verification in 012, after which the import counts as row 1.

**G8. Review scope is not written down. (Medium.)** ADR-0076 puts the founder and an employee in front of every flagged
public recipe. _Mavrix_ makes that safe only while the review is a rights check. **Fix:** a written review guideline
that limits review to "is this someone else's work?". Add it to 016 FR-050.

**G9. The agent address for a solo founder. (Low.)** 016 FR-025 covers filing and renewal, not the published address.
**Fix:** use a business or registered-agent address, or ask the Copyright Office for a PO box under 37 CFR 201.38.

**G10. Research predates _Cox v. Sony_. (Low.)** 016's research does not cite the March 25, 2026 decision. It narrows
contributory liability and leaves direct and vicarious liability alone. **Fix:** update 016's research note.

**G11. Household sharing of book and paid-site recipes is unruled. (Low.)** 017 shares "shared collections" with up
to six accounts as part of Pro. **Fix:** owner ruling, read with 016 FR-029a.

**G12. Export of clones. (Low.)** 016 FR-011 covers copying into collections, not export outside Commise. **Fix:**
counsel to confirm the licence scope, or limit export of clones to the cloner's own changes plus a link.

**G13. No opt-out channel for sites. (Low.)** Copy Me That lets sites opt out of community sharing by email. Commise
has the notice form but no standing "do not show my recipes publicly" list. **Fix:** a host list, reused by 020 and
004 FR-014's data-driven blocklist.

---

## 8. Next steps

| #   | Action                                                                                | Owner                                                                    | When                            |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| 1   | Rule on G1: how `imported_public` recipes and their clones show to others (5.3 row 3) | Owner                                                                    | Before 020 and 021 build        |
| 2   | Rule on amending 020 FR-012 and ADR-0074 for outside-source checks (G3)               | Owner, then `staff-architect`                                            | Before 020 blocking switches on |
| 3   | Design the rights line and the two new statement choices (G4, G5)                     | `staff-ux-engineer` (DESIGN, SPECIFY), `staff-architect` (policy module) | With 021's licence panel        |
| 4   | Replace "The cook keeps ownership" in 021 FR-040 (G2)                                 | Owner, spec edit                                                         | Now                             |
| 5   | Decide the label for private sources and typed public-domain books (G6)               | Owner                                                                    | Before bulk import ships        |
| 6   | Write the reviewer guideline limited to rights checks (G8)                            | Owner, counsel                                                           | Before launch                   |
| 7   | File the DMCA agent with a non-home address (G9)                                      | Owner                                                                    | Before any public recipe        |
| 8   | Build the labelled set for containment and web-hit thresholds                         | `mle-1` or `da-1`                                                        | During 020 shadow mode          |
| 9   | Privacy notice lines for search and image vendors                                     | `dpo-1`, counsel                                                         | Before 6.2 B or D ships         |
| 10  | Update 016's research for _Cox v. Sony_ (G10)                                         | Spec edit                                                                | Now                             |

### Items for counsel (add to 016 FR-050)

1. The rights-line wording in 5.3, and the phrase "You keep ownership of what you wrote". **What breaks:** a promise we
   cannot keep, shown on every recipe.
2. Whether showing ingredients, title and a link (no method prose) for a web copy is enough (G1). **What breaks:**
   public display of protected text on every `imported_public` recipe.
3. Whether a stored shingle hash or MinHash of a source page is a "copy" (6.2 A). **What breaks:** the free
   comparison method becomes a reproduction under 016 FR-027.
4. Whether household sharing of book and paid-site recipes is private use (3.4, G11). **What breaks:** the
   household feature distributes copies.
5. The reviewer guideline's scope under _Mavrix_ (G8). **What breaks:** the safe harbour for reviewed content.
6. Whether a registered-agent address satisfies 512(c)(2) and 37 CFR 201.38 (G9).
7. Whether the 016 licence covers export of clones (G12).
8. Whether Article 17 of the DSM Directive can reach public recipes at any foreseeable scale (3.6).
9. Whether showing a source's photo by reference on a public recipe is a "display" by Commise in the First Circuit
   (3.4a). **What breaks:** 016 FR-027a's photo rule becomes a display of every imported blog photo.

### Regulatory change

These rules move. _Cox v. Sony_ is seven months old. Google's search API ends January 1, 2027. Rival terms changed as
recently as October 2026 (Paprika, Deglaze). Re-check sections 2, 3 and 6 every six months, and before launch.

**Confidence: Medium.** High on what the US Copyright Office and the courts say about recipes, and on the quoted
competitor terms. Medium on how those rules apply to private copies, households and fingerprints, because no case
decides them. Low on UK recipe law and on Instagram's terms, which I did not open.

**Note:** This is guidance only, not binding legal advice. Confirm with external counsel before acting.

**Agents to involve next:**

- `staff-architect`: the rights-line policy module, the outside-source checks, the vendor budget.
- `staff-ux-engineer`: the rights lines and the statement choices.
- `dpo-1`: the privacy notice for search and image vendors.
- `cfo-1`: the search and image vendor budget.

---

## Sources

All accessed 2026-10-29. "Page date" is the date the page itself shows. "Live" means read directly. "Wayback" means
read from the Internet Archive snapshot named. "CAP" means the Caselaw Access Project copy at static.case.law.

### Competitors

1. ReciMe, Terms and Conditions. Page date 18 November 2024. Live. https://www.recime.app/terms-and-conditions
2. ReciMe, DMCA Policy. Page date 18 November 2024. Live. https://www.recime.app/dmca-policy
3. ReciMe, "Recipe Saving on ReciMe and Copyright". Page date August 9, 2026. Live. https://recime.app/help/en/articles/11596213-recipe-saving-on-recime-and-copyright
4. ReciMe, Privacy Policy. Page date 18 November 2024. Live. https://www.recime.app/privacy-policy
5. ReciMe, App Store listing. Undated. Live. https://apps.apple.com/us/app/recime-recipes-meal-planner/id1593779280
6. Samsung Food, Terms of Use. Page date 12 December 2024. Wayback 20260421092929. https://web.archive.org/web/20260421092929/https://samsungfood.com/policy/terms/
7. Samsung Food, Copyright. Page date 30 August 2023. Wayback 20251118095432. https://web.archive.org/web/20251118095432/https://samsungfood.com/policy/copyright/
8. Samsung Food, App Store listing. Undated. Live. https://apps.apple.com/us/app/samsung-food-meal-planner/id1133637674
9. Paprika, Terms of Use and EULA. Page date October 15, 2026. Live. https://www.paprikaapp.com/terms/
10. Paprika, Privacy Policy. Live. https://www.paprikaapp.com/privacy/
11. Copy Me That, Terms of Use. Undated. Live. https://www.copymethat.com/policy/terms_of_use/
12. Copy Me That, Copyright Policy. Undated. Live. https://www.copymethat.com/policy/copyright/
13. Copy Me That, FAQ for bloggers. Undated. Live. https://www.copymethat.com/faqforbloggers/
14. Pestle, Terms and Conditions. Shows "© 2021-2026". Wayback 20260905182926. https://web.archive.org/web/20260905182926/https://pestlechef.app/terms
15. Pestle, Privacy. Wayback 20260905182935. https://web.archive.org/web/20260905182935/https://pestlechef.app/privacy
16. Plan to Eat, Terms of Use. No page date. JSON-LD dateModified 2025-04-07. Live. https://www.plantoeat.com/legal/terms/
17. Deglaze, Terms of Service. Page date October 21, 2026. Live. https://www.deglaze.app/terms
18. AnyList, Terms of Service. Page date July 18, 2019. Live. https://www.anylist.com/terms
19. Mela, Help (with Privacy Policy section). Undated. Live. https://mela.recipes/help/
20. People Inc., Brands Terms of Service (governs Allrecipes). Page date July 31, 2025. Wayback 20261020043935. https://web.archive.org/web/20261020043935/https://www.people.inc/brands-termsofservice
21. Allrecipes home page footer, showing the link to source 20. Wayback 20261019081819. https://web.archive.org/web/20261019081819/https://www.allrecipes.com/
22. Food52, Terms and Conditions. Page date March 18, 2026. Wayback 20260501022913. https://web.archive.org/web/20260501022913/https://food52.com/pages/terms-conditions
23. Cookpad, Terms of Service. "Valid from November 1st, 2018". Wayback 20260907014819. https://web.archive.org/web/20260907014819/https://cookpad.com/us/terms
24. Cookpad, Community Guidelines. "Valid from September 28, 2026". Wayback 20261001071005. https://web.archive.org/web/20261001071005/https://cookpad.com/us/community
25. The New York Times, Terms of Service. Page date January 20, 2026. Live (redirects to help.nytimes.com/policies/115014893428-Terms-of-Service). https://help.nytimes.com/hc/en-us/articles/115014893428-Terms-of-Service
26. BuzzFeed User Agreement (linked from tasty.co). Page dates July 16, 2026 and October 30, 2023 (conflicting). Live. https://www.buzzfeed.com/about/useragreement
27. Guild of Food Writers, Code of Conduct. dateModified 2024-09-05. Live. https://www.gfw.co.uk/code-of-conduct/

### US law

28. US Copyright Office, Circular 33, Works Not Protected by Copyright. Revised 03/2021. Live. https://www.copyright.gov/circs/circ33.pdf
29. US Copyright Office, FAQ "Protecting my work". Undated. Live. https://www.copyright.gov/help/faq/faq-protect.html
30. Compendium of US Copyright Office Practices (Third), chapter 300, §313.4(F). Page date 01/28/2021. Live. https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf
31. 37 CFR 202.1. Current eCFR. Live. https://www.ecfr.gov/current/title-37/chapter-II/subchapter-A/part-202/section-202.1
32. _Publications International, Ltd. v. Meredith Corp._, 88 F.3d 473 (7th Cir. 1996-07-08). CAP. https://static.case.law/f3d/88/cases/0473-01.json
33. _Barbour v. Head_, 178 F. Supp. 2d 758 (S.D. Tex. 2001-12-26). CAP. https://static.case.law/f-supp-2d/178/cases/0758-01.json
34. _Tomaydo-Tomahhdo, LLC v. Vozary_, 629 F. App'x 658 (6th Cir. 2015-10-20). CAP. https://static.case.law/f-appx/629/cases/0658-01.json
35. 17 U.S.C. 101 (definitions, "compilation", "publicly"). Live. https://www.law.cornell.edu/uscode/text/17/101
36. 17 U.S.C. 107 (fair use). Live. https://www.law.cornell.edu/uscode/text/17/107
37. 17 U.S.C. 512. Live. https://www.law.cornell.edu/uscode/text/17/512
38. 47 U.S.C. 230. Live. https://www.law.cornell.edu/uscode/text/47/230
39. 37 CFR 201.38 (designated agent). Live. https://www.law.cornell.edu/cfr/text/37/201.38
40. US Copyright Office, DMCA Designated Agent Directory. Undated. Live. https://www.copyright.gov/dmca-directory/
41. US Copyright Office, Fees. Undated. Live. https://www.copyright.gov/about/fees.html
42. _Mavrix Photographs, LLC v. LiveJournal, Inc._, No. 14-56596 (9th Cir. filed April 7, 2017). Live. https://cdn.ca9.uscourts.gov/datastore/opinions/2017/04/07/14-56596.pdf
43. _Cox Communications, Inc. v. Sony Music Entertainment_, 607 U.S. 583 (2026-03-25). Live. https://www.supremecourt.gov/opinions/25pdf/607us2r22_k4lo.pdf
44. US Copyright Office, _Section 512 of Title 17: A Report of the Register of Copyrights_. May 2020. Live. https://www.copyright.gov/policy/section512/section-512-full-report.pdf
45. Cornell University Library, Copyright Term and the Public Domain in the United States. Updated January 1, 2026. Live. https://guides.library.cornell.edu/copyright/publicdomain
    45a. _Perfect 10, Inc. v. Amazon.com, Inc._, 508 F.3d 1146 (9th Cir. 2007-12-03). CAP. https://static.case.law/f3d/508/cases/1146-01.json
    45b. _Goldman v. Breitbart News Network, LLC_, 302 F. Supp. 3d 585 (S.D.N.Y. 2018-02-15). CAP (its court-name field wrongly says Illinois, its abbreviation says S.D.N.Y.). https://static.case.law/f-supp-3d/302/cases/0585-01.json

### EU and UK law, platform terms

46. Regulation (EU) 2022/2065 (Digital Services Act). Official text from the EU Publications Office (EUR-Lex refused automated reads). https://publications.europa.eu/resource/celex/32022R2065
47. Directive (EU) 2019/790 (DSM Directive). Official text from the EU Publications Office. https://publications.europa.eu/resource/celex/32019L0790
48. Electronic Commerce (EC Directive) Regulations 2002, reg 19. Live. https://www.legislation.gov.uk/uksi/2002/2013/regulation/19
49. Copyright, Designs and Patents Act 1988, s.3. Live. https://www.legislation.gov.uk/ukpga/1988/48/section/3
50. TikTok, Terms of Service (US). Page date July 15, 2026. Live. https://www.tiktok.com/legal/page/us/terms-of-service/en
51. Instagram, Terms of Use. **Did not open** (live page and Wayback snapshot 20261025163142 both rendered no text). https://help.instagram.com/581066165581870

### Detection

52. Broder, A. Z., "On the resemblance and containment of documents" (1997). Live copy. https://www.cs.princeton.edu/courses/archive/spring13/cos598C/broder97resemblance.pdf
53. Manku, Jain and Das Sarma, "Detecting Near-Duplicates for Web Crawling" (Google, 2007). Live. https://research.google.com/pubs/archive/33026.pdf
54. datasketch, MinHash LSH documentation. Undated. Live. https://ekzhu.com/datasketch/lsh.html
55. PostgreSQL, pg_trgm documentation (current). Live. https://www.postgresql.org/docs/current/pgtrgm.html
56. Google, Custom Search JSON API overview. Undated. Live. https://developers.google.com/custom-search/v1/overview
57. Microsoft, "Bing Search APIs retiring on August 11, 2025". Live. https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
58. Brave Search API, plans and pricing. Undated. Live. https://brave.com/search/api/
59. Google Cloud Vision, pricing. Undated. Live. https://cloud.google.com/vision/pricing
60. Google Cloud Vision, detect web entities and pages. Live. https://cloud.google.com/vision/docs/detecting-web
61. TinEye, "Purchasing search bundles". Page date March 5, 2025. Live. https://help.tineye.com/article/169-purchasing-search-bundles
62. TinEye blog, "New image search pricing". Undated. Live. https://blog.tineye.com/new-image-search-pricing/
63. Google Search Central, Recipe structured data. Last updated 2026-09-08. Live. https://developers.google.com/search/docs/appearance/structured-data/recipe

### Repo context (read, not edited)

64. specs/016-legal-compliance-framework/spec.md
65. specs/020-content-source-check/spec.md and research.md (R-17)
66. specs/021-public-discovery-and-sharing/spec.md
67. specs/004-recipe-importing/spec.md (FR-010 to FR-028)
68. specs/001-commise-recipe-app/spec.md (FR-004, FR-005 to FR-005d, C-004)
69. specs/017-recime-parity/spec.md (household)
70. docs/architecture/decisions/0023, 0024, 0074 and 0076

### Not opened, and so not quoted

- _Viacom International, Inc. v. YouTube, Inc._, 676 F.3d 19 (2d Cir. 2012). Quoted only as _Mavrix_ quotes it.
- _BMG v. Cox_ (4th Cir.). Mentioned only as the 2020 Section 512 Report describes it.
- IACP ethics guidelines. Not used. The Guild of Food Writers code is the attribution source.
- Allrecipes' own submission guidelines, BuzzFeed's DMCA page, Brave's API terms, today's live Bedrock price page.
