# Architecture: Commise UI overhaul — PLAN rulings (§12 A1–A21) + BLUEPRINT (slices 1–3)

- **Mode:** PLAN for the 21 questions in `docs/design/uiOverhaul/buildSpec.md` §12. BLUEPRINT for slices 1–3. Slices
  4–9 are covered at the level of seams and contracts only.
- **Date:** 2026-10-08. **Agent:** `staff-architect` (read-only). **Inputs:** `ownerDecisions.md`, which binds and
  outranks everything below; `buildSpec.md` in full; `CLAUDE.md`; the offline memory `offlineLocalFirstArchitecture.md`;
  the code and ADRs cited by path.
- **Working tree:** slice 0 is in progress and uncommitted (`git status`: `ui/src/durationField/`,
  `ui/src/layout/BottomChromeFrame.native.tsx`, `web/src/app/[locale]/[...rest]/`, edits to `AppRoot.tsx`,
  `RecipesScreen.tsx`, the web chrome). This blueprint builds on top of that tree.

---

## Governing decisions checked

| Source                                                                                            | What it says, where it constrains this work                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-0026** (`0026-two-engine-ingredient-parse-pipeline.md:288-292`)                             | "`recipe-core` is a hard **zod-only leaf** (its `dependencies` is exactly `{ zod }`) because the web and mobile bundles import it. `recipe-import-core` carries no such constraint — it already depends on `entities`, `fraction.js`, `parse-ingredient` and `sanitize-html`." **Binds A1.** No parser library may go into recipe-core.                                                                                                                                                                              |
| **Bundle-boundary guard** (`recipe-import-core/tests/corpusPipeline.integration.test.ts:337-352`) | "is depended on by no app package, because its parsers must not ship in the Expo bundle". It greps only `packages/apps/**/package.json` for `@kitchensink/recipe-import-core`. **Binds A1.** It cannot see a transitive edge through a shared package, or a direct `parse-ingredient` dependency.                                                                                                                                                                                                                    |
| **`ingredientLine.ts` header** (`recipe-import-core/src/ingredientLine.ts:16-50`)                 | "recipe-core cannot reach for the library at all: it ships in the Expo bundle". Its U35 note records that `parse-ingredient`'s unit vocabulary and recipe-core's disagreed (`T.`/`t.`): "two modules implementing one ruling and disagreeing". **Binds A1.**                                                                                                                                                                                                                                                         |
| **`recipes.schema.ts:160-232`** (create-only `sourceLine`/`sourcePhrase`/`statedMeasure`)         | "a picker-built line has no source and never reaches the gate at all"; `sourcePhrase` "IS the cross-user memo's KEY"; all three are create-only on purpose (ADR-0023 shape). **Binds A2, A5.**                                                                                                                                                                                                                                                                                                                       |
| **ADR-0034** (save and version row are one transaction)                                           | "Every recipe write — create, update, clone, restore — records an immutable `recipe_versions` row." The restore's opt-out "is deleted" as "an opt-out of an invariant". `VERSION_RETENTION_LIMIT = 10` (`versions/dal/versions.dal.ts:28`). **Binds A3.** I do not add a snapshot opt-out.                                                                                                                                                                                                                           |
| **ADR-0045** ("Rebinding one line is a command")                                                  | Rebind "takes the same version check and makes a version"; "the teaching requirement … is met only through the rebind command"; "An editor that uses the command must adopt the version the command returns". **Binds A3** for published recipes.                                                                                                                                                                                                                                                                    |
| **Offline memory, fourth round** (governs)                                                        | No client-supplied id (cancelled). The no-blind-retry rule. Zero server changes. One persisted one-way door: the outbox format. Owed before the first `submit` call site: a serialized mutator and a retry delay in `drainer.ts`. The web store was volatile (owner, 2026-09-17); D7, as amended 2026-10-09, keeps the editor's draft and its unsent saves in `sessionStorage` (ADR-0057), so durability copy still differs by platform (`disk` vs `tabSession`). **Binds A3, A4, A14, A15.**                        |
| **`syncProvider.tsx:153-156`**                                                                    | "⚠️ OWED BEFORE THE FIRST `submit` CALL SITE …" (the clobber). Still present today. **Binds slice 7.**                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`AppRoot.tsx` B13 note**                                                                        | "this app deliberately does NOT depend on `@react-navigation/*`: with exactly three flat destinations and no deep-linking/history requirements, a `useState` switch is the simplest correct design … Adopting react-navigation … is a legitimate future need but is a separate, feature-sized task." `RecipesScreen.tsx:1-12` adds that each screen exposes seams "so they drop straight into a real stack navigator when one is introduced app-wide". **Binds A6.** I argue below that its premise no longer holds. |
| **`CODING_STANDARDS.md` §14.2**                                                                   | Navigation and routing are per-app and may fork ("Next.js vs Expo Router"). The standard expects a navigation library on native.                                                                                                                                                                                                                                                                                                                                                                                     |
| **`CODING_STANDARDS.md` §11.2 + `patternRegister.test.ts`**                                       | Every ref-using module needs a `REF_MODULES` entry, by set equality, plus a `@pattern` in its own docblock. Precedents: a scroller handle is `sanctioned-adjacent` (`mobile/src/hooks/useScrollResetOnChange.ts`); a focus node is `sanctioned` (`ui/src/dialogFocus/useFocusOnSignal.ts`, `ui/src/screenReaderFocus/useScreenReaderFocusOnSignal.native.ts`). **Binds A7.**                                                                                                                                         |
| **`form/limits.ts:1-35`**                                                                         | "the editor may be stricter than the server, NEVER looser", asserted by tests. `TITLE_MAX_LENGTH = 64` today, against a wire limit of 200. **Binds** the title and collection limits (A12).                                                                                                                                                                                                                                                                                                                          |
| **`button/surfaceClass.ts:39-48`** (E2 I2)                                                        | "The radius is HALF the floor, not a full pill … A label that wraps makes a rounded rectangle, so its words stay inside the curve." **Conflicts** with spec §1.6 "Button radius `full`". I keep the recorded decision (see "Changes to the build spec").                                                                                                                                                                                                                                                             |
| **`ui/src/layout/index.ts` header**                                                               | `@commise/ui/layout` is a native-only barrel: it names `.native.js` files and no web app imports it. **Conflicts** with spec §1.11, which puts the web `LargeTitleHeader`/`ActionBar` under `./layout`.                                                                                                                                                                                                                                                                                                              |
| **`features/core/src/homeNavigation.ts`**                                                         | "**never drops** a destination: an unshipped feature is shown as coming soon". **Overturned by the owner** ("Navigation shows no 'Soon' items", `ownerDecisions.md`). I cite that ruling and do not re-argue it.                                                                                                                                                                                                                                                                                                     |
| **CLAUDE.md barrel rule**                                                                         | A forwarding `index.ts` is allowed only as a `package.json` `exports` target. Every new `ui` folder barrel below is one. Nothing else forwards.                                                                                                                                                                                                                                                                                                                                                                      |
| **CLAUDE.md, cross-platform rule / §14**                                                          | Every slice ships web and native together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **ADR-0054** (session seam)                                                                       | A cook's cache ends with their session. **Binds A13** (cook marks) and the editor draft store.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **ADR-0009**                                                                                      | Sign-out goes through `useSignOutAndLeave`/`signOutAndVerify`. Untouched. Profile keeps it (slice 9).                                                                                                                                                                                                                                                                                                                                                                                                                |
| **ADR-0014 / GR-015**                                                                             | Clients read wire types and bounds from `@kitchensink/schema-recipe`. **Binds A11, A12** and the title rule.                                                                                                                                                                                                                                                                                                                                                                                                         |

Not found and not applicable: no ADR covers web navigation, the design-system tokens or icons. The ADR store has no
entry for the outbox (memory says one is owed; see ADR-0057 below).

---

## Current state (anchored)

- **Native navigation** is hand-made. `mobile/src/screens/AppRoot.tsx` holds a `useState<RootDestination>`
  (`home | recipes{recipeId?} | profile | account`). `mobile/src/screens/RecipesScreen.tsx` holds its own
  `Surface` stack union (13 members, including `parse`, `parseReview`, `collectionCreate`, `collectionRename`).
  The Android Back chain runs through `@commise/ui/back-intercept`. There is no navigation library, no
  `react-native-screens`, no gesture handler and no Reanimated in `mobile/package.json`.
- **Nav model:** `features/core/src/homeNavigation.ts` is a Registry: `HOME_NAV_ITEMS` has six ids, including
  `meal-plan`/`grocery`/`nutrition`/`profile`, and resolves unreachable items to "coming soon".
- **Web shell:** `web/src/components/app/AppShell.tsx` (composition root) → `home/chrome/HomeChrome.tsx` (sidebar
    - top bar + tab bar + `HomeMobileNav` drawer, switching at `lg`). `shellSurfaces.ts` is a Registry of 19 surface
      ids, including the routes to be deleted.
- **Tokens:** `ui/src/tokens/{colors,scale,typography,native,themeCss}.ts`. `semantic.secondary = coral`,
  `semantic.ring = seafoam-light` (`colors.ts`). On Android, elevation is taken from `offsetY`
  (`native.ts:toNativeShadow`). Native has display faces only (`displayFontFace`) and no body face.
  `nativeFontFace.test.ts` guards the face contract. Web fonts load correctly (`globals.css:1-10` fixed the
  dropped-font defect).
- **Already built (slice 0, working tree):** `ui/src/durationField/` (export `./duration-field`, `./duration`:
  `splitDuration`/`joinDuration`), and `formatDuration` in `features/recipes/src/list/model.ts:89`. The spec's
  §1.11 `input/DurationField.tsx` and `recipe-core/src/duration.ts` would duplicate both.
- **Editor:** `features/recipes/src/hooks/useRecipeEditor.ts` (996 lines) is a headless statechart: seeded once,
  409 → conflict, the rebind command queue, wizard step state layered on top. It does **not** use the sync
  queue. `features/recipes/package.json` has no `@commise/query` dependency.
- **Sync:** `@kitchensink/sync` (`packages/shared/sync/src/*`) is the platform-free domain. `IntentKind` is
  `create | update | delete | setVisibility | createFreeform | upload | addMember` (no `removeMember`, no
  `clone`). `mintLocalRef` gives a `local:` ref built on `Math.random` (Hermes-safe). `@commise/query/sync`
  `SyncProvider` is mounted on both platforms and has zero `submit` call sites. The two owed items are still
  open (`syncProvider.tsx:153`, `drainer.ts:38-40`). Web's `'anonymous'` subject is fixed
  (`RecipeProviders.tsx:131-145`).
- **Wire facts:** `listRecipesQuerySchema` already takes `sortBy ∈ {updatedAt, createdAt, title}`
  (`recipes.schema.ts:460-488`). Collection create takes `description`. Bounds are name 120, description 1000
  (`collections.schema.ts:41-44, 75-80`). Recipe title is at most 200 (`recipeRequestBounds.ts:48`).
- **Facets** on My recipes filter client-side (`list/model.ts:154`, `matchesListFacet`).
- **Deps verified on 2026-10-08** (npm registry and `node_modules/expo/bundledNativeModules.json`):
    - `lucide-react` 1.53.0 and `lucide-react-native` 1.53.0 (peer `react-native-svg ^12–15`; deep imports
      `./icons/*` exported; `sideEffects: false`). All 30 glyphs in spec §1.7 exist in 1.53.0 (checked by name).
    - `react-native-svg` 15.15.4, `react-native-screens ~4.26.0`, `expo-keep-awake ~57.0.1` (already a dependency
      of `expo`).
    - `@expo-google-fonts/inter` 0.4.2.
    - `@react-navigation/native` latest is 7.5.0; 8.x is `next` (8.0.0-alpha.50). `@react-navigation/bottom-tabs`
      7.20.0.
    - `numeric-quantity` 3.3.1 (no dependencies, ~6 KB; uses `/\p{Nd}/u` at module scope).
    - Radix `react-radio-group` 1.4.8 and `react-toggle-group` 1.1.20.

---

## Part A — the 21 rulings

Each ruling gives the decision, the patterns and how they compose, the seam with real paths, the alternatives
rejected, and risk and reversibility.

### A1 — The leading-measure reader

**Decision.** A pure function `readLeadingMeasure(text: string): LeadingMeasureReading` lives at
`packages/apps/commise/features/recipes/src/form/leadingMeasure.ts`.

- The amount comes from the `numeric-quantity` library, a new `dependency` of `@commise/features-recipes`:
  numbers, mixed numbers, ASCII and unicode fractions.
- A range (`2–2.5`, `2-3`, `2 to 3`) is two amounts joined by the range separators. These separators are the
  module's only own grammar.
- The **known unit** is the next one or two tokens with **case preserved**. A token is known when
  `@kitchensink/recipe-core`'s `classifyUnit(token) !== 'unknown'` (canonical or subjective), and is normalized
  with `normalizeUnit`.
- Text after the first comma is the preparation. The remainder is the food search.
- The amount goes through `statedQuantity` / `ABSENT_QUANTITY`, so the reader cannot produce a quantity the wire
  rejects.

```ts
export interface LeadingMeasureReading {
    readonly quantity: IngredientQuantity; // ABSENT_QUANTITY when no leading amount
    readonly unit: string; // '' when none; normalizeUnit output
    readonly search: string; // what the food search is asked
    readonly preparation: string; // '' when no comma
}
```

**Patterns.**

- Parser (parse, don't validate) at the UI boundary.
- A Specification ("known unit") delegated to recipe-core's single authority.
- An Adapter over `numeric-quantity`.

**Seam.** It lives in feature code that both apps already import, and it never ships to a service.

**Rejected.**

1. **recipe-core.** ADR-0026's zod-only leaf; HALT.
2. **`parse-ingredient` in features-recipes.** It passes the guard because the guard only greps for
   `recipe-import-core`. But it brings a **second unit vocabulary** into the editor and recreates exactly the
   `T.`/`t.` disagreement `ingredientLine.ts` documents. "Known unit" must have one authority.
3. **A new shared package.** One consumer, no second reason to change.
4. **Hand-rolled fractions.** Library-first.

**Risk.**

- `numeric-quantity` compiles `/\p{Nd}/u` at module load. Two sources disagree on whether Hermes supports
  Unicode property escapes. If it does not, the bundle crashes when the module loads. **This is a
  precondition, checked before slice 8 starts:** run the reader on the RN 0.86 Hermes Android emulator. If it
  fails, the fallback is a ~15-line amount reader over an explicit fraction table, recorded as a
  `PLATFORM-FORK` on the library's absence.
- Extend the bundle guard to fail if any app manifest declares `parse-ingredient` (one line in the same test),
  so rejection 2 stays closed.

**Reversibility:** two-way door.

### A2 — What a typed line stores

**Decision.** A line made in the add field is an **authored, picker-built line**.

- It stores the cook's amount, unit and preparation from the reader, plus the binding of the food they picked.
- It sends **no** `sourceLine`, `sourcePhrase` or `statedMeasure`. It creates **no** parse job, never reaches
  the U11 gate, and its raw text is not kept.
- The correction → cache → engines order is protected by never entering it.

**Why it must not store the typed text as `sourceLine`:**

- The gate would then judge the cook's own pick against the cook's own words. That spends Bedrock budget and
  risks a wrong DISAGREE, which withholds nutrition from a line the cook chose deliberately. U11 ranks that
  direction as the unacceptable one.
- `sourcePhrase` is the cross-user memo key, so sending it from a typed field reopens the memo-steering hole
  `recipes.schema.ts:194` closes.

**"Nothing later overwrites."** Verified for the binding path: `withLineBinding` (`form/lineBinding.ts`) replaces
only `name/isUserEntered/resolutionStatus/unresolvedReason/foodId/variant` and keeps every written field.
Resolution and rebind write bindings only.

**Patterns.**

- Value Object (`LineBinding`, already the shape).
- Command (the pick commits a row).

**Reversibility:** two-way door. Nothing new is persisted.

### A3 — Autosave against versioning and the write port

**Decision.** There are three parts with three owners.

1. **Device draft = Memento.**
    - New module `features/recipes/src/editor/draftStore.ts`, over the existing `OutboxStore` key/value **port**
      from `@kitchensink/sync`, with one build-time adapter per app, shared with the outbox: mobile AsyncStorage
      (`nativeDeviceStore`), web the tab's `sessionStorage` (`webDeviceStore`, D7 as amended 2026-10-09).
    - Format as ADR-0057 §1 fixed it: one key per user, `editor.draft.v1.{subject}`, holding every memento.
    - It is written 1 s after typing stops, on blur, on section change and on hide, for **every** recipe.
2. **Promotion = Policy.**
    - A pure `checkpointPolicy.ts` decides when a memento becomes a server write.
    - **Never-published draft:** at checkpoints only: section change, editor exit, app background or
      `visibilitychange: hidden`, 10 s after typing stops, and Publish.
    - **Published recipe:** only on Save changes.
    - The policy reads the lifecycle from the first publish (`firstPublishedAt`, ADR-0058 rule 1), not `status`: a
      recipe set back to draft stays published to the editor. It is a Strategy keyed on that lifecycle (unsaved,
      never published, published), chosen in one place.
3. **Server write = Command through the outbox.**
    - A checkpoint `submit`s one `update` intent (or a `create`, see A4). The outbox's existing
      at-most-one-pending-update-per-entity rule makes coalescing lossless, because the editor submits the whole
      draft.
    - Save changes on a published recipe first drains the memento's `pendingRebinds` through the editor's
      existing command queue (ADR-0045: each makes a version and teaches), then submits the one `update`.

**ADR-0034 is untouched.** Every server write still versions. The cadence change bounds the versions to a few per
editing session instead of one per pause. One per pause would evict the whole 10-version DB window in a minute and
flood the S3 archive outbox.

**Second device.**

- The memento records `baseVersion`. On reopen, the editor seeds from the memento and shows the resume notice.
- If the server moved on, Save changes gets a 409 → the existing conflict view. That entry is ordinary: a live
  submit while mounted, so no `initialConflict` API is needed.

**`useRecipeEditor` change.** The seed becomes `{ recipe, memento?: DraftMemento }`, still captured once at mount.
Seed-once holds; only the source of the seed widens.

**Patterns.**

- Memento: device draft.
- Policy / Strategy: checkpoint and promotion.
- Command processor: outbox.
- Statechart: editor, unchanged in its four invariants.
- Ports & adapters: storage.

Each part can be tested and replaced alone. The policy is a pure table; the store has a memory adapter; the
outbox already has unit tests.

**Rejected.**

1. **Server autosave at 1 s.** Version flood; see above.
2. **A snapshot opt-out for draft-to-draft writes.** It is the opt-out ADR-0034 deleted. HALT, unless the owner
   amends ADR-0034 (Q2).
3. **Storing published device changes in the outbox.** The outbox drains; these must not.
4. **Persisting the web draft to IndexedDB.** The owner's 2026-09-17 ruling keeps durable app data out of the browser;
   D7 relaxes it for the editor's draft and unsent saves in `sessionStorage` only.

**Risk.**

- On web, the memento and the outbox journal live in the tab's `sessionStorage` (D7): they survive a reload and end
  with the tab. A published recipe's device-only changes are lost on tab close, so the web status copy names the tab,
  not the device (Q1). A duplicated tab copies both; its journal's first read parks its pending creates (ADR-0057 §3).
- Each rebind on a published recipe makes a version at Save changes (N + 1), so spec §13's "Save changes makes
  exactly one version" holds only with no food re-picks (Q5).

**One-way door:** the memento's persisted format (AsyncStorage on mobile, `sessionStorage` on web). It is versioned
(`v1`) and quarantined on mismatch, like the outbox. Recorded as **ADR-0057**.

### A4 — No stored draft before first input; idempotent create

**Decision.**

- **No client id is ever sent.** Client-minted UUIDv7 ids are cancelled: v7 throws on Hermes, and the
  fourth-round no-blind-retry rule removed the need.
- At first input, the editor mints `mintLocalRef('recipe')`. That ref keys the memento only.
- The **server `create`** is the first checkpoint at which the draft floor passes (`draftFloorErrors` in
  `form/steps.ts`; it needs a title, which the wire requires). Until then the recipe exists only on the device.
  A cook who types only ingredients and leaves keeps them on mobile, but has nothing in My recipes.
- Later checkpoints are `update` intents that `dependsOn` the create's local ref. `substituteRefs` swaps in the
  server id at drain.
- Idempotency comes from the no-blind-retry rule: an unknown outcome parks for the user; it is never resent.
- After create, the editor navigates nowhere; only Publish navigates. So `submit` resolving `{queued: true}` is
  enough. The detail route after Publish takes the id from the outbox's resolution map (`resolveRef`) once the
  create has answered.

**Patterns.** Command with a dependency edge, and a local reference substituted at drain.

**Rejected:** a client id (cancelled twice); a server create at first keystroke (it fails the title floor).

**Risk:** a parked create shows "Couldn't save." Its copy is the UX engineer's to write.

**Reversibility:** two-way.

### A5 — Paste into the editor

**Decision.**

- **Paste a list is offered until the first publish** (D10, amended 2026-10-09): autosave stores a draft on the server
  as soon as it has a title, so the gate is the first publish, not the first save (`pasteOffered`). After it, the
  editor offers no paste control.
- **A paste still joining holds the server create** (`serverWriteFor`'s paste hold), so no pasted line joins a draft
  whose create already went out, except on the editor's exit. The hold is one cell made before both the editor and
  the paste (`editor/pasteHold.ts`): the paste writes it as its state commits, a checkpoint reads it when it runs.
- **Paste a list** creates a parse job through the existing client (`useParseJob`-family hooks). This is a
  **non-deferrable write** (offline memory): offline it fails fast with the ordinary error, on both platforms.
  That is the one honest exception to "never changes behaviour offline", because queueing it would lie.
- A new headless hook `features/recipes/src/editor/usePasteIntoIngredients.ts` (Observer over the job read)
  inserts one draft row per line in a `reading` state.
- On settle, each line becomes an **unbound** draft row (name, quantity, unit from the job's answer), and the
  existing lookup cascade takes over (ADR-0045). R19 holds: the parse binds nothing.
- For a recipe whose **create has not been submitted yet** (`pastedLineKeepsSource`), the create carries each line's
  `sourceLine`/`sourcePhrase` (create-only on the wire). For a recipe already stored, a PATCH cannot carry them, so pasted lines are stored
  as authored lines and the U11 gate never judges them. This is a recorded consequence (Q3).
- `/recipes/parse*`, `ParsePasteContainer`, `ParseJobReviewContainer`, `features/recipes/src/parse/*`, and
  native `ParseIngredientsScreen`/`ParseJobReviewScreen` retire in slice 8.
- Surviving strings move to `form/messages.ts`.

**Patterns:** Observer (job polling) + Adapter (job answer → draft row) + the existing resolution cascade.

**Rejected:** re-sending `sourceLine` on PATCH (reopens ADR-0023's steering hole). Changing the wire to allow it
on new lines only needs its own ADR, because `replaceForRecipe` re-inserts every line and cannot tell a new line
from an old one.

**Reversibility:** two-way.

### A6 — Native root tab bar and per-tab stacks

**Decision.** Adopt **React Navigation 7**: `@react-navigation/native` ^7.5, `@react-navigation/native-stack` ^7,
`@react-navigation/bottom-tabs` ^7.20, with `react-native-screens ~4.26.0`. Install with `npx expo install`.

- **Root native stack:** `Tabs` (`headerShown: false`), plus the focused-task routes (`RecipeEditor`; today's
  `RecipeCreate`/`RecipeEdit`/`Parse*` until slices 7–8; `CollectionPicker` until slice 5).
    - Focused tasks sit **above** the tabs, so the tab bar hides by construction.
    - `presentation: 'card'`, `gestureEnabled: true`, so iOS edge swipe does what × does.
- **Tabs:** `home`, `recipes`, `discover`, each a native stack.
    - Pushed screens are registered in each stack: `RecipeDetail`, `RecipeVersions`, `CollectionDetail`,
      `Profile`, `LegalSources`, and `AccountSettings` until slice 9. So Profile is pushed onto the current stack.
    - `backBehavior: 'initialRoute'`, so Android Back goes to Home from Recipes and Discover.
    - `tabBar={(props) => <AppTabBar {...props} />}` keeps our own bar; D6 holds on iPad.
- **Second tap on the active tab:** a nested stack pops to top on `tabPress`, and `useScrollToTop(handle)` scrolls
  a root screen. Both are library behaviour. `AppTabBar` must emit `tabPress` with `canPreventDefault`, exactly
  like the default bar.
- **Recipes segments** (My recipes · Collections) are one root screen with a `segment` param
  (`navigation.setParams`). Discover becomes its own tab.

**B13's premise no longer holds.** B13 rests on "exactly three flat destinations and no … history requirements".
The owner now requires per-tab history, push and pop with an iOS edge swipe, pop-to-root on re-tap, and Profile
pushed onto any stack. Those are history requirements. B13 itself names react-navigation as "a legitimate future
need".

**Rejected.**

1. **Hand-made stack + iOS swipe.** It needs gesture-handler and Reanimated (two native dependencies), and
   reinvents `UINavigationController`'s interactive pop with parallax and interruptibility. Library-first.
2. **React Navigation 8.** Still alpha (`next` = 8.0.0-alpha.50), and its bottom tabs default to native tabs,
   which would replace our bar.
3. **Expo Router.** A file-based restructure of the entry point and `AuthGate` for no requirement beyond what
   React Navigation gives. It is built on React Navigation anyway.

**Seam with `@commise/ui/back-intercept`.** RN `BackHandler` calls listeners last-registered-first. Mount
`BackInterceptProvider` **inside** `NavigationContainer`, so sheets get first refusal and an unhandled press falls
through to navigation. A test (below) pins the order.

**Risk.**

- `react-native-screens` is a native module, so the dev client must be rebuilt.
- jsdom may not render native-stack. Native component tests stub `react-native-screens` if needed (assumed; see
  "Verified vs assumed"). The real proof is Maestro.

**Reversibility:** two-way at the code level, but it is the app's navigation spine. Record as **ADR-0056**,
superseding B13's note.

### A7 — Scroll tracking and its ref

**Decision.** Yes: a scroll view's imperative handle is the sanctioned "external, non-declarative system".
`scrollTo` has no declarative form; precedent `useScrollResetOnChange.ts`. There is **one** `ScrollHost` per
screen, at `packages/apps/commise/ui/src/scrollHost/` (export `./scroll-host`).

- **Native** (`ScrollHost.native.tsx`):
    - **One** `useRef` to the screen's single vertical scroller, handed out through a render prop
      `children(bind)` with `bind = { ref, onScroll, scrollEventThrottle: 16 }`. That works the same for
      `ScrollView`, `FlatList` and `FlashList`.
    - It owns an `Animated.Value` for `scrollY`, used for title condensation through `Animated.event` with the
      native driver.
    - It exposes `useScrollHost(): { scrollToY(y, animated), sectionLayout(id) /* onLayout handler */, current,
handle }`.
    - `handle` is the same ref, passed to React Navigation's `useScrollToTop` in the app, so the one scroller has
      one ref.
    - Sections must be **direct children** of the content container, because `onLayout` `y` is relative to the
      parent.
- **Web** (`ScrollHost.tsx`): **no ref.**
    - The document scrolls. Sections are addressed by their element **id**, which the accessibility contract
      already requires (`href="#ingredients"`, `aria-describedby`).
    - An `IntersectionObserver` in an effect reads `getBoundingClientRect` and feeds the same pure algorithm.
    - Jumps call `scrollIntoView` and `history.replaceState`.
- **One algorithm:** `ui/src/scrollHost/currentSection.ts`,
  `currentSectionOf(tops, scrollY, activationY, atEnd): SectionId | undefined`. Pure, with a table test.
- **Focus after a jump** reuses `useFocusOnSignal` (web) and `useScreenReaderFocusOnSignal` (native), driven by a
  jump counter. No new focus refs.

**Patterns.**

- Mediator: the host coordinates the scroller, the sections and their observers.
- Observer: the spy.
- Adapter: platform scroll APIs.

**Guard obligations.**

- One new `REF_MODULES` entry, `ui/src/scrollHost/ScrollHost.native.tsx` (`sanctioned-adjacent`: scroller handle
  plus `Animated.Value`), with `@pattern Mediator over the screen's one native scroller` in its docblock.
- The unsanctioned ceiling cannot move.

**Rejected:** three hooks with three refs to one ScrollView; web refs on H2s (ids already exist).

**Reversibility:** two-way.

### A8 — The 840 breakpoint and container queries

**Decision.**

- One numeric source: `ui/src/tokens/layout.ts` (new), holding the viewport thresholds 600/840, container
  thresholds 600/960, content widths, and gutters 16/24/32.
- `themeCss.ts` emits, appended last:
    - `--breakpoint-nav: 52.5rem`;
    - container-query thresholds `--container-regular: 37.5rem` and `--container-wide: 60rem`;
    - content widths `--container-reading: 40rem`, `--container-list: 48rem`, `--container-detail: 72rem`,
      `--container-page: 90rem`.
- **Rename `content-wide` → `page`.** In Tailwind v4, the `--container-*` namespace drives **both** `max-w-*`
  and the `@container` size variants. The spec's `--container-wide` (1440) would make `@wide/main:` fire at 1440
  instead of 960. Consequence: `max-w-wide` exists, equals 60rem, and is never used. Document that in
  `layout.ts`.
- `<main>` is `@container/main` with the gutters as padding.
- Native uses the same numbers through a pure `containerClassOf(widthPx)` / `viewportClassOf(widthPx)` in
  `ui/src/layout/containerClass.ts` (export `./container-class`; platform-neutral, because `./layout` is native
  only).

**Proof.** `web/tests/__integration__/tailwindTheme.integration.test.ts` compiles and asserts `nav:`, `@regular/main:`,
`@wide/main:`, `max-w-page`, the type roles and the colour roles. Its header records two earlier namespace
failures, so nothing is assumed.

**Reversibility:** two-way; nothing is live.

### A9 — New dependencies

**Decision: approved with the placements below.** Also corrected: the spec misses three dependencies and
assumes one that is absent.

| Dependency                                                        | Version                  | Declared in                                                                  | Notes                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lucide-react`                                                    | 1.53.0                   | `@commise/ui` `dependencies`                                                 | Imported **only** by `ui/src/icon/Icon.tsx`. Web/features import `@commise/ui/icon`, so web's Dockerfile `no-extraneous` rule sees no direct import.                                                                                                    |
| `lucide-react-native`                                             | 1.53.0                   | `@commise/ui` optional `peerDependencies` + `@commise/mobile` `dependencies` | **Deep imports only** (`lucide-react-native/icons/house`). Metro does not tree-shake by default, and the root barrel would ship about 4,266 icons.                                                                                                      |
| `react-native-svg`                                                | 15.15.4 (`expo install`) | `@commise/mobile` `dependencies` (autolinking) + `@commise/ui` optional peer | Native module → dev-client rebuild.                                                                                                                                                                                                                     |
| `expo-keep-awake`                                                 | ~57.0.1 (`expo install`) | `@commise/mobile` + `@commise/ui` optional peer                              | Already in `expo`'s own dependencies; declare it anyway.                                                                                                                                                                                                |
| `@expo-google-fonts/inter`                                        | ^0.4.2                   | `@commise/mobile`                                                            | Same series as Playfair.                                                                                                                                                                                                                                |
| **`@react-navigation/{native,native-stack,bottom-tabs}`**         | ^7                       | `@commise/mobile`                                                            | A6.                                                                                                                                                                                                                                                     |
| **`react-native-screens`**                                        | ~4.26.0                  | `@commise/mobile`                                                            | A6; native → rebuild.                                                                                                                                                                                                                                   |
| **`@radix-ui/react-radio-group`, `@radix-ui/react-toggle-group`** | 1.4.8 / 1.1.20           | `@commise/ui`                                                                | Web roving focus and arrow keys for choice chips, the list/grid switch and the visibility cards (radio), and difficulty (single toggle that can be cleared). Library-first over hand-rolled roving tabindex; same family as the existing Radix dialogs. |

**Rejected: Reanimated.** Spec §1.9 writes "Native (Reanimated `withSpring`)", but Reanimated is **not installed**.
The house primitives use RN `Animated` (`ui/src/motion/EnterTransition.native.tsx`,
`ui/src/sheet/useSwipeToDismiss.native.ts`). `Animated.spring({ stiffness, damping, mass, useNativeDriver: true })`
takes the spec's numbers directly. Adding Reanimated plus worklets plus a Babel plugin for one overshoot is not
justified.

**Glyph Registry and guard.**

- `ui/src/icon/glyphs.ts` maps a closed `IconName` union to the Lucide component on each leaf. That is the spec's
  "one glyph list".
- A new guard, `packages/infra/global/__tests__/iconImportBoundary.test.ts`, asserts:
    1. no file outside `ui/src/icon/` imports `lucide-react*`;
    2. the native leaf imports only `lucide-react-native/icons/*`;
    3. a ratchet: the number of files importing `@expo/vector-icons` only goes down, to 0 at the end of slice 2,
       after which `@expo/vector-icons` leaves `features-recipes` `peerDependencies` and the mobile stub.

**Tests.** A shared native test alias maps `lucide-react-native/icons/*` to a stub. Add it to every
`vitest.native.config.ts` that renders icons, the same way as `tests/stubs/expoVectorIcons.tsx`.

**If Lucide is refused on native:** keep Feather behind the same `Icon.native.tsx` (spec fallback). The Registry
makes that a one-file change.

### A10 — Deleted routes

**Decision.** Delete each route in the slice the spec names, with no redirect. The slice-0 `[...rest]` catch-all
renders the 404 for them. Each deletion removes, in one commit:

- the `app/[locale]/…/page.tsx` directory;
- its `shellSurfaces.ts` id and copy (`recipeParse`, `recipeParseReview`, `collectionNew`,
  `collectionAddRecipes`, `collectionRename`, `account`, `settings`);
- the container (`ParsePasteContainer`, `ParseJobReviewContainer`, `CollectionFormContainer`, …);
- the native route or `Surface` member;
- the e2e specs, with coverage moved as spec §13 lists.

`routeProtection.spec.ts` gains an assertion that each deleted path answers the 404 surface, not a redirect.

**Pattern:** Registry (`SHELL_SURFACE_IDS`). Its compile-time copy requirement makes a stale id a type error.

**Reversibility:** two-way; nothing is live.

### A11 — Library sort

**Decision: the premise is false.** `GET /api/v1/recipes` already takes `sortBy` (`updatedAt` default,
`createdAt`, `title`; `recipes.schema.ts:460-488`), and the client passes it (`client.ts:412`). A server sort
before paging is correct across pages. So Sort is buildable in slice 4 with three keys: Recently edited, Newest,
A–Z. Changing it resets the infinite-query key. Whether to show it is the UX engineer's call; architecture blocks
nothing.

"Quickest" and "Most saved" need new server keys; they are not in scope.

**Finding the spec missed.** The facet chips filter **client-side** over the loaded pages (`matchesListFacet`).
That is the same "one page of a paged list misreports the rest" defect the spec cites against sort. Facet counts
and "No recipes match these filters" are wrong past page 1.

- Recorded for slice 4.
- Either load all pages under 500 recipes (FR-defined size?), or add server facet filters. That is a
  recipe-service contract change and gets its own decision.

### A12 — Collection create contract

**Decision.** Create **does** take `description` (`collections.schema.ts:75-80`), so the field ships on create.

- Wire bounds are name 120 and description 1000. The spec's 80/280 are **display caps**, and they are legal under
  `limits.ts`'s governing rule ("stricter than the server, NEVER looser").
- Put them in a new `features/recipes/src/collections/limits.ts` with the same invariant test against the schema
  package's `MAX_COLLECTION_NAME_LENGTH`/`MAX_COLLECTION_DESCRIPTION_LENGTH` (exported by
  `packages/schemas/recipe/src/schemas/collections.schema.ts`).

### A13 — Session state for checks and the current step

**Decision.** One rule on both platforms: marks are keyed by (session subject, recipe id). They are **not** per
stack entry.

- A pure reducer `features/recipes/src/detail/cookMarks.ts` (State + Command: `toggleLine`, `toggleStep`, `clear`).
- A `CookMarksStore` port with two adapters:
    - web: `sessionStorage` key `cook.v1.{subject}.{recipeId}`, holding **only line keys and a step index, never
      recipe content**, so the "no recipe bodies at rest in a browser" ruling holds;
    - native: an in-memory map in a provider under the session scope.
- Both are cleared at session end through the ADR-0054 seam.

**Rejected:** "per stack entry" on native. A recipe opened twice would show two different check states.

### A14 — Save a copy from a card

**Decision.**

- A TanStack mutation over the existing clone endpoint (Command). The "optimistic" part is the **control's**
  state, from `useMutationState` filtered by mutation key `['saveCopy', sourceId]`: the icon fills while pending
  and stays filled on success. **No cache pre-write.** There is no id before the server answers, and client ids
  are cancelled.
- A second press while pending or succeeded is a no-op, from the same mutation state.
- On failure: unfill and an inline alert.
- On success: invalidate the list and show the snackbar with Edit, which opens the copy's id from the response.
- Not through the outbox: there is no `clone` intent, and adding one is a persisted-format change. Offline gives
  the ordinary error.

**Risk:** dedupe is per session only. Q8 covers whether "already copied" must survive a reload; that needs a
server fact.

### A15 — Picker toggles

**Decision.**

- Per-row TanStack mutations (add and remove endpoints). Command + optimistic update + reconciliation:
  `onMutate` cancels the collection-members query, snapshots, flips membership; `onError` rolls back and shows the
  inline alert.
- Mutations are serialized per pair with `scope: { id: \`member:${collectionId}:${recipeId}\` }`, so a fast
  on → off → on cannot land out of order.
- Outbox adoption waits for a `removeMember` intent kind. That is a persisted-format change, recorded under
  ADR-0057's open items.

**Related, collection-detail remove with undo (slice 5).** Undo **cancels before sending**: a delayed commit on
snackbar timeout, on a new snackbar, or on navigation. It does not re-add afterwards, because a member carries
provenance (`sourceIndicatorFromSource`, "From source collection", `collections/messages.ts:295-296`), and a
re-add would plausibly come back as "Added by you" (inferred, not verified server-side).

### A16 — Editor section hash and deep links

**Decision.**

- One Registry, `features/recipes/src/editor/sections.ts`: `EDITOR_SECTIONS = ['details','ingredients','steps',
'photos'] as const` → `EditorSectionId`, with the H2 element id and label key.
- **Web:** `/recipes/{id}/edit#ingredients`. The hash is read once on mount (it never reaches the server). Jumps
  use `history.replaceState`, so Back still leaves the editor.
- **Native:** route param `section?: EditorSectionId` on `RecipeEditor`.
- Detail's "Edit" links build the URL or params from the same registry.

### A17 — Google given name as a prefill

**Decision.**

- Prefill from Clerk's `useUser().user`: the Google `externalAccounts` entry's `firstName`, else
  `user.firstName`. **Never saved** until the cook presses Save.
- **Assumed, not verified:** that Clerk populates it with the dashboard's name fields turned off. Verify on the
  sandbox instance in slice 9. If it is absent, there is no prefill and nothing else changes.

### A18 — Keyboard shortcuts preference

**Decision.** The preference is a server-side user setting (`searchShortcut`), not a per-device value. Owner
ruling D19 superseded the earlier plan to keep it in web `localStorage`. The setting follows the cook to another
browser, and ADR-0059 records the settings endpoint it is read from. The switch is web-only, because the `/` key
is a keyboard affordance. Native shows no switch, and ADR-0059 records that waiver.

### A19 — `ui` token roles

**Decision.** Agreed: expand–contract inside the design system.

1. Add `role` (and `pewter`/`honey`).
2. Move consumers.
3. Delete `semantic.secondary`/`semantic.ring`, with a guard (`colors.test.ts`) asserting zero readers across
   `packages/apps/**`. The guard lands in the same slice as the delete.

Never change what an existing key means.

### A20 — Web Wake Lock

**Decision.** Agreed.

- An Adapter, `ui/src/keepAwake/wakeLock.ts`: capability is `isSecureContext && 'wakeLock' in navigator`;
  re-acquire on `visibilitychange`; release on unmount.
- Native uses `activateKeepAwakeAsync(tag)`/`deactivateKeepAwake(tag)`.
- `KeepAwakeToggle` renders nothing without the capability (Null Object). It is never shown disabled.
- `localhost` is a secure context; sandbox previews are HTTPS.

### A21 — Import chooser clipboard detection and share targets

**Decision.** Agreed: out of scope. When import is scheduled, a share extension or share target is a config
plugin plus a native dependency, and needs its own ADR.

---

## Part B — BLUEPRINT, slices 1–3

### Decision

- **Slice 1** puts the overhaul's visual language into the token layer as **roles**, from one numeric source,
  emitted to Tailwind v4 and projected to native. It adds Inter on native and the container scaffold on
  `<main>`. No layout or behaviour moves.
- **Slice 2** builds or reshapes every primitive in `@commise/ui` against those roles, behind a Lucide glyph
  Registry.
- **Slice 3** replaces both shells: React Navigation 7 on native, a sidebar/tab-bar switch at `nav` (840) on web.
  It adds `LargeTitleHeader`, `CreateFab`, `BackToTop`, the avatar entry and the `ScrollHost`.

### Slice 1 — tokens, type and layout foundation

**Build order** (each step leaves the tree green; tests first in every step):

1. **Colour roles.**
    - `ui/src/tokens/colors.ts`: add `palette.pewter = '#858F93'` and `palette.honey = '#A86A12'`.
    - Add `export const role = { canvas, paper, ink, inkMuted, lineControl, lineDivider, action, actionText,
selectedFill: '#E2EDEC', selectedEdge, hereBar, focusRing, rating, attention, attentionTint, danger,
dangerText } as const`. Each role references palette entries; `selectedFill` is a literal, pinned by a test
      that recomputes 14% seafoam over white.
    - `export type Role = keyof typeof role`.
    - Tests first in `ui/src/tokens/__tests__/colors.test.ts`: every §1.4 contrast pair, using `culori`'s
      `wcagContrast`, which the file already uses.
2. **Tones.** `ui/src/tokens/tones.ts` (new). `difficultyTone: Record<'easy'|'medium'|'hard', { fill, text }>` and
   `statusTone: Record<'draft'|'private'|'public', { fill, text, icon: IconName }>`. Registry keyed by a union.
   `IconName` is a type-only import; the module is added in slice 2. Until then, `icon` is a string literal union
   declared here and re-pointed in slice 2. Test: `tones.test.ts`, contrast for each pair and "error is never a
   difficulty".
3. **Type roles.**
    - `ui/src/tokens/scale.ts`: add `bodyFontFace = { normal: 'Inter_400Regular', medium: 'Inter_500Medium',
semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' }`.
    - `ui/src/tokens/typography.ts`: add `typeRole: Record<TypeRole, { face: 'display'|'body'; size: number |
{ narrow, regular, wide }; weight; lineHeight; figure?: true }>` for `largeTitle, barTitle, sectionTitle,
cardTitle, body, readingBody, meta, label, caption, overline, figureInline, figureStat`. The web projection
      emits `--text-{role}` with the `--text-{role}--line-height` and `--text-{role}--font-weight` sub-properties.
      `largeTitle` is `clamp(1.75rem, …cqi…, 2.5rem)`.
    - `ui/src/tokens/native.ts`: add `fontFace.body` and `type: Record<TypeRole, { fontFamily (face per weight),
fontSize, lineHeight (px), fontVariant? }>`. A native role selects a **face per weight** and never sets
      `fontWeight` (spec §1.5).
    - Extend `nativeFontFace.test.ts`: body faces derived from `fontFamily.body` and the weight steps; no native
      type role carries a `fontWeight`.
4. **Elevation by level.** `native.ts`: replace `elevation: spec.offsetY` with a level map
   `{ sm: 1, md: 2, lg: 3, xl: 6, glow: 0 }`. New test `nativeElevation.test.ts`. Blast radius is every Android
   shadow; re-shoot the Pixel captures.
5. **Layout tokens.**
    - `ui/src/tokens/layout.ts` (new): `viewportThreshold = { medium: 600, expanded: 840 }`,
      `containerThreshold = { regular: 600, wide: 960 }`, `contentWidth = { reading: 640, list: 768, detail: 1152,
page: 1440 }`, `gutter = { compact: 16, medium: 24, expanded: 32 }`, `spacingRole` (§1.6).
    - Pure `ui/src/layout/containerClass.ts` (new) with
      `containerClassOf(px): 'narrow'|'regular'|'wide'` and `viewportClassOf(px): 'compact'|'medium'|'expanded'`.
    - Export `./container-class` (new `package.json` `exports` entry, so the barrel rule holds).
    - Test `containerClass.test.ts`: the boundary table 599/600/959/960 and 599/600/839/840.
6. **Emit.** `ui/src/tokens/themeCss.ts`, appended **after** the existing declarations so every earlier line keeps
   its position: role colours (`--color-ink`, `--color-ink-muted`, `--color-paper`, …), `--text-*` roles,
   `--breakpoint-nav`, `--container-regular`/`--container-wide`/`--container-reading`/`--container-list`/
   `--container-detail`/`--container-page`.
    - **Integration test first:** extend `web/tests/__integration__/tailwindTheme.integration.test.ts` to compile
      and assert `nav:hidden` → `@media (width >= 52.5rem)`, `@regular/main:grid-cols-2` →
      `@container main (width >= 37.5rem)`, `@wide/main:` → 60rem, `max-w-page` → 90rem, `text-card-title` →
      1rem / 1.3 / 600, and `bg-paper`/`text-ink-muted` resolve.
7. **Inter on native.**
    - `mobile/package.json` add `@expo-google-fonts/inter`.
    - `mobile/App.tsx` `useFonts({ …Playfair, Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
Inter_700Bold })`.
    - Component test `mobile/tests/theme/bodyFace.native.test.tsx` asserts a `body` role resolves to
      `Inter_400Regular`.
8. **Container on `<main>`.** `web/src/components/home/chrome/HomeChrome.tsx`: `<main className="@container/main
…">` with gutter padding from `layout.ts` (classes `px-4 md:px-6 nav:px-8`). Update `HomeChrome.test.tsx`.
   Native: `ui/src/layout/useContainerClass.native.ts` (window width minus gutters), exported from `./layout`.
9. **Remove the second gradients** ("no box in a box"):
    - glass H1 card: `features/recipes/src/list/RecipeListFrame(.native).tsx`;
    - greeting card: `web/src/components/home/HomeGreeting.tsx`, `mobile/src/components/home/HomeGreeting.tsx`;
    - detail title cards: `features/recipes/src/detail/RecipeHero(.native).tsx`, `RecipeDetailBody(.native).tsx`.
    - Their component tests are rewritten to assert the H1 is not inside a `GlassCard`, with the reason in the
      test docblock.
10. **Duration home.** Move `formatDuration` from `features/recipes/src/list/model.ts` to
    `features/recipes/src/format/duration.ts`, so card, detail and editor do not import `list/model`. It keeps
    using `ui`'s `splitDuration`. `Intl.DurationFormat` is **not** used: Hermes support is unverified, and the
    message keys already cover it.

**Tests owed (slice 1).**

| Tier        | Files                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `colors.test.ts` (extended), `tones.test.ts`, `typeRoles.test.ts`, `nativeFontFace.test.ts` (extended), `nativeElevation.test.ts`, `containerClass.test.ts`, `layout.test.ts` (content widths equal the emitted rems), `features/recipes/src/format/__tests__/duration.test.ts` (moved suite) |
| Integration | `web/tests/__integration__/tailwindTheme.integration.test.ts` (extended, compiles the real artifact)                                                                                                                                                                                          |
| Component   | every component whose classes moved: `HomeChrome.test.tsx`, `HomeGreeting(.native).test.tsx`, `RecipeHero(.native).test.tsx`, `RecipeListFrame` tests, `StatusBadge(.native).test.tsx` (tones)                                                                                                |
| Playwright  | new `web/tests/e2e/layoutContainers.spec.ts`: at 320/390/768/1024/1280/1920, `<main>`'s content-box width and `containerName` match spec §1.2's table. Re-baseline `mockupFidelity.spec.ts` and `recipeHomeResponsive.spec.ts` snapshots, with the reason in the commit.                      |
| Maestro     | re-shoot `.maestro/visual/uiAuditCapture.yaml` on Android (no dark halo; Inter everywhere). The iOS half needs macOS (Q4).                                                                                                                                                                    |
| Guards      | none new. `docgen-components` regeneration if any component docblock changed (`npm run docs:generate --workspace=packages/tools/docgen-components`).                                                                                                                                          |

### Slice 2 — primitives

**Build order:**

1. Icon Registry and guard.
2. Button.
3. Input / TextArea / FieldLabel.
4. Chip / ChipRow / SegmentedControl.
5. SearchField.
6. Stepper.
7. StatusBadge.
8. ActionMenu.
9. ConfirmDialog.
10. RecipeCover.
11. Snackbar host + UndoSnackbar.
12. Adoption sweep (the 29 hand-built buttons, E30; Feather → Lucide), then delete `@expo/vector-icons`.

Each step is one reviewable commit, tests first.

Every new folder is `packages/apps/commise/ui/src/<name>/` with `X.tsx`, `X.native.tsx`, `props.ts` (one shared
contract, §14.4), `index.ts` as a **`package.json` export target**, and `__tests__/`. Every one carries a
`@pattern` tag (§11.2 clause 1).

| Unit                              | Path · export                                                                                                                                   | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pattern                                                                                 | Must not know         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------- |
| **Icon**                          | `icon/{glyphs.ts, Icon.tsx, Icon.native.tsx, props.ts, index.ts}` · `./icon`                                                                    | `type IconName = 'house'\|'bookOpen'\|'compass'\|'plus'\|'clipboardPaste'\|'ellipsis'\|'chevronLeft'\|'x'\|'search'\|'copyPlus'\|'trash'\|'clock'\|'users'\|'flame'\|'star'\|'lock'\|'globe'\|'pencilLine'\|'timer'\|'sun'\|'check'\|'arrowUp'\|'imagePlus'\|'listPlus'\|'chevronsLeft'\|'slidersHorizontal'\|'rotateCcw'\|'chevronDown'\|'eye'\|'user'`. `IconProps { name: IconName; size?: 20 \| 24; tone?: Role; filled?: boolean; label?: string }`. Decorative (`aria-hidden`) unless `label`. `filled` only for the active tab. `mirrorInRtl` is derived from the glyph table (`chevronLeft` only).                                                                                                               | Registry (module-scope map keyed by a union) + Adapter over Lucide per platform         | screens, routes, i18n |
| **Button**                        | `button/*` (change) · `./button`                                                                                                                | `ButtonProps = ButtonCommon & ({ variant: 'primary' \| 'secondary'; icon: IconName } \| { variant: 'destructive'; icon: IconName; tone?: 'inline' \| 'confirm' } \| { variant: 'ghost'; icon?: IconName })`. `ButtonCommon { children; size?: 'lg'\|'md'\|'sm'; width?; onPress?; type?; disabled?; busy?; accessibilityLabel?; focusRequested?; onFocusRequestHandled? }`. `icon` becomes an `IconName`, not a `ReactNode`, so a screen cannot pick its own glyph. `surfaceClass(variant, size)` keeps the **half-height radius** per size (lg 26, md 22, sm 18 with a 44 hit area). The secondary docblock and pin are rewritten to neutral `paper`/`lineControl`/`ink` (owner overruled coral); focus is `focusRing`. | Discriminated union (illegal states unrepresentable) + style recipe                     | the screen it is on   |
| **Input / TextArea / FieldLabel** | `input/{Input.tsx (new web), Input.native.tsx, TextArea.tsx, TextArea.native.tsx, FieldLabel.tsx, FieldLabel.native.tsx, props.ts}` · `./input` | `InputProps { id: string; value; onChangeText; invalid?; describedBy?; inputMode?; autoComplete?; enterKeyHint? }`. `TextAreaProps` adds `minRows; maxRows?`. Web auto-grow uses CSS `field-sizing: content`, bounded by `minRows`/`maxRows`; the fallback is a fixed `minRows` (support assumed; see below). Native uses `multiline` + `onContentSizeChange`, clamped. `FieldLabelProps { forId: string; label; hint?; required? }`: web `<label htmlFor>`, native `nativeID` with the field's `accessibilityLabelledBy`.                                                                                                                                                                                               | Template (one geometry, two leaves)                                                     | validation rules      |
| **Chip / ChipRow**                | `chip/*` · `./chip`                                                                                                                             | `ChipProps = { kind: 'filter'; label; selected; count?; onPress } \| { kind: 'input'; label; removeLabel; onRemove }`. `ChipRowProps = { mode: 'filter' \| 'input'; label; overflow: 'scroll' \| 'wrap'; maxLines?; children } \| { mode: 'choice'; label; overflow; options: readonly { value: string; label: string }[]; value: string \| null; onChange(value \| null); clearable?: boolean }`. Web choice mode: Radix RadioGroup; `clearable` (difficulty) uses Radix ToggleGroup `type="single"` with `aria-pressed`. Native: `accessibilityRole` `radio`/`checkbox`, `accessibilityState.checked`. Labels over 24 visible characters truncate, with the full name.                                                 | Composite (row owns the group semantics) + Adapter over Radix                           | facet meaning         |
| **SegmentedControl**              | `segmentedControl/*` · `./segmented-control`                                                                                                    | `{ form: 'route'; label; segments: readonly { id; label; href? }[]; current; onSelect(id) }` (web renders `<nav><a aria-current="page">`; native ignores `href`) \| `{ form: 'view'; label; segments: readonly { id; label; icon?: IconName }[]; value; onChange(id) }` (web Radix RadioGroup).                                                                                                                                                                                                                                                                                                                                                                                                                          | Discriminated union: two semantics, one look                                            | routing               |
| **SearchField**                   | `searchField/*` · `./search-field`                                                                                                              | `{ id; label; labelVisibility: 'visible' \| 'hidden'; value; onChangeText; onSubmit?; placeholder? }`. Clear returns focus to the input with a **focus request** (the existing `focusRequested` prop pattern Button already uses). No new ref.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Adapter                                                                                 | search semantics      |
| **Stepper**                       | `input/Stepper(.native).tsx` · `./input`                                                                                                        | `{ id; label; value; min?: number = 1; max?; onChange(n); announce: (n) => string }`. Polite announcement through `@commise/ui/live-region`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | — (layer only; no tag beyond the design-system obligation: `@pattern Controlled input`) | servings meaning      |
| **StatusBadge**                   | `statusBadge/*` (change)                                                                                                                        | `{ status: 'draft' \| 'private' \| 'public' \| 'pro' \| 'soon' }`. Radius `sm`, colours from `tones.ts`, icon from the Registry. The free `tone` prop goes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Registry consumer                                                                       | —                     |
| **ActionMenu**                    | `actionMenu/*` (change)                                                                                                                         | `{ triggerLabel; items: readonly ActionMenuItem[]; destructiveItem?: ActionMenuItem }`. `ActionMenuItem { id; label; icon?: IconName; onSelect }`. Trigger is always `ellipsis`. "Destructive last, after a divider" is **structural** (a separate field). Web: Radix `avoidCollisions` with `collisionPadding.bottom = var(--bottom-chrome)`, set by the shell. Native: the existing titled sheet.                                                                                                                                                                                                                                                                                                                      | Adapter over Radix DropdownMenu                                                         | what the items do     |
| **ConfirmDialog**                 | `confirmDialog/*` (change)                                                                                                                      | `{ open; title; body; confirm: { label; icon: IconName }; keep: { label; icon?: IconName }; onConfirm; onKeep; busy?; error? }`. Initial focus on Keep (Radix `AlertDialog.Cancel` default; native focus request). Buttons stack below a 400 px dialog through a **container query on the dialog**.                                                                                                                                                                                                                                                                                                                                                                                                                      | Adapter over Radix AlertDialog                                                          | —                     |
| **RecipeCover**                   | `recipeCover/{RecipeCover.tsx, RecipeCover.native.tsx, coverTint.ts, props.ts, index.ts}` · `./recipe-cover`                                    | `{ recipeId; title; cuisine?; photoUrl?; aspect: '4:3' \| '1:1' \| 'band' }`. `coverTintOf(recipeId)` is pure, FNV-1a mod 6. A bucket hash is not crypto, so no library is needed. Web `<img loading="lazy" decoding="async">` with `aspect-ratio`; native `expo-image` (new **optional peer** of `ui`; mobile already depends on it). Monogram is `aria-hidden`.                                                                                                                                                                                                                                                                                                                                                        | Null Object (monogram when no photo)                                                    | the card it sits in   |
| **Snackbar host + UndoSnackbar**  | `snackbar/{SnackbarHost.tsx, SnackbarHost.native.tsx, snackbarQueue.ts, UndoSnackbar(.native).tsx, props.ts, index.ts}` · `./snackbar`          | `useSnackbar(): { show(input: { message; action?: { label; onAction }; onTimeout?; durationMs?: number = 6000 }) }`. `snackbarQueue.ts` is a pure reducer: `show` commits the current one (fires its `onTimeout`) before it replaces it. The timer pauses on hover and focus (SC 2.2.1). `role="status"`; never takes focus. The host is mounted once per app, in `AppShell` (web) and inside `NavigationContainer` (native), and offsets above the bottom chrome.                                                                                                                                                                                                                                                       | State + Command (reducer) + Mediator (host)                                             | why a message exists  |

**`DurationField`** already exists (`ui/src/durationField/`). Slice 2 only moves its geometry onto the `Input`
rules. Spec §1.11's `input/DurationField.tsx` path is **void**.

**Pseudo-localisation for `controlLabels.spec.ts`.**

- Add a pure `pseudoExpand(messages, factor = 0.35)` to `@commise/i18n` (its tests already know `en-XA`).
- Add a **build-gated** `en-XA` locale on web, enabled only when `COMMISE_PSEUDO_LOCALE=1` at build. A guard
  asserts that a production build's `SUPPORTED_LOCALES` is unchanged.
- Native +35% layout cannot be measured in jsdom. That check is part of the slice's EVALUATE pass.

**Tests owed (slice 2).**

| Tier                        | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                        | `glyphs.test.ts` (every `IconName` maps on both leaves; RTL mirror set), `surfaceClass.test.ts` (rewritten pins), `snackbarQueue.test.ts`, `coverTint.test.ts` (stable, uniform-enough over 10k ids, six buckets), `pseudoExpand.test.ts`                                                                                                                                                                                                                                                                                                                             |
| Component (web + `.native`) | for **every** primitive and **every** state in spec §1.10: default, hover (web), pressed, selected, focus-visible, disabled, busy. Plus: Chip input "Remove {label}"; ChipRow choice arrow keys move selection (web) and clearable toggle; SegmentedControl route `aria-current`; SearchField clear restores focus; Stepper min clamp + announcement; ActionMenu destructive last; ConfirmDialog focus opens on Keep; RecipeCover photo vs monogram and no overline under 96 px; UndoSnackbar pause on hover/focus, a new one commits the old, `onTimeout` fires once |
| Integration                 | `web/tests/__integration__/tailwindTheme.integration.test.ts`: the role classes primitives use resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Playwright                  | new `controlLabels.spec.ts` (`en-XA` build, 320 px, every primitive's label has `getClientRects().length === 1`). Update `recipeOwnerActions.spec.ts` (menu ⋯, "Keep recipe"). The detail ⋯ menu no longer opens under the tab bar.                                                                                                                                                                                                                                                                                                                                   |
| Maestro                     | existing flows green. New `.maestro/visual/primitives.yaml` (Android; iOS per Q4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Guards                      | new `iconImportBoundary.test.ts` (A9). `patternRegister.test.ts` gets no new ref entries in slice 2 (focus uses props, not refs); confirm it stays green. Regenerate the docgen catalogue.                                                                                                                                                                                                                                                                                                                                                                            |

### Slice 3 — shell and information architecture

**Build order:**

1. **Nav model.** `features/core/src/homeNavigation.ts`:
    - `HomeNavItemId = 'home' | 'recipes' | 'discover' | 'meal-plan' | 'grocery'`.
    - `HOME_NAV_ITEMS` in that order.
    - `resolveHomeNav` **returns only reachable items** (owner: no "Soon" items). Its "never drops" docstring is
      replaced, citing `ownerDecisions.md`.
    - `nutrition` leaves the nav (it sits inside Plan). `profile` leaves the nav (it is the avatar).
    - Add `NAV_ITEM_GLYPH: Record<HomeNavItemId, IconName>` beside it in `features/core` (a type-only `ui` import).
    - Unit tests first: `homeNavigation.test.ts`.
2. **ScrollHost** (A7). `ui/src/scrollHost/{ScrollHost.tsx, ScrollHost.native.tsx, currentSection.ts, props.ts,
index.ts}` · `./scroll-host`.
    - Contract (shared): `useScrollHost(): { scrollToTop(): void; scrollToSection(id: string): void;
sectionLayout(id: string): LayoutHandler | undefined /* native */; current: string | undefined;
condensed: boolean }`. `ScrollHostProps { sections?: readonly string[]; headingId?: string; activationOffset?:
number; children: ReactNode | ((bind: ScrollBind) => ReactNode) /* native */ }`.
    - Slice 3 uses `scrollToTop` + `condensed`. Slices 6–7 use sections.
    - Register in `REF_MODULES` (native leaf).
3. **LargeTitleHeader + CondensedTitleBar + Avatar.**
    - `ui/src/largeTitleHeader/{LargeTitleHeader(.native).tsx, CondensedTitleBar(.native).tsx, props.ts,
index.ts}` · `./large-title-header`. Not `./layout`, which is native-only.
    - `LargeTitleHeaderProps { headingId: string; title; subtitle?; back?: { label; href?; onPress? }; action?:
HeaderAction; segments?: ReactNode; focusSignal?: number }`.
    - `type HeaderAction = { kind: 'avatar'; avatar: ReactNode } | { kind: 'controls'; button?: ReactNode; menu?:
ReactNode }`. This makes "at most one button plus one ⋯, or the avatar" structural.
    - `CondensedTitleBarProps { title; back?; menu?; visible: boolean }`. `visible` is display derivation, so it
      does not breach §11.1.
    - The **screen** (orchestration) decides whether a condensed bar exists at all: pushed web screens and every
      native screen. Top-level web pages mount none. No mode prop.
    - `ui/src/avatar/{Avatar(.native).tsx, props.ts, index.ts}` · `./avatar`: `{ name?: string; status: 'loading' |
'ready' | 'failed'; onPress?; href? }`. `pearl` disc while loading; `user` glyph without a name; name
      "Profile, {name}" / "Profile".
    - The app-level orchestration `ProfileAvatarEntry` (web `web/src/components/home/chrome/ProfileAvatarEntry.tsx`,
      native `mobile/src/navigation/ProfileAvatarEntry.tsx`) reads `useUserProfile()`. Data enters the chrome
      only there, as `AppShell`'s docblock already rules.
4. **CreateFab policy + primitive.**
    - `ui/src/createFab/{createFabPolicy.ts, CreateFab(.native).tsx, props.ts, index.ts}` · `./create-fab`.
    - `createFabPolicy.ts` (pure): `fabPresentationOf({ viewportClass, scrollingDown, atTop, focused,
keyboardOpen, firstRun, labelWidthPx, windowWidthPx }): 'hidden' | 'icon' | 'extended'`, and
      `FAB_RESERVED_BOTTOM_PX` (height + 32).
    - `CreateFabProps { label; icon: IconName; onPress; presentation }`. Rendered by the screen **right after the
      H1** in DOM and accessibility order; visually fixed bottom-trailing; RTL corner.
    - Scroll direction: web `ui/src/createFab/useScrollDirection.ts` (a passive, rAF-throttled `scroll` listener
      on `window`; the one permitted web scroll listener, stated in its docblock, because IntersectionObserver
      cannot tell direction); native from `ScrollHost`'s `scrollY`.
    - **Interim (spec §13), with no duplicated rules:** `features/recipes/src/speedDial/SpeedDial(.native).tsx`
      keeps its Menu Button Adapter over Radix, but its trigger takes `createFabPolicy`'s presentation and
      `CreateFab`'s exported surface class. The five rules live once. Slice 8 deletes SpeedDial and calls
      `CreateFab` with `onPress`.
5. **BackToTop** (web only). `ui/src/backToTop/{BackToTop.tsx, backToTopPolicy.ts, props.ts, index.ts}` ·
   `./back-to-top`. `backToTopPolicy` (pure) needs a page taller than 4 viewports, a position past 4 viewports,
   and an upward last scroll. Pressing it scrolls to the top (instant under reduced motion) and bumps the H1
   `focusSignal`. **No native file.** §14.3 is satisfied because native's job is the tab re-tap. Record a
   `PLATFORM-FORK` comment.
6. **Web shell.**
    - `HomeChrome.tsx`: delete the top bar and `HomeMobileNav`. Sidebar `hidden nav:flex`; tab bar `nav:hidden`.
      `<main>` reserves the bar height + 16 and `scroll-padding-bottom`. Sets `--bottom-chrome` for ActionMenu and
      the snackbar.
    - `HomeSidebar.tsx`: sticky `100dvh`; order wordmark → **New recipe** (interim SpeedDial trigger) → nav rows
      → divider → profile row → collapse. The collapse preference is persisted in a **cookie**
      (`commise.sidebar=collapsed`), read by the server layout, so SSR renders the right width with no hydration
      mismatch and no layout shift.
    - `HomeTabBar.tsx`: three items from `resolveHomeNav`, Lucide glyphs, `hereBar`, `aria-current`. Re-tap:
      `tabRootOf(pathname)` from `navHref.ts` (pure, new): on a pushed route it navigates to the root; at the root
      it scrolls to the top.
    - Delete `HomeTopBar.tsx`, `HomeMobileNav.tsx`, `web/src/components/home/chrome/icons.tsx` and their tests.
    - `AppShell.tsx`: `titleId` is no longer used for a bar. Remove it, and drop `shellSurfaces` copy used only by
      the bar. Keep the registry for the document title "{page} · Commise".
    - Home, My recipes and Discover headers adopt `LargeTitleHeader` with `ProfileAvatarEntry` below 840.
7. **Native shell** (A6). New `mobile/src/navigation/`:
    - `routes.ts`: `RootStackParamList`, `TabParamList`, `HomeStackParamList`, `RecipesStackParamList`,
      `DiscoverStackParamList`. These **replace** `RecipesScreen`'s `Surface` union and `AppRoot`'s
      `RootDestination`. It is the same knowledge, now typed by the navigator.
    - `RootNavigator.tsx`: `NavigationContainer` → `BackInterceptProvider` → `SnackbarHost` → root native stack
      `{ Tabs, RecipeCreate, RecipeEdit, ParseIngredients, ParseJobReview, CollectionForm, CollectionPicker }`.
      These are the interim focused tasks, with `presentation: 'card'` and `gestureEnabled: true`.
    - `TabsNavigator.tsx`: bottom tabs, `backBehavior="initialRoute"`, `screenOptions={{ headerShown: false }}`,
      `tabBar={(p) => <AppTabBar {...p} />}`.
    - `stacks.tsx`: `HomeStack`, `RecipesStack`, `DiscoverStack`. Each registers `RecipeDetail`,
      `RecipeVersions`, `CollectionDetail`, `Profile`, `AccountSettings` (until slice 9), and `LegalSources`.
    - `AppTabBar.tsx`: an Adapter from `BottomTabBarProps` to `HomeTabBar`. It emits
      `navigation.emit({ type: 'tabPress', target, canPreventDefault: true })` and navigates unless prevented.
    - `TabRootScreen.tsx`: wraps a tab root in `ScrollHost` and calls `useScrollToTop(host.handle)`.
    - `mobile/src/components/home/chrome/HomeTabBar.tsx`: three items, Lucide, `hereBar`,
      `accessibilityState.selected`. `HomeTopBar.tsx` and `chrome/icons.tsx` are deleted; the avatar moves to
      `LargeTitleHeader.action`.
    - `mobile/src/screens/AppRoot.tsx`: reduced to the root `ErrorBoundary` around `RootNavigator`. The B13 note is
      replaced by an ADR-0056 pointer.
    - `RecipesScreen.tsx`: its `Surface` stack, internal tab bar and footer plumbing go. The screens it composed
      become route components.
    - The `account` destination survives as a pushed `AccountSettings` route until slice 9.
8. **One `scrollsToTop` per screen.** Every horizontal `ScrollView`/`FlatList`/`FlashList` and every scroller
   inside a sheet sets `scrollsToTop={false}`. New guard
   `packages/infra/global/__tests__/nativeScrollsToTop.test.ts` parses `.native.tsx` and `mobile/src/**/*.tsx`
   for `horizontal` scrollers without `scrollsToTop={false}`. Set equality with an empty allowlist.

**Tests owed (slice 3).**

| Tier                   | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                   | `homeNavigation.test.ts` (drops unreachable; order; glyph map total), `currentSection.test.ts`, `createFabPolicy.test.ts` (full table, including label over 50% → icon), `backToTopPolicy.test.ts`, `navHref.test.ts` (`tabRootOf` for every route)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Component, web         | `HomeChrome.test.tsx` (no top bar, no drawer, `<main>` container, `--bottom-chrome`), `HomeSidebar.test.tsx` (expanded/collapsed, cookie round-trip, New recipe first, profile row truncation, `aria-expanded`, tooltip on hover and focus with Escape), `HomeTabBar.test.tsx` (three items, `aria-current`, re-tap at root scrolls, re-tap when pushed navigates), `LargeTitleHeader.test.tsx` (each `HeaderAction` kind, back eyebrow at 840+, segments), `CondensedTitleBar.test.tsx`, `Avatar.test.tsx` (loading/ready/failed/no name), `CreateFab.test.tsx` (three presentations; name always the label; DOM right after the H1), `BackToTop.test.tsx`, `ProfileAvatarEntry.test.tsx` |
| Component, native      | `AppTabBar.native.test.tsx` (emits `tabPress`; selected state; prevented default does not navigate), `HomeTabBar.native.test.tsx`, `LargeTitleHeader.native.test.tsx`, `CreateFab.native.test.tsx`, `ScrollHost.native.test.tsx` (one scroller; `scrollToTop` calls `scrollTo`; condensed flips past the H1 height), `mobile/tests/screens/AppRoot.shell.native.test.tsx` (rewritten from slice 0: tab switching keeps each stack; Profile pushed on the current stack; hardware back with a sheet open closes the sheet, not the screen)                                                                                                                                                  |
| Integration (frontend) | `web/tests/__integration__/shellLayout.integration.test.tsx`: renders `AppShell` with the real `@commise/ui` and features nav model at a mocked width; asserts nav landmarks "Main"/"Tabs" and a single H1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Playwright             | new `shellNavigation.spec.ts`: tab bar below 840; sidebar at 840, 1024 and 1280; collapse persists across reload with no layout shift; no top bar; FAB DOM order after the H1; FAB hidden with the keyboard; tab re-tap to top; back to top after 4 screens. Delete `homeTopBarGeometry.spec.ts` (coverage moves here). Update `homeNavCutover.spec.ts`. `routeProtection.spec.ts` keeps the sign-up link assertion.                                                                                                                                                                                                                                                                       |
| Maestro                | `.maestro/shell/tabBar.yaml`, which **replaces** `.maestro/appTabBar.yaml`: each tab; Recipes → Home and back; avatar → Profile; Android Back to Home; re-tap pops to root. `.maestro/shell/iosSwipeBack.yaml` (iOS Simulator; Q4).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Guards                 | `patternRegister.test.ts`: add `REF_MODULES['packages/apps/commise/ui/src/scrollHost/ScrollHost.native.tsx']` (`sanctioned-adjacent`); the ceiling does not move. New `nativeScrollsToTop.test.ts`. Regenerate the docgen catalogue. The device check needs a dev-client rebuild (`react-native-screens`, `react-native-svg`).                                                                                                                                                                                                                                                                                                                                                             |

### Data flow (slices 1–3)

- **Tokens:** `scale.ts`/`layout.ts`/`colors.ts`/`typography.ts` (the numbers) feed two projections: `themeCss()` →
  `dist/theme.css` → `globals.css` → Tailwind utilities, and `nativeTokens` for StyleSheets. One source, two
  projections. The integration test proves the web half; `nativeFontFace`/`nativeElevation` prove the native half.
- **Shell:** `HOME_NAV_ITEMS` × live capabilities → `resolveHomeNav` → `HomeSidebar`/`HomeTabBar` (web) and
  `AppTabBar` → `HomeTabBar` (native). The route → active id mapping is `tabRootOf` (web) or the navigator state
  (native).
- **Profile read** enters only at `ProfileAvatarEntry`.
- **Scroll:** screen → `ScrollHost` → (`condensed` → `CondensedTitleBar.visible`), (`scrollY` →
  `createFabPolicy`), (`handle` → `useScrollToTop`).

### One-way doors in slices 1–3

None that holds data. The navigation library (ADR-0056) is the costliest reversal: every screen becomes a route
component. The sidebar cookie name is trivial.

---

## Part C — Slices 4–9: seams and contracts only

- **Slice 4 (cards and lists).**
    - `features/recipes/src/card/RecipeCard(.native).tsx` takes `variant: 'grid' | 'row' | 'compact'`. That is
      display derivation of one data shape, so it is legal under §11.1.
    - The orchestration picks the variant with a pure `cardVariantOf(containerClass, viewMode, surface)`.
    - The list/grid choice persists in a cookie (web, so SSR matches) or AsyncStorage (native).
    - Sort uses the existing `sortBy` (A11). The client-side facet defect is recorded (A11).
    - New-collection sheet: `features/recipes/src/collections/CollectionSheet(.native).tsx` over `@commise/ui/sheet`,
      with display caps from `collections/limits.ts` (A12). `/collections/new` and native `collectionCreate` are
      deleted.
- **Slice 5 (Discover, collection detail, picker).**
    - The facet panel/sheet switch is `containerClassOf(main) === 'wide' && windowHeight >= 480`. It replaces
      `useFilterBarLayout.ts`, and only one facet tree renders.
    - Save a copy (A14). Picker (A15).
    - Remove with undo as a **delayed commit** (A15).
    - Visibility from the menu with undo = a `setVisibility` mutation and a compensating `setVisibility`. This is
      safe because visibility carries no provenance.
- **Slice 6 (detail).**
    - `SectionSwitch` over `ScrollHost` sections (A7).
    - `KeepAwakeToggle` (A20).
    - `cookMarks` (A13).
    - Version compare per row uses the existing pure `computeConflictDiff` over the two snapshots. No new server
      API.
- **Slice 7 (editor frame).** Prerequisites first, each with its own tests:
    1. the serialized outbox mutator (`syncProvider.tsx:153`);
    2. jittered backoff in `drainer.ts` (honouring `Retry-After`);
    3. the write port. The `features/recipes → @commise/query` package edge planned here was not added.
       `useRecipeEditor` takes the outbox as an injected port (`EditorWritePort`,
       `features/recipes/src/hooks/useRecipeEditor.ts`), and each platform's editor container adapts the app's
       `SyncQueue` (`@commise/query/sync`) to it. `features/recipes/package.json` still has no `@commise/query`
       dependency, so no cycle can form, and a test drives the editor with a fake port.

    Then:
    - `features/recipes/src/editor/{sections.ts, draftStore.ts, checkpointPolicy.ts, sectionStatus.ts,
saveStatus.ts, messages.ts}`.
    - `sectionStatusOf(validateRecipeForm(values), publishAttempted)` is pure and reads the **one** validator.
    - `TITLE_MAX_LENGTH` becomes 120 and moves from `maxLength` into `validateRecipeForm` as a publish rule. The
      draft floor also refuses titles over the wire's 200, so a checkpoint cannot loop on a 400.
    - The `useRecipeEditor` seed widens to `{ recipe, memento? }`. The wizard's step state (`step`, `goNext`,
      `canAdvanceFrom`, `wizard/*`) is deleted, not kept as unreachable code.
    - `saveStatusOf({ durableDevice, memento, outbox, lastAck })` maps to one status union; the per-platform copy is
      UX's (Q1).
    - Write ADR-0057.

- **Slice 8 (ingredients + one-tap create).** A1, A2, A5. Delete SpeedDial (slice 3 interim). `CreateFab.onPress`
  goes straight to the editor; the Home first-run "Paste ingredients" opens the editor with `section=ingredients`
  and the paste sheet open. Blocked on the Hermes `\p{Nd}` check (A1).
- **Slice 9 (Profile, sign-in, `/`).** A17 and A18. Delete `/settings`, `/account` and native `AccountSettings`
  as a route. Sign-out keeps `useSignOutAndLeave` (ADR-0009). The `/` shortcut is one document `keydown`
  listener in `web/src/components/app/useSearchShortcut.ts`, ignored inside editable targets.

---

## Changes to the build spec

1. **§7.3 Saving.** Device save at 1 s; **server** write at checkpoints (section change, exit, hidden, 10 s after
   typing stops, Publish), not 1 s. Web must not say "on this device" (Q1). "Save changes makes exactly one
   version" becomes "one version plus one per food re-pick (ADR-0045)" (Q5).
2. **§12 A3/A4.** No client id and no UUIDv7. Local ref only; server create waits for the title floor.
3. **§1.6 Button radius.** Keep the recorded half-height radius (`surfaceClass.ts` E2 I2). It draws a pill on one
   line and keeps wrapped words inside the curve.
4. **§1.11 paths.**
    - `LargeTitleHeader` → `./large-title-header`; `ActionBar` → `./action-bar` (`./layout` is native-only).
    - `DurationField` already exists at `durationField/` (`./duration-field`).
    - `formatDuration` lives in `features/recipes/src/format/duration.ts`, not recipe-core (no i18n there, and the
      package is shared with the backend).
    - New: `./icon`, `./avatar`, `./scroll-host`, `./snackbar`, `./container-class`.
5. **§1.3/§1.2.** Content width `content-wide` → `page` (`--container-page`). The Tailwind v4 namespace collision
   with `@wide`.
6. **§1.9 Motion.** RN `Animated.spring`, not Reanimated (not installed).
7. **§1.7.** Lucide is outline-only. "Filled glyph on the active tab" works for `house` and `book-open`, but a
   filled `compass` hides its needle. A UX check (Q6).
8. **§4.3.** "No Sort" rests on a false premise (A11). Also, the facet chips misreport past page 1.
9. **§5.1.** 80/280 are display caps under the wire's 120/1000 (legal). They live in `collections/limits.ts`.
10. **§7.4.** The 120 title limit becomes a `validateRecipeForm` publish rule. The draft floor also enforces the
    wire's 200.
11. **§7.5.4 / §3.8.** Paste a list fails with the ordinary error offline (a non-deferrable write). Lines pasted
    into an already-stored recipe are authored lines that the gate does not judge (Q3).
12. **§3.1 / nav.** `resolveHomeNav` drops unreachable destinations; `profile` and `nutrition` leave
    `HomeNavItemId`.
13. **§13, all slices.** iOS Simulator Maestro flows cannot run on the owner's Linux/WSL machine (Q4).
14. **§13 slice 2.** `controlLabels.spec.ts` needs the build-gated `en-XA` pseudo-locale (Part B).
15. **§3.3.** `headingRef` → `headingId` + `focusSignal` (no ref passed across the boundary).
16. **§12 A9.** Add React Navigation 7, `react-native-screens`, and the two Radix group primitives. Remove
    Reanimated.

## Conflicts with ADRs and recorded decisions

| Decision                                  | Conflict                                                                 | Resolution                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ADR-0034                                  | Spec autosave at 1 s means a version per pause.                          | Not amended. Server cadence reduced (A3). An opt-out needs a new ADR and an owner ruling (Q2). |
| ADR-0045                                  | "Device until Save changes" against rebind making a version immediately. | Rebinds queue in the memento and run before the Save changes PATCH (A3).                       |
| ADR-0026                                  | Reader in recipe-core.                                                   | Refused (A1).                                                                                  |
| ADR-0023 shape (create-only `sourceLine`) | Paste into a stored recipe.                                              | Accepted as a consequence (Q3).                                                                |
| AppRoot B13                               | No navigation library.                                                   | Superseded by ADR-0056; the premise changed (A6).                                              |
| `homeNavigation.ts` "never drops"         | Owner: no "Soon" items.                                                  | Owner ruling wins (`ownerDecisions.md`).                                                       |
| `surfaceClass.ts` E2 I2                   | Spec "radius full".                                                      | Recorded decision kept.                                                                        |
| Offline memory, 2026-09-17 (web volatile) | D1 "saves to the device until Save changes" on web.                      | Blocking question Q1.                                                                          |

## ADRs to write

- **ADR-0056 — Native navigation is React Navigation 7, one native stack per tab.**
    - Context: B13's flat-destination premise, now false.
    - Decision: A6.
    - Alternatives: hand-made stack + gestures; v8 alpha; Expo Router.
    - Consequences: dev-client rebuild, the `BackInterceptProvider` ordering, the test stub.
    - Pair it with a CLAUDE.md pointer and a `// ⚠️ DELIBERATE` comment at `AppRoot.tsx`.
- **ADR-0057 — Editor autosave: device memento, checkpoint promotion, published edits stay on the device.**
    - Decision: A3/A4.
    - The persisted memento format (`editor.draft.v1`) is the one-way door, and its quarantine rule is stated.
    - Rebind ordering under ADR-0045.
    - Open items: `removeMember`/`clone` intents.
    - Also records the outbox's own one-way door, which memory says has no ADR yet.

---

## Pattern register

**Prescribed, and how they compose:**

- **Token layer:** single numeric source → Adapter projections (web CSS, native objects). Role Registry (`role`,
  `typeRole`, `tones`) keyed by closed unions. Each part is testable alone: the numbers in unit tests, the CSS by
  compiling it, native by its own tests.
- **Glyph Registry + per-platform Adapter** (`ui/src/icon`). Screens name meanings, never glyphs. A guard owns the
  boundary.
- **Discriminated-union props** for Button, Chip, ChipRow, SegmentedControl, HeaderAction and ActionMenu
  (`destructiveItem`), so illegal combinations cannot be written.
- **Adapters over Radix** (RadioGroup, ToggleGroup, DropdownMenu, AlertDialog) on web; native leaves translate
  roles to accessibility props.
- **Snackbar:** pure reducer (State + Command) + host (Mediator). The reducer owns the "one at a time" rule; the
  host owns timers and position.
- **ScrollHost:** Mediator + Observer + Adapter.
    - It owns the one scroller handle (native) and the spy wiring.
    - `currentSection.ts` owns the algorithm, which is pure.
    - Consumers (`CondensedTitleBar`, `CreateFab` policy, `useScrollToTop`, later `SectionIndex`/`SectionSwitch`)
      only read.
- **Policy modules** (pure): `createFabPolicy`, `backToTopPolicy`, `checkpointPolicy`, `cardVariantOf`,
  `containerClassOf`. Each owns one rule. Render components receive the decided presentation.
- **Navigation:** React Navigation's navigators are the State machines for history. `routes.ts` param lists are
  the Registry of screens. `AppTabBar` is an Adapter. `TabRootScreen` composes `ScrollHost` with the library's
  `useScrollToTop`.
- **Editor (slice 7):** Memento (`draftStore`) + Strategy/Policy (`checkpointPolicy`, keyed on status) + Command
  processor (outbox) + Statechart (`useRecipeEditor`, invariants unchanged) + Ports & adapters (the `OutboxStore`
  key/value port reused).
- **Reader (slice 8):** Parser at the boundary + an Adapter over `numeric-quantity` + a Specification delegated to
  recipe-core's `classifyUnit`.
- **Cook marks:** reducer + Port with two adapters, session-scoped.

**Preserved:**

- `useRecipeEditor` as a headless statechart: seed-once, 409 → conflict, the terminal latch, the rebind Command
  queue.
- SpeedDial's Menu Button Adapter, as the interim until slice 8.
- `withLineBinding` as a Value Object.
- `OutboxStore` as a Port with build-time adapters.
- `SHELL_SURFACE_IDS` and `HOME_NAV_ITEMS` as Registries.
- `useFocusOnSignal`/`useScreenReaderFocusOnSignal`, reused rather than adding refs.

**Intent already satisfied (add nothing):**

- TanStack mutations are Command for Save a copy and the picker toggles. No outer mutation wrapper (§11.0).
- React Navigation's tab and stack routers already implement pop-to-top and back behaviour. Do not reimplement
  them in `AppTabBar`.
- Radix AlertDialog already focuses Cancel. Do not add a focus effect.
- `Animated.spring` already provides the spring.
- `history.replaceState` plus the hash already provides the deep link.

**Contract breaches found:**

- `homeNavigation.ts`'s "never drops" was correct for its ruling and is now overturned; that is a decision, not a
  breach.
- The spec's `--container-wide` would have **broken the Registry contract** of the Tailwind namespace: one name,
  two meanings. Fixed in A8.
- Spec §3.3's `headingRef` prop would have exported a ref across a package boundary with no register entry.
  Replaced.

---

## Dimensions examined

- **Structure:** package edges (features → query), the `./layout` boundary, the barrel rule, dependency direction.
  Examined.
- **Data:** memento shape, keys, quarantine; title and collection limits; no client ids. Examined.
- **Contracts:** `sourceLine` create-only, `sortBy`, collection bounds, schema-package bounds. Examined.
- **Failure:** parked creates, the web volatile store, the 409 path, delayed-commit undo, rebind ordering.
  Examined.
- **Concurrency:** the outbox clobber (owed), per-pair mutation scopes, one ScrollHost. Examined.
- **Operability:** limited. No new telemetry is prescribed. Draft-abandonment analytics is the owner's success
  measure, through the existing `useAnalyticsEmitter`; checkpoint failures should emit through it in slice 7.
  Flagged.
- **Cost of change:** ADR-0056/0057 are the costly doors.
- **Evolution:** interim entries via SpeedDial; expand–contract for colour roles.
- **People:** the owner works on WSL Linux, so the iOS tier is unrunnable there (Q4).
- **Security:** no new trust boundary. `sessionStorage` holds ids only. The pseudo-locale is build-gated and
  guarded.
- **Not applicable:** server scaling and infrastructure (no backend change in slices 1–3).

## Verified vs assumed

**Verified (read or run):**

- Every file and line cited above.
- Dependency versions from the npm registry and Expo's `bundledNativeModules.json`.
- All 30 Lucide glyph names exist in 1.53.0.
- `lucide-react-native` exports `./icons/*`.
- `numeric-quantity` has no dependencies and uses `\p{Nd}`.
- React Navigation 8 is still alpha; 7.5.0 is `latest`.
- Reanimated, gesture-handler and screens are absent from mobile.
- `sortBy` exists; collection bounds are 120/1000.
- `DurationField` and `formatDuration` already exist.
- The web Dockerfile exists.
- Member provenance keys exist.

**Assumed, to be verified by the slice that relies on it:**

1. Hermes on RN 0.86 accepts `\p{Nd}` (slice 8 precondition). Sources disagree.
2. Tailwind v4's `--container-*` drives both `max-w-*` and `@` variants, and `--text-*--line-height`
   sub-properties work (slice 1's integration test proves or disproves this first).
3. `@react-navigation/native-stack` renders under the jsdom/react-native-web alias, or with a
   `react-native-screens` stub (slice 3).
4. CSS `field-sizing: content` support in Safari; the fallback is acceptable either way.
5. Clerk exposes the Google given name with the name fields turned off (slice 9).
6. A collection member re-add would lose "From source collection" (not read server-side).
7. Checkpoint cadence values (10 s) are judgement, not measurement.

## Questions blocking this

1. **Q1 (owner; blocks slice 7 copy, not code).** On web, the device store is in memory, by your 2026-09-17
   ruling. A **published** recipe's device-only changes are lost on reload or tab close, and D1 says they "save
   to the device". Choose one:
    - (a) accept the loss, and add the browser's own leave-page warning only while such changes exist;
    - (b) allow `sessionStorage` for the editor draft only (it survives reload, and it is at rest in the browser
      profile);
    - (c) on web only, published edits save to the server as a draft copy.

    I recommend (a).

2. **Q2 (owner).** Draft checkpoints still create versions: a few per editing session, and the database keeps 10.
   Is that acceptable, or do you want a new ADR that lets draft-to-draft saves skip the version? That reverses
   ADR-0034's "no opt-out" rule.
3. **Q3 (owner).** Lines pasted into a recipe that is already saved cannot carry their source line, so the
   AI check never reviews them. Lines pasted before the first save can. Accept that, or schedule a wire change
   with its own ADR?
4. **Q4 (owner).** iOS Simulator Maestro flows (`iosSwipeBack.yaml`, the iOS status-bar tap) need macOS. Where
   do they run: EAS, a Mac, or deferred and recorded as a gap?
5. **Q5 (owner).** On a published recipe, each food re-pick makes its own version when you press Save changes
   (ADR-0045 teaching). Accept "one version plus one per re-pick"?
6. **Q6 (`staff-ux-engineer`).** Lucide has no filled glyph set, and a filled `compass` hides its needle. Show the
   active tab with stroke weight, the bar and the label weight instead of fill?
7. **Q7 (owner; spec §11.19 already asks).** Compact cards on Home at every width?
8. **Q8 (owner).** Must "Saved a copy" survive a reload? That needs a server fact; today it lasts one session.
9. **Q9 (`staff-ux-engineer`).** Ship library Sort now that the API supports it (A11)?

## Hand-off

- **`fe-1`:** slices 1–3 as blueprinted, tests first, in the stated order. A dev-client rebuild after the
  `react-native-svg`/`react-native-screens` installs.
- **`staff-ux-engineer`:** owns the `ui` primitives' visual detail. Answer Q6 and Q9. Write the per-platform
  save-status copy once Q1 is ruled.
- **`staff-engineer`:** write ADR-0056 in slice 3 and ADR-0057 in slice 7, each with its CLAUDE.md pointer and
  guard comments. In slice 7, land the outbox prerequisites (serialized mutator, backoff) before the editor work.
- **`qse`:** review the guard fixture tables (`iconImportBoundary`, `nativeScrollsToTop`) for shapes the tree has
  never held.
- **`staff-code-quality`:** GATE each slice.
- **`staff-architect`:** REVIEW at the end of each slice's plan (owner, 2026-10-02: staff reviews once per plan).

Confidence: **Medium**. The governing decisions and the code are read and anchored. Four load-bearing inputs are
still unverified: Hermes `\p{}`, the Tailwind v4 namespace behaviour (proved by slice 1's first test), React
Navigation under jsdom, and Clerk's given name. Q1/Q2 are owner rulings that change slice 7's copy and cadence.
