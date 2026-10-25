# Feature Specification: Offline Mode

**Feature Branch**: `docs/offline-start-adr` (single-branch directive. The spec directory is `specs/019-offline-mode`.)
**Created**: 2026-10-25
**Status**: Draft
**Input**: User description: "turn ADR 69 into a specification for enabling offline mode"

## Overview

If the device has no network, Commise must still work. A cook can open the app, read their recipes, cook from them, and
make changes. When the network returns, the app syncs those changes. Only the cook needs to know they are offline:
the app does not ask them to do anything different.

Parts of this already ship. A running app that loses the network keeps working, changes wait on the device in an
outbox, and the app shows an offline notice. The part that does not ship is the offline start.
[ADR-0069](../../docs/architecture/decisions/0069-offline-cold-start-waits-for-clerk.md) records why: when the mobile
app starts with no network, it waits on "Checking your session…" until the network returns. A fix was built and
measured, and it opened the app offline. But after the network returned, the app stayed stuck in about 2 runs of 3:
no session, "Syncing 1 change…" and loading placeholders for at least 3 minutes. The owner rules that offline is a
pause. A change left syncing forever breaks that rule worse than the spinner did, so the fix was turned off.

This specification is for turning offline mode on in full. The offline start is its core, and the reliable reconnect
is the condition that lets it ship. ADR-0069 names three conditions for turning the offline start back on. They are
this feature's exit gate (SC-001 to SC-003).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Open the app with no network and cook from a saved recipe (Priority: P1)

A cook is in a kitchen with no signal, or in a shop with poor reception. The app was closed, or the phone restarted.
They open the app. It opens to their recipes, not to a waiting screen. They open a recipe they saved earlier and cook
from it: ingredients, steps, amounts, servings and their own notes are all there. A calm notice tells them they are
offline.

**Why this priority**: It is the gap ADR-0069 left open, and it is the moment offline matters most. A cook mid-recipe
who loses access loses their place and can ruin a dish (user need CK-005). Shoppers in stores with poor reception say
an app that will not open offline is useless to them (GL-019).

**Independent Test**: Sign in, open some recipes, close the app fully, turn off the network, and open the app again.
The cook reaches their recipes and can read a full recipe with no network at any point.

**Acceptance Scenarios**:

1. **Given** a signed-in cook who opened recipes before, **When** they open the closed app with no network,
   **Then** the app shows their recipes and an offline notice, and no screen waits on the network.
2. **Given** the app opened offline, **When** the cook opens a recipe available offline (FR-004), **Then** it shows
   in full, the same as online, apart from content that needs the network (FR-007).
3. **Given** the app opened offline, **When** the cook opens a recipe that is not available offline, **Then** the
   app says that this recipe needs the network and offers to go back, and it never shows an empty or broken recipe.
4. **Given** the phone restarted while offline, **When** the cook opens the app, **Then** the outcome is the same as
   scenario 1.

---

### User Story 2 - Changes made offline sync by themselves when the network returns (Priority: P1)

The cook edits a recipe, adds a note or saves a recipe to a collection while offline, including after an offline
start. Each change shows as saved on this device. When the network returns, the changes reach the server without the
cook doing anything, and the "not synced" marks go away.

**Why this priority**: This is the condition that makes User Story 1 safe to ship. A change that stays "Syncing"
forever after the network returns is the defect that blocked ADR-0069. Without a reliable reconnect, the offline start
must stay off.

**Independent Test**: With the network off, start the app, make a change, close and reopen the app, then turn the
network on. The change reaches the server within the time in SC-004, and the app shows it as synced.

**Acceptance Scenarios**:

1. **Given** a change made offline, **When** the network returns, **Then** the change syncs with no action by the
   cook, and its "not synced" mark goes away.
2. **Given** a change made offline, **When** the app is closed and reopened while still offline, **Then** the change
   is still there and still marked as not synced.
3. **Given** the app was started offline with changes waiting, **When** the network returns, **Then** the app
   restores the cook's session, finishes loading and syncs the waiting changes. It never stays on "Syncing", or on
   loading placeholders, while the network is up.
4. **Given** the network returns and drops again during a sync, **When** it returns a second time, **Then** sync
   resumes, and no change is lost or sent twice.

---

### User Story 3 - A conflict or rejection is shown on the item, and the cook's version is kept (Priority: P2)

The cook edited a recipe offline, and the same recipe changed elsewhere in the meantime, for example on their other
device. When the network returns, the app does not overwrite either version silently. It marks that recipe and lets
the cook choose which version to keep. If the server refuses a change for another reason, the app says so on that
item. The cook's version stays on the device until they decide.

**Why this priority**: Without it, an offline edit can disappear while the app said it was saved, which is the worst
outcome for trust. It comes after Stories 1 and 2 because a conflict needs two edits to the same recipe. That happens
less often than a single offline change.

**Independent Test**: Edit a recipe offline on one device and online on another, then reconnect the first device.
The app marks the recipe as in conflict, shows both versions, and keeps the offline version until the cook chooses.

**Acceptance Scenarios**:

1. **Given** a recipe changed both offline here and online elsewhere, **When** the network returns, **Then** the app
   marks the recipe as needing a choice, and neither version is lost.
2. **Given** a conflict, **When** the cook opens the recipe, **Then** they can keep their version, keep the other
   version, or keep the other version and copy their changes over by hand.
3. **Given** the server refuses an offline change (for example, the recipe was deleted elsewhere), **When** the
   network returns, **Then** the app explains this on that item, and the cook can save their version as a new recipe
   or discard it.

---

### User Story 4 - The cook always knows what is on the device and what is not synced (Priority: P2)

At any time, the cook can see whether they are offline and whether any of their changes have not reached the server
yet. When they are about to do something that needs the network, the app says so before they try.

**Why this priority**: The owner rules that only the cook needs to know they are offline. That knowledge must be
accurate. If work is at risk, a notice that says "saved" is worse than no notice.

**Independent Test**: Go offline, make two changes, and check that the app shows the offline state and a count of two
unsynced changes. Reconnect and check that both marks clear.

**Acceptance Scenarios**:

1. **Given** the device is offline, **When** the cook is on any screen, **Then** an offline notice is visible, and
   it does not block reading or editing.
2. **Given** unsynced changes exist, **When** the cook looks at the notice, **Then** it states how many changes wait
   to sync, and each changed item carries its own mark.
3. **Given** the device is offline, **When** the cook opens an action that needs the network (FR-007), **Then** the
   app says it needs the network before the cook starts it.

---

### User Story 5 - Signing out removes the cook's data from the device (Priority: P3)

A cook signs out on a shared or borrowed device. Their recipes, drafts and waiting changes must not stay on it for the
next person.

**Why this priority**: Offline mode stores personal data on the device. Removing it on sign-out is part of storing it
safely, but it affects fewer moments than Stories 1 to 4.

**Independent Test**: Sign in, use the app offline so data is stored, reconnect, sync, then sign out. Start the app
with no network: it shows the sign-in screen and none of the previous cook's data.

**Acceptance Scenarios**:

1. **Given** a cook with everything synced, **When** they sign out, **Then** the app removes their stored recipes,
   drafts and waiting changes from the device.
2. **Given** a cook with unsynced changes, **When** they try to sign out, **Then** the app warns that those changes
   will be lost and asks them to accept the loss or wait for sync.
3. **Given** the device is offline, **When** the cook tries to sign out, **Then** the app refuses with its existing
   message and keeps them signed in, because the app cannot prove that the sign-out happened (ADR-0068).

---

### Edge Cases

- **The session expired while the device was offline.** The app still opens offline with the cook's stored data. If
  the session cannot be renewed after the network returns, the app asks the cook to sign in again. It keeps their
  waiting changes on the device. If the same account signs in, it syncs them.
- **A different account signs in after a lapsed session.** The waiting changes of the first account are never sent
  under the second account. They stay on the device until the first account signs in, or until the first account's
  data is removed from the device.
- **The account was closed or erased elsewhere while this device was offline.** On reconnect, the session cannot be
  renewed, so the app shows the sign-in screen and removes the stored recipes at once (FR-025). The waiting changes go
  when another cook signs in or when the offline admission limit passes (FR-027).
- **The device is very low on storage.** The app stores each change first, and only then marks it as saved on the
  device. A change it cannot store gets an error on that change at once.
- **The stored data is from an older app version.** After an app update while offline, the app still opens and reads
  the stored data. If it cannot read the data, it says that it needs the network once to refresh. It never loses
  waiting changes in that step.
- **The network is up but the server is unreachable.** The app treats this like being offline: reading and editing
  keep working, and changes wait.
- **First run with no network.** A cook who has never signed in on this device sees the sign-in screen and a message
  that signing in needs the network. A browser that never loaded the app cannot open it offline at all, and shows its
  own offline page.
- **Many changes wait at once.** All of them sync on reconnect, in the order the cook made them, and the count in the
  notice goes down as they sync.

## Clarifications

### Session 2026-10-25

- Q: Must web reopen with no network after the tab or browser closed? → A: Yes (owner, 2026-10-25). Web gets the same
  offline start as mobile, and keeps unsynced changes after the tab or browser closes. The ruling of 2026-09-17 that
  kept app data out of the browser was overturned the same day.
- Q: Which recipes must open with no network? → A (owner, 2026-10-25, accepted for now): Summaries of the whole library, the full version of every recipe the
  cook wrote, and recently opened recipes within a storage budget (FR-004).
- Q: How does the app tell an erased account from an ended session? → A (planning decision): It cannot, because both look the same to the
  device. So FR-025 bounds what stays on the device by time and by a change of cook (FR-027).

## Open Question

### OQ-1: How the app opens offline (major, owner, open)

The app must open offline (FR-001, FR-002) without a lasting dependency on behavior the sign-in provider marks
experimental. Two ways exist, and the choice decides how SC-003 reads:

- **The provider's offline cache.** It needs no sign-in code of ours, but it is mobile-only and experimental. It is
  the path ADR-0069 measured getting stuck, and SC-003 must be met again on every provider upgrade.
- **Our own held state.** The app shows the cook's stored data until the provider loads, then hands back to it. It works
  on web and mobile alike, but it is code we own.

The owner does not want to build sign-in behavior ourselves. On 2026-10-25 the provider had published no plan to make
its cache stable, and no offline support for web at all. There are three options. The provider's cache on mobile with our held state on web
only. Our held state on both. Or an answer from the provider first. Plan research R1 holds the detail.
Build step 1 does not depend on this choice.

## Requirements _(mandatory)_

### Functional Requirements

**Offline start**

- **FR-001**: The app MUST open for a signed-in cook with no network and show their stored data, without waiting for
  the network to renew the session.
- **FR-002**: An offline start MUST be available on web and on mobile (iOS and Android).
- **FR-003**: On web, the app MUST open with no network in a browser that loaded it before, and changes made
  offline MUST survive closing the tab or the browser.

**Reading offline**

- **FR-004**: The app MUST keep on the device a summary of every recipe in the cook's library, the full
  version of every recipe the cook wrote, and the full version of recently opened recipes, within a storage budget
  the plan sets. If the budget is full, the oldest opened recipe leaves first.
- **FR-005**: An offline recipe MUST show everything the cook needs to cook it: title, ingredients with amounts and
  units, steps, servings and serving scaling, and the cook's own notes and photos.
- **FR-006**: When stored data is newer on the server, the app MUST refresh it when the network returns, without
  replacing an item that has an unsynced local change (FR-012).
- **FR-007**: Actions that need the network MUST say so while offline, before the cook starts them. These include
  search across the public catalog, food search, importing a recipe from a link, sharing, signing in, signing out, and
  account and payment settings.

**Changing offline**

- **FR-008**: The cook MUST be able to make, while offline, the changes they can make to their own recipes and
  collections online: create, edit, delete, and add to or remove from a collection.
- **FR-009**: Each change made offline MUST be saved on the device at once, and MUST survive the app being closed, the
  device restarting, and an app update.
- **FR-010**: The app MUST show a change made offline as saved on this device and not yet synced, on the changed item.

**Reconnecting and syncing**

- **FR-011**: When the network returns, the app MUST restore the cook's session, finish loading, and send all waiting
  changes, with no action by the cook. This MUST hold after an offline start as well as for a running app.
- **FR-012**: While a change to an item waits to sync, every view of that item MUST show the local version. A
  background refresh MUST NOT replace it.
- **FR-013**: If the network drops during a sync, or the app closes mid-sync, each waiting change MUST still reach the
  server exactly once.
- **FR-014**: Waiting changes MUST be sent in the order the cook made them.
- **FR-015**: A change MUST stay on the device until the server acknowledges it or the cook discards it.
- **FR-016**: When the server reports a conflict, the app MUST mark the item, keep both versions, and let the cook
  choose (User Story 3). It MUST NOT resolve a conflict silently.
- **FR-017**: When the server refuses a change for any other reason, the app MUST show the reason on the item, keep
  the cook's version, and offer to save it as a new recipe or discard it.
- **FR-018**: If sync cannot complete while the network is up, the app MUST show an error with a way to retry within
  the time in SC-004. It MUST NOT stay on "Syncing" indefinitely.
- **FR-019**: Waiting changes MUST be sent only under the account that made them.

**Status and notices**

- **FR-020**: The app MUST show an offline notice on every screen while offline, without blocking reading or editing.
- **FR-021**: The app MUST show how many changes wait to sync, and mark each waiting item.
- **FR-022**: All offline copy MUST be localized and MUST follow the committed design in
  [`docs/design/offlineNotice.md`](../../docs/design/offlineNotice.md).

**Data on the device**

- **FR-023**: Signing out MUST remove the account's stored recipes, drafts and waiting changes from the device.
- **FR-024**: Signing out with unsynced changes MUST warn the cook and ask them to accept the loss or wait.
- **FR-025**: If the app cannot renew the cook's session after reconnecting, it MUST remove their stored recipes
  at once. It MUST keep their waiting changes so the same cook can sign in and send them. It MUST remove those changes
  when another cook signs in on the device, or when the offline admission limit (FR-027) passes.
- **FR-026**: Offline mode MUST be available to every cook, with no paid tier.
- **FR-027**: The app MUST NOT open offline for a cook whose last successful sign-in on this device is older than the
  longest session the sign-in provider allows. That cook sees the sign-in screen and a message that signing in needs
  the network.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`. No `any` is used outside explicitly marked test doubles.
  (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Every offline notice, mark and choice MUST expose an accessible name queryable by role or label in
  Playwright and Maestro tests. (Principles IV and VII)
- **NFR-004**: Offline and unsynced states MUST NOT be shown by color alone. Each pairs with an icon or text.
  (Principle VII)
- **NFR-005**: Offline mode MUST ship to web and mobile in the same release. (Principle VIII)
- **NFR-006**: Changes to offline behavior MUST follow `docs/offline-strategy.md`, which this feature creates
  (GR-005 AC-005-d).

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: read and write. Reading covers the recipes in FR-004 and FR-005. Writing covers the changes in
  FR-008. Actions in FR-007 are not available offline.
- **Persistence layer**: the device's own storage: app storage on mobile, and the browser's durable storage on web. The plan names the
  exact storage and its format, and keeps the existing device-draft and outbox formats (ADR-0057).
- **Sync strategy**: when the network returns, the outbox sends waiting changes in order. Each stays on the device
  until the server acknowledges it (FR-013 to FR-015).
- **Conflict handling**: the server's version check detects a conflict. The app shows it on the item and the cook
  chooses. Nothing is overwritten silently (FR-016).

### Key Entities

- **Stored recipe**: a copy of a recipe kept on the device for offline reading, with the time it was last refreshed.
- **Waiting change**: one change the cook made that the server has not acknowledged. It holds the change, the account that
  made it, the version of the item it was made against, and its status: waiting, sending, needs a choice, or refused.
- **Device draft**: the cook's unsaved work in the editor, kept on the device (ADR-0057).
- **Cached session**: what the device keeps of the cook's sign-in so the app can open offline. It never grants access to
  the server without being renewed online.

## Success Criteria _(mandatory)_

### Measurable Outcomes

**Exit gate.** SC-001, SC-002 and SC-003 must all hold before the offline start (User Story 1) ships. These are
ADR-0069's three conditions, and the change that meets them amends that ADR.

- **SC-001**: The cause of the stuck reconnect measured in ADR-0069 is named, with evidence, before the offline start
  is turned on.
- **SC-002**: The test that starts the app offline, makes a change, restarts it offline and reconnects passes 10 runs
  in a row on each mobile platform and in the web browser. Each run uses a fresh device or browser profile, on the
  version that ships, and the change reaches the server in every run.
- **SC-003**: Before the offline start ships, the team makes sure that the sign-in capability it depends on is present and supported in the exact
  version that ships, read from that version's own source.
- **SC-004**: After the network returns, waiting changes reach the server within 30 seconds in 95% of reconnects, and
  never take longer than 2 minutes without an error and a retry option on screen.
- **SC-005**: A signed-in cook can open the app, on web or mobile, with no network and see a full recipe within 5 seconds of opening it,
  with no network request made at any point.
- **SC-006**: Zero offline changes are lost or applied twice across the full offline test suite, including network
  drops during sync and app closes mid-sync.
- **SC-007**: Every conflict and refusal in the test suite shows on its item, and in every case the cook's version stays
  available until they choose.
- **SC-008**: After sign-out, a device started with no network shows none of the previous cook's data.

## Assumptions

- **What ships today.** A running app that loses the network keeps working. The editor keeps a device draft and an
  outbox (ADR-0057), the offline notice exists, and sign-out refuses while offline (ADR-0068). This feature builds on
  them and keeps their formats.
- **What blocks the offline start today** is the sign-in gate, which waits for the sign-in provider to load from the
  network (ADR-0069). Turning on the provider's cached start opened the app offline but made the reconnect unreliable.
  The plan decides how to meet SC-001 to SC-003, whether by fixing that path or by another approach.
- **The sign-in provider's cached start is experimental** and can change in any release, which is why SC-003 reads it
  from the shipped version.
- **Offline mode is free.** No paid tier gates it (FR-026). ReciMe gates offline access behind its paid plan, which
  the competitive review counts against it.
- **Content that needs the network** stays unavailable offline: public catalog search, food search, link imports,
  sharing, and third-party images not stored on the device. Licensed images follow `016-FR-027e`: a placeholder offline,
  while the cook's own photos are available (017 FR-025).
- **Cooking mode (feature 008)** reads the same stored recipes. Its own session state follows its spec.
- **Household sharing (017)** is out of scope here. Its offline rules follow 017 and GR-005.
- **Grocery lists and meal plans (006, 007)** declare their own offline behavior under GR-005. This feature supplies
  the shared offline layer and `docs/offline-strategy.md` they build on.
- **Evidence grade.** The user needs cited (CK-005, GL-019) are desk research from reviews. GL-019 is only `reported`,
  from two apps.
