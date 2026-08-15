# 03 — Apps & shared UI (`web`, `mobile`, `features`, `ui`)

REVIEW mode. Branch `chore/code-quality-enforcement-phase-1-2`. Read-only audit.

Scope read: `packages/apps/commise/{web,mobile,features,ui}`. Governing docs consulted before forming an
opinion: `CLAUDE.md` (design-pattern-first mandate; pure render components; orchestration/render split;
refs near-forbidden; localization; testing policy), `docs/CODING_STANDARDS.md` §1a/§1b/§7/§7.1,
`docs/engineering/ENGINEERING_EXCELLENCE.md` → _Frontend Engineering Excellence_ (§ read in full for
component architecture, state completeness, responsive/touch rules).

**No ADR governs any finding below.** ADR-0001/0003/0005/0009 were checked; 0009 (Clerk sign-out) touches
`useSignOutAndLeave`, which is untouched here. `CLAUDE.md`'s "no welcome/landing screen" ruling (2026-07-28)
was checked against F-U14 and does not bear on it.

Overall: this tree is well above average — the wizard rail, the native tab bar, `CollectionHeader.native`'s
`flexShrink`, `RecipeList.native`'s skeletons, and the `@commise/ui` `Button` all carry evidence of a prior
remediation pass, with the failure and its measurement recorded in the docstring. The defects below are the
places that pass did **not** reach, and they cluster in three seams: **native leaves that hand-roll a
`Pressable` instead of composing `@commise/ui`'s `Button`**, **native leaves whose web sibling got a
responsive/clamping affordance that was never mirrored**, and **the `rename` half of the collection vertical**.

---

## F-U1

**Severity:** High (correctness — silent wrong write)

**File:** `packages/apps/commise/web/src/components/recipes/CollectionFormContainer.tsx:81-93`
(type at `:23-30`; mirror defect at `packages/apps/commise/mobile/src/screens/CollectionFormScreen.tsx:50-60`)

**What breaks:** The suspected defect is **CONFIRMED**. `handleSubmit` guards the rename path on
`isRename && collectionId !== undefined` and, when that guard fails, **falls through to
`createCollection.mutate(...)`**. A `mode="rename"` render with no `collectionId` therefore CREATES a brand-new
collection named with the user's edit, then navigates to it — the original collection is untouched and the user
believes they renamed it. `handleCancel` (`:96-104`) has the identical fall-through shape (benign there — it
only picks a navigation target).

A second variant is live in the same guard: `collectionId === ''` satisfies `!== undefined`, so an empty id
takes the rename path and issues `PATCH /collections/` — a 404 surfaced as the generic `submitError`.

Not reachable from the shipped route today: `.../collections/[id]/rename/page.tsx:32` always passes the `id`
segment. But the props type makes the illegal state representable, the failure is a silent **write**, and there
is no test pinning it (see Verified).

The mobile sibling has the same illegal state with the opposite failure: `CollectionFormScreen.tsx:57-59`
returns without an `else`, so rename-without-id is a **silent no-op** — the button presses, nothing happens, no
error, no busy state. Two platforms, one representable illegal state, two different wrong behaviours.

**Why it happens:** `mode` and `collectionId` are independent props (`mode: CollectionFormMode` +
`collectionId?: string`) rather than one discriminated union, so the compiler cannot enforce "rename implies an
id" and each call site re-derives the pairing defensively at runtime. This is the connascence-of-value smell
`ENGINEERING_EXCELLENCE.md` names, and it is the "make illegal states unrepresentable" rule in `CLAUDE.md`.

**Smallest fix:** Make the props a discriminated union in both containers, which deletes the runtime guard and
the fall-through together:

```ts
type CollectionFormContainerProps =
    | { readonly mode: 'create'; readonly locale: string }
    | { readonly mode: 'rename'; readonly locale: string; readonly collectionId: string };
```

`isRename` then narrows `collectionId` to `string`, `handleSubmit` becomes an exhaustive two-arm switch on
`mode` with no fall-through, and `CollectionFormScreen`'s no-op arm disappears for the same reason. If a union
is judged too large a change for this PR, the one-line floor is to replace the fall-through with an explicit
`if (isRename) { return; }` before the `createCollection.mutate` call — but that keeps the illegal state and
converts web's wrong write into mobile's silent no-op, so the union is the correct fix.

**Verified:** Read both containers, both route pages (`collections/new/page.tsx`,
`collections/[id]/rename/page.tsx:32`), `RecipesScreen.tsx:251-262` (the mobile navigator, which does pass
`collectionId`), and `collections/model.ts`. Enumerated every test in
`web/tests/components/recipes/CollectionFormContainer.test.tsx` (`rg -n "it\(|describe\("`, 9 cases): there is
**no** case for `mode="rename"` without an id, and **no** case for a rename-mode mutation error — the
`surfaces a mutation error` case sits under `describe('create mode')`.

---

## F-U2

**Severity:** High (mobile layout — the field you are typing into is under the keyboard)

**File:** `packages/apps/commise/mobile/src/screens/RecipeEditor.tsx:167-171` (the authoring `ScrollView`);
affected inputs in `packages/apps/commise/features/recipes/src/form/RecipeFormSections.native.tsx` (10
`TextInput`s), `.../form/ChipInput.native.tsx`, `.../collections/CollectionForm.native.tsx`,
`.../collections/CollectionRecipePicker.native.tsx`, `.../list/RecipeList.native.tsx`,
`.../discovery/RecipeDiscoveryList.native.tsx`, `.../filters/RecipeFilterBar.native.tsx`,
`mobile/src/components/IngredientPicker.tsx`

**What breaks:** On iOS, tapping any field in the lower half of the recipe wizard (title, servings, prep/cook
time, any ingredient quantity/name row, any instruction step, the ingredient typeahead) puts the software
keyboard — roughly 300pt on an 812pt device — directly over the field being edited. The author types blind.
The same applies to the collection-name field, the recipe-list search, the discovery search, and the filter
bar's ingredient typeahead. React Native's `ScrollView` does **not** inset for the keyboard by default.

**Why it happens:** `KeyboardAvoidingView` exists in this repo and is used correctly — but **only on the three
Clerk auth screens**: `mobile/src/screens/login.tsx:150`, `signup.tsx:88`, `profile.tsx:81`. Every other
scrollable surface with a text input was built without it, and without the modern alternative
(`automaticallyAdjustKeyboardInsets`). `RecipeEditor.tsx:170` sets `keyboardShouldPersistTaps="handled"`, which
solves the "first tap dismisses the keyboard" problem and is easy to mistake for keyboard handling — it is not.

**Smallest fix:** Wrap the wizard's `ScrollView` exactly as `login.tsx:150` already does, so the pattern is
copied rather than invented:

```tsx
<KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView … />
</KeyboardAvoidingView>
```

Cheaper single-prop alternative on RN 0.86: add `automaticallyAdjustKeyboardInsets` to the `ScrollView` at
`:167`. Apply the same to `CollectionRecipePickerScreen`, `RecipeListScreen`, `RecipeDiscoveryScreen` and
`CollectionFormScreen`. Because this recurs on six surfaces, the durable shape is a
`<KeyboardSafeScrollView>` primitive in `@commise/ui` composed by all of them — one definition, the
`@commise/ui/button` precedent.

**Verified:** `rg -n "KeyboardAvoidingView|KeyboardAwareScrollView|automaticallyAdjustKeyboardInsets|
keyboardVerticalOffset"` across `packages/apps/commise` returns hits in `login.tsx`, `signup.tsx`,
`profile.tsx` and their three tests, and **nowhere else**. `rg -c "<TextInput"` confirms 19 `TextInput`s across
the feature/mobile native tree outside those three screens.

---

## F-U3

**Severity:** High (mobile layout — the FAB occludes the last recipe)

**File:** `packages/apps/commise/features/recipes/src/list/RecipeList.native.tsx:264-278` (`fab`) vs `:292`
(`cards`)

**What breaks:** Scrolled to the bottom of the recipe list, the floating create button covers the last card.
The FAB is `position: 'absolute'`, `bottom: nativeTokens.spacing[5]` (24pt), `height: 56` — so it occupies the
band from 24pt to 80pt above the container's foot. The FlashList's content inset is
`cards: { paddingBottom: nativeTokens.spacing[5] }` = **24pt**. The last card is therefore overlapped by
80 − 24 = **56pt** on its right-hand side: its title/meta region is hidden and its tap target is partly
unreachable, because the FAB swallows the press.

**Why it happens:** The FAB was added later (`showFab`, `:224-228`) as a sibling of `body` in the same
`container` View, and the list's content inset was never widened to account for a control that now floats over
it. The list and the FAB each read a correct-looking token; nothing states the relationship between them.

**Smallest fix:** Give the list an inset that clears the FAB, derived from the FAB's own geometry rather than a
new magic number:

```ts
/** The FAB's bottom offset + its diameter + one gutter — the band the list must not lay a card under. */
const FAB_CLEARANCE = nativeTokens.spacing[5] + FAB_SIZE + nativeTokens.spacing[4]; // 24 + 56 + 16
…
cards: { paddingBottom: FAB_CLEARANCE },
```

with `FAB_SIZE = 56` hoisted out of the `fab` style so the two cannot drift. Strictly, only the `showFab`
branch needs it, but the extra 72pt of scroll slack in the no-FAB case is invisible and not worth a second
style object.

**Verified:** Read the whole file. `container` (`:224-229`) has `paddingTop` and no `paddingBottom`;
`RecipesScreen.tsx:159` applies `paddingBottom: insets.bottom` at the screen level, so the device inset is
handled and is not the cause. Token values read from `ui/src/tokens/scale.ts:19-30` (`spacing[5] = 24`,
`spacing[4] = 16`). Checked the sibling lists: `CollectionList.native.tsx:173` and
`RecipeDiscoveryList.native.tsx:361` carry the same 24pt inset but have **no** absolute FAB
(`rg -n "position: 'absolute'"` is empty in both), so this finding is scoped to `RecipeList.native.tsx` only.

---

## F-U4

**Severity:** High (state completeness — the error state renders unstyled)

**File:** `packages/apps/commise/web/src/components/recipes/RecipeDetailContainer.tsx:146-155`

**What breaks:** When a recipe fails to load, the surface renders

```tsx
<div role="alert">
    <p>{notFound ? … : …}</p>
    {!notFound && <button type="button" onClick={…}>{recipes.detail.retry}</button>}
</div>
```

with **no `className` on any of the three elements**. Under Tailwind v4 preflight a bare `<button>` has
transparent background, zero border, zero padding and inherited font — so the Retry affordance renders as plain
body text that does not look pressable, at no touch-target height, flush against the `<main>` gutter. The
`<p>` inherits nothing either. The branch immediately above it (`:133-138`, loading) is styled
(`px-4 py-8 text-body-md text-slate`), and every other control in this same file goes through
`buttonSurfaceClass(...)` (`:196`, `:260`, `:266`, `:289`) — so the error path is the one state in the
component that was never given a surface.

**Why it happens:** The B21 comment at `:125-130` shows the error branch was recently rewritten to fix the
settled-but-absent routing. The logic landed; the presentation did not.

**Smallest fix:** Match the loading branch and the file's own button recipe:

```tsx
<div role="alert" className="flex flex-col items-start gap-3 px-4 py-8">
    <p className="text-body-md text-slate">{notFound ? … : …}</p>
    {!notFound && (
        <button type="button" onClick={() => void query.refetch()} className={buttonSurfaceClass('secondary')}>
            {recipes.detail.retry}
        </button>
    )}
</div>
```

`buttonSurfaceClass` is already imported at `:47`, and it carries the `min-h-11` touch floor
(`ui/src/button/surfaceClass.ts:37`), so this closes the touch-target gap in the same edit.

**Verified:** Read the container end to end, `ui/src/button/surfaceClass.ts:33-37`,
`web/src/app/globals.css` (86 lines — no global `button` rule; only the font import, the theme import, two
`@source` directives, a `body` rule and two `@keyframes`), and `HomeChrome.tsx:94` for the `<main>` padding
the branch inherits.

---

## F-U5

**Severity:** Medium-High (state completeness — a missing error state renders a lying form)

**File:** `packages/apps/commise/web/src/components/recipes/CollectionFormContainer.tsx:45`, `:55`, `:62-68`

**What breaks:** In `rename` mode, `useCollection` has a loading branch (`:62`) and a success path, but **no
error branch**. When the seed fetch fails (network, 404 on a deleted collection, 403), `isLoading` goes false,
`data` stays `undefined`, and `seededName` falls back to `''` (`:55`). The user is shown a fully functional
**"Rename collection" form with an empty name field** and no indication that anything failed. Submitting it
either renames the collection to whatever they type (if the collection actually exists and the failure was
transient) or issues a doomed `PATCH` whose 404 surfaces as the generic `collections.form.submitError` — a
message about saving, for a failure that happened on read.

**Why it happens:** The container derives its view from three independent flags rather than one discriminated
query view. `@commise/features-core` already exports `toDetailQueryView` — the "ONE derivation of which
fetch-state affordance to render, applying the settled-but-absent rule" that `RecipeDetailContainer.tsx:125-131`
uses precisely to avoid this class — and this container does not use it.

**Smallest fix:** Route the seed query through the existing shared derivation and give the error case the same
affordance shape the detail container uses:

```ts
const seed = toDetailQueryView(collectionQuery);
if (isRename && seed.status === 'loading') { … }              // existing branch
if (isRename && seed.status === 'error') { return <ErrorNotice … />; }
```

with a `collections.form.loadError` key added beside `loadingLabel` in `web/src/i18n/messages.ts`. This also
removes the settled-but-absent hole (a query that settles with no data and no error currently renders the same
blank form).

**Verified:** `rg -n "isError|isLoading|isPending"` in the container returns exactly three hits (`:59`, `:62`,
`:110`) — `collectionQuery.isError` is referenced nowhere. `toDetailQueryView` confirmed exported from
`features/core/src/queryStatus.ts` and consumed at `RecipeDetailContainer.tsx:131`. Test enumeration (see F-U1
Verified) confirms no rename-error case exists.

---

## F-U6

**Severity:** Medium-High (layout — the recipe title is squeezed to a sliver on both platforms)

**File:** `packages/apps/commise/features/recipes/src/collections/CollectionMemberRow.tsx:54-63` and
`.../CollectionMemberRow.native.tsx:48-55` + `:74`; copy at `.../collections/messages.ts:273`

**What breaks:** The Remove control's **visible** label is the templated `removeRecipe: 'Remove {title}'`, so
the button text grows with the recipe title. Both leaves then explicitly forbid that button from shrinking —
web `className="shrink-0 …"` (`:60`), native `removeButton: { flexShrink: 0, … }` (`:74`) — while the title
next to it is `flex-1` / `flex: 1`. At a 375pt viewport a member row for "Grandma's Slow-Roasted Sunday Pot
Roast with Root Vegetables" renders a Remove button that claims nearly the full row width (or wraps to four
lines on native, where nothing clamps it — see F-U10) and compresses the recipe title, the row's primary
content and its navigation target, to a few characters.

**Why it happens:** The accessible name and the visible label were collapsed into one string. The row already
does this correctly one element earlier: the title button carries `aria-label={member.title}` (`:48`) with
`RecipeCard.Title` as its content. The Remove button never got the same split.

**Smallest fix:** Split them — visible label short, templated name on the accessibility attribute:

```tsx
<button type="button" aria-label={removeLabel} onClick={…} className="shrink-0 …">
    {detail.remove}
</button>
```

and the native mirror with `accessibilityLabel={removeLabel}` (already present at `:50`) plus
`<Text style={styles.removeLabel}>{detail.remove}</Text>`. Requires one new short key `detail.remove` in
`collections/messages.ts`. `removeRecipe` stays as the accessible name, which is what it was written for
("Remove {title}" disambiguates identically-named controls for a screen reader — the `RecipePhotoManager`
convention at `photos/RecipePhotoManager.tsx:104`).

**Verified:** Read both leaves and `collections/messages.ts:273` (`removeRecipe: 'Remove {title}'`).
`rg -n "removeRecipe"` across `packages/apps/commise` returns only the two leaves and the message file — **no
test asserts the long visible string**, so this fix breaks nothing (the three
`CollectionDetailContainer.test.tsx` hits are `removeRecipeFromCollection` client spies, not label queries).

---

## F-U7

**Severity:** Medium-High (mobile layout + contrast — the "why did my upload fail" message is invisible)

**File:** `packages/apps/commise/features/recipes/src/photos/RecipePhotoManager.native.tsx:179-181` rendered
under `:255-263` (`itemError`), inside `:239` (`cell`)

**What breaks:** REQ-014's per-file failure reason is unreadable on mobile in the common case, and clipped in
the rest:

1. **Invisible.** `itemError` is `color: palette.white` (#FFFFFF). It is absolutely positioned over the cell,
   and when the queue item has no `previewUri` the cell renders the `placeholder` at `:241` —
   `backgroundColor: palette.pearl` (#F5F5F5, read from `ui/src/tokens/colors.ts:75`). White on #F5F5F5 is
   ~1.08:1. The message is not merely below AA; it is not visible at all. A queue item with **no** preview is
   exactly the client-rejection case (wrong file type) this message exists to explain.
2. **Clipped.** `cell` is `aspectRatio: 1` with `overflow: 'hidden'` (`:239`). At a 375pt viewport the cell is
   ~106pt square. `itemError` starts at `top: 30` and `queueControls` occupies the band from `bottom: 6`
   upward (~21pt), leaving ~49pt — about four lines at `fontSize: 10` — before the text is clipped by the
   cell's own `overflow: 'hidden'`, with no `numberOfLines` to truncate it gracefully.

The web sibling has neither problem: `RecipePhotoManager.tsx:161` lays the queue cell out in normal flow
(`flex flex-col items-center justify-center`) on a `bg-pearl` surface, and the error at `:182` is
`text-error-dark` on that surface.

**Why it happens:** The native leaf reproduced the web cell's _appearance_ with absolute overlays rather than
its _layout_, and the white text was chosen for legibility over a photo — correct for the badge (`:242-253`,
which carries its own `rgba(45, 52, 54, 0.7)` backing plate) and wrong for a message that also renders over a
pale placeholder with no plate.

**Smallest fix:** Give the error a plate and a bound, matching the badge that already solves the same problem
two styles above it:

```ts
itemError: {
    position: 'absolute', top: 30, left: 6, right: 6,
    backgroundColor: 'rgba(45, 52, 54, 0.7)',   // same plate as `statusBadge`
    borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6,
    color: palette.white, fontSize: 10, textAlign: 'center',
},
```

plus `numberOfLines={2}` on the `<Text>` at `:180`. The durable fix is to adopt the web leaf's flow layout for
the queue cell so the cell grows with its content, but the plate + clamp is the minimum that makes the message
readable and stops it colliding with Retry/Remove.

**Verified:** Read both leaves in full. Palette values from `ui/src/tokens/colors.ts:72-76`
(`pearl: '#F5F5F5'`, `white: '#FFFFFF'`). `rg -n "numberOfLines"` across all of `packages/apps/commise`
returns **0** results.

---

## F-U8

**Severity:** Medium (mobile layout — three columns at every width; 21pt controls inside a 106pt cell)

**File:** `packages/apps/commise/features/recipes/src/photos/RecipePhotoManager.native.tsx:239` (`cell`),
`:264-272` (`queueControls`/`queueControlButton`), `:299-322` (`photoControls`/`coverControl`/`replaceButton`),
`:273-281` (`removeButton`)

**What breaks:** The native photo grid is `width: '31%'` — a fixed **3 columns at every viewport** — while the
web sibling is `grid-cols-2 sm:grid-cols-3` (`RecipePhotoManager.tsx:80`), i.e. two columns below 640px. At a
375pt phone that yields ~106pt cells, and every control inside one is far under the 44pt floor the rest of the
design system enforces:

| Control                       | Style                                | Height |
| ----------------------------- | ------------------------------------ | ------ |
| Remove (`:273`)               | `paddingVertical: 4`, `fontSize: 11` | ~21pt  |
| Retry / Remove queue (`:265`) | `paddingVertical: 4`, `fontSize: 11` | ~21pt  |
| Replace (`:315`)              | `paddingVertical: 4`, `fontSize: 11` | ~21pt  |
| Cover radio (`:300`)          | `padding: 6` around a 12pt dot       | ~24pt  |

Four ~21pt targets crowded into the corners of a 106pt tile is a thumb-accuracy problem, not a taste problem —
and the cover radio and Replace share a 94pt-wide bottom bar with a 6pt gap.

**Why it happens:** The 3-column grid is described in the style comment as "the wireframe" — a desktop
wireframe transcribed to native without the responsive step the web leaf took. The touch floor was never
applied because these are hand-rolled `Pressable`s, not `@commise/ui` `Button`s (see F-U11).

**Smallest fix:** Two columns below a phone-width threshold, and a touch floor on each control:

```ts
const { width } = useWindowDimensions();
const columns = width < 400 ? 2 : 3;                 // mirrors the web leaf's `sm:` cutover
cell: { …, width: columns === 2 ? '48%' : '31%' }
```

and `minHeight: 44, justifyContent: 'center'` on `removeButton`, `queueControlButton`, `replaceButton` and
`coverControl`. At two columns the cell is ~165pt, which accommodates the 44pt floor without the controls
overlapping.

**Verified:** Read both leaves. `useWindowDimensions` is not currently used anywhere in
`packages/apps/commise` — this would be its first use, which is the RN-idiomatic equivalent of the web `sm:`
breakpoint and is preferable to a second hard-coded percentage.

---

## F-U9

**Severity:** Medium (web layout — the bottom tab bar cannot contain its own labels at ≤360px)

**File:** `packages/apps/commise/web/src/components/home/chrome/HomeTabBar.tsx:53` (and `:71`, `:86`)

**What breaks:** The bar is a **fixed** `h-[calc(4rem+env(safe-area-inset-bottom))]` (64px) with
`items-center`, holding six `flex-1` destinations (`features/core/src/homeNavigation.ts:37-44`: home, recipes,
meal-plan, grocery, nutrition, profile). Each tab is a column of `py-2` + a `size-6` glyph + `gap-1` + a
`text-xs` label, with no `whitespace-nowrap`, no `truncate`, and no `overflow` clip on the bar. At 360px — the
single most common Android viewport — each tab gets (360 − 16 for `px-2`) / 6 ≈ **57px**, which is narrower
than the intrinsic width of the two-word label `"Meal Plan"`. That label wraps to two lines, making the column
16 + 24 + 4 + 32 = **76px** inside a 64px bar; with `items-center` and no clip, the tab overflows the bar
symmetrically, so the glyph rides up over the page content above the bar and the label runs down into the home
indicator.

**Why it happens:** The native sibling gets this right by construction and the web one does not:
`mobile/src/components/home/chrome/HomeTabBar.tsx:111-130` gives the **bar** no fixed height at all and the
**tab** a `minHeight: 44`, so the bar grows when a label wraps. The web leaf pinned the height instead.

**Smallest fix:** One character — `h-` → `min-h-`:

```
min-h-[calc(4rem+env(safe-area-inset-bottom))]
```

This adopts the native leaf's growth model, leaves the 375px/390px rendering byte-identical (the content is
under 64px there), and makes the overflow class unrepresentable rather than merely untested.

**Verified:** Read both leaves and `features/core/src/homeNavigation.ts:29-44` (six destinations, confirmed) and
`web/src/i18n/messages.ts:359-366` (`'meal-plan': 'Meal Plan'`, `nutrition: 'Nutrition'`). The existing
regression at `web/tests/e2e/recipeHomeResponsive.spec.ts:203-217` does assert every tab stays inside the bar's
box — but only at `viewport: { width: 375 }` (`:177`); the other touch test is at 390 (`:329`). **No test runs
below 375px**, which is why this survived. Widths quoted are geometric, computed from the classes; I did not
run a browser at 360px, so the exact wrap point is inferred from the label's word count rather than measured
— but the fix is correct at every width regardless.

---

## F-U10

**Severity:** Medium (mobile layout — unbounded titles make card heights ragged)

**File:** `packages/apps/commise/features/recipes/src/card/RecipeCard.native.tsx:118-122` (`CardTitle`),
style at `:375`

**What breaks:** The native card title is a bare `<Text style={styles.title}>{recipe.title}</Text>` with no
`numberOfLines`. The web sibling clamps it: `RecipeCard.tsx:174` is
`<h3 className="line-clamp-2 …">`. Titles run to `TITLE_MAX_LENGTH = 64` characters
(`features/recipes/src/form/model.ts:113`), so at `fontSize: nativeTokens.fontSize.bodyLg` in a ~311pt card a
long title takes three or four lines against the web's two. Consequences, in order of visibility:

- In `RecipeDiscoveryList.native`'s two-column grid (`flashCell: { flex: 1, … }`, `:366`), two neighbouring
  cards with different title lengths get different heights, so every grid row goes ragged.
- In `RecipeList.native`'s FlashList v2 recycler (auto-measuring, no `estimatedItemSize`), row heights vary
  by up to two extra text lines, which is what makes scroll-position restoration and the pull-to-refresh
  spring feel loose.
- Everything below the title in the card — meta, badges, rating, tags — shifts down by a variable amount.

**Why it happens:** `line-clamp-2` was applied on the web leaf and its RN equivalent (`numberOfLines`) was
never mirrored. This is the only clamped element in the whole app, so there was no convention to copy.

**Smallest fix:** One prop:

```tsx
return (
    <Text numberOfLines={2} style={styles.title}>
        {recipe.title}
    </Text>
);
```

**Verified:** `rg -n "line-clamp|truncate"` across all non-native `.tsx` in `packages/apps/commise` returns
exactly one product hit — `RecipeCard.tsx:174`. `rg -n "numberOfLines"` and `rg -n "ellipsizeMode"` across the
whole of `packages/apps/commise` each return **0**. Read both `CardTitle` implementations side by side.

---

## F-U11

**Severity:** Medium (touch targets — the design system's 44pt floor is bypassed by hand-rolled `Pressable`s)

**Files (worst first):**

- `features/recipes/src/versions/VersionCompareView.native.tsx:157` `closeButton` — `paddingVertical: 4`
- `features/recipes/src/versions/RecipeVersionList.native.tsx:208` `compareButton` — `paddingVertical: 4`;
  `:203`/`:205` Preview/Restore — `paddingVertical: 6`
- `features/recipes/src/collections/CollectionHeader.native.tsx:102` `textButton` — `paddingVertical: 6`
  (this is Back, **Rename** and **Delete**)
- `features/recipes/src/collections/CollectionMemberRow.native.tsx:74` `removeButton` — `paddingVertical: 6`
- `features/recipes/src/collections/CloneInfoPanel.native.tsx:60`,
  `.../CollectionRecipePicker.native.tsx:191` — `paddingVertical: 6`
- `features/recipes/src/filters/RecipeFilterBar.native.tsx:405`/`:410` chips — `paddingVertical: 6`
- `features/recipes/src/wizard/Wizard.native.tsx:490` `railPill` — no height floor; the rail marker is 24pt
- Web: `features/recipes/src/versions/RecipeVersionList.tsx:47`, `:164`, `:176` — `py-1.5` (~32px)

**What breaks:** With a 13–14pt label these resolve to **26–32pt** tall controls against the repo's own
documented 44pt floor. The delete affordance for a collection (`CollectionHeader.native.tsx:102`) and the
compare/restore controls in version history are the highest-consequence of them: a 26pt destructive target
sitting 8pt from its neighbour is a mis-tap waiting to happen.

**Why it happens:** This is the pattern finding behind the layout symptom. `@commise/ui` ships a `Button` that
solves this once — `ui/src/button/Button.native.tsx:100` (`minHeight: 44`) and
`ui/src/button/surfaceClass.ts:37` (`min-h-11`, reset at `md:`) — and its docstring says so. But
`rg -c "<Pressable"` across the native leaves finds **~90 hand-rolled `Pressable`s in 32 files**, and a
follow-up search finds **zero** feature leaves importing `Button` from `@commise/ui` other than
`Wizard.native.tsx`. The shared primitive exists and is bypassed almost everywhere, so every leaf re-decides
padding, radius, colour and touch floor — the "seam nothing crosses" smell from the design-pattern
composition catalogue, inverted: the seam is real and the callers route around it.

**Smallest fix:** Per-site, the one-line floor is `minHeight: 44, justifyContent: 'center'` on each style
above (web: swap the bespoke `rounded-full px-4 py-1.5 …` strings for `buttonSurfaceClass('secondary')`,
which already carries `min-h-11`). The correct fix, and the one this repo's own mandate points at, is to
compose `@commise/ui`'s `Button` in these leaves as `Wizard.native.tsx` already does — that deletes the
per-leaf `StyleSheet` entries entirely and makes the floor unrepresentable rather than repeatedly re-typed. I
would not attempt the full migration in this PR; I would fix the destructive and navigational controls
(`CollectionHeader.native`, `CollectionMemberRow.native`, `RecipeVersionList.native`) now and file the rest.

**Verified:** Enumerated every `paddingVertical: <12` in the native tree by search and read each style block in
context to confirm it belongs to an interactive `Pressable` (rather than a badge or a text run).
`ui/src/button/Button.native.tsx:94-105` and `ui/src/button/surfaceClass.ts:33-37` read directly. Confirmed
correct counter-examples so the finding is not over-broad: `Wizard.native.tsx:523/552` (`menuTrigger`,
`menuItem`), `mobile/src/components/home/chrome/HomeTopBar.tsx:111`, `HomeTabBar.tsx:127`,
`rating/RecipeRatingControl.native.tsx:188`, `collections/CollectionList.native.tsx:168/182` and
`ui/src/input/Input.native.tsx:87` all carry the 44pt floor already.

---

## F-U12

**Severity:** Medium (state completeness — the submit-failure message renders unstyled and unpadded)

**File:** `packages/apps/commise/mobile/src/screens/RecipeEditor.tsx:147-149`

**What breaks:**

```tsx
{
    submitError !== undefined && submitError.length > 0 && <Text accessibilityRole="alert">{submitError}</Text>;
}
```

No style. React Native's default `Text` is ~14pt system black with no colour, no size and no margin — and this
node sits **outside** the `ScrollView` whose `scrollContent` supplies `paddingHorizontal: 16` (`:204`), so it
renders flush against x = 0. When a recipe fails to save, the explanation appears as unpadded black body copy
jammed against the screen edge, visually indistinguishable from the form's own text and carrying none of the
error register (`palette['error-dark']`) every other error in the tree uses.

**Why it happens:** The error slot was wired for correctness (the `accessibilityRole="alert"` is right) and
never given a surface, in a file whose `StyleSheet` (`:201-216`) has no `error` entry at all.

**Smallest fix:** Add the house error style and the container's gutter:

```ts
error: { fontSize: 13, color: palette['error-dark'], paddingHorizontal: nativeTokens.spacing[4] },
```

and apply it at `:148`. `palette` is already imported at `:32`. The values match
`collections/CollectionForm.native.tsx:99` and `IngredientPicker.tsx:461`, so this converges on the existing
convention rather than inventing a third.

**Verified:** Read the file end to end including its full `StyleSheet`. Compared against the eleven other
`error:` style definitions in the native tree, which are uniformly
`{ fontSize: 13, color: palette['error-dark'] }`.

---

## F-U13

**Severity:** Medium (cross-platform state gap — mobile submits an empty collection name)

**File:** `packages/apps/commise/mobile/src/screens/CollectionFormScreen.tsx:50-60`

**What breaks:** Mobile's collection form has **no empty-name guard and no trim**, where web has both
(`CollectionFormContainer.tsx:71-77` rejects `trimmed.length === 0` with `collections.form.nameRequired`, and
`:82`/`:91` submit `trimmed`). On mobile, pressing Create with a blank field fires the mutation with
`{ name: '' }`; the user's only feedback is the server's 400 rendered as the generic `t.saveError` ("could not
save") — a message that describes a transport failure for what is a local validation failure. Whitespace-only
names (" ") are submitted verbatim rather than trimmed, so mobile can create a collection whose name web
would have refused.

This is `CLAUDE.md`'s cross-platform rule (`docs/CODING_STANDARDS.md` §14) failing at the state level rather
than the component level: both platforms ship the feature, but only one ships all of its states.

**Why it happens:** The empty-name rule lives inline in the web container rather than in the shared
`collections/model.ts` that both platforms already import, so mobile had nothing to reuse and did not
re-derive it.

**Smallest fix:** Move the rule into the shared model, where the other collection predicates already live, and
have both containers call it:

```ts
// collections/model.ts
export const normalizeCollectionName = (raw: string): string => raw.trim();
export const isCollectionNameValid = (raw: string): boolean => normalizeCollectionName(raw).length > 0;
```

Then mobile's `handleSubmit` gains the same three-line guard web has, surfacing `t.nameRequired` (a new key
mirroring web's `collections.form.nameRequired`), and both submit the normalized value. One rule, one
representation — the DRY test in `CLAUDE.md` (same knowledge, same reason to change).

**Verified:** Read both containers side by side and `collections/model.ts` (no name-validation export today).
`mobile/tests/screens/CollectionFormScreen.native.test.tsx` exists but is not asserted against here beyond
noting it does not cover the empty-name path — see "Not examined".

---

## F-U14

**Severity:** Low-Medium (localization — hard-coded English metadata under a `[locale]` segment)

**File:** `packages/apps/commise/web/src/app/[locale]/account/page.tsx:8-11`,
`.../[locale]/profile/page.tsx:8-11`, `.../[locale]/settings/page.tsx:8-11`

**What breaks:** Three locale-scoped routes export a static, English `Metadata`:

```ts
export const metadata: Metadata = { title: 'Account Settings | Commise', description: 'Manage your account settings' };
```

`metadata.title` is the browser tab title and the link-preview/share title; `description` is the search and
social snippet. Both are user-facing copy, and both stay English at `/fr/account`, `/es/settings`, and every
other locale the app serves — while the route's own body is fully localized. `[locale]/layout.tsx:23` already
does this correctly (`return { title: home.title, description: home.tagline };`), so these three are the
outliers rather than the convention.

**Why it happens:** These three pages predate the localized-metadata pattern the layout established, and a
static `export const metadata` reads as idiomatic Next.js, so nothing flagged it.

**Smallest fix:** Convert each to the `generateMetadata` form the layout already uses, reading the same
dictionary:

```ts
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { account } = getMessages(webMessages, locale);
    return { title: account.pageTitle, description: account.pageDescription };
}
```

with the two keys added to `web/src/i18n/messages.ts` beside the existing `home.chrome.pageTitles` record.

**Verified:** This is the **entire** localization result. Two exhaustive scans across
`features/**`, `web/src/**`, `mobile/src/**` and `ui/src/**` `.tsx` (excluding tests) — one for English-looking
JSX text nodes, one for `aria-label`/`accessibilityLabel`/`placeholder`/`title`/`alt` string literals — both
returned **zero** hits. A third scan for English-looking single-quoted literals returned only these three
`metadata` blocks plus `RecipeProviders.tsx:64`, which is an `Error` message (developer-facing, correctly not
localized). Every user-facing string in the component tree goes through `useMessages`. `SUPPORTED_LOCALES`
currently ships `en` only (`i18n/src/locales.ts:2`), so this is latent rather than presently visible — which is
why it is Low-Medium and not Medium.

---

## F-U15

**Severity:** Low (mobile layout — the wizard footer's two buttons cannot wrap)

**File:** `packages/apps/commise/features/recipes/src/wizard/Wizard.native.tsx:515-521` (`controlsRow`) vs
`:501-514` (`topBar`)

**What breaks:** `controlsRow` is `flexDirection: 'row'` + `justifyContent: 'space-between'` with **no
`flexWrap`**, holding two `@commise/ui` `Button`s whose labels are templated with the adjacent step name —
`fillTemplate(m.prevLabel, { name })` and `fillTemplate(m.nextLabel, { name })`, e.g. "Prev: Ingredients" and
"Next: Instructions". Each `Button` carries `paddingHorizontal: nativeTokens.spacing[5]` (24pt each side), a
16pt icon and `gap: spacing[2]`, so the pair needs roughly 340–360pt against 343pt of usable width at 375pt —
and less on a 360pt device, where the two buttons collide. `topBar`, eleven lines above, **does** carry
`flexWrap: 'wrap'`; `railRow` at `:489` carries it with a load-bearing comment explaining the exact same
failure ("a pill that does not fit moves to the NEXT LINE instead of past the screen edge"). The footer is the
one row in this file that did not get the treatment.

**Why it happens:** The U6 remediation reduced the footer from four buttons to two and concluded the overflow
was solved by count. It is solved for short step names; the labels are templated and localized, so the widest
case is not the one that was measured.

**Smallest fix:** `flexWrap: 'wrap'` on `controlsRow`, plus `rowGap: nativeTokens.spacing[2]` so a wrapped
secondary does not sit flush against the primary. The rail's own comment at `:485-489` is the precedent and
the justification.

Related and smaller: `railPill` (`:490`) has no height floor and its marker is 24pt, so each step-rail jump
target is ~24pt — see F-U11.

**Verified:** Read the file's full `StyleSheet` (`:483-540`) and `ui/src/button/Button.native.tsx:94-105` for
the button's own geometry. Width figures are computed from the token scale
(`ui/src/tokens/scale.ts:19-30`), not measured on a device.

---

## F-U16

**Severity:** Low (mobile layout — the ingredient search field is squeezed by an inline badge)

**File:** `packages/apps/commise/mobile/src/components/IngredientPicker.tsx:425-436`, badge at `:437-445`,
rendered at `:276-300`

**What breaks:** `searchField` is a single no-wrap row holding: a 18pt search glyph, `gap: 8`, the
`TextInput` (`flex: 1`), the clear `×` (18pt), and the `USDA database` badge (`:298`,
`mobile/src/i18n/messages.ts:465`) at `fontSize: 11` with 8pt horizontal padding each side. The badge has no
`flexShrink`, and RN defaults `flexShrink` to 0, so it never yields. At a 375pt viewport inside this card
(16pt card padding, 12pt field padding) the fixed furniture consumes roughly 175pt, leaving about **130pt** —
around 13 characters at `fontSize: 16` — for the field the user is typing an ingredient name into.

The web sibling avoids this by putting the badge **outside** the input row
(`web/src/components/recipes/IngredientPicker.tsx:232-244`: the `<input>` is `w-full flex-1` and the badge is a
sibling in the same flex row but on a surface with far more width to give).

**Why it happens:** The badge is a C5 wireframe element ("names the ingredient database the typeahead
searches") placed inside the field chrome, which reads well at desktop width and does not survive a phone.

**Smallest fix:** Move the badge to its own line below the field (a `<View style={styles.searchMeta}>` between
`:300` and `:302`), which restores the full row to the input and keeps the badge's meaning intact. If it must
stay inline, `flexShrink: 1` on `badge` plus `numberOfLines={1}` on `badgeLabel` bounds the damage without
recovering the width.

**Verified:** Read both leaves and `mobile/src/i18n/messages.ts:465` (`usdaBadge: 'USDA database'`). Widths are
computed from the declared styles and the token scale, not measured on a device — this is why the severity is
Low; the mechanism (a no-shrink element in a no-wrap row on a phone) is certain, the exact residual width is
an estimate.

---

## Shapes that are fine (checked, no finding)

Recorded so the absence of a finding is evidence rather than an omission.

- **`CollectionForm.tsx` / `.native.tsx` `mode` prop.** Not a behaviour-switching boolean under `CLAUDE.md`'s
  rule. `mode` selects only `title` and `submitLabel` (`:25-26` on both leaves) — pure display derivation. The
  _behaviour_ fork (which mutation runs) correctly lives in the orchestration layer. Both leaves are pure
  `props → JSX` with no fetch, no mutation, no effect. Correct as written.
- **Route boundaries.** `web/src/app/**` has `global-error.tsx`, `[locale]/{error,loading,not-found}.tsx`, and
  `{recipes,collections,discover}/{error,loading}.tsx` plus `recipes/[id]/{error,loading,not-found}.tsx`. Next's
  nesting means `recipes/new`, `recipes/[id]/edit`, `recipes/[id]/versions`, `collections/new` and
  `collections/[id]/rename` are covered by their parent segment's boundary. `routeBoundaries.test.tsx` exists.
  No gap.
- **`RecipeHomeWidget.tsx`.** Suspense-for-data with a skeleton fallback, and the empty-vs-populated choice
  made by the orchestration layer selecting the render component (`:60-81`) rather than a mode prop — exactly
  what `CLAUDE.md` §3 prescribes. Per-widget error boundaries are supplied by the hosts
  (`web/src/components/home/RecipeWidgetSlot.tsx`, `mobile/.../HomeWidgetSurface.tsx`), so a widget failure does
  not take the surface down.
- **`mobile/.../HomeTabBar.tsx`**, **`HomeTopBar.tsx:111`**, **`RecipeRatingControl.native.tsx:188`**,
  **`CollectionList.native.tsx:168/182`**, **`ui/Input.native.tsx:87`**, **`ui/Button.native.tsx:100`** — all
  carry the 44pt floor correctly.
- **`CollectionHeader.native.tsx:107-113`.** The `flexShrink: 1` / `flexShrink: 0` pair, with the on-device
  Maestro measurement recorded in the comment. This is the correct fix for exactly the class F-U6 describes,
  already applied here. Do not "simplify" it.
- **`Wizard.native.tsx` rail + actions menu.** Wrapping rail, `minHeight: 44` menu items and trigger,
  `Modal` mounted only while open, both `accessibilityState` and `aria-*` channels with the reason recorded.
  High quality.
- **Purity.** `rg` across the tree found no `useRef` in a render leaf beyond the two Radix focus-return
  captures (`VersionCompareView.tsx:55-62`, `VersionPreviewModal.tsx`), which are the sanctioned
  "genuinely external, non-declarative system" case and are documented as such at `VersionCompareView.tsx:11-15`.
  No render component fetches data.

---

## Structural readiness for the recipe-import UI (assessment only — no defect)

Asked: are `wizard/`, `form/` and `photos/` a sound base for an import method-chooser plus per-format surfaces?

**`wizard/` — no. It is a fixed four-step recipe-authoring statechart, not a general wizard shell.** The step
identity is a literal type: `RecipeWizardStep = 1 | 2 | 3 | 4` (`form/model.ts:532`). `WIZARD_STEPS` is the
literal array `[1, 2, 3, 4]` (`wizard/model.ts:9`) and `WIZARD_TOTAL_STEPS` is its length. Step→field mapping
is a `Readonly<Record<RecipeWizardStep, …>>` (`form/model.ts:540-545`) consumed by `stepErrorsFor` (`:557`) and
`canAdvanceFromStep` (`:580`). Step names are a fixed-length array indexed positionally
(`Wizard.native.tsx` `m.stepNames[index]`). The model's `values` are `RecipeFormValues` — the fully-authored
shape. Widening any of that to carry an import flow (chooser → format surface → parse/confirm → save, over a
_candidate_ value with per-field provenance and confidence, not a `RecipeFormValues`) means turning the literal
union into an open one, which ripples through all four functions, both leaves, and the message arrays. That is
a rewrite of a currently-correct statechart to serve a second, different one — the "one pattern wearing three
names" smell.

**`form/` and `photos/` — yes, and they are the reusable half.** `RecipeBasicsFields` /
`RecipeIngredientsFields` / `RecipeInstructionsFields` / `RecipeVisibilityField` are already extracted leaves
that both the web edit container and the mobile `RecipeEditor` compose independently of the wizard shell.
`validateRecipeForm`, `toRecipeFormValues`, `toCreateRecipeInput` and `defaultRecipeFormValues`
(`form/model.ts:216-325`) are pure and reusable as-is. `RecipePhotoManager` + `useRecipePhotoUploadQueue` are
independent of the wizard entirely.

**Recommended shape, so this does not become a reshaping task later.** A **separate `import/` vertical** beside
`wizard/`, not inside it:

- an **import statechart** (`import/model.ts`) over its own step union, mirroring `wizard/model.ts`'s structure
  without sharing its type;
- a **format registry** — a module-scope `const` map keyed by a discriminated `ImportFormat` union
  (`'url' | 'photo' | 'paste' | 'file'`), each entry naming its parser adapter and its per-format surface. That
  is Registry + discriminated-union render map, and `features/recipes/src/descriptor.ts` and
  `features/core/src/roadmapWidgets.ts` are the two in-repo precedents to copy;
- a **parser adapter per format**, translating an external shape into a `RecipeFormValues` _candidate_; the
  adapter contract is translation only — anything that changes behaviour belongs in the statechart, not the
  adapter;
- a **hand-off** at the end: once the candidate is confirmed, it becomes `RecipeFormValues` and the **existing**
  `RecipeBasicsFields`/`IngredientsFields`/`InstructionsFields` leaves render the review-and-edit step. No new
  form leaves, no wizard change.

Net: `form/` and `photos/` need **no** reshaping and should be composed directly. `wizard/` should be **left
alone** rather than generalized. The one thing to avoid is widening `RecipeWizardStep`.

---

## Test debt this review implies

Per `docs/CODING_STANDARDS.md` §7.1 and `CLAUDE.md`'s testing policy — every UI path, not just the happy one.
Written before the fix in each case (TDD red → green).

| Finding    | Tier                       | Owed                                                                                                                                                                                                    |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-U1       | vitest component           | `CollectionFormContainer` with `mode="rename"` and no id must not call `createCollection`; `CollectionFormScreen` likewise. Better: the union makes both unwriteable, and the test becomes a type test. |
| F-U1, F-U5 | vitest component           | rename-mode mutation error; rename seed-fetch error. Neither exists today.                                                                                                                              |
| F-U2       | Maestro                    | a flow that focuses the last field of wizard step 2 and asserts it is still on screen.                                                                                                                  |
| F-U3       | Maestro / native component | the last card's title is visible and tappable with the FAB rendered.                                                                                                                                    |
| F-U4       | vitest component           | assert the retry control carries `buttonSurfaceClass`'s `min-h-11` (the file's neighbours at `RecipeDetailContainer.test.tsx:522/543` already assert exactly this for other controls — copy the shape). |
| F-U9       | Playwright                 | extend `recipeHomeResponsive.spec.ts`'s existing bar-containment assertion (`:203-217`) to a 360×740 viewport.                                                                                          |
| F-U10      | native component           | assert `numberOfLines` on the card title.                                                                                                                                                               |
| F-U13      | native component           | blank and whitespace-only name must not call `createCollection`.                                                                                                                                        |
| F-U14      | vitest                     | assert the three routes' metadata comes from the dictionary, mirroring `layout.test.tsx`.                                                                                                               |

---

## Not examined

Stated so the gaps are visible rather than guessed at.

- **Nothing was executed.** No `npm test`, no `next build`, no Playwright, no Maestro, no emulator, no browser.
  Every geometric claim (F-U3, F-U8, F-U9, F-U15, F-U16) is computed from the declared styles and the token
  scale in `ui/src/tokens/scale.ts`, not measured on a device. F-U3's numbers are exact (56pt FAB, 24pt inset —
  both literal). F-U9's and F-U16's wrap points depend on font metrics I did not measure; the mechanism is
  certain, the exact breaking width is inferred.
- **`packages/apps/commise/i18n/**`beyond`locales.ts` and the dictionary's exports\*\* — the matcher and the
  dictionary merge logic were not reviewed.
- **`packages/apps/commise/ui/src/tokens/**`** beyond `colors.ts`, `scale.ts`and`native.ts`. `themeCss.ts`,
`emit.ts`, `gradients.ts`, `shadows.ts`, `typography.ts`, `radius.ts` were not read. Colour-contrast claims
  in this document are limited to the two I computed from raw hex (F-U7); every other contrast decision in the
  tree carries its own recorded ratio in a comment and I took those on trust.
- **`ui/src/{motion,surface,pressScale,confirmDialog}/**`** — read only where a finding passed through them
(`Button`, `Input`, `ConfirmDialog.native`'s padding). `EnterTransition`, `GlassCard`, `GradientSurface`,
`blurSupport` and the reduce-motion hooks were **not** reviewed.
- **`features/account/**`** — only `danger/AccountEraseDialog.native.tsx`'s styles were inspected (for the
touch-target sweep). `authState.ts`, `erasure.ts`, `queries.ts`, `session/signOutAndVerify.ts` and the
  account surfaces were **not** reviewed; ADR-0009 governs the sign-out path and nothing here touches it.
- **Web surfaces not read in full:** `RecipeListContainer`, `RecipeDiscoveryContainer`,
  `CollectionDetailContainer`, `RecipeCreateContainer`, `RecipeEditContainer` (read only for their `Wizard.*`
  composition order), `AccountContent`, `ProfileContent`, `SettingsContent`, `HomeSidebar`, `HomeMobileNav`,
  `HomeTopBar`, `HomeGreeting`, `SubscriptionNudge`, the three `home/skeletons/*`.
- **Mobile screens not read in full:** `AppRoot`, `AuthGate`, `AccountSettings`, `CollectionsScreen`,
  `CollectionDetailScreen`, `CollectionRecipePickerScreen`, `RecipeCreateScreen`, `RecipeDetailScreen`,
  `RecipeEditScreen`, `RecipeListScreen`, `RecipeVersionsScreen`, `RecipeDiscoveryScreen`, `login`, `signup`,
  `profile` (read only for their `KeyboardAvoidingView` usage), `AppCanvas`, `LoadingState`,
  `RecipePhotoUploader`, `SuspensionBanner`, `IngredientStatusPoller`, `components/account/*`.
- **Feature leaves not read in full:** `detail/RecipeDetailView*`, `detail/RecipeHero*`,
  `detail/PhotoCarousel*`, `discovery/*` (except the FAB/inset check and the `flashCell` style),
  `versions/RecipeConflictView*`, `versions/VersionPreviewModal*`, `actions/*`, `rating/*`,
  `form/RecipeFormSections*` (styles scanned, JSX not read), `form/ChipInput*`, `form/CuisineSelect.native`,
  `hooks/*` (none of the ten hooks was reviewed).
- **Accessibility beyond touch targets and the two contrast cases** — no keyboard-navigation trace, no screen-
  reader trace, no focus-order review, no reduce-motion audit.
- **Performance** — no re-render audit, no bundle analysis, no FlashList recycling review beyond the height-
  variance consequence noted in F-U10.
