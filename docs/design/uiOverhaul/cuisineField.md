# Cuisine field: SPECIFY (2026-10-13)

> **What this is:** the committed design for the editor's Cuisine field, its list, and how Discover treats the values.
> **What it is not:** production code. It amends `buildSpec.md` §7.4 (row "Cuisine") and §4.4 (Cuisine facet, "Browse
> by cuisine"). Where this file and `buildSpec.md` disagree on the Cuisine field, this file wins. `ownerDecisions.md`
> still wins over both.

**Owner ruling, 2026-10-13 (verbatim):** "First we should expand the list - there are way more cuisines than that. I
don't think cuisine should be an optional field. Why are we even saving type-ahead? But we should require free text but
treat the cuisine input box the same way we treat the input boxes for food: have a dropdown under the input with
suggested names - we show all of them and only filter the list down to cuisines that match their inputted text; if
nothing match we say 'No cuisines found - but don't worry you can add your own' (or something similar that the UI agent
approves for the copy)."

**Coordinator decisions, already taken:** cuisine is required to PUBLISH. A draft saves without it, like the other
publish-gate fields. Free text is accepted. A value that matches a list entry, case-insensitively after trimming
and collapsing spaces, is saved in the list's spelling.

**Standing:** designer, SPECIFY. Read from source. Nothing rendered. The current field is
`RecipeBasicsFields.tsx:232-253` and `RecipeBasicsFields.native.tsx:150-174`, the list is
`recipe-core/src/recipe.types.ts:197-213`, and the matcher is `form/props.ts:546-550`.

**The interaction model is APG "list autocomplete with manual selection":** "The character string the user has typed
will become the value of the combobox unless the user selects a value in the popup." (W3C ARIA APG, Combobox pattern,
checked 2026-10-13). The food field is the opposite case, where the value must be picked. That is why two of the
primitive changes in §4 exist.

---

## 1. The list

### 1.1 The inclusion rule

The shipped list has **15** entries, not 16 as the brief says. It has `Other`, plus 14 cuisines.

No source publishes a list of "the cuisines a home cook names", so one source cannot settle this. The rule has three
steps, and it says which step is judgement:

1. **Recipe-API taxonomies (sourced).** Include every _specific_ cuisine in Spoonacular's supported-cuisines list (27
   values) or Edamam's `cuisineType` list (21 values), both checked 2026-10-13. Exclude their **continent-scale
   umbrellas**: African, Asian, European, Latin American, South American, South East Asian, Central Europe, Eastern
   Europe, World. Nobody cooks "Asian". These names also take recipes away from the specific facets in Discover,
   and free text still lets a cook type one. Exclude **Kosher**, because it is a dietary practice: it belongs in
   `dietaryFlags`, beside Halal and Vegan. This step gives Cajun, Caribbean, Jewish, Nordic and Southern, plus the
   nations already shipped.
2. **National cuisines (judgement, constrained).** Wikipedia's _List of cuisines_ (checked 2026-10-13) is the universe
   of candidates, and every entry below has an article there. A national cuisine is in when it is a distinct, widely
   cooked tradition that home cooks in English-language markets name as a dish's origin. **This step is
   editorial judgement, not evidence.** It is bounded in two ways:
    - Microstates and territories are out (Andorran, Monégasque, Gibraltarian, island territories). Cooks there name
      the larger tradition.
    - A nation is out when a region entry already covers it and its own name is rarely typed. For example, Nordic
      stands for Danish, Finnish, Norwegian and Swedish, and British for English, Scottish and Welsh. Free text covers
      the rest.
3. **Sub-national regions (narrow).** A region is in only when an API taxonomy names it (Cajun, Southern), when the
   owner named it (Sichuan), or when it is named as a cuisine of its own, separate from its nation, as often as those
   are: Cantonese, Creole, Hawaiian, Soul food, Tex-Mex. Italian, Indian and Mexican regions stay free text, because
   one region in invites twenty.

Also excluded: **styles** (Fusion, Barbecue, Street food), which belong in tags, and **historical** cuisines (Medieval,
Ancient Roman).

### 1.2 The list: 90 entries, alphabetical

```
Afghan · Algerian · American · Argentinian · Armenian · Australian · Austrian · Bangladeshi · Belgian · Brazilian ·
British · Burmese · Cajun · Cambodian · Canadian · Cantonese · Caribbean · Chilean · Chinese · Colombian · Creole ·
Cuban · Czech · Dominican · Dutch · Egyptian · Ethiopian · Filipino · French · Georgian · German · Ghanaian · Greek ·
Haitian · Hawaiian · Hungarian · Indian · Indonesian · Iraqi · Irish · Israeli · Italian · Jamaican · Japanese ·
Jewish · Kenyan · Korean · Lao · Lebanese · Malaysian · Mediterranean · Mexican · Middle Eastern · Moroccan ·
Native American · Nepalese · New Zealand · Nigerian · Nordic · Pakistani · Palestinian · Persian · Peruvian · Polish ·
Portuguese · Puerto Rican · Romanian · Russian · Salvadoran · Senegalese · Sichuan · Singaporean · Somali · Soul food ·
South African · Southern · Spanish · Sri Lankan · Swiss · Syrian · Taiwanese · Tex-Mex · Thai · Trinidadian ·
Tunisian · Turkish · Ukrainian · Venezuelan · Vietnamese · Yemeni
```

- **Spelling** is the name an English-speaking home cook types, with no diacritics: **Persian**, not Iranian, and
  **Argentinian**, not Argentine. Sentence case: "Soul food", "Tex-Mex".
- **`Other` is removed.** Free text replaces it. As a stored value it says nothing, so a Discover facet "Other"
  groups recipes that have nothing in common. It also competes with the cook's own words, which the owner chose to
  allow. Nothing is live, so nothing needs migrating. Its consumers are the `Cuisine` type,
  `__tests__/recipe.types.test.ts`, `form/__tests__/props.test.ts`, both `RecipeBasicsFields` tests,
  `tools/e2e-seed/src/bulkSeed.ts` and `recipe-service/tests/load/searchLatency.load.js`. The seed and the k6 script
  spread recipes over `CUISINES`. A longer list changes their cuisine distribution. That is expected. Check the seed
  output once.
- **Order: alphabetical, by `Intl.Collator('en')`, asserted by a test.** With 90 entries, a popularity order breaks
  position prediction: nobody can guess where "Peruvian" sits. We have no popularity data to order by, and both API
  taxonomies are alphabetical. Typing is the main way to find an entry, and alphabetical order is what makes scanning
  the full list work at all. There is no "Popular" group pinned on top: it needs data we do not have, and every
  entry in it appears twice.

### 1.3 Aliases (recommended, and the field ships without them)

`CUISINE_ALIASES` is a `Record<string, Cuisine>` beside `CUISINES`:

| Alias              | Entry       |
| ------------------ | ----------- |
| Szechuan, Szechwan | Sichuan     |
| Iranian            | Persian     |
| Scandinavian       | Nordic      |
| Argentine          | Argentinian |
| Laotian            | Lao         |
| Nepali             | Nepalese    |
| Philippine         | Filipino    |

An alias does two things:

- **Matching:** typing "Szech" offers **Sichuan**.
- **Canonical form:** a value equal to an alias is saved as its entry.

Without aliases, "Szechuan" and "Sichuan" become two Discover facets for one cuisine. That is the only cost of
shipping without them.

### 1.4 ⚠️ ONE-WAY DOOR: entry spelling

A list entry is stored on the wire as its English display string (`recipe.types.ts:190-196`). So:

- Renaming an entry splits its facet.
- Localising the list later means treating today's English names as keys, with translated display labels.

Undoing either costs a data rewrite. Decide the spellings above once. The evidence that changes this decision: the
product commits to a non-English locale before launch. In that case, make each entry a key now.

---

## 2. Matching and the canonical value (shared, pure)

Two functions live in `packages/shared/recipe-core` beside `CUISINES`, because the server is meant to use them too (§5):

- **`foldCuisine(text)`**: NFD, strip combining marks, lower case, treat hyphens as spaces, collapse whitespace, trim.
- **`canonicalCuisine(text): string`**: trim and collapse spaces. Empty stays `''`, and an empty value is absent on the
  wire, as `wire.ts:44` already does. If the folded text equals the fold of an entry or an alias, return the entry's
  spelling. Otherwise return the text with its **first letter upper-cased** for the `en` locale, and the rest unchanged.
    - So "nyonya" is saved as "Nyonya", while "BBQ-style" and "pan-Asian" keep their inner case.
    - This matches what the Discover chips already show (`format/sentenceCase.ts`). Without it, "nyonya" and "Nyonya"
      become two facets drawn as two identical "Nyonya" chips.
    - It is idempotent.

`cuisineSuggestions(text)` stays in `features/recipes/src/form/props.ts`. It changes from `includes` to **word-start**
matching on the folded text. An entry matches when the folded text is a prefix of the folded name, or of the name
starting at any later word. An entry also matches through any alias that matches.

- **Order:** names that start with the text come first, then later-word matches. Each group keeps alphabetical order.
  For example, "can" gives Canadian, Cantonese, where today's `includes` gives American and Dominican before them
  and Jamaican, Mexican and others after. "mex" gives Mexican, then Tex-Mex. "south" gives South African, then Southern.
  "an" gives nothing, where `includes` gives half the list. "am" gives American, then Native American. Every
  example here, the count of 90 and the `Intl.Collator('en')` order were checked by a script over the list above
  (2026-10-13). `props.test.ts` can take them as its table.
- **Empty text:** all 90.

---

## 3. The field: every state

**Placement:** unchanged from §7.4. The field is in the Kind of dish group. Below a 600 container it is full width.
From 600 it sits beside Meal type.

**Filter text is not the value.** When the field takes focus with a value already in it, the list shows **all 90**
until the cook's first edit after that focus. From then on, it filters by the field's text. Otherwise a cook who
picked "Thai" cannot browse again without first clearing the field. The host owns this as one boolean,
`editedSinceFocus`.

### 3.1 State table

| #   | State                                                | Field                                                                                                                      | List (popup on web, in the page's flow on native)                                                                            | Polite announcement (4.1.3)                                      |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| S1  | Empty, unfocused                                     | label "Cuisine", hint under the label, no placeholder                                                                      | closed                                                                                                                       | none                                                             |
| S2  | Focused, empty                                       | caret                                                                                                                      | opens on focus (`openOnFocus`), shows all 90, nothing active                                                                 | "90 cuisines"                                                    |
| S3  | Filtering, ≥1 match ("ind")                          | the text                                                                                                                   | the matches (Indian, Indonesian), then the **Not listed?** group with **Use “Ind”**                                          | "2 cuisines", after a 500 ms pause                               |
| S4  | Exact match ("thai", or "Iranian" once aliases ship) | the text                                                                                                                   | the matches, with **no** Use option, because the entry _is_ the value                                                        | "1 cuisine"                                                      |
| S5  | No match ("nyonya")                                  | the text                                                                                                                   | status note before the options: "No cuisines match “Nyonya”. You can use it as your own.", then one option, **Use “Nyonya”** | the note's text                                                  |
| S6  | Matched value committed                              | the entry's spelling ("Thai")                                                                                              | closed. On the next focus: all 90, with "Thai" marked (§4 P3) and scrolled into view, not active                             | none                                                             |
| S7  | Custom value committed                               | the canonical form ("Nyonya")                                                                                              | closed. On the next focus: all 90                                                                                            | none                                                             |
| S8  | Publish refused, empty                               | `invalid`, `danger` edge, error under the field: "Choose a cuisine, or type your own."                                     | as S1/S2                                                                                                                     | assertive, once, from the editor's existing publish-refusal path |
| S9  | Over 100 characters                                  | `invalid`, error: "Shorten the cuisine to 100 characters or fewer." This blocks even a draft save, as the title's 200 does | the Use option shows the full text, wrapped                                                                                  | none                                                             |
| S10 | Disabled / busy                                      | does not occur. The editor never disables this field                                                                       | n/a                                                                                                                          | n/a                                                              |

- **Commit** puts `canonicalCuisine(text)` into the form value. It happens on a pick, on Enter or return with no
  active option, and on Tab or blur. Changing the value on blur is not a change of context (3.2.2). The cook sees the exact string
  that will be saved, and `wire.ts:44` applies the same function again as a safety net.
- **How the cook confirms their own value.** The text is already the value as they type (APG). **Use “{text}”** is a
  real option at the end of the list, keyed `CUISINE_USE_OWN_KEY = '::use-own'` (in `form/props.ts`, with a test that
  no `CUISINES` entry equals it). `onSelect` receives only a key, so the host branches on that key and commits
  `canonicalCuisine(text)`. Every other key is an entry name and is committed as it is. The option sits under a **Not listed?** heading. It is the same shape as the food field's "Not
  listed?" with "Use “{query}” as written" (`form/messages.ts:614-616`). Arrow keys, Enter, a tap and a screen reader
  all reach it with no new mechanism. Choosing it commits the value and closes the list.
    - It shows the **canonical** form ("Use “Nyonya”" for typed "nyonya"), so the cook sees the saved spelling before
      committing.
    - In S5 there is no "Not listed?" heading: the note already says it.
- **Long values.** List entries fit on one line: the longest, "Native American", is 15 characters. The Use option and
  its note **wrap**. They never truncate, because the text is the value. The input scrolls its text within itself, as
  a single-line field does. A long custom value in Discover is the chip's problem (§5), not this field's.

### 3.2 Keyboard

**Web**, following the APG and the primitive's existing departures (`Combobox.tsx:15-25`):

| Key                       | List open                                                                                                                                       | List closed                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Down / Up                 | move the active option (downshift wraps around)                                                                                                 | Down opens the list                                                                                         |
| Enter                     | on an active option: choose it, commit, close, keep focus. With nothing active: commit the typed text and close (§4 P1). Never submits the form | commit the typed text                                                                                       |
| Escape                    | close the list, keep the text                                                                                                                   | clear the field (the existing `onAbandon`). APG: "Optionally, if the popup is hidden … clears the combobox" |
| Tab                       | close, commit the typed text, move on. Never chooses the active option (3.2.2)                                                                  | move on                                                                                                     |
| Home / End / Left / Right | move the caret and clear the active option (the existing behaviour)                                                                             | same                                                                                                        |

**Native:**

- The return key is labelled **Done** (`returnKeyType="done"`). It commits the typed text, closes the list and
  dismisses the keyboard (§4 P1). The next control, Meal type, is chips, so a keyboard left up only covers it.
- A tap on an option chooses it, commits, closes the list and dismisses the keyboard.
- The clear button (existing `cuisineClear`, 48 dp, shown while the field has text) empties the field and keeps focus,
  so the list shows all 90.
- Android Back while the keyboard is up dismisses the keyboard. React Native does not blur a `TextInput` by default
  when that happens, so the list can stay open with no keyboard. Under `typedText="isValue"` the leaf closes the list
  on `Keyboard` `keyboardDidHide` while the field is focused (part of P1). **Device check owed** on Android.

### 3.3 Screen reader and WCAG 2.2 AA contract

Level: WCAG 2.2 AA, the project floor.

- **1.3.1, 4.1.2:**
    - Web: `combobox`, `aria-expanded`, a `listbox` named "Cuisine suggestions", and a `group` named "Not listed?".
    - Native: option `button`s and the group name as a header (`Combobox.native.tsx:18-20`).
- **3.3.2:** the visible label is "Cuisine". The hint is the field's description: "Choose one, or type your own. You
  need one to publish." **No `aria-required`**, because a draft saves without a cuisine and `aria-required` claims a
  refusal that never comes. The hint and the section index carry the publish rule.
- **3.3.1, 3.3.3:** the S8 error names the field and says the fix. Web links it to the field with `aria-describedby`,
  through `describedBy` and `fieldErrorIds.ts`. Native sets the input's `accessibilityHint`, as the other field errors
  do.
- **4.1.3:** `countAnnouncement` is filled in. Today it is `""` (`RecipeBasicsFields.tsx:251`), which means a screen
  reader user cannot tell how many entries a filter left. Rules:
    - The host changes the string only after a 500 ms pause in typing, the precedent of §7.5.3's live reading, so it is
      not spoken on every keystroke.
    - S5 speaks the note.
    - The primitive already speaks only while the popup shows.
- **2.5.3:**
    - The Use option's accessible name starts with its visible text: "Use “Nyonya” as the cuisine".
    - A marked option's name is "{cuisine}, chosen".
- **2.5.8:** options are 48 dp on native and keep the web's existing row height. The clear button is 48 dp.
- **2.4.11:**
    - Native: the existing reveal (`FieldRevealContext`) shows the field and three rows above the keyboard.
    - Web: the popup avoids the page's chrome (`popup-insets`).
- **3.2.2:** typing never selects (primitive). Opening on focus activates nothing.
- **1.4.10, 1.4.4:** no horizontal scroll at 320 CSS px. At 320 the field is 288 px and the popup takes the field's
  width, kept 8 px inside the viewport. At 200% the web popup's 20rem cap grows with the text, and the card scrolls.

### 3.4 320 px and large text

- **Web 320:** the popup is 288 px wide and at most 20rem tall, about 7 rows. It scrolls inside itself, which is
  existing behaviour.
- **Native, any width:** the in-flow list is **bounded** (§4 P2) to 5.5 rows at the current font scale, capped at 45%
  of the window height. The half row shows that the list scrolls. With all 90 rows in the page's flow, the list is
  about 4,300 dp tall (90 × 48 dp). It pushes Meal type, Difficulty and Tags out of reach for as long as the
  field has focus. At font scale 2.0 the cap still keeps the field and at least two rows above the keyboard.

### 3.5 Copy (en-US), with localisation keys

Keys go in `recipeFormMessages` (`features/recipes/src/form/messages.ts`) unless a row names another file.

| Key                                               | Text                                                    | Where                                         |
| ------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `cuisineLabel` (existing)                         | Cuisine                                                 | label                                         |
| `cuisineHint` NEW                                 | Choose one, or type your own. You need one to publish.  | hint                                          |
| `cuisineListLabel` (existing)                     | Cuisine suggestions                                     | listbox name                                  |
| `cuisineSuggestionCountOne` NEW                   | 1 cuisine                                               | polite                                        |
| `cuisineSuggestionCountOther` NEW                 | {count} cuisines                                        | polite                                        |
| `cuisineNoMatch` NEW                              | No cuisines match “{text}”. You can use it as your own. | S5 note, and spoken                           |
| `cuisineNotListedHeading` NEW                     | Not listed?                                             | group heading (S3)                            |
| `cuisineUseOwn` NEW                               | Use “{text}”                                            | option label                                  |
| `cuisineUseOwnName` NEW                           | Use “{text}” as the cuisine                             | option accessible name                        |
| `cuisineChosenName` NEW                           | {cuisine}, chosen                                       | marked option's name                          |
| `cuisineClear` (existing)                         | Clear cuisine                                           | native clear button                           |
| `errors.cuisineRequired` NEW                      | Choose a cuisine, or type your own.                     | S8                                            |
| `errors.cuisineTooLong` NEW                       | Shorten the cuisine to {max} characters or fewer.       | S9, `max` = `MAX_RECIPE_CUISINE_LENGTH` (100) |
| `editor/messages.ts` `reason.cuisineRequired` NEW | Cuisine needed                                          | section index, in progress                    |

**Copy rationale.** The owner's line, "No cuisines found - but don't worry you can add your own", has the right
intent. It is approved in this form:

- It **names the text**, so the cook can check what was searched.
- It drops "don't worry", which reassures about a problem the cook does not have.
- It says **"use it"** rather than "add", because nothing joins a shared list: the value belongs to this recipe only.
  "Add" promises a list entry that never appears.

### 3.6 Publish gate: the touch points

- `form/validate.ts`: a new `cuisine?: RecipeFormErrorCode` field and the codes `cuisineRequired` and
  `cuisineTooLong`.
    - `cuisineRequired`: `validateRecipeForm`, when `canonicalCuisine(values.cuisine) === ''`.
    - `cuisineTooLong`: both `validateRecipeForm` **and** `draftFloorErrors`, because the wire refuses over 100 even
      for a draft (`recipeRequestBounds.ts:196`).
- `editor/sections.ts:26`: `FIELD_SECTION` gains `cuisine: 'details'`. It is a total `Record` over the error keys, so
  leaving it out is a compile error.
- `editor/gate.ts:46`: `firstInvalidFieldOf` returns `cuisineFieldId` for a cuisine error, straight after the title
  check. That is page order: servings and times have no single control, and Ingredients comes after Details.
- `editor/sectionStatus.ts`: `InProgressReason` gains `cuisineRequired`. When something in Details is entered, the
  title is present and the cuisine is empty, the Details row reads "Cuisine needed". The title reason still wins when
  both are missing. After a refused publish, the existing "Fix {count} things" counts it. Details is not `complete`
  without a cuisine.
- The Details hint `hint.details` stays as it is. The section reason already names what is missing.
- ⚠️ **Consequence, stated and not hidden.** The gate lives in the editor only. The server's publish floor is
  ingredients and steps (`recipes.service.ts:1011-1017`). Imported (`imported_public`) and cloned recipes can be
  published without a cuisine. Every reader (cards, detail, Discover) must keep treating an absent cuisine as "no
  cuisine", as today. Pressing "Save changes" on such a recipe in the editor will now ask for one. Whether the server
  enforces the gate is in §5.

---

## 4. Shared primitive vs. the cuisine field

The test for each line: is this a class of field, or this field?

**`packages/apps/commise/ui/src/combobox` (design system, mine to change):**

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                          | Why it is a class                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | `typedText?: 'needsChoice' \| 'isValue'`, default `needsChoice`. With `isValue`: Enter with nothing active, or native return, still calls `onSubmitWithoutChoice` **and** closes the list. Native uses `returnKeyType="done"` and `submitBehavior="blurAndSubmit"`, and a pick dismisses the keyboard. Native also closes the list on `keyboardDidHide` while the field has focus (§3.2).       | APG's two models, list autocomplete with manual selection versus a value that must be picked, are a property of the field kind. Today the primitive hard-codes the food model (`Combobox.native.tsx:257-261`, `Combobox.tsx:478-486`), so every free-text use (unit? tags?) fights it. An enum, not a boolean, because it names the model.                                                                                                 |
| P2  | Native `listMaxRows?: number`. It applies when there are more options than that. The options then sit in a nested vertical scroller, `listMaxRows + 0.5` rows tall at the current font scale, and never taller than 45% of the window. `nestedScrollEnabled` and `keyboardShouldPersistTaps="handled"`. Default: unbounded, as today. Web needs nothing, because its 20rem cap already scrolls. | Any long fixed list. The docstring gives two reasons for having no scroller, and both still hold. (a) On Android a child drawn outside its parent takes no touches. The list stays in flow, so nothing is drawn outside. (b) A drag that began on the list keeps it open. That stays true, and the drag now scrolls the list instead of the page. The ScrollerDragContext tests need a case for a drag that began inside the bounded list. |
| P3  | `ComboboxOption.current?: boolean`: a decorative trailing `check` glyph, and the option is scrolled into view when the list opens. **Not** `aria-selected`: in APG that marks the active option, and setting it lies about what Enter does. The host names it through `accessibleName`.                                                                                                         | Any combobox whose value is one of its options. **Deferrable:** without it S6 still works, minus the mark.                                                                                                                                                                                                                                                                                                                                 |

**Not in the primitive.** The primitive's contract already says "the host owns the text and the suggestions"
(`props.ts:7-8`). So matching, the canonical form, the Use option, the copy and the `editedSinceFocus` rule all stay
out of it.

**`packages/shared/recipe-core`:** the expanded `CUISINES` (alphabetical, with tests for both order and membership),
`CUISINE_ALIASES`, `foldCuisine` and `canonicalCuisine`. They are pure and shared by every writer.

**`packages/apps/commise/features/recipes/src/form` (feature code, built by `fe-1`):**

- Word-start `cuisineSuggestions`.
- Building the groups: the matches, then "Not listed?" with the Use option.
- `editedSinceFocus`.
- The debounced `countAnnouncement`.
- Commit through `canonicalCuisine`.
- `invalid`, `describedBy` and `hint` wiring.
- The `validate.ts` and `sectionStatus.ts` codes.
- Both leaves pass `typedText="isValue"`, and native passes `listMaxRows={5}`.

---

## 5. Discover with free text

**Each custom value is its own facet, and there is no "Other" bucket.** Two reasons:

- The search filter is an exact match (`search.dal.ts:540-541`, `cuisine = $1`), and facets group exact strings
  (`search.dal.ts:495-499`). A grouped "Other" chip needs a new negative filter ("not in the list") that the API
  does not have.
- It also hides exactly the cuisines the owner chose to allow.

`canonicalCuisine` keeps the most common split, case, from happening on the client.

- **Filter panel and sheet, Cuisine group:** unchanged in shape (§4.4). Chips with counts, most-common first (the
  server's order), wrapping to 3 lines, then "Show all ({n})". A custom value sits among the curated ones, ordered by
  its count. Nothing marks it as custom: on Discover it is a cuisine like the others.
- **"Browse by cuisine" row, a change:** each chip needs **3 or more recipes**, the existing
  `CUISINE_SHORTCUT_MIN_RECIPES`. The row's own visibility rule stays as it is.
    - Today the row maps **every** facet bucket once it shows (`RecipeDiscoveryContainer.tsx:415-421`,
      `RecipeDiscoveryScreen.tsx:429-434`). With free text, that means a chip for every one-off spelling.
    - The two containers repeat the same mapping, so the fix belongs in one shared pure `cuisineShortcutsOf(facets)` in
      `discovery/noResults.ts`, beside `showsCuisineShortcuts`, used by both. This is the place to stop the per-screen
      copies drifting.
- **Long custom values in chips:** I have not checked the `Chip` primitive's long-label rule. If it has none, a
  100-character chip shows a primitive gap. Clamp to 2 lines at a 240 px / 240 dp maximum width, then ellipsis, with the
  full value in the accessible name. Never `nowrap`.

**For `staff-architect` (not decided here):**

1. Does recipe-service apply `canonicalCuisine` on create and update, so imports, clones and other clients cannot
   split facets? I recommend yes. The function is pure and in `recipe-core` for this reason.
2. Does the server enforce the publish gate? The cost: every `imported_public` corpus recipe needs a cuisine before
   it can publish.
3. Does the facet query fold case and spacing for the splits canonicalisation cannot catch ("NYONYA")? Low priority.

---

## 6. How we will know it worked

- **Primary:** the share of published recipes whose cuisine is a list entry. A healthy share is high, but not 100%.
- **Guardrail 1:** facets that split one cuisine across several spellings. Count them by `foldCuisine` collisions in
  a facet sample.
- **Guardrail 2:** publish refusals caused by `cuisineRequired`. If cooks are often stopped here, the requirement costs
  more than it gives.

All three can be read from the existing search facets and recipe rows. No new telemetry is needed.

---

## Evidence and validation

- **Verified (this session):**
    - Spoonacular cuisines (27) and Edamam `cuisineType` (21), from their documentation.
    - Wikipedia _List of cuisines_.
    - APG Combobox keyboard text and the list-autocomplete definition.
    - WCAG criterion numbers, from the corpus `accessibility.md`.
    - Every path cited above was read.
- **Assumed:**
    - The `Chip` long-label behaviour.
    - That the native page scroller tolerates a nested scroller on both platforms. P2 needs a device check.
- **Judgement:**
    - The step-2 and step-3 membership.
    - Alphabetical order.
    - The copy.
    - First-letter capitalisation of custom values.
- **Validation passes run:**
    - Against publication (APG, WCAG, the API taxonomies). This changed the rule from "in an API list" to a stated
      judgement, because Ethiopian, Peruvian and Filipino are in neither API.
    - Adversarial: "alphabetical buries what most cooks want. Put Italian first." Answer: with type-to-filter, the
      first 1–2 letters reach any entry, and a popularity order of 90 cannot be predicted. The case for popularity
      holds only for lists short enough to scan without typing, which this one no longer is.

**Hand-off:**

- `fe-1`: the feature changes in §3 and §4.
- `staff-architect`, before anything is built: P1 and P2 are new contract on a design-system primitive, and P1 is a
  mode prop that changes behaviour (`openOnFocus` is the precedent). Also the three §5 questions.
- Then this agent, or a design-system build: P1–P3 in `@commise/ui`.
- Then EVALUATE this field on web and native, including P2 on a device at font scale 2.0.
