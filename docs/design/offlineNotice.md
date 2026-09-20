# Offline / sync notice — design specification

**Mode:** SPECIFY · **Surfaces:** app-wide sync notice (web + mobile), plus a per-item sync mark on recipe
surfaces · **Status:** committed design, ready to build · **Accessibility contract:** WCAG 2.2 level AA.

> **What this document is.** A design specification: placement, form, every state, the exact copy with its
> localisation keys, the cross-platform translation, and the accessibility contract by success-criterion
> number. It is **not** production code and contains none. The components it specifies do not exist yet.

---

## ⚠️ Raising this before we build

Three things must be true for the copy in this spec to be honest. Two of them are **not true of the tree
today**, and one is a reachable flow where the copy is currently a lie. All three are decisions for the
architecture/feature layer, not for this surface — but the surface cannot ship truthful copy without them.

### R1 — The durable store must be an outbox keyed by entity id, not just a persisted query cache

The notice says _"saved on this device"_ and the conflict banner says _"open it to choose which version to
keep."_ Both promises require the cook's unsynced payload to survive **independently of the query cache** and
to be retrievable **by recipe id** so the existing conflict resolver can be seeded with it.

`persistQueryClient` + `resumePausedMutations` does not provide that. A resumed mutation that 409s settles as
an error; its `variables` are then garbage-collected, and the next successful refetch overwrites the
optimistic value. At that point the cook's edit is gone and the banner has told them it was safe.

**Required:** a durable outbox — one record per unsynced write, keyed by `(entity, id)`, holding the payload
and the `expectedVersion` it was written against, surviving reload / tab close / swipe-kill / OOM, and
removed only on a confirmed server ack or an explicit user resolution.

⛔ Verified absent: no persister, outbox or durable mutation store exists in the tree. The only `AsyncStorage`
consumer is `packages/apps/commise/mobile/src/storage/recentSearchStore.ts`, and there is no web equivalent
beyond `useRecentSearches`' `localStorage` seam.

### R2 — The read invariant: local wins while a write is unresolved

**While an unresolved local write exists for recipe X, every read of X must render the local version.**

Without this, a background refetch after a failed sync silently reverts the cook's edit while the notice
reports everything is fine — the same data loss that makes auto-resolution unacceptable (§5), arriving from
the display side instead of the write side. Scope it to **unresolved**: once the cook picks _Keep theirs_ in
`RecipeConflictView`, local stops winning for that recipe.

This invariant is what makes the whole design coherent. The banner's claim is "your work is safe"; a read path
that can show the cook a version without their edit falsifies that claim on the surface where they would most
expect to see it.

### R3 — Sign-out with unsynced writes

_"Saved on this device"_ stops being true the moment local state is cleared. Sign-out is a real, load-bearing,
already-verified flow (`signOutAndVerify`, ADR-0009), reached from `LogoutButton`, `AccountCloseForm` and
`AccountEraseForm` on both platforms.

**Recommendation:** when `unsyncedWrites > 0`, sign-out gains a confirmation step naming the count. The
alternative — hedging the notice copy with _"unless you sign out"_ — spends words on a rare case in the state
the cook reads most often, and makes the common case read as less trustworthy than it is.

⛔ Named as an adjacent dependency, not designed here: it belongs to the account feature, and ADR-0009's
ordering and post-condition must not be disturbed by a design document.

**A persister write failure** (quota exceeded, storage unavailable) is the same class of promise-breaking and
is covered by `syncFailed`'s copy rather than a seventh state — see §4.

---

## 1. Hat and standing

UI/visual design + design technologist. I authored nothing under review here; this is a new surface.

**Not seen rendered.** No component exists to screenshot, and the copy's fit is asserted as a **character
budget** (§6) rather than a pixel measurement. Every geometric claim in this document is marked as owed
verification, not as a measurement taken — the existing measurements quoted (the 320px action-bar figures) are
the repo's own, read from source, not re-taken by me.

**Premise change absorbed.** An earlier brief for this surface assumed writes were held **in memory only** and
required the copy to hedge with _"keep the app open."_ That premise is **withdrawn** by owner ruling: writes
are persisted locally and synced on reconnect. This document carries only the durable model. No hedge copy
appears anywhere in it, and the ruling that a global drain state was unnecessary is **reopened and reversed**
in §5.

---

## 2. Governing decisions checked

| Decision                                                                                                           | Where                                                                         | How it binds                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A cross-platform notice is two leaves mirroring one directory, file for file                                       | `packages/apps/commise/ui/src/refreshNotice/`                                 | The structure of §7                                                   |
| _"The localized strings … the design system carries no copy of its own"_                                           | `ui/src/refreshNotice/props.ts:6`                                             | All copy lives in a feature dictionary; the leaf takes `labels`       |
| _"unmounting the pressed button would drop its focus to `<body>` (WCAG 2.2 SC 2.4.3)"_                             | `ui/src/refreshNotice/RefreshNotice.tsx` module doc                           | §4's retry rule: the Try-again button stays mounted and busy          |
| _"ONE CHANNEL PER PLATFORM, NEVER BOTH"_ — Android live region vs iOS imperative announcement                      | `ui/src/liveRegion/LiveRegion.native.tsx` module doc                          | Native announcements go through `LiveRegion`, never hand-rolled       |
| _"Mount it BEFORE there is anything to say (empty `children`)"_                                                    | same                                                                          | The resting `idle` state renders an empty region rather than nothing  |
| Polite when on-screen data is still valid; assertive when _"an action the viewer just took"_ failed                | same docstring, contrasting `LoadMoreControl`                                 | §8's politeness ruling, and the correction in it                      |
| _"the accent tone — not the text — carries the colour, and the copy stays `charcoal`/`slate`"_                     | `mobile/src/components/AlertBanner.tsx` module doc                            | §7's tone treatment; `palette.warning` is 1.88:1 as text              |
| _"pinned by WHERE the composing screen puts it (outside the scroller), not by absolute positioning"_               | `features/recipes/src/wizard/Wizard.native.tsx` `controls` style              | The mobile mount strategy in §7                                       |
| `busy` _"swaps the icon slot for a real spinner"_                                                                  | `ui/src/button/Button.tsx:17-18, 72`                                          | ⛔ Why `syncing` is never expressed through a spinner-bearing control |
| A `fixed` element is excluded from scrollable overflow, so a clipped bar produces no scrollbar and no tooling flag | `wizard/messages.ts` `prevLabelShort` docstring                               | Why the web notice is **static**, not fixed                           |
| `HomeTabBar` is `fixed bottom-0 z-50`; the wizard bar is `fixed bottom-0 z-60`                                     | `HomeTabBar.tsx:53`, `Wizard.tsx` `WizardControls`                            | The bottom edge is fully contested — the notice does not go there     |
| "Commise" is established user-facing terminology                                                                   | `mobile/src/i18n/messages.ts:390,397,455`; `web/src/i18n/messages.ts:339,415` | The product name may be used in copy                                  |
| `countOne` / `countOther` + `{count}`, selected by `Intl.PluralRules`                                              | `features/recipes/src/list/model.ts:62-67`                                    | The plural shape in §6                                                |
| Every user-facing string is localised; no literals                                                                 | `CLAUDE.md` pre-write gates                                                   | All copy ships as keys                                                |
| No hyphens in file names                                                                                           | owner directive                                                               | This file is `offlineNotice.md`                                       |

**Nothing found that decides placement, tone or copy for a sync notice.** No `offline`, `sync` or
`connectivity` copy key exists in either app's message files. This is a greenfield surface.

---

## 3. The ruling that shapes everything else: two tiers, with a strict division of labour

**Both a global notice and a per-item mark. Neither alone is sufficient, and the reason is structural.**

| Question the cook asks                     | Who can answer it                                                       | Who cannot                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| _"Is anything of mine not on the server?"_ | The **global notice** — it is the only thing that sees the whole outbox | No single screen knows about writes made on other screens                       |
| _"Is **this** recipe not on the server?"_  | The **per-item mark** — one item, one unambiguous state                 | The global notice, structurally: it reports a count, not an identity            |
| _"Which recipe needs my decision?"_        | The **per-item mark**                                                   | The global notice — and this is what makes the conflict ruling (§5) work at all |

The owner's case — a cook creating several recipes offline — is exactly where the global notice stops being
enough: _"3 changes waiting"_ does not tell them which three, and after a partial drain it does not tell them
which one failed. And the global notice is exactly what the item mark cannot replace: a cook on Home, or in
the grocery surface, or anywhere showing none of the affected recipes, would otherwise see nothing at all.

**The precedence rule below only works because of this split.** The banner names the single most urgent
condition; the item marks disambiguate everything the banner had to collapse into a count.

### Scope and cost — ship the mark where it routes a decision, defer the rest

A recipe appears on at least five surfaces × two platforms: the list, discovery cards, collection member rows,
the detail view, and Home's recent-recipes widget. Threading per-item sync state through all ten is a wide
blast radius for a brief that asked for one surface.

**Committed scope:** the mark is **required** for `syncFailed` and `syncConflict` only — the two states that
route the cook somewhere — and **required** on the recipe **detail** and **list** surfaces first.

**Deferred:** the plain _"not synced yet"_ mark, and the mark on discovery / collections / Home. If the promise
is "it is all safe and it will sync," a cook does not need to know which items are in flight. Add it only if
cooks are observed hunting for it.

⚠️ This is the 70% version. The full version is the same mark on all five surfaces plus the unsynced tier; it
costs roughly five times as much plumbing for the states that need no action.

---

## 4. The state contract

```
packages/apps/commise/ui/src/offlineNotice/props.ts
```

```
kind            carries               visible chrome            announced       tone
────────────────────────────────────────────────────────────────────────────────────────
idle            —                          nothing                 — (empty)       —
offline         unsyncedWrites             in-flow banner          polite          info
syncing         unsyncedWrites             same banner + strip     — (silent)      info
syncFailed      failedWrites, retrying,    banner + Try again      polite          caution
                onRetry
syncConflict    conflictedWrites           banner, no control      ASSERTIVE       caution
```

⛔ **There is no `synced` member.** The confirmation is owned by the leaf, not the union — see below.

⚠️ **`retrying` is set by the CALLER**, from the drain the cook's own Try-again press initiated. It is a
field on `syncFailed`, never a separate `kind`, and that is the mechanism behind the "same button, busy"
rule: the leaf re-renders one mounted button with `busy={retrying}`. ⛔ An implementation that swaps `kind`
on retry remounts the button and drops focus (SC 2.4.3).

**Precedence, highest first:** `syncConflict` › `syncFailed` › `syncing` › `offline` › `synced` › `idle`.
The caller derives one `kind` from the outbox. Two conditions can be true at once (2 failed + 1 conflicted);
the banner names the top one and the item marks carry the rest — which is the whole justification for §3.

**Naming.** `unsyncedWrites`, not the `queuedWrites` of the earlier contract, and deliberately not
`pendingWrites`: "pending" collides with TanStack's `isPending` and with the design system's `PendingBar`, and
"queued" described a memory queue that no longer exists. `unsynced` is the same word the user-facing copy uses.

**`unsyncedWrites: 0` is valid** on `offline` — the cook went offline having changed nothing — and gets its own
copy line. It is a state, not an edge case; see §6.

### Two members that need their lifecycle pinned down

**`synced` is owned by the leaf, not the caller.** It renders nothing visible; it exists only to give a
screen-reader user the closure a sighted user gets from the banner collapsing and the item marks clearing.
Rather than make the caller hold a state and run a timer, **the leaf detects the `non-idle → idle` transition**
using the previous-render pattern `LiveRegion.native.tsx:38-44` already uses, and announces once.

⛔ Consequence: `synced` is **not a member of the union.** The caller emits `idle`; the leaf decides whether
that `idle` deserves a word. This removes a timer, a member, and the "who clears it, and what happens if the
app was backgrounded" question in one move.

⛔ **Where the announced count comes from: the leaf's remembered previous `unsyncedWrites`** — the value it
held on the render before the transition to `idle`. Nothing passes a `syncedWrites` prop, because no caller
knows it: the outbox is empty by the time `idle` is emitted. `syncedOne` / `syncedOther` in the copy deck are
therefore consumed by the leaf through `labels`, like every other string, and by nothing else.

**`syncFailed`'s retry does NOT transition to `syncing`.** Pressing _Try again_ must keep the **same button
mounted and busy** — unmounting the pressed control drops focus to `<body>` (SC 2.4.3), which is the exact
defect `RefreshNotice`'s own docstring names, in the directory this leaf mirrors. So the re-drain is a **busy
`syncFailed`**, carrying a `retrying: boolean`, not a `syncing`.

That also keeps the two drains honestly distinguishable: `syncing` is the drain that happened **to** the cook
on reconnect; a busy `syncFailed` is the drain the cook **asked for**.

---

## 5. Rulings requested

### 5a. The global drain state — REOPENED and REVERSED. Show `syncing`.

⛔ **The reason, first, because this reverses a recorded ruling: under the durable model NO SCREEN REPORTS THE
DRAIN AT ALL.** The write already succeeded from the cook's point of view — the editor resolved, possibly
hours and several screens ago — so there is nothing left for a global banner to double-report. That is the
single fact the earlier ruling rested on, and the premise change removed it.

The earlier ruling removed it because a resumed write was in the same state as an ordinary foreground save,
which the owning screen's `submitting` already reported — so a global banner would double-report it.

**That argument dissolved with the premise**, for the reason stated above. And the drain is now real work
whose duration scales with the queue — a cook returning to wifi with twelve offline edits waits.

Without it, the banner jumps from _"12 changes saved on this device"_ straight to nothing, and a
disappearance is not an answer.

⚠️ **One layout shift, not two.** `syncing` reuses the **same banner** with changed copy plus a progress
strip, rather than swapping the banner for a strip. The banner collapses once, at the end, when the news is
good. Swapping would shift the page twice for one reconnect.

⛔ **`syncing` is not announced.** It is a transient the cook did not initiate and cannot act on; SC 4.1.3
does not require announcing progress. Its live region stays empty, and the _outcome_ is what gets spoken.

### 5b. Asynchronous conflict — PARK AND MARK

An offline edit that loses a CAS check surfaces hours later, on another screen. Three candidate answers:

- ⛔ **Interrupt with a modal.** Rejected. It hijacks a cook mid-task over an edit they no longer have in
  mind, at the worst possible moment on a phone in a kitchen, and it is a change of context on a trigger the
  user did not initiate.
- ⛔ **Auto-resolve (last-write-wins, or server-wins).** Rejected. It silently discards the cook's work, which
  is the one outcome the offline-first promise must never produce. The editor already models this correctly:
  `useRecipeEditor`'s `status: 'discarded'` exists _because_ discarding is a decision the cook makes, not a
  default the system takes.
- ✅ **Park the conflict, mark the item, let the cook choose when.**

**The ruling.** The conflicting local write stays durably parked (R1). The global banner reports
`syncConflict` with a count, assertively, once. The affected recipe carries a **"Needs your review"** mark on
the list and detail surfaces. Opening that recipe routes into the **existing** `RecipeConflictView`, seeded
from the parked local payload and the current server version.

**Why:** it preserves the cook's work; it moves the decision to the moment they have context, which is when
they are looking at the recipe; and it reuses the resolver that already ships rather than building a second
surface for the same decision. Two surfaces resolving one conflict drift apart — the wizard rejected exactly
that when it deleted Preview in favour of the Review step.

⚠️ **Accepted costs, stated not hidden.**

1. A conflict can sit unresolved indefinitely, with the assertive banner present the whole time. It is rare;
   the alternative (letting it be dismissed) hides a pending decision about the cook's own data.
2. Until it is resolved, R2 means the cook sees **their** version on the detail screen while the server holds
   another. The mark is what stops that being silently confusing.
3. ⛔ **A parked conflict must never be silently expired or dropped.** Whether there is a retention ceiling at
   all is an owner question, not mine — see §12.

### 5c. Dismissible — NO, for all states

- `offline` / `syncing`: the condition is still true after dismissal, so dismissing produces an app that is
  offline and says nothing — the exact gulf this surface exists to close.
- `syncFailed`: clears when a retry succeeds. State-driven, not user-driven.
- `syncConflict`: clears when the cook resolves it. A dismiss would hide an unresolved decision about their
  own data.

**Design consequence:** apart from `syncFailed`'s Try-again, the banner contains **nothing focusable**, so it
can appear and disappear at any time without orphaning focus (SC 2.4.3). Non-dismissibility is what buys that.

### 5d. Honest limits — `isConnected`, not `isInternetReachable`. Do NOT put it in the copy.

`packages/apps/commise/mobile/src/query/connectivity.ts` drives `onlineManager` from NetInfo's `isConnected`,
so wifi that is associated but whose router or ISP is down does **not** pause. The notice is trustworthy when
shown and incomplete when absent.

**Ruling: the copy does not acknowledge it. The contract does.** Three reasons:

1. **Copy cannot describe its own absence.** Every word spent on _"…though sometimes we won't notice"_ is
   spent on the case where the notice is not on screen to be read.
2. It makes the notice longer and less trustworthy in the majority case where it is correct — which is the
   case it exists for.
3. **It is a different defect with a different remedy.** Associated-but-dead wifi does not produce the state
   this surface reports; it produces a real request that hangs or errors, which belongs to the request
   timeout and the screen's own error path. Patching it with a hedge here fixes neither.

**What does change is one word.** _"You're offline"_ is a claim about the **device**, which is what NetInfo
actually measured — accurate. _"Commise can't reach the internet"_ would be an over-claim the signal does not
support. The distinction is the whole ruling, and it belongs in the `props.ts` docstring so the next person
does not "improve" the wording into a claim the sensor cannot back.

**Named follow-up (not recommended outright):** moving to `isInternetReachable` trades this gap for a
false-offline risk while the probe resolves (`null`), and changes behaviour for every query in the app. It is
a connectivity decision, not a copy decision.

---

## 6. The copy deck

### Where it lives

**One dictionary, `offlineNoticeMessages: LocalizedMessages<OfflineNoticeMessages>`**, consumed by both
callers (`AppShell` on web, `App.tsx` on mobile) via `useMessages` — the `wizardMessages` precedent, where one
dictionary serves both platform leaves so the two cannot drift.

⛔ It must **not** be duplicated into `web/src/i18n/messages.ts` and `mobile/src/i18n/messages.ts`. That is two
authoritative representations of one piece of knowledge, and the app-wide notice says the same thing on both
platforms by definition.

⚠️ **Implementation note — `fillTemplate` and the plural select live in the wrong package.**
`fillTemplate` is declared once, at `features/recipes/src/list/model.ts:39`, with ~77 consumers, all inside
`features-recipes`. `formatRecipeCount` (`:62`) is the `Intl.PluralRules` select. Both are **locale
knowledge** sitting in a recipe feature, and a core-level dictionary cannot depend on a feature package.
**Cheapest correct path:** move both into `@commise/i18n` and re-export them from `list/model.ts` — one-line
change, zero churn at the 77 call sites. Not a rename of 77 files.

### The strings

Typographic apostrophes (`’`) throughout, matching the existing dictionaries.

```ts
// Accessible name for the notice's region landmark.
regionLabel: 'Sync status';

// ── offline ───────────────────────────────────────────────────────────────────
offlineTitle: 'You’re offline';
offlineBodyNone: 'Anything you change is saved on this device and syncs when you’re back online.';
offlineBodyOne: '{count} change is saved on this device and will sync when you’re back online.';
offlineBodyOther: '{count} changes are saved on this device and will sync when you’re back online.';

// ── syncing ───────────────────────────────────────────────────────────────────
syncingTitle: 'Back online';
syncingBodyOne: 'Syncing {count} change…';
syncingBodyOther: 'Syncing {count} changes…';

// ── synced (announced only; never rendered) ───────────────────────────────────
syncedOne: '{count} change synced.';
syncedOther: '{count} changes synced.';

// ── syncFailed ────────────────────────────────────────────────────────────────
failedTitle: 'Some changes haven’t synced';
failedBodyOne: '{count} change is still saved on this device. Nothing has been lost.';
failedBodyOther: '{count} changes are still saved on this device. Nothing has been lost.';
failedRetry: 'Try again';

// ── syncConflict ──────────────────────────────────────────────────────────────
conflictTitle: 'Choose which version to keep';
conflictBodyOne: '{count} recipe was changed somewhere else while you were offline. Open it to choose which version to keep.';
conflictBodyOther: '{count} recipes were changed somewhere else while you were offline. Open them to choose which version to keep.';
```

**Per-item marks** — these live in the recipe feature's dictionary, not the notice's, because they render on
recipe surfaces and change when recipe vocabulary changes:

```ts
syncMarkFailed: 'Couldn’t sync'; // required tier
syncMarkConflict: 'Needs your review'; // required tier
syncMarkUnsynced: 'Not synced yet'; // deferred tier (§3)
```

### Copy rationale — what each line is doing, and what it refuses to do

| Line                                        | Doing                                                              | Refusing                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| _"saved on this device"_                    | States **where** the work is, which is the whole reassurance       | _"saved"_ unqualified — the cook would reasonably read that as "on the server"                                                              |
| _"will sync when you're back online"_       | Names the mechanism and the condition                              | Any hedge about keeping the app open. The premise that required it is withdrawn, and a stale hedge makes the product look weaker than it is |
| _"Back online"_ as the `syncing` title      | Gives the sighted cook the good news first, then the work          | Leading with _"Syncing…"_, which reads as a machine's status rather than an answer to their question                                        |
| _"Nothing has been lost."_                  | Does the emotional work of `syncFailed` in four words              | _"Failed"_, _"Error"_, _"couldn't be saved"_ — all of which are false: it **is** saved, just not there                                      |
| _"changed somewhere else"_                  | True whether it was another device, the web app, or a collaborator | _"on another device"_, which asserts a fact we have not established                                                                         |
| _"Open it to choose which version to keep"_ | Tells the cook the remedy and where                                | Implying the app will choose. It will not (§5b)                                                                                             |
| _"Needs your review"_ as the item mark      | Neutral, actionable, no blame                                      | _"Conflict"_ — accurate jargon nobody outside engineering uses                                                                              |

⛔ **The word "saved" never appears unqualified anywhere in this deck.** Under the durable model that is no
longer a hard prohibition, but it is still the right discipline: _"saved on this device"_ is a stronger,
truer claim than _"saved"_, and it is what makes the `syncFailed` line land.

### Character budget at 320 CSS px

Content width at 320px with the banner's `px-4` is **288px**. At `text-body-sm` (≈14px) that is roughly **40
characters per line**.

| String              | Chars (count = 12) | Lines | Budget                                               |
| ------------------- | ------------------ | ----- | ---------------------------------------------------- |
| `offlineTitle`      | 15                 | 1     | comfortable                                          |
| `offlineBodyOther`  | ~79                | 2–3   | fits                                                 |
| `conflictBodyOther` | ~104               | 3     | the longest — fits, and is the one to re-check first |
| `failedRetry`       | 9                  | 1     | control element, must not wrap — see below           |

⚠️ **Pixel verification is OWED, not done.** These are character counts against an assumed metric, not a
measurement. The repo already ships under a font-fallback condition (production renders `system-ui`, not
Inter), so the check must be run against the fallback. See §11.

**On the owner's wrapping rule.** The banner **body is prose and wrapping it is correct** — the rule is scoped
to control elements and to short text where wrapping breaks layout or widens a gulf, and a two-line
explanation does neither. ⛔ The rule **does** bind `failedRetry` ("Try again"): it is a control element, it
must not wrap, and the banner is a wrapping row (`flex-wrap`) precisely so the button drops to its own line
intact rather than breaking its own label. This is the `RefreshNotice` row's existing behaviour, unchanged.

---

## 7. Placement and form — and the §3.6 translation

### Web — a static, in-flow banner at the top of `<main>`

Mounted in `AppShell.tsx`, above the `children` it passes to `HomeChrome`, so it renders as the first block
inside the `<main>` landmark.

**Static, not fixed, and not sticky.** Three reasons, in order of weight:

1. ⛔ **The bottom edge is fully contested and the fixed class of bug has already bitten this repo.**
   `HomeTabBar` is `fixed bottom-0 z-50`; the wizard action bar is `fixed bottom-0 z-60` and carries a
   docstring explaining that a `fixed` element is excluded from scrollable overflow, so a clipped bar produced
   no scrollbar and no tooling flag. A third fixed layer on a 320px viewport is how that recurs.
2. **Sticky would be a third sticky layer in one scroll container.** `HomeTopBar` is `sticky top-0 z-40 h-14`
   and `WizardHeader` is `sticky top-0 z-20` inside the same `<main>`. A `sticky top-14` notice couples its
   offset to another file's `h-14` by literal, and gives three sticky layers with mismatched offsets.
3. A static element is **in normal flow**, so it is included in scrollable overflow and visible to exactly the
   overflow checks that could not see the clipped action bar.

**Cost, stated:** the banner scrolls away. A cook deep in a long list sees it only on return to the top. That
is acceptable because §3's item marks are the local answer and the banner is ambient context — and because
placement is a **two-way door**.

⚠️ **Flip condition:** promote to `sticky` if cooks are observed missing it. If that happens, derive the
offset from a shared token rather than repeating `14`.

**Mechanics.** `<main>` carries `px-4 md:px-6`, so a full-bleed banner needs `-mx-4 md:-mx-6`. ⚠️ Holding the
cook's scroll position when the banner appears mid-session relies on **browser scroll anchoring**; expected to
work, **verification owed** (§11).

### Mobile — a sibling above `RootNavigator`, inside `<AuthGate>`

Mounted in `App.tsx`. It is a sibling in a column, so it occupies real space at the top of the app and every
screen below simply gets less height. ⛔ **No absolute positioning** — this is the same "pinned by where the
composing screen puts it, not by absolute positioning" rule `Wizard.native.tsx`'s `controls` style already
states, and it is what makes clipping structurally impossible.

#### ⛔ The safe-area finding — a real defect, with a disposition

The notice is now the topmost element, and the screens below it **still pad by `insets.top` themselves**
(`HomeScreen.tsx:36,43`, and the same pattern in `RecipesScreen`, `profile`, `AccountSettings`, `login`,
`signup`). `useSafeAreaInsets()` returns **device** insets, not remaining space.

| Option                                                          | Verdict                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Notice does not consume the inset, renders under the status bar | ⛔ **Rejected.** `HomeScreen.tsx`'s own comment: occluded nodes _"drop out of the accessibility hierarchy, which also makes them invisible to screen readers and to Maestro E2E."_ An accessibility defect, not a cosmetic one |
| Notice consumes `insets.top` when visible; screens double-pad   | ✅ **Ship this.**                                                                                                                                                                                                              |
| Screens switch to a shared "remaining top inset" from context   | The correct long-term answer; out of scope here                                                                                                                                                                                |

**Accepted consequence, with the number:** while the notice is visible there is roughly **47pt of dead space**
between it and the screen's top row on a notched device — and **0pt on a device without a top inset.** ⚠️ That
second half is why it will pass every simulator check somebody runs; it must be verified on a notched device.

⚠️ **This is the "does it belong in the primitive" question, and the answer is yes.** The fix is one shared
inset provider consumed by six screens — mechanical, but a per-screen patch would leave the seventh screen
wrong. Named as a follow-up, not designed here.

### §3.6 disposition — every element that differs

| Element                                | Web                                                                             | Mobile                                          | Disposition                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Container                              | `<div>` at top of `<main>`, in flow, full-bleed via negative margin             | `<View>` above `RootNavigator`, in flow         | **kept** — same role, same position in reading order                                                            |
| Pinning mechanism                      | static, normal flow                                                             | sibling placement, no absolute positioning      | **kept** (different spelling of "in flow" per platform)                                                         |
| Top safe-area inset                    | n/a (`env()` is 0 in a normal viewport, and the notice is below the sticky bar) | `paddingTop: insets.top` while visible          | **moved** — the inset obligation moves to the notice because it is now topmost                                  |
| Tone accent                            | 4px left border                                                                 | 4px `borderLeftWidth`                           | **kept** — `AlertBanner`'s existing treatment                                                                   |
| Title / body                           | `text-body-sm`, `charcoal` / `slate`                                            | `nativeTokens.fontSize.bodySm`                  | **kept**                                                                                                        |
| Try-again control                      | `<button>` + `busyControlProps` (`aria-disabled`, focus retained)               | `Pressable` + native `disabled`                 | **kept**, different mechanism — native `disabled` does not move the screen-reader cursor (`button/props.ts:53`) |
| Progress strip (`syncing`)             | 4px `seafoam`, CSS `animation-delay` reveal                                     | 4px `seafoam`, timer-child reveal               | **kept** — the `PendingBar` house pattern, both leaves                                                          |
| Live region                            | `role="status"` / `role="alert"`                                                | `LiveRegion` (Android region, iOS announcement) | **moved** — the platform channel differs; `LiveRegion` owns that choice                                         |
| Hover / right-click / drag affordances | none                                                                            | n/a                                             | **dropped** by design — the notice has exactly one control and no gesture                                       |
| Dismiss control                        | none                                                                            | none                                            | **dropped** on both (§5c)                                                                                       |
| Layout at 320px                        | prose wraps; row is `flex-wrap` so Try again drops intact                       | `flexWrap: 'wrap'`, `flexShrink: 1` on the text | **kept**                                                                                                        |

**Reach — the primary action re-decided per platform.** `syncFailed` is the only state with a control. On web
it sits trailing on the row, matching `RefreshNotice`'s existing `justify-between`. **On mobile it stays
trailing too**, and that is a deliberate call rather than symmetry: the notice is at the **top** of the phone,
firmly outside the thumb zone at any placement, so moving the button left buys nothing — while diverging from
`RefreshNotice`'s row would make the two notices read as different components. Reach cannot be improved here;
consistency can.

⚠️ **Scroll budget.** Web: the banner is 2–3 lines of prose plus a title, so roughly **96–128px** of the
first screen, once, at the top of content — it does not reduce what is reachable, only what is visible on
arrival. Mobile: the same, plus the inset, taken off **every** screen's height while visible. On the recipe
wizard that compounds with the `fixed` action bar at the foot; the wizard's existing `pb-[calc(6rem+…)]`
reservation is unaffected because this notice is at the top.

⛔ **No horizontal scroll at 320 CSS px** — the banner is a wrapping block with no fixed-width child.
Verification owed (§11).

---

## 8. Accessibility contract — WCAG 2.2 level AA

### Politeness, by state — including one correction

| State          | Channel                           | Ruling                                                                                                                                           |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle`         | `role="status"` mounted **empty** | Mounted before there is anything to say, per `LiveRegion`'s docstring: a region that mounts _with_ its text is not reliably announced on Android |
| `offline`      | **polite**                        | A benign ambient change the cook did not cause. Interrupting would cut off whatever they are reading, for news that costs them nothing           |
| `syncing`      | **silent** (region stays empty)   | Progress the cook cannot act on. SC 4.1.3 does not require announcing it; the outcome is what matters                                            |
| `synced`       | **polite**, once                  | The only closure a screen-reader user gets, since the visual closure is a banner collapsing and marks clearing — neither of which is announced   |
| `syncFailed`   | **polite** ⚠️ _corrected_         | See below                                                                                                                                        |
| `syncConflict` | **ASSERTIVE**                     | See below                                                                                                                                        |

⚠️ **Correction — `syncFailed` is polite, not assertive.** Assertive was right under the memory-only premise,
where a failed flush meant work at risk. It is wrong now. The repo's own precedent draws the line at _"an
action the viewer just took failing"_ (`LiveRegion`/`LoadMoreControl`, cited in `RefreshNotice`'s docstring) —
and here the cook took the action hours ago, it **succeeded from their point of view**, and the work is safe.
Interrupting a cook mid-recipe for a non-urgent, non-lossy condition spends the interruption budget on the
wrong state.

✅ **`syncConflict` is the one assertive state, and it is assertive for a specific reason:** it requires a
human decision, and until that decision is made the recipe the cook sees on screen is not the one the server
holds (R2). That is worth interrupting for, it is rare, and reserving assertiveness for exactly one state is
what keeps it meaningful.

### Criteria checked

| SC                               | Level | How it is met                                                                                                                                                                                                 |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1.3** Status Messages        | AA    | The core criterion. `role="status"` (polite) / `role="alert"` (assertive) on web; `LiveRegion` on native. Mounted empty at `idle` so a later change is announced                                              |
| **1.3.1** Info and Relationships | A     | Counts are in the text. The tone accent is redundant with the words, never the sole carrier                                                                                                                   |
| **1.4.1** Use of Color           | A     | Tone is carried by the accent **and** the wording. `offline` and `syncFailed` are distinguishable with colour removed                                                                                         |
| **1.4.3** Contrast (Minimum)     | AA    | Copy is `charcoal` / `slate` on `pearl`. ⛔ The accent colour is **never** used as text: `palette.warning` is 1.88:1 (`AlertBanner` docstring)                                                                |
| **1.4.4** Resize Text            | AA    | Prose block, no fixed heights, wraps at 200%                                                                                                                                                                  |
| **1.4.10** Reflow                | AA    | No horizontal page scroll at 320 CSS px; wrapping block, no fixed-width child                                                                                                                                 |
| **1.4.11** Non-text Contrast     | AA    | The 4px tone accent and the `seafoam` progress strip must reach 3:1 against `pearl`. ⚠️ **Verification owed** for `seafoam` on `pearl`                                                                        |
| **2.1.1** Keyboard               | A     | One control (`Try again`), a real `<button>`                                                                                                                                                                  |
| **2.2.1** Timing Adjustable      | A     | Nothing auto-dismisses. This is a **design reason** for §5c, not an afterthought                                                                                                                              |
| **2.2.2** Pause, Stop, Hide      | A     | The progress strip is **still** — no animation — following `PendingBar`'s own ruling that a moving bar beside usable content is not covered by the loading exemption                                          |
| **2.4.3** Focus Order            | A     | Nothing focusable except `Try again`, which stays **mounted and busy** through its own retry (§4). The banner can appear or vanish at any time without orphaning focus — non-dismissibility is what buys this |
| **2.5.8** Target Size (Minimum)  | AA    | `Try again`: `min-h-11` (44px) on web, `minHeight: 44` on native — both above the 24px floor and at the platform HIG figure                                                                                   |
| **3.2.2** On Input               | A     | The banner's appearance is not triggered by input and changes no context                                                                                                                                      |
| **3.3.1** Error Identification   | A     | `syncFailed` and `syncConflict` state what happened and what to do                                                                                                                                            |

**Not applicable, stated:** 2.5.7 Dragging Movements (no drag), 1.4.13 Content on Hover (no hover affordance),
2.4.11 Focus Not Obscured (the notice is at the top and never overlays).

⚠️ **The one criterion a spec cannot discharge:** SC 4.1.3 is satisfied by the _mechanism_; whether it is
actually announced depends on the AT. NVDA, VoiceOver iOS and TalkBack behave differently on region changes.
Manual verification owed (§11).

---

## 9. Every state is a deliverable

| #   | State                       | Trigger                              | Visible                                       | Spoken           | Item mark               |
| --- | --------------------------- | ------------------------------------ | --------------------------------------------- | ---------------- | ----------------------- |
| 1   | `idle`                      | Online, outbox empty                 | nothing                                       | — (empty region) | none                    |
| 2   | `offline`, count 0          | Connection lost, nothing changed yet | Title + `offlineBodyNone`                     | polite           | none                    |
| 3   | `offline`, count 1          | One unsynced write                   | Title + `offlineBodyOne`                      | polite           | deferred tier           |
| 4   | `offline`, count N          | N unsynced writes                    | Title + `offlineBodyOther`                    | polite           | deferred tier           |
| 5   | `syncing`, count 1          | Reconnect, drain in progress         | `syncingTitle` + `syncingBodyOne` + strip     | —                | deferred tier           |
| 6   | `syncing`, count N          | as above                             | `syncingTitle` + `syncingBodyOther` + strip   | —                | deferred tier           |
| 7   | _synced_ (leaf-detected)    | Drain completes, outbox empty        | Banner collapses — nothing                    | polite, once     | marks clear             |
| 8   | `syncFailed`, count 1       | Non-conflict sync error              | `failedTitle` + `failedBodyOne` + Try again   | polite           | **required**            |
| 9   | `syncFailed`, count N       | as above                             | `failedTitle` + `failedBodyOther` + Try again | polite           | **required**            |
| 10  | `syncFailed`, retrying      | Try again pressed                    | Same banner, **same button, busy**            | —                | unchanged               |
| 11  | `syncConflict`, count 1     | Sync 409                             | `conflictTitle` + `conflictBodyOne`           | **assertive**    | **required**            |
| 12  | `syncConflict`, count N     | as above                             | `conflictTitle` + `conflictBodyOther`         | **assertive**    | **required**            |
| 13  | Conflict + failure together | Both                                 | Conflict wins (precedence, §4)                | assertive        | each item shows its own |
| 14  | Signed out                  | `AuthGate` renders the auth screens  | Nothing — the notice is inside `<AuthGate>`   | —                | none                    |
| 15  | First run, never online     | Fresh install, no connection         | State 2                                       | polite           | none                    |
| 16  | Local storage unavailable   | Persister write fails                | State 8/9 copy                                | polite           | **required**            |

**On 14:** the notice is mounted **inside** `<AuthGate>` by the settled architecture, so a signed-out cook
sees nothing. Correct: there is no outbox to report. ⚠️ But it is also the state R3 is about — sign-out with
unsynced writes must be confirmed **before** the notice disappears along with the claim it was making.

**On 16:** a persister write failure means "saved on this device" was not true for that write. It reports as
`syncFailed` rather than earning a seventh state — the cook's remedy (retry) and the fact they need (it is not
on the server) are identical, and a seventh state would need its own copy for a case indistinguishable to
them. ⛔ It must **not** be silent.

---

## 10. Files this specifies

| Path                                                                  | What                                                                                                                | §9 category                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/apps/commise/ui/src/offlineNotice/props.ts`                 | The union (incl. `syncFailed`'s `retrying` + `onRetry`), `labels`, and the `isConnected` limitation docstring (§5d) | design system — mine to own                |
| `packages/apps/commise/ui/src/offlineNotice/OfflineNotice.tsx`        | Web leaf                                                                                                            | design system                              |
| `packages/apps/commise/ui/src/offlineNotice/OfflineNotice.native.tsx` | Native leaf                                                                                                         | design system                              |
| `packages/apps/commise/ui/src/offlineNotice/index.ts`                 | Package export                                                                                                      | design system                              |
| A shared `offlineNoticeMessages` dictionary                           | The copy deck (§6)                                                                                                  | feature code — `fe-1`                      |
| `AppShell.tsx` / `App.tsx` mount + `kind` derivation                  | Callers                                                                                                             | feature code — `fe-1`                      |
| Per-item mark on recipe detail + list                                 | §3 required tier                                                                                                    | feature code — `fe-1`                      |
| The durable outbox (R1) and the read invariant (R2)                   | —                                                                                                                   | **architecture — `staff-architect` first** |

⛔ Everything below the design-system rows is feature code and is **not** mine to write.

---

## 11. Verification owed

Nothing in this spec has been rendered. These are the checks the implementation owes, and the ones I could not
run.

1. **320px reflow**, web and native, worst case `conflictBodyOther` with a 3-digit count — against the
   **`system-ui` fallback**, not Inter, since production ships the fallback.
2. **Notched-device safe area** (§7). A simulator without a top inset shows 0pt of dead space and proves
   nothing.
3. **`seafoam` on `pearl` ≥ 3:1** for the progress strip (SC 1.4.11).
4. **Live-region announcement** on NVDA, VoiceOver iOS and TalkBack — mechanism is specified, behaviour is not
   guaranteed.
5. **Browser scroll anchoring** holds position when the banner appears mid-session (§7).
6. **Focus retention** across `syncFailed` → retrying → `syncFailed` (SC 2.4.3).

### Test tiers (`docs/CODING_STANDARDS.md` §7.1)

- **Component (vitest + RTL), both leaves, every row of §9** — including `offline` with count **0**, the
  retrying state, and the precedence case (13).
- **Component**, the item mark on detail and list, both platforms.
- **Playwright** (web) and **Maestro** (mobile) for the happy path: go offline → edit → reconnect → synced.
- ⛔ **Not a deployed e2e test.** Offline is browser/device-emulation-shaped, and under the owner ruling of
  2026-09-05 a deployed e2e suite skips when the PR's sandbox is not running — a skipped test proves nothing
  about this. The offline path belongs in the component and integration tiers where it can actually be driven.

---

## 12. Questions blocking this

**Genuine blockers — the design cannot ship truthfully without these.**

1. **R1 — is a durable outbox keyed by entity id being built?** If the mechanism is only `persistQueryClient`
    - `resumePausedMutations`, the conflict copy promises something the layer cannot honour.
2. **R2 — is "local wins while unresolved" accepted as a read invariant?** If not, the banner's core claim is
   falsifiable by a background refetch.

**Confirmations requested — I have decided these; flag if wrong.**

3. **R3 — sign-out with unsynced writes.** I recommend a confirmation step. If the answer is instead to hedge
   the copy, §6 changes.
4. **Conflict retention.** Is there any ceiling on how long a parked conflict may sit unresolved? ⛔ Not my
   ruling — it is a data-retention decision. My design assumes **no expiry**, and silently dropping a parked
   conflict would be the worst outcome available.
5. **Item-mark scope.** §3 ships the mark on detail + list for `syncFailed` and `syncConflict` only. Confirm
   the deferral is acceptable.

---

## 13. Evidence: verified · assumed · judgement

**Verified (read in this tree, anchored).** No persister, outbox or durable mutation store exists. No
`offline`/`sync`/`connectivity` copy key exists in either app. `connectivity.ts` uses NetInfo `isConnected`.
`Button`'s `busy` renders a spinner (`Button.tsx:72`; native `ActivityIndicator` at `Button.native.tsx:62`).
`HomeTabBar` `z-50` and the wizard bar `z-60` are both `fixed bottom-0`. `HomeTopBar` is `sticky top-0 z-40
h-14`; `WizardHeader` is `sticky top-0 z-20`. `HomeScreen` pads `insets.top` itself. `fillTemplate` has one
declaration and ~77 consumers, all in `features-recipes`. "Commise" is established user-facing copy.
`RecipeConflictView` exists on both platforms.

**Assumed (stated, not checked).** TanStack v5's `isPaused` is available on the mutation result (standard, but
not confirmed against the installed types — and under the new model the surface never reads it, so this is
informational). The durable layer will expose the outbox counts the union needs. ~40 characters per line at
`text-body-sm` / 288px.

**Informed prior (published mechanism, no local study).** Interrupting a user with a modal over a decision
they have no current context for degrades both the decision and the interrupted task (Nielsen #1 visibility of
system status, and the interruption literature behind it) — the basis for rejecting modal conflict. Peak–end:
a task is judged by its ending, which is why `synced` earns an announcement. Proximity and redundancy coding:
tone must not be the sole carrier of meaning.

**Judgement (mine, labelled).** The two-tier split and its division of labour. The precedence order. Park-and-
mark. The single-assertive-state line. That the accent never goes red, because no data is at risk. Every word
in the copy deck. The static-not-sticky web placement. That `syncFailed` is polite.

⛔ **No claim in this document is user evidence.** I cannot observe a cook. Nothing here has been tested with
one, and the flip conditions in §7 exist because of that.

---

## 14. Hand-off

1. **`staff-architect`** — R1 and R2 first. They are the contract this surface renders, and questions 1–2 are
   blocking.
2. **Owner** — questions 3–5.
3. **`fe-1`** — the two leaves, the dictionary, the two mounts, the item marks. The accessibility contract in
   §8 is **WCAG 2.2 AA**; confirm the implementer's stated floor matches before handing this over.
   ⛔ **§11's six verifications are `fe-1`'s obligation, discharged before the parity audit — not a floating
   list.** Each is reported by name as run or not run. ⚠️ Item 4 (NVDA / VoiceOver iOS / TalkBack) is the one
   that realistically gets skipped, and a skipped check reported as done is worse than a stated gap: SC 4.1.3
   is the criterion this whole surface exists to satisfy, and the mechanism being correct is not evidence the
   announcement happened.
4. **`staff-ux-engineer` (EVALUATE)** — after build, for the §11 checks and a design-vs-implementation parity
   audit. ⛔ Feature 001 shipped with ~50 audited drifts from seven wireframes because the parity check did not
   exist. This spec is not finished until that audit runs.

**State to carry forward, so it is not lost between modes:** the model is **durable local writes, optimistic
success, background sync** — not a memory queue. Cooks are in kitchens on unreliable wifi, often mid-task, on
a phone, one-handed. The requirement is _"only the user should know they are offline"_ — no consumer branches
on connectivity. The chosen direction is **two tiers** (global notice + per-item mark), with **park-and-mark**
for asynchronous conflict. The flip condition on placement is: promote the web banner to sticky only if cooks
are observed missing it.

---

---

# Part II — the offline READ surface

**Mode:** SPECIFY · **Surface:** the content region of a screen whose read cannot resolve because the device is
offline (web + mobile) · **Status:** committed design, ready to build · **Accessibility contract:** WCAG 2.2
level AA.

> **Why this lives in the same document.** Part I specifies what the app says about the cook's unsynced
> **writes**. This specifies what a screen says when a **read** cannot resolve. They are two halves of one
> feature — _"what the product says about being offline"_ — and §17 is a rule about how they coexist. A rule
> about two surfaces cannot be enforced from two files.

---

## 15. Hat, standing, and what changed since Part I

UI/visual design + design technologist. I authored nothing under review; this is a new surface. I did author
Part I, which §17 amends — that self-review is declared here rather than buried.

**Not seen rendered.** No leaf exists. Every geometric claim is owed verification (§23). The **contrast figures
in §22 are measured, not recalled** — computed from the tokens in `ui/src/tokens/colors.ts:72-75`.

**What is different from Part I: the mechanism already exists and is inert.** Part I specified a surface whose
every dependency (R1, R2) is unbuilt. This one decorates code that ships today:

| Built, read in this tree                | What it establishes                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `query/src/pendingSlot.tsx:45-70`       | The trigger is `parked ∧ offline`, and the replacement is total — `renderOffline(children)` **or** `children`, never both |
| `query/src/offlineReadNotice.tsx:23-28` | `RenderOffline = (loading: ReactNode) => ReactNode`, with an identity Null Object default                                 |
| `query/src/useIsOffline.ts`             | One connectivity reader for both apps, over TanStack's `onlineManager`                                                    |
| `query/src/QueryBoundary.tsx`           | `PendingSlot` wraps the Suspense fallback only — a failed read is the error boundary's, never this                        |

⛔ **The seam is a contract, not a draft.** This spec supplies a `renderOffline` implementation; it does not
propose changing `RenderOffline`'s signature. Where a limitation follows from the signature, §21 states it.

---

## 16. Governing decisions checked

| Decision                                                                                      | Where                                                                                  | How it binds                                                                                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| _"IT IS PENDING, NOT FAILED"_ — `docs/CODING_STANDARDS.md` §11.0                              | `pendingSlot.tsx:9-11`                                                                 | §18's tone, and why there is no error framing anywhere in §19                                                         |
| _"THE CONJUNCTION IS LOAD-BEARING"_ — a backgrounded app parks while online                   | `pendingSlot.tsx:36-39`                                                                | §20's state table: `paused` alone is **not** this surface                                                             |
| _"AND THE READ RECOVERS BY ITSELF, which is why nothing here offers a Retry"_                 | `pendingSlot.tsx:13-16`                                                                | §19's copy must **state** that, not merely imply it                                                                   |
| _"the design system carries no copy of its own"_                                              | `ui/src/refreshNotice/props.ts:6`                                                      | The leaf takes `labels`; the string lives in a feature dictionary                                                     |
| _"Mount it BEFORE there is anything to say (empty `children`)"_                               | `ui/src/liveRegion/LiveRegion.native.tsx:13-15`                                        | §22's live-region ruling — this node mounts **populated**                                                             |
| _"a live region announces its CONTENT, not its label"_ + the predecessor's `role="status"`    | `features/recipes/src/card/RecipeCardGridSkeleton.tsx:11, 54-55`                       | The disposition in §22; and the reason §18 rules **replace**                                                          |
| Native skeleton: `accessibilityLabel` on a `View`, **no** live region; _"inert, motion-free"_ | `features/recipes/src/list/RecipeListLoading.native.tsx:5, 23`                         | §22's native disposition is parity-preserving, not a removal                                                          |
| `animate-pulse … motion-reduce:animate-none` on the web skeleton cells                        | `RecipeCardGridSkeleton.tsx:59-61`                                                     | §18's SC 2.2.2 argument — and the reason it is an argument **against augmenting**, not a finding against the skeleton |
| _"a moving bar beside usable content is not covered by the loading exemption"_                | Part I §8, from `PendingBar`'s own ruling                                              | Same                                                                                                                  |
| `useMessages` resolves a shared `LocalizedMessages<T>` from `LocaleProvider`                  | `i18n/src/react.tsx:28-30`                                                             | §19's dictionary mechanism                                                                                            |
| `LocaleProvider` sits **above** `RecipeProviders` / `QueryClientProvider`                     | `web/src/app/[locale]/layout.tsx:84-86`; `mobile/src/providers/AppProviders.tsx:61-69` | The mount in §21 can read the dictionary                                                                              |
| `RefreshNotice.tsx` carries **no** `'use client'`                                             | `ui/src/refreshNotice/RefreshNotice.tsx:21`                                            | The leaves do not either; the consuming provider is already a client module                                           |
| Every user-facing string is localised; no literals                                            | `CLAUDE.md` pre-write gates                                                            | The string ships as a key                                                                                             |

**Nothing found that decides copy, form or announcement for a parked read.** `grep` finds no `offline`, `sync`
or `connectivity` copy key in either app. Greenfield, as in Part I.

---

## 17. ⛔ The composition ruling — banner and slot on one screen

**They never say the same thing, because they are about different objects.** That is the whole rule, and it is
enforceable rather than aspirational:

|               | App-wide banner (Part I)                                                          | In-place read slot (Part II)                                                                      |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Object**    | The cook's **writes** — "your work is safe"                                       | **This region's read** — "this content is not here yet"                                           |
| **Claim**     | The device is offline; N changes are held locally                                 | This region is waiting, and it will fill itself in                                                |
| **Form**      | Titled banner, tone accent, border                                                | **No title, no icon, no accent, no border** — body text only                                      |
| **Announced** | Polite, once, through a region mounted empty at `idle` — **the reliable channel** | `role="status"` on web only, and **unreliable** because it mounts populated; none on native (§22) |
| **Control**   | `syncFailed`'s _Try again_ only                                                   | None, ever (constraint 1)                                                                         |

Three consequences, each doing work:

**17a. The slot is self-sufficient, because the banner is not guaranteed to be on screen.** Part I §7 rules the
web banner **static, not sticky** — it scrolls away. A cook deep in a list who scrolls sees the slot alone. So
the slot names its own cause ("Waiting for a connection") rather than deferring to a banner that may be a
screen above. ⛔ It does **not** follow that the slot may restate the banner's sentence: naming a cause and
asserting the device's state are different claims.

**17b. The forms diverge on purpose, and that is what stops two notices reading as two alarms.** The banner is
chrome; the slot is a placeholder. A cook offline on Home sees one bordered, accented banner at the top and one
quiet grey line where the widget would be — a hierarchy, not a duplicate. This is also what makes the slot
**safe to repeat**: `HomeWidgetSurface` renders one slot per curated widget and the architecture admits N live
widgets, so two parked boundaries on one screen would print the same line twice. Two quiet placeholders is a
tolerable outcome; two accented banners would not be. ⚠️ Today N is 1 — the recipe widget is the only live
widget, and the roadmap placeholders use a plain `Suspense` with no `QueryBoundary`, so `PendingSlot` never
decorates them. ⚠️ **Flip condition:** if a second live widget ships, re-check this on a real screen before
shipping it; the copy needs no change, the judgement does.

**17c. ⚠️ Recommendation, not a blocker — `offline` must outrank `syncFailed` while the device is offline.**
Part I §4 orders precedence `syncConflict › syncFailed › syncing › offline`. That ordering was chosen without
this surface in view, and it produces one incoherent screen: a cook with no connection reads _"Try again"_ in
the banner beside a line that says this loads on its own and needs nothing from them. **The button cannot
succeed** — a drain needs the network the device does not have — so it is a control that spends the cook's
attention on a certainty of failure.

**Minimal amendment:** while `onlineManager.isOnline()` is `false`, `offline` outranks `syncFailed`. Nothing is
lost — Part I §3's per-item marks still carry each failed recipe's identity, which is the tier that was always
meant to carry it. This is a one-line change to the caller's derivation, not a redesign, and it is **Situation
B**: both orderings are defensible in isolation and only the composition decides it. _I recommend it; I am not
blocking on it._

---

## 18. ⛔ Replace or augment — REPLACE, and the skeleton does not stay behind it

`renderOffline` receives the pending node precisely so this is a choice. It is **discarded**, and this section
is the reason, so that nobody later "fixes" the unused parameter by rendering it.

**The decisive fact: the pending node makes a claim that is false here, and the seam cannot reach inside to
correct it.** `RecipeCardGridSkeleton` renders `role="status"` captioned with the **visible, localized string
`'Loading recipes'`** (`RecipeCardGridSkeleton.tsx:54-55`; `features/recipes/src/messages.ts:575`). It is not
loading. It is parked, and it will stay parked until the device has a network. Augmenting therefore produces,
in one region:

- two visible statements, one of them untrue — _"Loading recipes"_ directly above _"Waiting for a connection"_;
- two `role="status"` regions nested in one content area, the outer one speaking the false claim;
- and, on web, `animate-pulse` running **for the duration of the outage** beside a text message. On its own the
  skeleton is fine — it _is_ the content, and a loading indicator is exempt. The moment a message is presented
  in parallel with it, this becomes exactly the case Part I §8 already ruled on from `PendingBar`: _"a moving
  bar beside usable content is not covered by the loading exemption"_ (SC 2.2.2). ⛔ **This is an exposure that
  augmenting would create, not a defect in the skeleton** — the skeleton as it ships today is correct.

None of the three is fixable from outside: `RenderOffline` hands over an opaque `ReactNode`. Wrapping it in
`aria-hidden` would silence the false claim and leave it **visible**, which is the worse half.

**Accepted costs, stated:**

1. **The layout reservation is lost.** The message is shorter than the skeleton it replaces, so the region
   shrinks now and grows when content arrives. ⚠️ Not a new class of shift — three skeleton cards already give
   way to a full grid — and the alternative costs an untrue caption. Stated, not hidden.
2. **The leaf cannot name what is missing** ("your recipes", "this collection"), because one app-wide renderer
   serves every boundary. §21 records why widening the seam to pass a label is **not** recommended.

**The one thing that makes this better than the obvious version:** the message replaces a shimmer that was
promising imminence it could not deliver. A skeleton says _"any moment now"_; offline, that is a small lie the
cook re-reads every few seconds. Swapping it for one still line is the honest answer, and stillness is itself
the signal that this is a wait of a different kind.

---

## 19. The copy, and where it lives

### The string

**One key. Identical on web and mobile.**

```ts
// The whole of the offline-read surface. No title, no second line, no control.
readOffline: 'Waiting for a connection. This loads on its own.';
```

Typographic apostrophes are the house rule; this string happens to need none.

### Why these eight words

| Clause                           | Doing                                                                                                                  | Refusing                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| _"Waiting for a connection."_    | Frames it as **pending**, names the cause, and makes the slot self-sufficient when the banner has scrolled away (§17a) | _"You're offline"_ — the banner's sentence, and a stronger claim than the sensor supports (§5d)                        |
| _"This loads on its own."_       | **States** constraint 1 rather than implying it: no action is required, and none would help                            | _"Try again"_, _"Reload"_, _"Check your connection"_ — all of which ask the cook to do something the code already does |
| The full stop after _connection_ | Two short declaratives read at a glance in a kitchen, one-handed                                                       | One long sentence with a subordinate clause                                                                            |
| No title                         | Keeps the slot a placeholder, not a second banner (§17b)                                                               | Visual weight this state has not earned                                                                                |

⛔ **The word "offline" never appears in this string, and that is the no-echo rule made concrete.** Part I's
banner owns _"You're offline"_ and ends _"…syncs when you're back online."_ On mobile both surfaces are
guaranteed to be on screen together (the banner is a sibling above `RootNavigator`). A slot ending _"…when
you're back online"_ would put the same trailing clause on screen twice, which is precisely what constraint 2
forbids. **Rejected for that reason:** _"This will load as soon as you're back online."_

⚠️ **Rejected for length:** _"Waiting for a connection. This loads on its own as soon as there is one."_ The
second clause restates what the first already established; the shorter version says everything at a glance and
survives being printed twice on one screen.

✅ **§5d's ruling holds on this surface, and is slightly reinforced.** The copy makes no claim about
reachability. _"Waiting for a connection"_ is weaker than _"You're offline"_ — it describes what this region is
doing, not what the device's radio reports — so it stays true even in the associated-but-dead-wifi case the
sensor cannot see. Nothing hedges; the limitation belongs in the `props.ts` docstring, as in Part I.

### Where it lives — ⛔ this section CREATES the dictionary; the banner joins it later

**`offlineNoticeMessages: LocalizedMessages<OfflineNoticeMessages>`, at
`packages/apps/commise/features/core/src/offline/messages.ts`, with `readOffline` as its first and currently
only member.**

⛔ **The dependency runs this way round, not the other, and the direction is the decision.** Part I §6
specified this dictionary, but Part I is **blocked** on R1/R2 and may not ship. If this section said _"joins
the §6 dictionary,"_ an implementer reaching a blocked artefact would either hard-code a literal or open a
second file — and a second file is exactly the drift the one-dictionary rule exists to prevent. So: this
surface, whose mechanism already ships and is inert, **creates** the dictionary and the leaf directory. The
banner adds its keys and its leaf to both when R1/R2 resolve.

**Why `features/core` and not either app's `messages.ts`:** connectivity is app-shell knowledge, not recipe or
account knowledge, and `@commise/features-core` is the package both apps already depend on for app-shell
concerns (`appShell.ts`, `capabilities.ts`, `homeNavigation.ts`). Duplicating into
`web/src/i18n/messages.ts` and `mobile/src/i18n/messages.ts` would be two authoritative representations of one
sentence that says the same thing on both platforms by definition — Part I §6's ruling, unchanged.

⚠️ `features/core/package.json` gains `"@commise/i18n": "*"`. One line; it has no i18n dependency today.

⚠️ **Not needed here:** `fillTemplate` and `Intl.PluralRules`. This string interpolates nothing and pluralises
nothing, so Part I §6's _"move `fillTemplate` into `@commise/i18n`"_ note stays a **Part I** prerequisite and
does not block this surface.

---

## 20. Every state — honestly, there is one

Most rows below read _unchanged_ or _not this surface_. That is the deliverable: the trigger is narrow by
design, and a matrix would manufacture states the mechanism cannot produce.

| #   | Condition                                                     | What renders                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Announced                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Online, read pending                                          | **Unchanged** — the surface's own skeleton                                                                                                                                                                                                                                                                                                                                                                                                                        | Whatever the skeleton already does                                                                                                                                                                                |
| 2   | Offline, read **has cached data**                             | **Not this surface.** The read resolves from cache and never suspends; the banner is the only offline signal                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                 |
| 3   | **Offline, no cached data, read parks**                       | **THIS SURFACE** — `readOffline`, replacing the skeleton                                                                                                                                                                                                                                                                                                                                                                                                          | `role="status"` on **web** — kept from the node it replaces, and **unreliable because the region mounts populated**; **none on native**, at parity with its predecessor. The banner is the reliable channel (§22) |
| 4   | Mobile app **backgrounded** (`paused ∧ online`)               | **Unchanged** — skeleton. `focusManager` parks a perfectly online app and it self-heals on foreground (`pendingSlot.tsx:36-39`)                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                                                                                 |
| 5   | Reconnect while state 3 is showing                            | Node unmounts; content renders                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Silent on both platforms** (§22)                                                                                                                                                                                |
| 6   | Read **fails** (a real error)                                 | **Not this surface** — the error boundary's `renderError`. §11.0: _"the boundary owns failed"_                                                                                                                                                                                                                                                                                                                                                                    | The surface's own error path                                                                                                                                                                                      |
| 7   | Offline **and** a `React.lazy` chunk pending                  | **Not this surface at the one site read from source** — `RecipeWidgetSlot` wraps its chunk in an inner `Suspense` _inside_ the boundary (module doc), so `PendingSlot` never decorates it. ⚠️ **Not a general property:** `parked` is cache-wide (`pendingSlot.tsx:41-43`), so a chunk suspending **directly** under a `QueryBoundary` while any query is parked would print _"This loads on its own"_ — untrue of a chunk, which does not auto-retry. §23 item 7 | —                                                                                                                                                                                                                 |
| 8   | No `OfflineReadNoticeProvider` mounted (leaf test, storybook) | **Unchanged** — identity Null Object, the pre-existing skeleton. The compatibility guarantee, deliberately preserved                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                 |

⚠️ **One scope limit, checked rather than assumed.** On web, `ClientQueryBoundary` returns the bare `loading`
node — bypassing `QueryBoundary` and therefore `PendingSlot` — while `!hydrated && !prefetched`
(`ClientQueryBoundary.tsx:46-50`). `useIsHydrated` reads the **client** snapshot on the very first render of a
client-side navigation (`useIsHydrated.ts:28-31`), so that window is only the server render and the hydration
pass of a full document load. A full document load requires the network, and there is no service worker in this
tree — so the window is not reachable while offline. **Stated as a scope note, not a gap**, and it is the one
claim in this spec an implementer would otherwise have to take on faith.

⛔ **State 3 has no sub-states.** No count, no elapsed time, no "still waiting" escalation. A count would need a
query handle the fallback does not hold; a timer would add motion to a state whose stillness is the point.

---

## 21. The leaf, the mount, and two things a reader will otherwise get wrong

### The leaf

`OfflineReadNotice`, a presentational pair in the **banner's own directory** — so the no-echo rule (§17, §19)
lives in the shared `props.ts` docstring, in code, beside the strings it governs, rather than only in prose.

```
packages/apps/commise/ui/src/offlineNotice/props.ts                    ← created here
packages/apps/commise/ui/src/offlineNotice/OfflineReadNotice.tsx       ← web leaf
packages/apps/commise/ui/src/offlineNotice/OfflineReadNotice.native.tsx ← native leaf
packages/apps/commise/ui/src/offlineNotice/index.ts                    ← package export
```

⚠️ `ui/package.json` gains `"./offline-notice": "./src/offlineNotice/index.ts"` — the kebab-cased specifier
over the camelCase directory, matching every sibling (`"./refresh-notice"`, `"./live-region"`,
`"./pending-bar"`). ⛔ This is the **one** barrel the owner directive permits: the target of a `package.json`
`exports` entry, never an intra-package convenience.

```ts
/** The localized strings the offline-read notice renders; the design system carries no copy of its own. */
export interface OfflineReadNoticeLabels {
    /**
     * The whole of the notice.
     * ⛔ It must NOT restate the app-wide banner's sentence: both are on screen together on mobile, and a cook
     * must not read the same claim twice on one screen. The banner owns "You're offline"; this owns what THIS
     * region is doing. See docs/design/offlineNotice.md §17, §19.
     */
    readonly body: string;
}
```

⛔ **`role="status"` sits on the web leaf's padding WRAPPER, with the text as its child** — the predecessor's
shape (`RecipeCardGridSkeleton.tsx:54-55`), and the one that keeps the region's announced content equal to its
visible content. Not on the `<p>`.

Each leaf is a single text node — web `<p className="text-body-sm text-slate">`, native
`<Text style={{ fontSize: nativeTokens.fontSize.bodySm, color: palette.slate }}>` — inside a block with
vertical padding so it reads as a deliberate state rather than a stray sentence. The `RecipeWidgetEmptyState`
pair (`features/recipes/src/components/RecipeWidgetEmptyState{,.native}.tsx`) is the existing shape for exactly
this: one line of `text-body-sm text-slate` standing in for absent content.

⚠️ **The cheaper path, and why I am not taking it.** Two app-local components (one per app's provider) would
avoid four files in `@commise/ui`. Rejected: the styling would then exist twice and drift, and §14's
cross-platform lockstep wants one directory with two leaves. Four small files is the correct floor here, not
over-systematisation — and the directory is shared with the banner, so it is not a new directory at all.
⛔ No `'use client'` on either leaf, matching `RefreshNotice.tsx`; the provider that mounts them is already a
client module.

### The mount

`OfflineReadNoticeProvider` goes **immediately inside `QueryClientProvider`** in both apps, as
`offlineReadNotice.tsx:12-15` requires — _"has a query client" ⇒ "has offline copy"_, structurally, because a
silent default cannot report a boundary that escaped it.

| App    | File                                                | Position                                                     |
| ------ | --------------------------------------------------- | ------------------------------------------------------------ |
| Web    | `web/src/components/recipes/RecipeProviders.tsx:90` | Inside `QueryClientProvider`, around `RecipeServiceProvider` |
| Mobile | `mobile/src/providers/AppProviders.tsx:63`          | Inside `QueryClientProvider`, around `RecipeServiceGate`     |

`LocaleProvider` is above both (`layout.tsx:84`, `AppProviders.tsx:61`), so the leaf can resolve the dictionary.

### ⛔ Two things to get right

**1. The closure must not call a hook.** `renderOffline` is created at the composition root but **invoked at
the boundary**, deep in the tree. So it returns an element whose component reads the dictionary — never calls
`useMessages` itself:

```
✅  renderOffline={() => <OfflineReadNoticeText />}     // the component calls useMessages
⛔  renderOffline={() => { const m = useMessages(…); … }}  // a hook in a function React does not call as a component
```

**`OfflineReadNoticeText` is APP-SIDE** — one ~6-line component per app, beside the provider that mounts it
(`web/src/components/recipes/` and `mobile/src/providers/`). It resolves `offlineNoticeMessages` via
`useMessages` and renders the `@commise/ui` leaf with `labels={{ body: m.readOffline }}`. ⛔ Not
`features/core`: that package has no React dependency today (`ditox`, `zod`) and would gain one to hold six
lines, and the provider mount is app-side regardless. There is no drift risk, because neither the styling (in
`@commise/ui`) nor the string (in the one dictionary) lives in the wrapper.

**2. The `loading` argument is deliberately discarded.** `(_loading) => <OfflineReadNoticeText />`. §18 is the
reason, and the implementation owes a one-line comment pointing at it — otherwise the unused parameter reads
like an oversight and the next person "fixes" it by rendering the skeleton behind the message, which is the one
outcome §18 rules out.

⚠️ **Not recommended: widening `RenderOffline` to accept a label** so the copy could name what is missing
("Waiting for a connection. Your recipes load on their own."). It would push a new required argument onto
every `QueryBoundary` call site — 20+ across both apps — to buy a noun the cook can already see from context,
and it would let the copy drift per surface, which is the thing one dictionary exists to prevent. Recorded as
considered and declined, not overlooked.

---

## 22. Accessibility contract — WCAG 2.2 level AA

### The announcement ruling: no reliable channel HERE; the banner owns the announcement

**The discriminator is that this node mounts already populated.** `LiveRegion`'s own docstring states the
mechanism: _"Mount it BEFORE there is anything to say (empty `children`) … Android announces a CHANGE to a
region it already holds, and a region that mounts with its text is not reliably spoken there"_
(`LiveRegion.native.tsx:13-15`). The same is true of `role="status"` on web. A Suspense fallback cannot mount
empty and then fill: it mounts when the read parks, with its message, and unmounts when the read resolves.

**So no announcement channel is reliable _here_, and the banner is the one that is** — it is mounted empty at
`idle` by Part I §8 precisely so a later change speaks. The condition's announcement therefore belongs to the
banner: one event, one announcement, from the surface architecturally capable of making it.

⛔ **That does not license removing the channel this node replaces.** "Unreliable" is not "absent", and the
right response to an unreliable channel on a message that matters _more_ than the one it replaces is to keep
it and declare the uncertainty — not to delete it and depend on a surface that is blocked. Hence the split
below: web KEEPS, native DROPS, and each is judged against **its own** predecessor rather than against the
other platform.

**Dispositions against the node being replaced** — this is a change to an existing accessible surface, so each
platform owes a reason:

| Platform | Predecessor                                                                                    | Disposition                                 | Reason                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      | `role="status"` with its label as visible content (`RecipeCardGridSkeleton.tsx:54`)            | **KEPT** — the leaf carries `role="status"` | It is a **removal** otherwise, on a message that matters more than the one it replaces. It is free and non-interrupting (`status` is implicitly polite), and keeping it means this surface does not depend on the blocked banner for its only channel. ⚠️ Declared honestly: mounted populated ⇒ **announcement is not guaranteed**. The mechanism is preserved; the behaviour is AT-dependent (§23) |
| Native   | `accessibilityLabel` on a plain `View`, **no** live region (`RecipeListLoading.native.tsx:23`) | **DROPPED** — plain `<Text>`, read on swipe | **Parity-preserving, not a removal**: the predecessor had no live channel either. And native's only equivalent is `LiveRegion`'s iOS path — an _imperative announcement that interrupts_, fired per boundary mount, potentially more than once per screen (§17b). Interrupting a cook for a parked read they cannot act on spends the interruption budget on the wrong state                         |

**What a screen-reader user hears on swap-back: nothing, on both platforms.** The node unmounts and the content
renders — the same silence as every other Suspense resolution in the app today.

⚠️ **`useRecoverySignal` (`query/src/useRecoverySignal.ts`) is the existing mechanism for exactly this, and I
am declining to wire it.** Two reasons: it is per-boundary plumbing across 20+ call sites, and what it drives
is a **focus move**, which for an unbidden reconnect is a change of context the cook did not initiate — its own
defect, and worse than the silence. ⚠️ The real residual is that an outage lasts longer than a 300 ms skeleton,
so a screen-reader cursor is likelier to be resting inside this region when it swaps. That is a **duration**
problem, not a mechanism one, and nothing in the fallback's lifetime can fix it. Named, not hidden.

### Criteria checked

| SC                               | Level | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1.3** Status Messages        | AA    | The core criterion, and the honest answer is split: **web** keeps `role="status"` (mechanism preserved, announcement AT-dependent because the region mounts populated); **native** is silent, at parity with what it replaces; the **banner** is the reliable channel for the condition once it ships. ⚠️ If the banner never ships, a screen-reader user's only signal on native is swiping to the text — a stated gap, carried to §24 |
| **1.3.1** Info and Relationships | A     | The message is text. Nothing is conveyed by position or presentation                                                                                                                                                                                                                                                                                                                                                                    |
| **1.4.1** Use of Color           | A     | Nothing carries meaning by colour. There is **no icon and no tone accent** by design (§17b), so there is no non-text carrier to be redundant with                                                                                                                                                                                                                                                                                       |
| **1.4.3** Contrast (Minimum)     | AA    | **Measured, not assumed.** `slate` `#636E72` on `white` `#FFFFFF` = **5.24:1**; on `pearl` `#F5F5F5` = **4.81:1**. Both clear 4.5:1. ⛔ The token must be used **opaque** — `colors.ts:54` records that `text-slate/60` measures 2.41:1, where the token passes and the rendered pixel does not                                                                                                                                         |
| **1.4.4** Resize Text            | AA    | One prose block, no fixed height; wraps at 200%                                                                                                                                                                                                                                                                                                                                                                                         |
| **1.4.10** Reflow                | AA    | A wrapping paragraph with no fixed-width child ⇒ no horizontal page scroll at 320 CSS px. Verification owed (§23)                                                                                                                                                                                                                                                                                                                       |
| **1.4.12** Text Spacing          | AA    | No fixed-height container; increased line height and spacing reflow                                                                                                                                                                                                                                                                                                                                                                     |
| **2.1.1** Keyboard               | A     | Nothing focusable, so nothing to reach                                                                                                                                                                                                                                                                                                                                                                                                  |
| **2.2.2** Pause, Stop, Hide      | A     | **Discharged by §18's replace ruling.** The web skeleton's `animate-pulse` is exempt as a loading indicator while it _is_ the content; presenting a message in parallel with it for the duration of an outage is the case `PendingBar`'s ruling covers. Replacing removes the motion entirely, and the native skeleton was already motion-free                                                                                          |
| **2.4.3** Focus Order            | A     | Nothing in the node is focusable, so it can mount and unmount at any moment without orphaning focus. ⚠️ **This is a direct dividend of constraint 1** — a Retry button here would unmount on reconnect, mid-outage, with focus on it, which is the defect `RefreshNotice`'s own docstring exists to prevent                                                                                                                             |
| **3.2.2** On Input               | A     | Appearance is not triggered by input and changes no context                                                                                                                                                                                                                                                                                                                                                                             |
| **3.3.1** Error Identification   | A     | ⛔ **Deliberately not engaged.** This is not an error (§11.0), the copy carries no error framing, and treating it as one would be the mis-framing constraint 3 forbids                                                                                                                                                                                                                                                                  |

**Not applicable, stated:** 2.5.8 Target Size and 2.5.1 Pointer Gestures (no targets, no gestures), 2.5.7
Dragging (no drag), 1.4.11 Non-text Contrast (no non-text carrier — see 1.4.1), 1.4.13 Content on Hover (no
hover affordance), 2.4.11 Focus Not Obscured (nothing overlays).

---

## 23. Cross-platform translation, 320 px and safe areas

### §3.6 disposition — every element that differs

| Element                             | Web                                       | Mobile                                                       | Disposition                                                                                                             |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The string                          | `readOffline`                             | `readOffline` — **identical**                                | **kept.** It names no gesture, no affordance and no platform noun, so a divergence would be difference for its own sake |
| Text node                           | `<p className="text-body-sm text-slate">` | `<Text>` at `nativeTokens.fontSize.bodySm` / `palette.slate` | **kept** — the `RecipeWidgetEmptyState` pair's existing spelling                                                        |
| Announcement channel                | `role="status"`                           | none                                                         | **moved** (see §22's disposition table — each is judged against its own predecessor, not against the other platform)    |
| Skeleton behind the message         | none                                      | none                                                         | **dropped** on both (§18)                                                                                               |
| Title / icon / tone accent / border | none                                      | none                                                         | **dropped** on both (§17b) — this is the deliberate divergence from the banner, not an omission                         |
| Control                             | none                                      | none                                                         | **dropped** on both (constraint 1)                                                                                      |
| Safe-area insets                    | n/a                                       | **none added** — see below                                   | **dropped**, and that is the correct translation                                                                        |
| Hover / right-click / drag          | none                                      | n/a                                                          | **dropped** — the notice has no interactive affordance to give a touch equivalent to                                    |

**Primary action, re-decided per platform: there is none, on either.** Constraint 1 is a design ruling, not an
omission, and it means reach cannot be the deciding factor here. Recorded so a future reviewer does not read
the absence as a §3.6 step skipped.

### 320 CSS px

Reusing Part I §6's budget rather than starting a parallel one: content width at 320 px with the surrounding
surface's `px-4` is **288 px**, ≈ **40 characters per line** at `text-body-sm`. `readOffline` is **47
characters** ⇒ **2 lines**. Comfortably inside the budget that already accommodates `conflictBodyOther` at ~104
characters. ⚠️ The same caveat applies: production renders the `system-ui` fallback, not Inter, so the check is
owed against the fallback.

**Body prose, so wrapping is correct** — the owner's wrapping rule is scoped to control elements and to short
text where wrapping breaks layout, and this surface has no control at all.

### Mobile safe areas

⛔ **The leaf adds no insets, and that is the requirement, not a gap.** It renders where the skeleton rendered —
inside the composing screen's content region, which already pads `insets.top` itself
(`HomeScreen.tsx:36,43`, and the same pattern in `RecipesScreen`, `profile`, `AccountSettings`, `login`,
`signup`). ⛔ A leaf that called `useSafeAreaInsets()` would **double-pad**, because that hook returns _device_
insets, not remaining space — the identical trap Part I §7 documents for the banner, arriving from the opposite
direction. The design-system leaf must not import `react-native-safe-area-context` at all.

⚠️ **The one case that owes a check:** a screen whose `QueryBoundary` is its root with no surrounding padding
of its own. `RecipeListFrame.native.tsx:66-67` supplies `paddingHorizontal`/`paddingTop` outside the boundary,
and the boundary sits inside the frame — but that is one surface read from source, not all of them. §23's
verification list carries it.

### Verification owed

Nothing here has been rendered. These are the implementation's obligations, reported by name as run or not run:

1. **320 px reflow**, web and native, against the **`system-ui` fallback**.
2. **Every mobile surface that mounts a `QueryBoundary`** — confirm the offline node inherits the screen's
   padding and is not clipped by the status bar or the tab bar, on a notched device. ⚠️ A simulator without a
   top inset proves nothing here, exactly as in Part I §7.
3. **`role="status"` announcement on web** — NVDA, and VoiceOver on Safari — for a region that **mounts
   populated**. ⚠️ This is the check most likely to be skipped and the one whose result changes §22: if it is
   reliably silent, say so in the `props.ts` docstring rather than leaving a role that implies a promise.
4. **Swap-back behaviour** with a screen reader active: where the cursor lands when the region resolves.
5. **`slate` on the actual surface each boundary sits on.** §22 measures `white` (5.24:1) and `pearl`
   (4.81:1); a boundary over a gradient or a `GlassCard` is a different measurement.
6. **State 4** — background the mobile app mid-read while online and confirm the skeleton, not this copy.
7. **A `React.lazy` chunk suspending directly under a `QueryBoundary`** (§20 row 7). Enumerate the sites: any
   chunk not wrapped in its own inner `Suspense` will show copy that is untrue of it while any query is
   parked. ⚠️ If one exists, the fix is an inner `Suspense` at that site — **not** a change to `PendingSlot`,
   whose cache-wide reading is correct for the question it asks.

### Test tiers (`docs/CODING_STANDARDS.md` §7.1)

- **Component (vitest + RTL), both leaves** — the message renders, and `role="status"` is present on web and
  absent on native.
- **Component, `PendingSlot`** — `parked ∧ offline` renders the provided node; `parked ∧ online` renders the
  children (state 4); no provider renders the children (state 8). ⚠️ `pendingSlot.test.tsx` and
  `useIsOffline.test.tsx` already exist untracked in this tree; these rows extend them rather than duplicating.
- **Component, one real surface** — a `QueryBoundary` under an offline `onlineManager` with an empty cache, to
  prove the composition end to end rather than the slot in isolation.
- ⛔ **Not a deployed e2e test**, for Part I §11's reason: offline is device/browser-emulation-shaped, and a
  deployed suite skips when the PR's sandbox is not running. A skipped test proves nothing about this.

---

## 24. Evidence, questions and hand-off

### Evidence: verified · assumed · judgement

**Verified (read in this tree, anchored).** The trigger is `parked ∧ offline` (`pendingSlot.tsx:69`) and the
replacement is total. `RenderOffline`'s signature and its identity default (`offlineReadNotice.tsx:23-28`).
`ClientQueryBoundary` bypasses the slot only while `!hydrated && !prefetched` (`:46-50`), and `useIsHydrated`
reads the client snapshot on a client-side navigation's first render (`:28-31`). The web skeleton renders
`role="status"` captioned `'Loading recipes'` (`RecipeCardGridSkeleton.tsx:54`; `messages.ts:575`) and its
cells carry `animate-pulse` (`:59-61`); the native skeleton is motion-free with `accessibilityLabel` on a
`View` (`RecipeListLoading.native.tsx:5,23`). `LiveRegion` requires an empty mount
(`LiveRegion.native.tsx:13-15`). `LocaleProvider` sits above both query providers. `RefreshNotice.tsx` carries
no `'use client'`. Both apps already depend on `@commise/features-core`, which has no `@commise/i18n`
dependency. No offline/sync/connectivity copy key exists in either app. **Contrast measured:** `slate` on
`white` 5.24:1, on `pearl` 4.81:1.

**Assumed (stated, not checked).** ≈ 40 characters per line at `text-body-sm` / 288 px — inherited from Part I
§6, still not measured. That every mobile `QueryBoundary` sits inside a screen that already applies its own top
inset (verified for the recipe list; assumed for the rest — §23 item 2). That no service worker serves an
offline document on web.

**Informed prior (published mechanism, no local study).** A progress indicator that keeps animating past its
plausible completion window degrades trust in the indicator rather than communicating progress — the basis for
§18's _"stillness is itself the signal"_. Nielsen #1 (visibility of system status): a region that states its
condition and its recovery closes the gulf of evaluation that an indefinite skeleton leaves open. Both are
mechanisms, not evidence about this product's cooks.

**Judgement (mine, labelled).** Every word of the string, and the decision that it is one string rather than a
title plus body. The replace-not-augment ruling's weighting of an untrue caption above a lost layout
reservation. That the slot carries no icon, accent or border. That `role="status"` is kept on web and dropped
on native. That `useRecoverySignal` is not worth wiring. §17c's precedence amendment.

⛔ **No claim in this section is user evidence.** I cannot observe a cook. Nothing here has been tested with
one — including §17b's judgement that two quiet placeholders on one screen read acceptably, which is the claim
most worth testing if anyone ever can.

### Questions

**Blocking: none.** The mechanism ships, the seam is built, and every decision this surface needs is made
above. ⛔ It does **not** wait on Part I's R1/R2.

**Confirmations requested — decided; flag if wrong.**

1. **§17c's precedence amendment** (`offline` outranks `syncFailed` while offline). A one-line change to a
   caller that does not exist yet; cheapest to accept now, before the banner is built around the old order.
2. **`role="status"` on web** (§22). If §23's check finds it reliably silent, the honest move is to drop the
   role and say so, rather than keep a mechanism that implies a promise it does not keep.
3. **Silence on native** (§22). ⚠️ If Part I's banner is **cancelled** rather than delayed, a screen-reader
   user on native gets no announcement of the condition anywhere, and this ruling should be revisited — not by
   adding a `LiveRegion` here (it would fire per boundary mount), but by giving the banner's announcement half
   a home even if its write-reporting half cannot ship.

### Hand-off

1. **`fe-1`** — the four `ui/src/offlineNotice/` files, the `features/core` dictionary, the two provider
   mounts, and the test tiers in §23. The accessibility contract is **WCAG 2.2 AA**; confirm the implementer's
   stated floor matches before handing over. ⛔ §23's six verifications are theirs, discharged before the
   parity audit, each reported by name — a skipped check reported as done is worse than a stated gap.
2. **Owner** — confirmations 1–3.
3. **`staff-ux-engineer` (EVALUATE)** — after build: the §23 checks and a design-vs-implementation parity
   audit, against **both parts** of this document.

**State to carry forward.** The trigger is `parked ∧ offline`, never `paused` alone. The copy is **one string,
one key, both platforms**, and it is the sentence the banner must never echo — the banner owns _"You're
offline"_, this owns _"Waiting for a connection. This loads on its own."_ The skeleton is **replaced, not
augmented**, because the pending node captions itself `'Loading recipes'` and the seam cannot reach inside to
correct it. There is **no control and no live announcement here** — the automatic recovery is the reason for
the first and a populated mount is the reason for the second. This section **creates** the dictionary and the
leaf directory that Part I will later join.
