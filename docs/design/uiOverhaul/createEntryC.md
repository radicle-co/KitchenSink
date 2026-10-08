# Create-recipe entry point: where it lives, what form it takes (proposal C)

> **What this is:** a DESIGN-mode recommendation, written from first principles and public sources.
> **What it is not:** a spec, and not production code. It was written **blind** on purpose: per the
> brief, nothing under `packages/apps/`, `.local-sandbox/`, `docs/mockups/`, `docs/design/`, `specs/` or
> `docs/competitive/` was opened. It can therefore clash with decisions already made there. Reconcile
> it with them before SPECIFY.
>
> Author: staff-ux-engineer, 2026-10-08. Fidelity: structure and placement (boxes and positions). The
> question it asks is **"is the place and the shape right?"** It does not ask about colour or exact
> sizing.

---

## 1. The answer in one screen

| Surface                                            | Where                                                                                         | Form                                                                                                                    | What a tap/click does                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phone, web 320–599 px, iPhone, Android compact** | Floating, **bottom-trailing**, above the tab bar. **Only on Home and Recipes › My recipes.**  | **Extended button with icon + "New recipe".** It shrinks to icon-only while scrolling down and grows back on scroll up. | **Today (2 methods):** opens the empty editor in one tap. **From the first whole-recipe import on:** opens a **bottom sheet** chooser.           |
| **Tablet, web 600–839 px, iPad, Android medium**   | Same corner, bottom-trailing. That spot sits at the lower side edge, where the hands grip.    | Extended button, **always labelled** (there is room).                                                                   | Same as phone, but the chooser is an **anchored popover**, not a full-width sheet.                                                               |
| **Wide web 840 / 1280 / 1920 px** (sidebar)        | **The first item in the sidebar**, above the navigation links. It is present on every screen. | Full-width filled button: icon + "New recipe".                                                                          | **Today:** opens the empty editor. **From the first whole-recipe import on:** opens a **modal dialog** with the same content as the phone sheet. |
| **Outside the app** (iOS, Android)                 | The **OS share sheet**: "Share → Commise" from Safari, Instagram, TikTok, Photos.             | System share extension (iOS) and share target (Android).                                                                | Opens the same import preview the in-app link and photo paths use.                                                                               |

**The one thing that makes this better than the obvious version.** The chooser is sorted by **what
the cook already has**. It is not sorted by which parser we run. A web link and a social-video link are both just _a
link_. An ingredient list and a whole pasted recipe are both just _text_. So five methods collapse into
**three choices**: _Paste a link or text_ · _Photo or screenshot_ · _Start from scratch_. The paste
field works out what it was given and says so on its main button ("Import from tiktok.com", "Add 12
ingredients"). The cook never has to classify their own clipboard. This is judgement, and the
principle behind it is Hick's Law: fewer, broader choices. The planned share-sheet entry carries the
rest, so the in-app control never grows past three rows.

---

## 2. Designing against (assumed context, nothing local was read)

- **Users.** Home cooks building a personal library. Most sessions are reading and browsing. Creating
  is rarer, but it is the most important write action. _Assumed from the brief._
- **Navigation (agreed, not mine to change).** Tab bar on phones and tablets. Sidebar on wide web.
  Tabs: Home · Recipes (My recipes | Collections) · Discover. Profile opens from the avatar. **Meal
  Plan and Shopping list will become tabs 4 and 5.**
- **Methods.** Today: scratch, and paste ingredients. Planned: web link, photo or screenshot, social
  video link. "Make a copy" lives on a recipe in Discover, not in this control.
- **Editor.** One scrolling page (Details, Ingredients, Steps, Photos & publish) with autosave and a
  section index.
- **Assumption I had to make:** the brief does not say where web switches from tab bar to sidebar. I
  use **840 px**, Material's "expanded" width class (developer.android.com, _window size classes_:
  compact < 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥ 1600). If the
  project uses another breakpoint, the rules below move with it.

---

## 3. The decisions and their reasons

### 3.1 Not a tab. A floating action on phones and tablets.

The tab bar is the obvious place for a "+" (Instagram puts one in the centre, and from memory,
unverified here, so do TikTok, Pinterest and YouTube). I reject it for three reasons:

1. **Platform rule.** Apple HIG, _Tab bars_: "Use a tab bar to support navigation, not to provide
   actions… If you need to provide controls that act on elements in the current view, use a toolbar
   instead." Material says the FAB is the home for "the primary or the most common action on a
   screen" (M3 FAB docs).
2. **The roadmap leaves no slot.** Meal Plan and Shopping make five destinations. A create tab is
   a sixth. HIG: "aim for a default list of five or fewer". NN/g (Budiu, 2015, _Basic Patterns for
   Mobile Navigation_): "If your site has more than 5 options, it's hard to fit them in a tab or
   navigation bar." A centre "+" also falls _between_ tabs 2 and 3, and that position changes
   every time a tab is added. ⚠️ **ONE-WAY DOOR**: tab positions are learned. Not spending the slot is
   the reversible choice.
3. **The counter-case, answered.** Instagram moved Compose out of the centre slot in November 2020
   (Reels took it) and put it back in February 2023 (TechCrunch / Tubefilter / MobileSyrup coverage).
   That was a **business lever** for an app whose economy runs on posting. It was not a usability
   finding. Commise is read-led. Its posting-led moment, "I just saw a recipe on TikTok", starts
   **outside** the app, and the share sheet serves that better than any tab (§3.5).

### 3.2 Bottom-trailing, on both phone platforms, on purpose

- **Reach.** The bottom third of a phone is the easy zone, and top corners need a change of grip. On
  devices over about 6.5", primary actions belong in the lower two-thirds (corpus,
  `device-ergonomics`). On tablets the reachable zone is the **lower side edges**, and bottom-trailing
  is exactly that.
- **iOS has no FAB, and this is a deliberate departure.** HIG, _Toolbars_: "You can place toolbar
  buttons in the top corners or along the bottom." Its own example puts Mail's compose "in a toolbar
  button at the top of the Inbox view". Paprika's help says "press the + button in the upper right
  hand corner of the recipes screen". I depart from top-trailing **for reach**, not for symmetry with
  Android. On iOS, draw it as a native floating glass button, not a Material-shaped FAB.
  _Judgement._ Flip condition: iOS users in testing fail to find a bottom button. Then move it to the
  top-trailing navigation-bar "+". That result means Jakob's Law beats Fitts's Law here.
- **Android.** The **extended FAB opens a modal bottom sheet**. It does _not_ open the M3 Expressive
  FAB menu. The M3 docs say the FAB menu "is not used with extended FABs". Its items are also plain
  buttons, and they cannot hold the paste field and preview that the chooser needs.
- ⚠️ **iPad conflict, raised once.** Since iPadOS 18 the system tab bar sits at the **top**
  (HIG _Toolbars_: "In iPadOS, a toolbar and a tab bar can coexist in the same horizontal space at
  the top of the view". HIG _Tab bars_ change log, 2024-08-06: guidance for the iPadOS 18 tab bar). The brief asks for a bottom bar on tablets. I design within the
  brief. If the team adopts the native iPad tab bar, the create button **stays** bottom-trailing. It
  does not follow the tabs to the top. Likewise, M3 offers a navigation rail with "FAB or Extended FAB
  (optional)" in its header for medium and wider widths. If the team adopts a rail on Android tablets,
  the button moves into that header slot.

### 3.3 Always labelled: "New recipe", never a bare "+"

- Recipes has a **Collections** sub-tab. There, a bare "+" reads as "new collection". So the control
  carries its noun. Corpus (`visual-systems`): "Icon-only controls need an accessible name and,
  usually, a visible label."
- **SC 2.5.3 Label in Name (A).** A visible "New recipe" gives voice-control users something to say.
  When it shrinks to icon-only on scroll, its accessible name stays "New recipe".
- On **Collections** this button is _replaced_ by that screen's own primary action, "New collection".
  The two are never stacked, so there is one floating action per screen.

### 3.4 One tap today, a chooser from the first whole-recipe import

HIG, _Pull-down buttons_: "listing a minimum of three items can help the interaction feel
worthwhile… If you need to list only one or two items, consider using alternative components." The
same page warns: "A view's primary actions need to be easily discoverable, so you don't want to hide
them in a pull-down button."

| Methods shipped                                                            | The control does                                                                                                                                                                     | Where the other methods live                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 (today)**: scratch, paste ingredients                                  | **One tap → empty editor**, focus on the title field.                                                                                                                                | The **empty Ingredients section** shows a "Paste a list" affordance. Pasting several lines splits them into rows. The empty **My recipes** state shows both options inline as two large rows. |
| **+ first whole-recipe import** (link **or** photo, whichever ships first) | **Tap → chooser.** Link first: _Paste a link or text_ (an input) · _Start from scratch_. Photo first: _Paste ingredients_ (an input) · _Photo or screenshot_ · _Start from scratch_. | Share sheet (§3.5).                                                                                                                                                                           |
| **+ the other whole-recipe import**                                        | Link: the paste field now also takes URLs (no new row). Photo: adds the _Photo or screenshot_ row.                                                                                   | Share sheet.                                                                                                                                                                                  |
| **+ social video link**                                                    | **No new row.** Same field. Detection routes it.                                                                                                                                     | Share sheet becomes the main path.                                                                                                                                                            |

Why the trigger is "the first whole-recipe import" and not "the third method": every import needs a
**source step and a preview** before the editor exists, so the chooser earns its step then, whatever
the shipping order. Once the chooser exists, _Paste ingredients_ moves into it (and stays in the empty
Ingredients section too). With every method shipped it has three rows: _Paste a link or text_ ·
_Photo or screenshot_ · _Start from scratch_.

- **Order is fixed and never personalised.** _Paste a link or text_ comes first, _Photo_ second,
  _Start from scratch_ last. Last is a memorable position (serial-position effect), and it keeps
  scratch stable as rows are added. I reject "remember the last method" because a control whose result
  changes from use to use is unpredictable. _Judgement._
- **Never show greyed "coming soon" methods.** They are noise and an implied promise.
- **Clipboard suggestion (optional extra).** When the clipboard holds a URL, the sheet opens with
  "Import from ‹site›?" at the top. Paprika already does this: it "detects the URL and asks if you want
  to add it". On iOS 16+ a programmatic paste raises a system prompt, so the _detection_ must use
  `UIPasteboard.detectPatterns` (Apple docs: it "does not read the contents… the system doesn't
  notify the user"), and the paste itself must go through a user-tapped paste control.
  ⚠️ _Unverified:_ whether Expo's clipboard module exposes pattern detection. If it does not, this
  needs a small native module, or the feature is skipped. On web, never read the clipboard
  unprompted. Offer a field plus a Paste button.
- **Flip condition.** The paste-ingredients path is used about as often as scratch today. In that
  case, ship the chooser now instead of waiting for the first import.

### 3.5 The entry point outside the screen: the share sheet

Every import method that is planned starts in _another_ app. Both apps I checked document the share
path as a first-class door. ReciMe: "Tap the Share button… Choose ReciMe from the list of apps".
Paprika: "press the Share button in Safari's toolbar… Tap the Paprika icon". Specify:

- **iOS:** a Share Extension that accepts URLs and images.
- **Android:** a share target (intent filter) that accepts `text/plain` URLs and `image/*`.
- **Web:** no equivalent to rely on. MDN marks `share_target` as "Limited availability… not
  Baseline", so web relies on the paste field.

All three land on **the same import preview** the in-app chooser uses: one preview, many doors. This
needs its own architecture pass, because a share extension is a separate native target in an Expo
build (§9).

### 3.6 Wide web: the top of the sidebar

At 840 px and wider, the control is the **first item in the sidebar**: a full-width button with icon +
"New recipe", above the nav links. Prior art, from memory and not fetched here: Gmail Compose, Google Drive "+ New", Notion "New page".
M3's navigation rail has a "FAB or Extended FAB" header slot for the same reason. Because the sidebar
is chrome, the button covers no content. So **it is present on every screen**, unlike the phone
button. That is consistency of _meaning_ (one predictable home), not of _arrangement_.

- **Today:** a click opens the empty editor.
- **From the first whole-recipe import:** a click opens a **modal dialog** (`aria-haspopup="dialog"`) with the same
  content as the phone sheet. Focus goes **into the paste field**. With a keyboard, Ctrl/⌘+V → Enter
  imports. I prefer a dialog to a menu. A menu adds a step (menu → dialog) for the most common
  path, and an input cannot live inside `role="menu"`.
- **Upload** accepts drag-and-drop of an image or URL onto the dialog. The file-picker button is the
  single-pointer alternative that SC 2.5.7 requires.
- **Keyboard shortcut (optional, later).** A single-key shortcut such as `n` falls under **SC 2.1.4
  Character Key Shortcuts (A)**. The user must be able to turn it off or remap it. The other option is
  that it works only while its component has focus. `Ctrl+N` belongs to the browser. Defer the shortcut until there is a
  settings surface that can satisfy 2.1.4.
- **At 1920 px** nothing changes. The sidebar keeps its width and the content column keeps its
  readable cap. The button does not grow with the viewport.

---

## 4. Per size, concretely

```
PHONE 320–599 (web) · iPhone · Android compact          TABLET 600–839 (web) · iPad · Android medium
┌───────────────────────────┐                          ┌──────────────────────────────────────────┐
│ My recipes          (av)  │                          │ My recipes                         (av)  │
│ [My recipes|Collections]  │                          │ [My recipes | Collections]               │
│ ┌───────┐ ┌───────┐       │                          │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│ │ card  │ │ card  │       │                          │ │card │ │card │ │card │ │card │          │
│ └───────┘ └───────┘       │                          │ └─────┘ └─────┘ └─────┘ └─────┘          │
│ ┌───────┐ ┌───────┐       │                          │  …                ┌────────────────────┐ │
│ │ card  │ │ card  │       │                          │                   │ Paste link or text │ │
│ └───────┘   ┌────────────┐│                          │                   │ Photo / screenshot │ │ ← popover
│             │+ New recipe││ ← 16 px from edge        │                   │ Start from scratch │ │   (all shipped)
│             └────────────┘│                          │                   └────────────────────┘ │
├───────────────────────────┤                          │                        ┌──────────────┐  │
│ Home  Recipes  Discover   │  tab bar                 │                        │ + New recipe │  │
└───────────────────────────┘                          ├────────────────────────┴──────────────┴──┤
                                                       │ Home      Recipes      Discover          │
 Chooser (all shipped) = bottom sheet:                  └──────────────────────────────────────────┘
 ┌───────────────────────────┐
 │ ─── New recipe        (×) │  ← title; grabber; close        WIDE WEB 840 / 1280 / 1920
 │ ┌───────────────────────┐ │                          ┌──────────────┬─────────────────────────┐
 │ │ Paste a link or text  │ │  [Paste]                 │ Commise      │ My recipes              │
 │ └───────────────────────┘ │                          │┌────────────┐│ [My recipes|Collections]│
 │  Import from tiktok.com → │  ← appears after paste   ││+ New recipe││ ┌────┐┌────┐┌────┐┌────┐ │
 │ ◻ Photo or screenshot   › │                          │└────────────┘│ │card││card││card││card│ │
 │ ✎ Start from scratch    › │                          │ Home         │ └────┘└────┘└────┘└────┘ │
 └───────────────────────────┘                          │ Recipes      │                         │
                                                        │ Discover     │                         │
                                                        └──────────────┴─────────────────────────┘
```

At **390 px** the button is identical to 320 px. At **320 px**, "+ New recipe" is about 140 px wide,
under half the viewport, so it stays extended at rest.

---

## 5. Where it must NOT appear, and what happens instead

| Screen                               | Floating button?                    | Why / what instead                                                                                                                                              |
| ------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                                 | **Yes**                             | It is the landing screen, and creating is the main write action.                                                                                                |
| Recipes › My recipes                 | **Yes**                             | New recipes land here.                                                                                                                                          |
| Recipes › Collections                | **Swapped** for "New collection"    | One floating action per screen. The label changes with the sub-tab.                                                                                             |
| Discover                             | No                                  | The job here is reading other people's recipes. A floating button covers cards. Copying happens on the recipe.                                                  |
| Recipe detail, editor                | No                                  | Each has its own primary action (cook, edit, publish). Autosave means a wide-web sidebar click from the editor loses nothing.                                   |
| Profile, settings, sign-in           | No                                  | Unrelated job.                                                                                                                                                  |
| Meal Plan, Shopping (future)         | No                                  | Each gets its own primary action ("Add to plan", "Add item"). The Meal Plan recipe picker can offer "New recipe" as its last row.                               |
| **My recipes, empty (first run)**    | **Hidden**                          | The empty state shows the methods **inline** as large rows with one line of reason ("Start with what you have"). Two identical controls on one screen is noise. |
| Search field focused / keyboard open | **Hidden** while the keyboard is up | It must not float over the keyboard or the results.                                                                                                             |
| Wide web sidebar                     | Always present                      | It is chrome, so it covers no content.                                                                                                                          |

**Moving between tabs:** the button animates out and in. With reduced motion it appears with no animation.

---

## 6. States of the control and the chooser

- **Default / pressed / focus-visible / hover (web)**: all four states are defined. Focus ring at 3:1
  against both the button and the content behind it.
- **Shrunk while scrolling** (phones): icon only, name unchanged. It grows back on scroll up or on
  focus.
- **Offline**: _Start from scratch_ stays enabled. Link and photo rows stay **visible and enabled**,
  and choosing one explains "Needs a connection. We kept what you pasted.". Rows are never
  silently hidden, and never shown as disabled with no reason.
- **Detection result**: a link becomes "Import from ‹site›". Multi-line text becomes "Add N
  ingredients" today and "Import recipe text" later. Unrecognised text becomes "Start a recipe with
  this text".
- **Import failed**: never throw away what was given. Open the editor with whatever was found, keep
  the source link, and say what is missing.
- **Gated method** (if a plan tier ever gates imports): show it with an honest label, never a fake
  one. Under DSA Art. 25 there must be no false urgency and no confirmshaming.

---

## 7. Accessibility (claimed against WCAG 2.2 AA)

| Criterion                             | Requirement here                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2.5.8 Target Size (AA)**            | WCAG's floor is 24×24 CSS px. The platforms are stricter. iOS 44×44 pt (HIG), Android 48×48 dp (Material). Build the button **56** tall on all three (M3 small extended FAB size) and chooser rows at ≥ 48 dp / 44 pt.                                                                                  |
| **2.5.3 Label in Name (A)**           | The accessible name is "New recipe" on every platform and in every state. On the wide web, never use an `aria-label` that differs from the visible text.                                                                                                                                                |
| **4.1.2 Name, Role, Value (A)**       | Web: a `<button>` with `aria-haspopup="dialog"` and `aria-expanded` once it opens a chooser. Native: `accessibilityRole="button"`, and, once it opens a chooser, the hint "Choose how to start" (iOS hint / Android state description). Today it is a plain button with no popup attribute and no hint. |
| **2.4.3 Focus Order (A)**             | Web phone layouts: put the button in the DOM **straight after the page heading**, not at the end of a long list. Native: same reading order.                                                                                                                                                            |
| **2.4.11 Focus Not Obscured (AA)**    | The floating button and tab bar cover the list. Reserve bottom padding equal to the tab bar + button height + margin. On web, also set `scroll-padding-bottom`. Then a focused last card is never hidden.                                                                                               |
| **Focus on open/close**               | Sheet, popover or dialog opens → focus moves to its title (phone) or the paste field (wide web), and is trapped. Esc, the close button, a scrim tap or the Android system Back closes it → focus **returns to the button**.                                                                             |
| **4.1.3 Status Messages (AA)**        | The detection result ("Import from tiktok.com") is announced politely.                                                                                                                                                                                                                                  |
| **1.4.11 Non-text Contrast (AA)**     | The button container ≥ 3:1 against content it floats over. Icon ≥ 3:1 against the container. Label text ≥ 4.5:1. Check it on photo-heavy cards in both themes.                                                                                                                                          |
| **1.4.10 Reflow / 1.4.4 Resize**      | No horizontal scroll at 320 px. If the label exceeds **50% of the viewport** (long translations, 200% text, iOS accessibility text sizes), show icon-only and keep the name. Never truncate or wrap the label.                                                                                          |
| **2.5.7 Dragging (AA)**               | Drag-and-drop upload always has the button alternative.                                                                                                                                                                                                                                                 |
| **2.1.4 Character Key Shortcuts (A)** | See §3.6. Only ship a shortcut that can be turned off or remapped.                                                                                                                                                                                                                                      |
| **Motion**                            | Sheet slide and button shrink both respect `prefers-reduced-motion` / Reduce Motion (cross-fade or instant).                                                                                                                                                                                            |
| **Screen-reader flow**                | VoiceOver/TalkBack on Home: heading → "New recipe, button" → content. In the sheet: "New recipe, dialog" → paste field → rows → Close.                                                                                                                                                                  |

---

## 8. Alternatives rejected

| Alternative                                               | Why rejected                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Centre "+" tab**                                        | HIG: tab bars are for navigation, not actions. It needs a 6th slot once Meal Plan and Shopping ship. Its position shifts as tabs are added (one-way door). Instagram's back-and-forth shows the slot is a business lever, not a usability rule (§3.1). |
| **Top-trailing "+" in the header** (Mail, Paprika)        | Hard to reach on large phones. Kept as the iOS fallback (§3.2 gives the test).                                                                                                                                                                         |
| **Tap = scratch, long-press = menu**                      | Hidden. HIG warns against hiding primary actions in a menu, and the corpus says long-press needs a hint. Screen-reader users need a custom action to find it at all.                                                                                   |
| **M3 FAB menu / speed dial**                              | Not used with extended FABs (M3 docs). Its items cannot hold a paste field. iOS has no equivalent. _Flip condition:_ the chooser becomes pure buttons. Then it is a valid Android-only choice.                                                         |
| **One row per method (5 rows)**                           | It makes the cook classify their own clipboard (is it a "web link" or a "social link"?). Hick's Law: going from 2 to 4 options costs more than the extra rows suggest. The merged field gets the same result with 3 rows.                              |
| **Show the button on every phone screen**                 | It covers content on Discover and the reading surfaces, and competes with each screen's own primary action. The corpus rule is one primary action per screen.                                                                                          |
| **Create surface on Home only** (a "Start a recipe" card) | Off-screen after one scroll, and missing from Recipes, where new recipes land.                                                                                                                                                                         |
| **Personalised default (last method used)**               | Unpredictable behaviour for a frequently used control (§3.4).                                                                                                                                                                                          |
| **Greyed "coming soon" rows**                             | Noise and an implied promise.                                                                                                                                                                                                                          |
| **Auto-reading the clipboard**                            | iOS 16+ shows a system prompt. On web it needs a permission. Detect only, and paste on tap (§3.4).                                                                                                                                                     |

---

## 9. Cost, measurement, hand-off

- **Cost.** _Today:_ one labelled floating button plus a sidebar button, both opening the editor, and
  an empty-state block. That is small. _At the first import:_ one chooser component in three presentations
  (sheet, popover, dialog) driven by **container width**, plus detection logic. That is medium.
  ⛔ Build the floating button, its shrink rule, its 50%-label rule and its bottom padding **into the
  shared design-system primitive**, not per screen. These are classes of defect, not one-off bugs.
  _Share extension:_ a large job, and a separate native target in Expo, so it needs its own
  architecture pass. **The 70% version:** ship the in-app paste field with link detection first, and
  the share extension second.
  _In-editor paste:_ the "one tap today" design depends on a "Paste a list" affordance in the empty
  Ingredients section. The brief says paste happens **before** the editor opens today, so this is a
  change to a shipped flow and new build work (small to medium). ⛔ **Without it, the one-tap design
  removes the paste method** for anyone who already has recipes (the empty state is gone for them).
  If it cannot be built, ship the chooser now instead.
- **Success measure.** Time from opening the app to the **first saved recipe** (median, with an
  interval and n), and the **method mix** of saved recipes. **Guardrail:** chooser-opened-then-
  dismissed in under 2 s with nothing chosen. A rise means accidental taps or a confusing chooser.
  A second guardrail is browse depth on Home and Recipes, to check the floating button is not
  covering content people read.
- **Hand-off.** Next comes SPECIFY by staff-ux-engineer, **after** reconciling with the existing specs
  this proposal deliberately did not read. Then staff-architect for the share extension, the share
  target and the clipboard module. A 5-person first-click test settles §3.2's iOS flip. Run it on
  phones (iOS and Android) with two tasks: "you just saw a recipe on TikTok, save it" and "type your
  gran's recipe".

---

## 10. Evidence: verified · assumed · judgement

- **Verified (fetched 2026-10-08).** Apple HIG _Tab bars_ (rev. 2026-06-08), _Toolbars_
  (rev. 2025-06-09), _Pull-down buttons_ (rev. 2022-09-14), _Menus_. M3 docs (material-components-
  android `docs/components/` FloatingActionButton, ExtendedFloatingActionButton,
  FloatingActionButtonMenu, NavigationRail). Android window size classes. WAI-ARIA APG Menu Button.
  MDN `share_target`. Apple `UIPasteboard.detectPatterns` / iOS 16 paste prompt (developer.apple.com,
  via search summary). NN/g _Basic Patterns for Mobile Navigation_ (Budiu, 2015). ReciMe help _Import
  from images_. Paprika iOS help.
- **Seen only through search summaries.** Instagram tab history (TechCrunch, Tubefilter, MobileSyrup,
  BGR). Mela's import methods (MacStories, Tools and Toys). Paprika's clipboard URL detection.
- **Recalled, not fetched.** TikTok, Pinterest and YouTube centre tabs. Gmail, Drive and Notion
  sidebar create buttons.
- **Assumed.** The 840 px sidebar breakpoint. That import methods will dominate creation once shipped
  (an informed prior from the import-centred design of ReciMe, Mela and Paprika, not measured for
  Commise).
- **⚠️ Confirmation needed.** That the editor's empty Ingredients section can take a multi-line paste
  and split it into rows. The one-tap-today design depends on it (§9 Cost).
- **Judgement.** Bottom-trailing on iOS. Fixed chooser order. Hiding the button on Discover. The 50%
  label rule. The dialog-over-menu choice on wide web.
- **Corpus consulted.** `device-ergonomics`, `cross-platform-translation`, `human-factors`,
  `accessibility`, `visual-systems` (icon labels, elevation, state matrix), `visual-design`
  (contrast). Gap: `design-process` was only skimmed, and `interaction-motion` was not loaded. The
  motion notes here are minimal.

**Validation run (§6c).** (1) Against publication: the HIG pull-down "three items" rule changed my
first draft, which opened a chooser today, into one tap today. (2) Against prior art: Paprika, ReciMe,
Mela and Instagram. (3) Adversarial: "creation is the key write action, so give it a tab like Instagram
and TikTok do." Answered in §3.1: the slot cost and the platform rule are concrete. The benefit is
a business lever this product does not need. _Flip condition:_ the roadmap drops tabs 4
and 5, **and** telemetry shows cooks hunting for create from Discover.

### Sources

- Apple HIG, Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Apple HIG, Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars
- Apple HIG, Pull-down buttons: https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons
- Apple, UIPasteboard detectPatterns: https://developer.apple.com/documentation/uikit/uipasteboard/detectpatterns(for:initemset:completionhandler:)-29iwn
- Material 3 component docs: https://github.com/material-components/material-components-android/tree/master/docs/components
- Android window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- WAI-ARIA APG Menu Button: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- MDN share_target: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
- NN/g, Basic Patterns for Mobile Navigation (2015): https://www.nngroup.com/articles/mobile-navigation-patterns/
- ReciMe help, Import from images: https://recime.app/help/en/articles/11625043-import-from-images
- Paprika iOS help: https://paprikaapp.com/help/ios
- Mela 2.5 (MacStories): https://www.macstories.net/reviews/mela-1-6-adds-web-search-engine-and-recipe-import-from-youtube-instagram-and-tiktok-videos/
- Instagram tab bar history: https://www.tubefilter.com/2020/11/12/instagram-reels-shop-tabs-permanent/ · https://bgr.com/tech/instagram-is-ripping-the-shop-tab-out-of-its-app/
