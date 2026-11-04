# Feature Specification: International Launch

**Feature Branch**: `docs/growth1028` (single-branch directive. The spec directory is `specs/025-international-launch`.
`.specify/feature.json` is not pointed here, because another session uses it.)
**Created**: 2026-10-28
**Status**: Draft. The three owner questions (Q1 to Q3) are resolved. Every user-facing surface needs `staff-ux-engineer`
DESIGN and SPECIFY at plan time. None has run.
**Input**: Owner, 2026-10-28: "Do 3 as well." Item 3 named a new spec for international launch. The owner wants full
international support, not just a Spanish listing, and noted that the app already holds food data from several
international sources. Mindset, the same brief: "assume that we can do this and figure out how."

## Dependencies

| Spec or decision                                                                                                                                                                         | Relationship                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                                                              | **Required, amendments listed.** Owns the market switch (`016-FR-048`) and fail closed (`016-FR-048a`). Owns the seam and capability split (`016-FR-048b`, `016-FR-048c`), localisation (`016-FR-049`) and counsel (`016-FR-050`) |
| [010-subscriptions](../010-subscriptions/spec.md)                                                                                                                                        | **Required, amendment owed.** Its plan register is the one authority for plans and prices (`010-FR-041b`). Per-storefront prices are an amendment to it, not numbers in this spec                                                 |
| [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md)                                                                                  | **Governs.** Store billing on mobile through RevenueCat. Web checkout sells to US buyers only until Stripe Managed Payments is active on live sales                                                                               |
| [017-recime-parity](../017-recime-parity/spec.md)                                                                                                                                        | **Referenced.** Owns the metric and imperial display preference (`017-FR-026`), which is display only. This spec adds the default per market and the measure convention under it                                                  |
| [003-usda-food-data](../003-usda-food-data/spec.md) and [ADR-0052](../../docs/architecture/decisions/0052-food-data-sources.md)                                                          | **Required, amendments listed.** The food catalog, its source register and its refused sources. Section E reads what it holds today                                                                                               |
| [ADR-0025](../../docs/architecture/decisions/0025-ingredient-parser-python-deployable.md) and [ADR-0026](../../docs/architecture/decisions/0026-two-engine-ingredient-parse-pipeline.md) | **Required.** The two-engine ingredient parse. Its CRF engine reads English. Section D covers other languages                                                                                                                     |
| [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)                                                                                              | **Governs.** The one $100 monthly AI pool. Any parse or review in a new language draws on it                                                                                                                                      |
| [ADR-0059](../../docs/architecture/decisions/0059-user-settings-typed-columns.md)                                                                                                        | **Governs.** A new setting is a nullable typed column with its default in code                                                                                                                                                    |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md)                                                                                                          | **Amended, listed.** Public pages, their locale path (`021-FR-010`) and the rule that recipe content is never machine-translated (`021` NFR-005)                                                                                  |
| [022-marketing-site-and-waitlist](../022-marketing-site-and-waitlist/spec.md)                                                                                                            | **Amended, listed.** Pages in a second language wait on this spec. The pricing page's local price note (`022-FR-032`)                                                                                                             |
| [023-referrals-and-growth-measurement](../023-referrals-and-growth-measurement/spec.md)                                                                                                  | **Amended, listed.** Attribution consent per market (`023-FR-046`), the referral switch per market (`023-FR-016`) and the soft launch (`023-FR-012`)                                                                              |
| `GR-003` FR Identifier Namespace                                                                                                                                                         | **Governs.** Every cross-feature reference here is written `{feature}-FR-{NNN}`                                                                                                                                                   |
| `GR-005` Offline declaration                                                                                                                                                             | **Governs.** See Offline Behavior                                                                                                                                                                                                 |

**Plan-time dependencies.** These run before any of this feature is built. None of them has run for this spec.

- **`staff-ux-engineer` DESIGN, then SPECIFY**, for every surface this spec changes or adds, on web and mobile, at
  phone, tablet and desktop widths. That is the language and region settings, the unit display and its conversions,
  the market-not-served state, the support language notice and each translated screen. Its §3.6 gate applies. Every
  state in FR-019 is a deliverable.
- **`staff-architect` PLANNING**, for the market record (FR-003), the measure convention on a recipe (FR-021), the
  content language on a recipe (FR-015), regional food names and source preference (section E), and the second parse
  engine for Spanish (section D). Each is persisted data or a contract, so each is expensive to reverse.
- **`clo` and counsel**, for every item in FR-115. **`cfo-1`**, for translation cost, regional prices and AI spend per
  language. **`gmm-1`**, for store listings and keywords. **`dpo-1`**, for transfers and processors per market.
- **A native culinary reviewer for each language**, before that language ships.

## Overview

Commise launches in the US only (`016-FR-048`). _(amended 2026-11-03, owner ruling O9, ADR-0082)_ At launch the app is listed only in US app stores, and that restriction is recorded (FR-088). "US only" is a launch plan, and it is only true while the store territories are restricted (FR-088). The owner wants it to go international in full: other markets, other
languages, local units, local food data, local store pages and local prices.

### What already exists

These were checked in the repository on 2026-10-28.

- **Translation machinery.** Every string already goes through `@commise/i18n`. Its own docs say that adding a locale
  is "exactly: add its dictionary entries and list its tag here". `SUPPORTED_LOCALES` holds `['en']` only. A
  pseudo-locale, `en-XA`, grows text by 35% to show layouts that only fit English. The web app serves the locale in the
  path (`/{locale}/…`) and negotiates it from the browser's language.
- **Food data from nine sources.** The food service's source register admits these:

    | Source                    | Region        | Edition in the register                         | Licence                         |
    | ------------------------- | ------------- | ----------------------------------------------- | ------------------------------- |
    | USDA FoodData Central     | United States | SR Legacy 2018, Foundation 2026, FNDDS, Branded | CC0 1.0                         |
    | CoFID                     | UK            | 2021                                            | Open Government Licence v3.0    |
    | Canadian Nutrient File    | Canada        | 2015                                            | Open Government Licence, Canada |
    | Ciqual                    | France        | 2025                                            | Licence Ouverte 2.0             |
    | BLS                       | Germany       | 4.0                                             | CC BY 4.0                       |
    | STFCJ                     | Japan         | Eighth edition, 2023 supplement                 | MEXT website terms              |
    | Matvaretabellen           | Norway        | 2026                                            | NLOD 2.0                        |
    | Livsmedelsdatabasen       | Sweden        | 2026-07-01                                      | CC BY 4.0                       |
    | Swiss Food Composition DB | Switzerland   | Recorded with its download                      | opendata.swiss terms            |

    ADR-0052 refused the Australian Food Composition Database ("Its licence is share-alike and adds further terms"),
    Open Food Facts (share-alike), NEVO and the FAO/INFOODS regional tables. No admitted source covers Australia,
    Spain or Mexico, and none names foods in Spanish.

- **A curated catalog in English.** The catalog holds 2,642 curated foods. Each has an English name and a list of
  synonyms, with no region on a synonym.
- **A unit preference, specified and not built.** `017-FR-026` gives a metric or imperial display preference that
  never rewrites the stored recipe.
- **A market switch, specified and not built.** `016-FR-048` serves one market, the US, as a value. An unserved
  market fails closed.

### The order of markets

1. **The US.** Launch.
2. **English-speaking markets: the UK, Canada and Australia.** Together they add about 39% of US households, in
   English. The figures are these:
    - UK: 28.6 million households in 2024
      ([ONS](https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/families/bulletins/familiesandhouseholds/2024))
    - Canada: about 15.0 million dwellings in 2021 ([Statistics
      Canada](https://www150.statcan.gc.ca/n1/daily-quotidien/220209/t005a-eng.htm))
    - Australia: 9.28 million dwellings in 2021
      ([ABS](https://www.abs.gov.au/census/find-census-data/quickstats/2021/AUS))
    - US: 134.79 million households in 2025 ([FRED](https://fred.stlouisfed.org/series/TTLHH))

    The three together are 39.2% of the US figure. No country survey of recipe-app use was found, so US rates stand in
    for these markets (business plan,
    market detail, A2.9).

3. **Spanish.** First the Spanish-speaking cooks inside the US market. Spanish is 61.1% of people aged 5 and over who
   speak a language other than English at home
   ([Census, December 2023](https://www.census.gov/newsroom/press-releases/2023/language-at-home-acs-5-year.html)).
   Which Spanish-speaking market comes next is Q1.
4. **Others.** Not chosen yet. The candidates are the markets where an admitted food source already exists: France,
   Germany, Japan, Norway, Sweden and Switzerland. The EU has about 1.5 times as many households as the US, but needs
   translation and EU consumer rules (business plan, market section 4.5). Two cautions apply:
    - European apps charge 29% to 39% more than North American ones
      ([Adapty](https://adapty.io/state-of-in-app-subscriptions/)).
    - In German iOS, Cookidoo peaked at about $67K a week against ReciMe's $7.4K in Q2 2025 (business plan, A2.9).
      The owner picks each later market with data from the earlier ones (FR-104).

Ireland and New Zealand were not named by the owner, so this spec does not commit them. Adding either is one owner
ruling and one readiness record.

### What this feature does NOT do

- **It does not translate recipes.** A recipe shows in the language its cook wrote it in (`021` NFR-005).
- **It does not open a market by flipping a value.** Each market needs a complete readiness record first (section K).
- **It does not sell on the web outside the US** before Stripe Managed Payments is active (ADR-0075).
- **It sets no price.** 010 owns prices. This spec says how regional prices are set and shown.
- **It forecasts no uptake.** Its success criteria are gates and quality checks, not install numbers.

### Words used in this spec

| Word                   | Meaning                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Market**             | Where a cook is served, for law, store, price and tax. A value under `016-FR-048`. Examples: US, UK, Canada, Australia   |
| **Locale**             | The language and formats a cook reads, as a BCP 47 tag. Examples: `en`, `en-GB`, `es`. A locale is not a market          |
| **Storefront**         | One country's App Store or Google Play store                                                                             |
| **Measure convention** | The set of measures a recipe was written in. A US cup, an Australian tablespoon and an imperial pint are different sizes |
| **Readiness record**   | One market's list of launch gates, each with its evidence, owner, date and state (section K)                             |
| **Regional coverage**  | The share of the foods that cooks in a market use that resolve to a food with nutrition, from an admitted source         |
| **Wave**               | One step in the market order above                                                                                       |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The owner opens a market only when it is ready (Priority: P1)

The owner wants to open the UK. The UK's readiness record lists every gate: counsel, privacy notice, terms, prices in
both stores, tax status, the `en-GB` text, units, food coverage, store listing, support language and accessibility.
Each gate shows its evidence and who signed it. One gate is still red, so the market switch refuses to add the UK.
When the last gate turns green, the switch accepts it, and the stores' availability is set to match.

**Why this priority**: Opening a market is a legal act, not a setting. A market opened with a missing privacy notice
or a wrong price is a legal and trust failure that is hard to undo.

**Independent Test**: Build a readiness record with one red gate. The switch refuses the market and names the gate.
Turn it green. The switch accepts the market. A test compares the store availability with the served markets.

**Acceptance Scenarios**:

1. **Given** a readiness record with any red gate, **When** someone adds the market to the switch, **Then** the change
   is refused and the red gates are named (FR-100).
2. **Given** a complete record, **When** the market is added, **Then** the app becomes available in that market's
   storefronts, and in no other new storefront (FR-005).
3. **Given** a gate the owner waives, **When** the market opens, **Then** the waiver is recorded with its reason and the
   owner's ruling (FR-101).
4. **Given** a market that is closed again, **When** the change takes effect, **Then** new sign-ups there are refused,
   and existing cooks keep their recipes, their access and their export (FR-102).

---

### User Story 2 - A cook in the UK uses Commise in British English (Priority: P1)

Priya lives in Leeds. She installs Commise from the UK App Store, which shows the price in pounds, with VAT. The app
opens in British English: "shopping list", "courgette", "favourite". Weights show in grams and oven heat in °C.
Dates show day first. She searches for "aubergine" and finds it.

**Why this priority**: The UK is the first market after the US. An app that reads as American, with cups and °F, tells
a UK cook it was not made for them.

**Independent Test**: Set a device to the UK storefront and the `en-GB` locale. Every screen shows British spelling
and food words, metric units, day-first dates and the store's own price string. No string falls back to US English.

**Acceptance Scenarios**:

1. **Given** a cook whose locale is `en-GB`, **When** any screen loads, **Then** its text uses the `en-GB` dictionary,
   which overrides only the strings that differ from `en` (FR-011).
2. **Given** a new cook in the UK market, **When** they first view a recipe, **Then** units show in metric by default,
   and they can change that (FR-020).
3. **Given** the UK storefront, **When** the paywall shows a price, **Then** it is the store's own localised price
   string, never a price we worked out (FR-061).
4. **Given** a search for "courgette", **When** results load, **Then** the food that the catalog names "zucchini" is
   found and shown as "courgette" (FR-041).

---

### User Story 3 - A recipe written in Australian measures converts correctly (Priority: P1)

Liam in Brisbane writes a recipe with "1 tablespoon" of oil. An Australian tablespoon is 20 mL, not 15 mL. His friend
in Chicago opens the shared recipe with US units. The app converts from Liam's measures, so the oil is right.

**Why this priority**: A conversion that assumes the wrong cup or spoon gives a wrong amount silently. That is the
worst kind of error in a recipe, and the owner's parse bar names wrong numbers as the thing to avoid.

**Independent Test**: Convert a fixture set of recipes, each written in a known convention, into each display
system. Every amount matches the expected value from the convention's own sizes.

**Acceptance Scenarios**:

1. **Given** a recipe recorded as Australian measures, **When** a cook views it in US units, **Then** each spoon and
   cup converts from the Australian sizes (FR-021, FR-022).
2. **Given** a recipe imported from a UK site, **When** it is saved, **Then** its measure convention defaults to the
   UK's, and the cook can change it (FR-021).
3. **Given** an amount with no unit, such as "2 eggs", **When** units change, **Then** it stays as written
   (`017-FR-026`).

---

### User Story 4 - A cook sees food data from their own country where it exists (Priority: P2)

A cook in Canada adds "cheddar" to a recipe. Where the Canadian Nutrient File holds the same food, the nutrition can
come from it, and the source is named. Where no Canadian food matches, a USDA food is used, and its source is named
too.

**Why this priority**: Foods and their nutrition differ by country. The repository already holds national tables for
the UK and Canada, so using them is cheap. Australia has none admitted yet, so this cannot be P1.

**Independent Test**: For a fixture list of common foods in each launch market, measure regional coverage and check
that every food shows its source.

**Acceptance Scenarios**:

1. **Given** a cook in a market with an admitted national source, **When** a food resolves, **Then** the plan's rule
   for national preference decides the source, and the source is shown (FR-040).
2. **Given** a cook in Australia, **When** a food resolves, **Then** it resolves to an admitted source and says which
   one, with no claim that it is Australian data (FR-043).

---

### User Story 5 - A Spanish-speaking cook in the US uses Commise in Spanish (Priority: P2)

Lucía lives in Texas and reads Spanish best. She sets Commise to Spanish. Every screen, email and notice is in Spanish.
Her recipes stay in the language she wrote them in. When she pastes a recipe in Spanish, the app reads it with the
Spanish parse path. If that path is not ready yet, the app says plainly which languages import reads well.

**Why this priority**: Spanish is the third wave. It needs translation, review and a parse path, so it comes after
the English-speaking markets.

**Independent Test**: Switch to `es`. No English string remains on any shipped screen. Paste a fixture set of Spanish
ingredient lines. The result meets the Spanish parse bar, or the app does not offer Spanish parsing and says so.

**Acceptance Scenarios**:

1. **Given** the `es` locale, **When** any shipped screen loads, **Then** every string is Spanish, reviewed by a native
   culinary reviewer (FR-012).
2. **Given** a Spanish ingredient line, **When** it is parsed, **Then** it is never read by the English engine alone as
   if it were English (FR-030).
3. **Given** the Spanish parse path has not met its bar, **When** a cook opens import, **Then** the screen says which
   languages import reads well, in Spanish, with no silent wrong parse (FR-033).

---

### User Story 6 - Each storefront shows a local listing (Priority: P2)

A cook in Australia searches the App Store for "meal planner". The Commise listing is in Australian English. It shows
screenshots of the real app in that locale, and a price in Australian dollars. Its keywords were researched for that
storefront.

**Why this priority**: Store search is where most installs start. A listing written for the US reads as foreign.

**Independent Test**: For each served storefront, the listing has its own name, subtitle, keywords, description and
screenshots, and every claim in it has a claims register entry.

**Acceptance Scenarios**:

1. **Given** a served storefront, **When** its listing is published, **Then** it carries that locale's text and
   screenshots of the current app in that locale (FR-050).
2. **Given** a translated claim, **When** the listing is reviewed, **Then** it matches a claims register entry in that
   language (FR-054).

---

### User Story 7 - A cook knows which language support answers in (Priority: P3)

Lucía writes to support in Spanish. Before she sends it, the help screen tells her which languages support answers in
and how long a reply takes.

**Why this priority**: Support is needed in every market, but the question of which languages it answers in is Q3.

**Independent Test**: In each shipped locale, open help. It states the support languages before a message is sent.

**Acceptance Scenarios**:

1. **Given** any shipped locale, **When** a cook opens help, **Then** the support languages are stated before they
   write (FR-090).

---

### Edge Cases

- **A cook travels.** A UK cook on holiday in Spain stays in the UK market. Their market comes from their recorded
  basis, not from where they are today (FR-003).
- **A cook moves country.** Their storefront changes. The market record changes only through the basis that recorded
  it, and the cook is told what changes for them, such as price and terms.
- **Locale and market differ.** A cook in the US market reads Spanish. A cook in the UK market keeps US English. Each
  is allowed (FR-001).
- **A web visitor from an unserved country.** The web app says plainly that Commise is not available in their country
  yet, and offers the waitlist. It never applies the US rules to them (`016-FR-048a`).
- **Canada mixes systems.** Canadian cooks use metric and many US measures. The default is metric, the measure
  convention is per recipe, and the cook can switch display at any time.
- **A recipe mixes conventions.** A UK recipe copied from a US site uses cups. The cook can set the recipe's
  convention, and a line with a stated unit size keeps it.
- **Gas marks.** A UK recipe says "gas mark 4". The app shows the °C and °F it stands for, from one table (FR-023).
- **A decimal comma.** "1,5 kg" in a Spanish recipe is 1.5 kg. A number is read with the recipe's content language
  (FR-025).
- **A food with no regional source.** It resolves to an admitted source from another country, and says which one. It
  never claims to be local data.
- **A store price changes in one storefront.** The app shows the store's current price string. It never caches a price
  across a store change.
- **Quebec.** Canada includes Quebec, where software has French-language duties (FR-084). Canada does not open until
  counsel answers that item.
- **A market is closed after opening.** Existing cooks keep access, data and export. Only new sign-ups stop (FR-102).
- **Right-to-left languages.** Arabic is one of the US storefront's extra listing languages, but no right-to-left
  locale is in any wave yet. Adding one needs its own layout review.

## Clarifications

### Session 2026-10-28

- **The ruling.** Owner, verbatim: "Do 3 as well." Item 3 was this spec. The owner wants full international support,
  not just a Spanish listing, and pointed to the international food data the app already holds. The owner named the
  market order: English-speaking first, then Spanish, then others. The owner named the UK, Canada and Australia as
  follow-on markets that add about 39% to the US market.
- **Reading: market and locale are two things.** A market is law, store, price and tax. A locale is language and
  formats. With the two apart, a Spanish-speaking cook in the US can use Spanish, and no new market opens. A market
  can also open before its language is ready.
- **Reading: the seam and capability split decides what is built when.** `016-FR-048b` already builds the seams to the
  strictest regime at v1. This spec adds the capabilities each market triggers, at the time that market opens
  (`016-FR-048c`).
- **Reading: "assume we can do this".** Each hard part has a stated answer. No Australian food source is admitted, so
  Australia opens with admitted sources, labelled honestly, while a licence is sought (FR-043). The parse engine reads
  English only, so Spanish gets its own parse gate (section D). Web tax outside the US is not ours to carry, so web
  checkout stays US only and the stores collect tax (section H).
- **Q1. Which Spanish-speaking market comes after US Spanish speakers? RESOLVED 2026-10-29.** The owner chose "Both
  at once": Mexico and Spain open together, after US Spanish. Each still has its own launch gate: a food source,
  privacy law work (Spain under GDPR, Mexico under its own law), and a localized store listing.
- **Q2. How are regional prices set? RESOLVED 2026-10-29.** The owner chose "Round launch markets". Each launch
  storefront gets a rounded local price, set by a person: the UK, Canada and Australia, then Mexico and Spain. The
  stores convert every other country from the US price. 010's plan register records the rule and the method, with
  each local number computed by that method ([Prices by storefront](../010-subscriptions/spec.md#prices-by-storefront)). The method (owner ruling, 2026-10-29, "Convert and round"): convert the US price at the
  day's exchange rate, add local tax where prices show tax, and round to the nearest store price point ending in .99
  (`010` Prices by storefront).
- **Q3. Which languages does support answer in? RESOLVED 2026-10-29.** The owner chose "English only". Support
  answers in English in every market, and each locale's help screen and store listing says so plainly.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Markets and their order

- **FR-001**: The system MUST keep **market** and **locale** apart. A market is a value under `016-FR-048`, with its
  legal posture, storefronts, prices, tax status, referral switch (`023-FR-016`) and attribution rule (`023-FR-046`).
  A locale is a BCP 47 tag for language and formats. Each market has a default locale, and a cook can choose any
  shipped locale in any served market.
- **FR-002**: Markets MUST open in the order of the Overview: the US, then the UK, Canada and Australia, then Spanish,
  then others by owner ruling. Each market needs a complete readiness record first (section K). This spec promises no
  date. Dates need engineering input and the readiness record.
- **FR-003**: A cook's market MUST be recorded with its basis, in the same shape as the age basis (`016-FR-008`). The
  basis is the storefront country on mobile, and on the web the country the cook declares at sign-up. A market MUST
  NOT be set from an IP address alone. A change to the basis is the only thing that changes the record. The cook is
  told what changes for them. `staff-architect` designs the record at PLANNING.
- **FR-004**: A person in an unserved market MUST get a plain "not available in your country yet" answer and the
  waitlist, never the US rules (`016-FR-048a`). The waitlist keeps the locale it already records (`022-FR-048`) and
  asks for no country.
- **FR-005**: The app's availability in each store MUST match the served markets exactly. A test MUST compare the
  stores' availability settings with the market switch before each release.
  _(Amended 2026-11-03, owner ruling O9, ADR-0082.)_ At launch the served market is the US, so the app is listed only in US storefronts. The EU and UK storefronts stay off until the market's `016-FR-048c` duties are met (FR-089, FR-100). Counsel review is owed before launch (`016-FR-050`).
- **FR-006**: The English-speaking wave needs no new language. It MUST still ship the regional English locales of
  FR-011, because spelling and food words differ.

#### B. App text translation

- **FR-010**: Every string a cook reads MUST go through `@commise/i18n`, as today. A locale's dictionary MUST cover
  every shipped string before the locale ships. A missing key in a shipped locale MUST fail the build. Falling back to
  English is a safety net for a key added after release, never a way to ship a partial locale.
- **FR-011**: Regional English MUST be built as `en-GB`, `en-CA` and `en-AU` dictionaries that override only the
  strings that differ from `en`: spelling (favourite, colour), food words (courgette, aubergine, coriander) and
  kitchen words (grill and broil, shopping list and grocery list). A shared glossary per locale holds these choices.
- **FR-012**: Spanish MUST be built as an `es` dictionary, with regional overrides only where needed. Every string
  MUST be reviewed by a native culinary reviewer before it ships. A machine or AI draft is allowed as a first pass,
  never as the shipped text. Every plan name in 010's plan register follows 010's naming rule in every language.
- **FR-013**: Before any locale ships, every screen MUST pass the pseudo-locale `en-XA` check, which grows text by
  35%. Controls size to the longest real string. Text wraps, and is never cut short or forced onto one line.
- **FR-014**: Plurals, counts and gendered words MUST use the locale's plural rules from CLDR, through a maintained
  message-format library. Strings MUST never be built by joining words.
- **FR-015**: A recipe MUST record the language its content is written in. The language is detected at save, and its
  cook can change it. Pages and screens mark that language, so a screen reader reads a Spanish recipe in Spanish inside
  an
  English screen (WCAG 2.2 SC 3.1.2). Recipe content is never machine-translated (`021` NFR-005). `staff-architect`
  designs the field at PLANNING.
- **FR-016**: The web app MUST keep its locale path (`/{locale}/…`). When a second locale ships, public pages and
  marketing pages MUST declare their alternate-language versions, and each locale's page MUST have its own canonical
  address (`021-FR-010`, `021-FR-026`, `022-FR-110`).
- **FR-017**: Legal documents in another language are versions recorded by 016 (`016-FR-003`, `016-FR-049`). Which
  language governs in each market is a counsel item (FR-115).
- **FR-019**: Every state below is a deliverable, on web and mobile, with copy and a localisation key.
  `staff-ux-engineer` SPECIFY owns the design of each:
    - the language setting and the region setting, each with its current value and its choices
    - each shipped screen in each shipped locale, at phone, tablet and desktop widths
    - the unit display: metric, US, and a recipe in a convention other than the cook's
    - a recipe's measure convention: shown, changed, and unknown
    - the market-not-served answer on web and mobile
    - the import screen for a language whose parse path is not ready
    - the help screen with its support languages
    - the nutrition panel with its source named, and with a source from another country

#### C. Units, dates and numbers

- **FR-020**: The metric or imperial display preference is `017-FR-026`'s, and stays display only. This spec adds its
  default: US customary in the US market, metric in the UK, Canada and Australia. A cook can change it at any time.
  The default is resolved in code and stored as a nullable typed column (ADR-0059).
- **FR-021**: Each recipe MUST record its **measure convention**: the sizes its spoons, cups and pints mean. The sizes
  differ by country:
    - A US nutrition-label tablespoon is 15 mL, and a label cup is 240 mL. The source is
      [21 CFR 101.9(b)(5)(viii)](https://www.law.cornell.edu/cfr/text/21/101.9).
    - A US customary cup is about 236.6 mL. This is from a secondary source,
      [Wikipedia](<https://en.wikipedia.org/wiki/Cup_(unit)>).
    - Australia, Canada and New Zealand use a metric cup of 250 mL, and an Australian tablespoon is 20 mL. This is from
      the same secondary source. Health Canada's food guide uses "the 250 mL measuring cup". The plan checks the
      Australian tablespoon against a primary source.
    - An imperial pint is "0.568 261 25 cubic decimetre". The source is
      [Weights and Measures Act 1985, Schedule 1](https://www.legislation.gov.uk/ukpga/1985/72/schedule/1).
    - A US pint is about 0.47 litres. The source is
      [NIST](https://www.nist.gov/pml/owm/approximate-conversions-us-customary-measures-metric).

    The convention defaults from the author's market for a recipe written in Commise, and from the source site's
    country for an import. The cook can change it. It is persisted data that every conversion reads, so
    `staff-architect` designs it at PLANNING. The size table lives in one place.

- **FR-022**: A conversion MUST start from the recipe's convention, never from an assumed US measure. An amount with
  no unit stays as written. A volume converts to a weight only where the food catalog holds that food's portion, and
  otherwise stays a volume.
- **FR-023**: Oven heat MUST show in the cook's system, °C or °F. A recipe that states a gas mark keeps it and shows the
  °C and °F beside it, from one table. Converted heats round to the steps cooks use.
- **FR-024**: Dates, times and numbers MUST follow the cook's locale through CLDR data and the platform's `Intl`
  formatters: date order, 12-hour or 24-hour clock, and the decimal mark. Fractions stay fractions where the locale's
  recipes use them.
- **FR-025**: A number in recipe text MUST be read with the recipe's content language (FR-015). "1,5" is one and a half
  in Spanish and one thousand five hundred nowhere in a recipe.
- **FR-026**: Grocery list amounts MUST follow the cook's display preference, converted from each recipe's own
  convention.
- **FR-027**: Energy MUST show in the units each market expects: kcal in the US, kJ and kcal in the UK, Australia and
  Canada. Values are stored once, under their source's own definition (ADR-0052 decision 4), and only the display
  changes.

#### D. Ingredient lines in another language

- **FR-030**: The CRF engine reads English only (ADR-0025). So for a language other than English, the two-engine
  agreement of ADR-0026 has one engine. A line parsed by one engine MUST be recorded as `single-engine`, never as
  `agree`. The English engine MUST NOT read a line in another language as English.
- **FR-031**: A language's import and paste parsing MUST meet a parse bar before it ships. The bar is checked on a
  corpus of real lines in that language. The bar is the owner's: no nonsense words and no wrong numbers. The corpus, its
  size and the check
  are set at plan time, in the way ADR-0026's corpus-wide diff was set for English.
- **FR-032**: `staff-architect` MUST choose how a second engine is supplied for Spanish at PLANNING. The options it
  weighs include these:
    - a Spanish model for a CRF engine
    - a rule-based reader for amounts and units only
    - the LLM alone, with every line flagged for the cook's review

    Any LLM call draws on ADR-0024's one pool, and `cfo-1` costs the
    Spanish volume before it ships.

- **FR-033**: Until a language meets its bar, the import screen MUST say, in the cook's language, which languages
  import reads well. It MUST NOT parse that language silently with a wrong engine.

#### E. Food data by region

- **FR-040**: Where a cook's market has an admitted national source (CoFID for the UK, the Canadian Nutrient File for
  Canada), the system MUST be able to prefer that source's food for nutrition, where it is the same food. How this
  fits ADR-0052's citation precedence, which refuses ties and never blends numbers, is `staff-architect`'s decision
  at PLANNING. Every food MUST show its source, as today.
- **FR-041**: Food names MUST work by region. A synonym MUST carry the locale it belongs to (`en-GB` courgette, `en-US`
  zucchini). Search finds a food by any of its names. Display uses the name for the cook's locale. Today's synonyms
  carry no locale, so tagging them is plan work.
- **FR-042**: Spanish food names MUST come from a reviewed Spanish name list, written for Commise and reviewed by a
  native culinary reviewer. No admitted source names foods in Spanish.
- **FR-043**: Australia MUST open with the admitted sources, labelled with their real country, and never called
  Australian data. ADR-0052 refused the Australian Food Composition Database for its share-alike terms. So, at plan
  time, the team asks its publisher for terms that allow commercial use without share-alike, and searches for other
  Australian sources. No candidate's licence is stated here until someone reads it.
- **FR-044**: The same search MUST be done for Spain and Mexico before a Spanish-speaking market opens (Q1). No
  admitted source covers either.
- **FR-045**: Branded foods come from USDA's US Branded data only. Open Food Facts is refused (ADR-0052). So branded
  foods outside the US are a stated gap, shown as such.
- **FR-046**: Each market's readiness record MUST include its **regional coverage**: the share of a fixture list of
  common foods in that market's recipes that resolve to a food with nutrition. The owner accepts the figure as a gate.
  This spec sets no number.

#### F. Store listings and keywords

- **FR-050**: Each served storefront MUST have its own listing on each store: name, subtitle, keywords, description,
  screenshots and what's new. Screenshots come from the current app, in the new UI only, in that locale (`022-FR-012`).
- **FR-051**: On the App Store, a storefront can carry more than one listing language.
  [Apple's table](https://developer.apple.com/help/app-store-connect/reference/app-store-localizations) lists Spanish
  (Mexico) for the US storefront, among others. Once the Spanish app ships, a Spanish (Mexico) listing on the US
  storefront MUST be honest Spanish for a Spanish
  app. A keyword field filled with terms in another language, or with words that mislead its readers, is refused.
- **FR-052**: On Google Play, each language MUST have its own listing. A market can also have a custom listing by
  country.
- **FR-053**: Keywords MUST be researched per storefront, with that storefront's spelling and food words.
- **FR-054**: Every claim in a listing MUST have a claims register entry (`022-FR-070`). A translated claim is reviewed
  against the entry in that language before it is published.

#### G. Regional pricing

- **FR-060**: 010's plan register is the one authority for prices (`010-FR-041b`). Per-storefront prices MUST be added
  to it as an amendment owed to 010, held equal to the store consoles by a test. This spec states no price.
- **FR-061**: Prices are set in App Store Connect and the Play Console. RevenueCat reads them. The stores are "where you
  configure price, duration, and free trials"
  ([RevenueCat](https://www.revenuecat.com/docs/offerings/products-overview)). The app MUST show each store's own
  localised price string, and never work out a price itself.
- **FR-062**: The App Store sells in 175 storefronts. Apple's pricing page names "the other 174 storefronts and 43
  currencies". It offers "up to 800 price points by default". It keeps prices "equalized with your base country or
  region". The source is
  [Apple, set a price](https://developer.apple.com/help/app-store-connect/manage-app-pricing/set-a-price/). Apple's
  developer news says auto-renewing subscriptions are excluded from automatic adjustments. So each launch storefront's
  subscription price MUST be set and checked by a person, by the rule Q2 picked: a rounded local price for each
  launch storefront, recorded in 010's plan register.
- **FR-063**: A market can need a different offer. RevenueCat Targeting can then show a different offering by
  country. Its page says it can "target customers by country"
  ([RevenueCat Targeting](https://www.revenuecat.com/docs/tools/targeting)). It MUST use the store country, never
  the IP country. Then the offer matches the price the store charges.
- **FR-064**: The trial, the one-trial rule and the referral rules MUST be the same in every market, unless a market's
  law needs a change. Any change is recorded in that market's readiness record.

#### H. Tax

- **FR-070**: In-app sales go through the stores. Google's tax page says these things
  ([Google Play](https://support.google.com/googleplay/android-developer/answer/138000)):
    - In the UK, Google is "responsible for determining, charging, and remitting VAT".
    - In the EU, the same holds for "all Google Play Store purchases".
    - In Australia, Google remits "10% GST" for developers outside Australia.
    - In Canada, Google collects GST and HST for a developer outside Canada, or one with no GST or HST number.

    Apple's agreement lists the regions where Apple collects and remits, and makes the developer responsible elsewhere
    (seen in a search snippet only). So each market's tax status on each store MUST be checked by the tax adviser and
    recorded in its readiness record. It is never assumed.

- **FR-071**: Web checkout MUST stay US only until Stripe Managed Payments is active on live sales, and every price has
  an eligible tax code (ADR-0075). An overseas seller must register for UK VAT at its first UK sale (ADR-0075, citing
  gov.uk). So a cook outside the US who opens the web subscription page is sent to their store, with a plain message.
- **FR-072**: If Stripe refuses Managed Payments, ADR-0075's fallbacks apply: Paddle through RevenueCat, or staying a
  US-only web seller. This spec adds no other path.
- **FR-073**: The app MUST NOT link to a web purchase from a storefront whose rules do not allow it. Which storefronts
  allow it is a counsel item for each market (FR-115, ADR-0075).

#### I. Privacy and consumer law

The seams below already exist at the strictest regime under `016-FR-048b`. Each market triggers its own capabilities
under `016-FR-048c`. They are built as that market opens, and recorded in its readiness record.

- **FR-080**: **UK.** UK GDPR and the Data Protection Act 2018. Capabilities to check:
    - a UK representative for a controller with no UK establishment
    - the UK transfer mechanism for each processor (`016-FR-039`)
    - the UK consumer rules for subscriptions, cancellation and renewal notices
- **FR-081**: **Canada.** PIPEDA, and in Quebec its private-sector privacy law. Capabilities to check: a person
  responsible for privacy, the transfer assessment for data leaving Quebec, consent for commercial email, and the
  provinces' consumer rules.
- **FR-082**: **Australia.** The Privacy Act 1988 and its Australian Privacy Principles, including the rule for
  sending data overseas. The Privacy and Other Legislation Amendment Act 2024 received assent on 10 December 2024. It
  added a statutory tort for serious invasions of privacy. The source is the
  [Federal Register of Legislation](https://www.legislation.gov.au/C2024A00128/latest/details). Capabilities to
  check: the Spam Act's rules for email, and the Australian Consumer Law for subscriptions.
- **FR-083**: **EU, for a later wave.** GDPR, an EU representative, and the withdrawal function. Secondary sources say
  the withdrawal function of Directive (EU) 2023/2673 applies from 19 June 2026. The plan checks it against the
  Official Journal.
- **FR-084**: **Quebec's French-language rule.** In its 1997 text, the Charter of the French Language says software
  must be available in French, unless no French version exists. The source is a
  [Université Laval archive](https://axl.cefan.ulaval.ca/amnord/quebecmodif-40-1997.htm). Law-firm summaries say
  the 2022 amendments added terms, which were not read from the current statute. Canada MUST NOT open until counsel
  says what Quebec needs.
- **FR-085**: Each market's privacy notice MUST name its processors and transfers (`016-FR-039`). Attribution consent
  follows `023-FR-046` per market.
- **FR-086**: The age floor per market follows `016-FR-008`. Each market's readiness record names its floor and its
  basis.
- **FR-087**: **Accessibility.** WCAG 2.2 AA applies everywhere, as today. A market-specific accessibility statement is
  a capability (`016-FR-048c`). Counsel checks each market's duties: the UK Equality Act, Canada's federal and
  provincial laws, Australia's Disability Discrimination Act, and the European Accessibility Act for an EU wave.
- **FR-088**: **"US-only" is not a defence** _(added 2026-11-03, owner ruling, ADR-0082)_. [Law] An app listed in the
  EU or UK app stores serves those places (DSA Recital 8, GDPR Art. 3(2), UK Online Safety Act s.4(5) and s.4(6)). So
  `016-FR-048` MUST do one of two things, and the readiness record shows which. Either store availability is
  restricted to the launch markets and the restriction is recorded (FR-005), or the UK is treated as a day-one market
  for the light duties below. Counsel review is owed before launch (`016-FR-050`).
  _(amended 2026-11-03, owner ruling O9, ADR-0082)_ Decided: at launch the app is listed ONLY in US app stores, and the readiness record shows
  that restriction. So the first branch applies. A listing in any EU or UK store MUST NOT be created until every duty
  in FR-089 for that market is met and the market's readiness record is green (FR-100). `016-FR-048c` holds the same
  rule. The web site follows `016-FR-048a`. [Law] Without the restriction, the EU and UK duties would already bind.
- **FR-089**: **Duties before a market is served.** [Law] Before Commise serves a market, its readiness record shows
  these, where they apply:
    - **EU:** a legal representative under DSA Art. 13, a GDPR Art. 27 representative, DSA Art. 11 and 12 contact
      points, a notice-and-action path (DSA Art. 16), statements of reasons for removal and for demotion or limits on
      visibility (DSA Art. 17(1)(a), no size exemption, with an "automated: yes or no" flag), and a plan for DSM Art. 17.
    - **UK:** a UK GDPR representative, the Online Safety Act duties (an illegal-content risk assessment, a children's
      access assessment, and age assurance where eating-disorder content can appear), and unfair-terms law
      (Consumer Rights Act 2015 Part 2) at the UK launch.
    - **EU and UK, creator sales** _(added 2026-11-03, owner ruling O15d, ADR-0082)_: [Law] When a creator sells a
      recipe to a buyer in these markets, by purchase or by subscription (`018-FR-029`, `018-FR-029h`), the buyer is a consumer of digital content. Directive (EU)
      2019/770 (conformity and remedies) and the UK Consumer Rights Act 2015 Part 1 Chapter 3 (digital content) then
      give the buyer rights, including a remedy when the content stops being available. [House rule] These duties are a
      **precondition for listing creator sales in an EU or UK storefront**, not a launch duty, because launch is US only
      (`018-FR-029e`, `016-FR-048c`). _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ The refund rule is now
      set in 018: a creator removal gives a 30-day download and no refund (`018-FR-029i`), and a takedown gives a full
      refund (`018-FR-029j`). [Law] In the EU and UK the no-refund path can fall short of a consumer's statutory remedy
      when content stops being available, so counsel MUST check it against these rules before any such listing.
      Counsel review is owed before launch (`016-FR-050`).
    - **Australia:** the under-16 social media self-assessment (Online Safety Act 2021 s.63C) and the Australian
      Consumer Law fairness test.
    - **Canada:** notice-and-notice (Copyright Act s.41.25 and s.41.26) with records kept for six months.
      Counsel review is owed before launch (`016-FR-050`).
- **FR-090a**: **The URL-import switch is per market (D6).** [Law] Our server makes the copy a URL import keeps, so the
  hosting defences do not cover it. A cook in the EU or UK gets facts and a link only, with no stored verbatim method,
  headnote or photo reference (EU DSM Art. 4(2), UK has no private-copy exception). A cook in the US keeps the private
  full copy. A cook who wants the full text pastes it. The switch lives in one policy, keyed on the cook's market, and
  defaults closed for any market counsel has not cleared. Extraction's legal basis differs per market: US fair use,
  EU DSM Art. 4 unless opted out, UK s.28A only, and no matching exception in Australia. The UK and Australia are
  counsel items. Counsel review is owed before launch (`016-FR-050`).

#### J. Support

- **FR-090**: The help screen and each store listing MUST state which languages support answers in, before a cook
  writes, by Q3's answer.
- **FR-091**: Help content MUST ship in each shipped locale. A store review is answered in the review's language where
  support can do so.

#### K. Launch gates per market

- **FR-100**: Each market MUST have a **readiness record**, with one entry per gate. Each entry holds its evidence, its
  owner, its date and its state. The market switch (`016-FR-048`) MUST refuse a market unless every gate is green. The
  rule is one pure Specification, tested on its own. The gates are:
    1. Counsel signs the market's items in FR-115.
    2. The privacy notice, processors and transfers for the market are published (FR-085).
    3. The terms and consumer notices for the market are published (FR-080 to FR-083).
    4. The age floor and its basis are set (FR-086).
    5. Store availability is set and matches the switch (FR-005). _(amended 2026-11-03, owner ruling O9, ADR-0082)_ No EU or UK storefront is enabled before that
       market's FR-089 duties are met. The launch setting is US storefronts only.
    6. Prices are set in both stores and recorded in 010's register (FR-060).
    7. The tax status on each store is checked, and web checkout stays US only (FR-070, FR-071).
    8. The market's default locale is complete, reviewed and through the pseudo-locale check (section B).
    9. The default units and measure conventions are set (section C).
    10. Regional coverage is measured and accepted (FR-046).
    11. For a language other than English, the parse bar is met or the import screen says so (section D).
    12. The store listings are published (section F).
    13. The support languages are stated (FR-090).
    14. Any accessibility statement the market triggers is published (FR-087).
    15. The attribution rule and the referral switch are set for the market (`023-FR-046`, `023-FR-016`).
    16. Public discovery for the market follows `016-FR-048`, and 021's open-to-web rule reads the market.
    17. AI spend for the market is costed against ADR-0024's pool.
    18. The platform duties in FR-088 and FR-089 are met for the market, and the URL-import switch (FR-090a) is set.
- **FR-101**: Only a recorded owner ruling, with its reason, can waive a gate. The record shows the waiver.
- **FR-102**: Closing a market MUST stop new sign-ups and new store availability there. Existing cooks MUST keep their
  recipes, their paid access until it ends, and their export. They are told first. A market closure never locks a cook
  out of their own data.
- **FR-103**: Each new market MUST have a soft launch with a start date and an end date recorded before it starts, read
  on 023's dashboard by market (`023-FR-012`). US rates are the stated proxy, since no country survey exists.
- **FR-104**: The owner decides whether the next market opens, from the earlier markets' data. The acquisition
  brainstorm's plan target is that a market bringing under 5% of US installs a month after 60 days pauses the next
  one. It is a target we chose, not a forecast.

#### L. Changes to other specs

Listed here and applied by each spec's owner. This change does not edit them, except where noted.

- **FR-110**: 016 MUST gain a readiness record per market under `016-FR-048`, and the counsel items of FR-115 under
  `016-FR-050`.
- **FR-111**: 010's plan register MUST gain per-storefront prices, held equal to the store consoles by a test
  (FR-060).
- **FR-112**: 017's unit preference (`017-FR-026`) MUST gain the default per market (FR-020) and read the measure
  convention (FR-021). 017 is being edited by another writer, so this is owed.
- **FR-113**: 003 and ADR-0052 MUST gain locale tags on synonyms (FR-041), the national preference rule (FR-040) and
  the source searches of FR-043 and FR-044.
- **FR-114**: 021 MUST declare alternate-language pages and read the market in its open-to-web rule, once a second
  locale or market ships. 022's out-of-scope line now waits on this spec, applied on 2026-10-28. 023 MUST report by
  market.
- **FR-115**: Counsel MUST check these, before each market opens:
    - the items of FR-080 to FR-083 for that market
    - Quebec's French-language duties, before Canada (FR-084)
    - which language governs each legal document (FR-017)
    - which storefronts allow a link to a web purchase (FR-073)
    - each market's tax status on each store, with the tax adviser (FR-070)
    - each market's accessibility duties (FR-087)
    - whether Australia's rules on minimum ages for social features reach the public recipe and creator features

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles. Market,
  locale, measure convention and gate state are closed unions. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. The readiness Specification, the unit
  conversion and the market record name the pattern they implement. (Principle II)
- **NFR-003**: Every control MUST have an accessible name queryable by `getByRole`/`getByLabel`, in every shipped
  locale. (Principles IV & VII)
- **NFR-004**: No state MUST be conveyed by colour alone. (Principle VII)
- **NFR-005**: Every string, email and notice MUST go through the localisation path (`016-FR-049`).
- **NFR-006**: Every user-facing surface ships on web and mobile in the same release (`docs/CODING_STANDARDS.md` §14).
- **NFR-007**: Every shipped locale MUST meet WCAG 2.2 AA, including the language of each part (FR-015).

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: the shipped dictionaries, the unit tables and the conversions work with no network.
- **Persistence**: the cook's locale and unit preference are settings (ADR-0059). Dictionaries ship with the app.
- **Sync**: a setting changed offline is sent with the outbox (ADR-0057).
- **Conflict**: the last write of a setting wins. A recipe's measure convention follows the recipe's own write rules.

### Key Entities

- **Market**: a served market under `016-FR-048`, with its storefronts, default locale, prices, tax status and rules.
- **Market record**: one cook's market and its basis (FR-003).
- **Locale dictionary**: one locale's strings, with its overrides and glossary (section B).
- **Measure convention**: one recipe's measure sizes (FR-021).
- **Content language**: one recipe's language (FR-015).
- **Regional synonym**: a food name with its locale (FR-041).
- **Readiness record**: one market's gates, each with evidence, owner, date and state (FR-100).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of markets open with every gate green or waived by a recorded ruling, checked by the readiness
  Specification's tests.
- **SC-002**: Zero missing strings in any shipped locale, checked on every build.
- **SC-003**: 100% of fixture recipes convert to the expected amount in each display system, for every measure
  convention, checked by a test.
- **SC-004**: Each language other than English meets its parse bar on its corpus before its import ships: zero
  nonsense words and zero wrong numbers on the corpus check.
- **SC-005**: Store availability matches the served markets in 100% of release checks.
- **SC-006**: Zero web sales to buyers outside the US before Managed Payments is active, checked against the payment
  records.
- **SC-007**: 100% of prices shown in the app are the store's own price strings, checked by a test over each served
  storefront.
- **SC-008**: `staff-ux-engineer` EVALUATE finds zero WCAG 2.2 AA failures in each shipped locale, and zero screens
  that cut text short in the pseudo-locale.
- **SC-009**: Regional coverage is measured and recorded for 100% of opened markets.

## Assumptions

- **Nothing is live.** There is no second market and no second locale yet.
- **The translation machinery holds.** `@commise/i18n` is built for many locales. Only its dictionaries and its locale
  list change.
- **016, 010 and 017's unit preference are planned and not built.** This spec rests on them.
- **US rates stand in for other markets.** No country survey of recipe-app use was found.
- **Counsel is available per market.** Each market's legal items need counsel before it opens.

## Out of Scope

- Translating recipe content.
- Right-to-left layouts, until a later wave includes such a language.
- Markets beyond the waves above, until the owner rules.
- Web checkout outside the US before Managed Payments.
- Selling printed products of any kind (`023-FR-056`).
