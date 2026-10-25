# Owner decisions for the UI overhaul (2026-10-08)

This file records the owner's rulings and the recommendations the owner approved. Where an earlier file in this
folder disagrees, this file wins. The build spec (`buildSpec.md`) follows it.

## Decided by the owner

- **Browser storage ruling overturned (owner, 2026-10-25).** The ruling of 2026-09-17 that the browser keeps no
  durable app data, and that persistence to disk is mobile-only, is overturned. D7, D18 and the recent-search entry
  below began as narrow exceptions to it. They now stand as decisions of their own, and storing other app data in the
  browser is open to a later decision.
- **Web offline start (owner, 2026-10-25).** Web gets the same offline start as mobile (`specs/019-offline-mode`). When
  it ships, the web editor draft and unsent saves move from `sessionStorage` to durable browser storage, which ends
  D7's tab lifetime.
- **D1, create and edit.** Create and edit use one scrolling editor page. The page has a section index and autosave.
  (Guided progress for a first recipe was part of this decision and was dropped on 2026-10-13, below.) A published recipe saves to the device until the cook presses "Save changes".
  The four-step wizard is retired.
- **D2, section index.** The owner's vertical box becomes `SectionIndex`, as `editorNavA.md` and `editorNavB.md`
  agree. It is a sticky rail at 960 px and wider. It is a one-row strip on tablets. On phones it is a one-line bar
  that opens a sheet. Section statuses follow the GOV.UK task list and come from the publish validator. A click
  scrolls to the section and moves focus to its heading. The scroll is instant under reduced motion.
- **D3, back to top.** The editor has no back-to-top control. Long web lists keep a labelled one after about four
  screens. On native, a second tap on the active tab and the iOS status-bar tap do this job.
- **D4, create entry.** The design is what `createEntryC.md` and `createEntryD.md` agree on. Phones and tablets get a
  labelled "New recipe" floating button on Home and Recipes only. On phones it shrinks to an icon on scroll. On the
  Collections tab it reads "New collection". Wide web puts "New recipe" first in the sidebar. With two methods, one
  tap opens the editor, and paste lives in the Ingredients section. After link or photo import ships, the button
  opens a chooser. The chooser leads with one paste box and never shows more than three choices.
- **D5, navigation breakpoint.** The sidebar replaces the tab bar at 840 px and wider.
- **D6, iPad.** The iPad keeps the bottom tab bar in both orientations (owner directive of 2026-07-18).
- **D7, web editor draft.** On web, the editor draft (ids and form values only) is kept in `sessionStorage`. It
  survives a reload in the same tab. Closing the tab ends it. It began as a narrow exception to the ruling
  of 2026-09-17, which is now overturned (above). It covers the editor draft and the editor's unsent saves
  (the outbox journal, ids and form values only), and nothing else (owner, 2026-10-09). Signing out clears both.
- **D9, draft versions.** Saves of a never-published draft overwrite it in place and create no version. Versions
  start at the first publish. This needs a new ADR that amends ADR-0034, written with slice 7.
- **D10, paste.** A cook can paste an ingredient list only while creating a recipe, which lasts until the recipe is
  first published. Autosave stores a draft on the server as soon as it has a title, so the gate is the first publish,
  not the first save (owner, 2026-10-09). A line pasted after that first save is stored without its source line. After
  the first publish, the editor offers no paste control, and ingredients are added one line at a time.
- **D8, Home cards.** Home uses compact cards below a 960 px content width and full recipe cards from 960 px. Phones
  get a compact 2 × 2 grid. Tablets (600 to 959 px) get one row of 4 compact cards. From 960 px, Home shows one row
  of exactly 4 full cards. The decision follows `homeCardsA.md` and `homeCardsB.md`, which agree.

- **D11, greys.** The greys become warm, from `modernizeB.md`: slate `#6B645C`, pewter `#8A847C`, and pearl becomes
  linen. Every contrast pair must still pass.
- **D12, glass.** Liquid Glass goes on the navigation and control layer only: the tab bar, the condensed title bar,
  the editor's action bar, the recipe page's jump bar, the photo's back and ⋯ buttons, menus and sheets. It never goes
  on cards, forms, ingredient rows, steps, nutrition, the snackbar or dialogs. iOS 26 uses real glass through
  `expo-glass-effect`. Android uses solid Material surfaces. Web blurs only small fixed bars, and each one stays
  readable with the blur off.
- **D13, New recipe button.** On iOS 26 it is seafoam-tinted real Liquid Glass with a semibold label. Apple says to
  tint only the primary action, and the system keeps the label legible. Android, web and older iOS use a solid seafoam
  button.
- **D14, iOS tab bar.** The app keeps its own tab bar, with a real glass view behind it on iOS 26. Native system tabs
  wait until React Navigation marks them stable.
- **D15, dark mode.** Dark mode is built inside the overhaul. Every slice builds and tests both themes. Every
  component reads colour from roles only, and a guard enforces it. The designers specify the dark values first.
- **D17, theme choice.** The app follows the device or browser appearance setting. There is no in-app theme switch
  for now.
- **D18, cook marks on web.** The recipe page keeps the ticked ingredients and the current step in `sessionStorage`,
  as recipe and line ids only. They survive a reload in the same tab. Closing the tab or signing out clears them. It
  began as a narrow exception to the ruling of 2026-09-17, after D7. That ruling is now overturned (above).
- **D19, user settings.** A user's app preferences are stored on the server, in a new identity `settings` table with
  its own wire contract, so they follow the user across devices (owner, 2026-10-10). The web "/" search-shortcut switch
  is the first setting. No preference is kept in browser storage. The recent-search exception of 2026-10-17 (below) is not a preference: it is a
  history, and it is recorded on its own.
- **D20, publishing with unmatched lines.** A cook may publish while some ingredients have no matched food. The section
  index and the publish step say how many lines have no match and that nutrition leaves them out (owner, 2026-10-10).
- **D21, ingredient row name.** A row shows the cook's own amount and unit, then the curated catalog food name, then the
  preparation ("1 large onion, finely chopped"). A count of one uses the food's singular form (owner, 2026-10-10).
- **D22, display name.** The identity service keeps filling in a new user's display name from their account. The cook
  can change it in Profile (owner, 2026-10-10).
- **D16, sandbox alarms.** Sandbox alarms stay off. A failed morning start is reported by the Sentry cron monitor.
- **D23, recent searches stay on the device, per user.** Discover's recent searches are kept on the device, on web and on
  mobile, keyed to the signed-in user and never to their email (the opaque identity-provider id the editor's device keys
  already use). They end with the session: our one sign-out command, account close and account erase remove them (and on
  web so does any other end of the session the app sees, as for D7 and D18). One user never sees another user's entries on
  the same device, and signed-out use keeps nothing on the device. The earlier unscoped list is not read again. On web they
  stay in `localStorage`, not `sessionStorage`; this began as a narrow exception to the ruling of 2026-09-17, which is now
  overturned (above), alongside D7 and D18, and it covers the search history only (owner, 2026-10-17). Where it
  lives in code: `recentSearchesKeyFor` and `endDeviceSession` in `@commise/features-recipes`.

## Adopted from the joint recommendations

The owner told the two designers to resolve their proposals. Where `resolutionA.md` §3 and `resolutionB.md` §3
agree, this file adopts their recommendation.

- The tabs are Home, Recipes and Discover. Recipes has two tabs, My recipes and Collections. Profile opens from the
  avatar. After they ship, Meal Plan and Shopping become tabs 4 and 5. Navigation shows no "Soon" items and no dead
  search or bell buttons.
- "Community" becomes "Discover". Profile, Settings and Account merge into one Profile page. The app deletes
  `/settings` and `/account` with no redirects, because nothing is live.
- Home shows recent recipes first, as a 2 × 2 photo grid on phones. The required placeholders come after them.
- The title limit is 120 characters. It is a soft limit and never cuts text silently.
- The last editor section is "Photos & publish". It holds visibility and Preview.
- "Clone" becomes "Save a copy" for recipes and collections. It stays on Discover cards as an icon.
- "Steps" replaces "Instructions" in en-US.
- The cook types the amount and a known unit in front of the food search. The food is always picked from a list.
  Healthy rows stay quiet. On phones the row editor opens as a sheet.
- The recipe page ships "Screen on", tap-to-check ingredients and the current step. These are the first slice of
  008 FR-035. The full cook view follows the overhaul.
- Sign-in offers email and password, plus Google. The brand line is "Your recipes, in one place.". A food photo
  panel shows at 1024 px and wider.
- A selected chip uses a tint with a check. Text inputs are rectangles. Only pressable controls are pills. Numbers
  use Inter with tabular digits. Coral leaves every control.
- The canvas wash stays (issue #145). A screen never changes behaviour for being offline, as the owner's offline
  directive says.
- The app has one signature motion: the overshoot on the check toggle. It respects reduced motion.

## Owner decisions of 2026-10-13

These come after the UI walk-through. Where an earlier line in this file or in `buildSpec.md` disagrees, these win.

1. **A private collection is a Premium feature.** A free-tier cook's new collection is public by default. "Make private"
   on a collection opens the Premium upsell. The server enforces it too: recipe-service refuses a private collection
   for a cook who is not premium, in a pure policy module (`collectionVisibilityPolicy`), not a route Guard.
2. **Recipes: "Make private" stays visible to everyone.** A free-tier tap opens the upsell sheet (B2 E1). The
   decision "may this cook go private?" is made in one place on each side, so the coming paid-features gate and roles
   can be added there: `privateNeedsPremium` and `useGatedPrivate` in `features/recipes`, and the policy modules in
   recipe-service.
3. **Save a copy creates a draft.** The copy is not published and not public until the cook makes a real edit and
   publishes. The server creates it with status `draft`. The cook lands in the editor on the copy.
4. **After a recipe is deleted, a "Recipe deleted" snackbar** shows on the screen the cook lands on, on both platforms.
5. **A description over 256 characters blocks Publish.** A counter shows near the limit (from 80%) and an error shows
   over it. The draft still saves.
6. **Web editor header before the first server save says "Saved in this tab".** Then the normal saved state.
7. **The recipe page shows no version number.** The versions page labels entries by date, with the number as a small
   secondary detail.
8. **Reads retry twice, with jitter.** TanStack's retry delay uses full jitter. This amends the D13 retry pin test
   (the old policy kept TanStack's default of three retries). Writes keep their own cap.
9. **Landscape phones get a compact tab bar.** When the window is shorter than 480 dp (on web: `max-height: 479px`
   below the 840 px sidebar breakpoint), the labels sit beside the icons and the bar is 48 dp (44 pt on iOS). On native
   it is hidden while the keyboard is open (`isFrameCollapsed`). The bar and the New recipe button pad the left and
   right safe-area insets, for a cutout and the 3-button navigation bar. The labels stay the accessible names.
10. **"Use ... as written" stays in the ingredient picker.** No change.
11. **Mobile Profile has no Email row.** The header already shows the email (commit a3e787f52, `evaluateFinal.md`). A
    test asserts the email shows once.
12. **The guided first-recipe editor mode is dropped, on both platforms.** The editor is the same for every cook. The
    index shows no hints, no "Start here" and no "{done} of 4 done".

## Owner decision of 2026-10-16

13. **Profile shows the username and the email once, in the header, on both apps.** The owner picked "Header only,
    like mobile". Web drops the read-only Username and Email rows under Account; the Account group holds the display
    name row alone. This amends decision 11 (which covered mobile only) and plan
    `docs/plans/2026-10-15-010-feat-username-byline-plan.md` D12 (the "web Account-group row").

## Owner decision of 2026-10-17

14. **Photo tiles get one ⋯ menu each, on both platforms.** One 44 pt (iOS and web) or 48 dp (Android) ⋯ button per
    tile opens a menu of Set as cover, Move earlier, Move later, Replace and, after a divider, Remove. This is
    `buildSpec.md` §7.7 (the `PhotoControl` and `ActionMenu` pair) plus one addition: **Replace** joins the §7.7 list
    by this ruling. It replaces the inline Remove pill, the cover radio and the Replace pill (parity audit G4,
    F1 to F3: about 21 to 24 pt). The first tile disables Move earlier and Set as cover; the last disables Move later.
    The cover is stated by the tile's "Cover" text and by the menu button's name ("Actions for photo 1, the cover").
    **Retry of a failed upload stays a visible `Button`** on the failed tile, not a menu item: it is the one recovery
    for that tile's state, so it is one tap at the design system's button size. Its Remove goes in the tile's menu.
    Reordering uses the existing `PATCH /api/v1/recipes/{id}/photos/reorder`, which takes the whole new order.
