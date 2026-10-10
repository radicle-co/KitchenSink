# Create entry: where "New recipe" lives, and how a cook picks a method (designer D)

> **What this is:** a DESIGN-mode answer to one question. It covers where the control that starts a new
> recipe lives, what form it takes, and how the cook picks a creation method. It covers web at 320 / 390 /
> 768 / 1280 / 1920 px and native iOS and Android, phone and tablet.
> **What this is not:** production code, a spec of the editor, or a parity audit.
> **How it was made:** from the brief, the `ux-design-corpus` skill and public sources only. On purpose, I
> did not look at the app as it is today, its mockups, its specs or the other designer's file. So nothing
> here claims to match or differ from the shipped app.
> **Evidence status:** no user was observed. Every claim about behaviour is either a cited published
> source or labelled **judgement**.

---

## 1. The answer in one screen

| Surface                                                                | Placement                                                                     | Form                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Phone: web 320 / 390, iOS, Android                                     | Floating over the content, **bottom trailing corner, just above the tab bar** | Extended floating button, `＋ New recipe`. On scroll down, it shrinks to a 56-unit icon button. On scroll up, it grows back.  |
| Tablet: web 768, iPad, Android tablet, using the agreed bottom tab bar | The same bottom trailing corner, inset from the side edge                     | Extended button that **stays extended**. There is room, and a label beats an icon.                                            |
| Wide web: 1280 / 1920, the sidebar layout                              | **Top of the sidebar**, above the nav items, full sidebar width               | Primary button `＋ New recipe`. In a collapsed icon rail it becomes a `＋` icon button with a tooltip and an accessible name. |

**Choosing a method**

- **Today (2 methods):** one tap opens the **empty editor**. "Paste an ingredient list" lives **inside the
  editor**, in the Ingredients section's empty state. There is no chooser yet.
- **From the first import method onwards (3 or more):** the same tap opens the **"Add a recipe" chooser**:
    - a bottom sheet on phones
    - a dialog anchored to the button on tablet and desktop

    The chooser is a **dialog, never a menu**, on every platform. It leads with a paste box, and it never
    holds more than three choices, at any count from 3 to 5:
    1. **Paste a link or text** (the paste box). Accepts a web link, a social video link, or a pasted
       ingredient list, and detects which one it got.
    2. **From a photo or screenshot** (from method 4)
    3. **Start from scratch** (a secondary action at the bottom)

**Where it does NOT show:** Discover, recipe detail, the editor, Profile, and the future Meal Plan and
Shopping tabs, on phones and tablets. Each of those screens keeps the slot for its own primary action.
On wide web the sidebar button is global chrome (see §4).

**The one thing that makes this better than the obvious version:** five creation methods show up as
**three** choices, not five. A link, a video link and a pasted list are all _"I have some text"_. The app
can tell which one it got, so the cook never has to classify their own clipboard. The chooser therefore
does not grow as methods ship. It also never offers a link-import row and a video-import row that a cook
has to tell apart.

---

## 2. Standing and what was checked

- **Hat:** UI/visual designer and design technologist. DESIGN mode, one direction recommended, with the
  rejected alternatives in §8.
- **Governing decisions:** the brief's agreed navigation is taken as given:
    - bottom tab bar on phones and tablets, sidebar on wide web
    - Home, Recipes (My recipes | Collections) and Discover today. Meal Plan and Shopping come later.
    - Profile opens from the avatar
    - the editor is one scrolling page with autosave

    As instructed, I read nothing in the repo that can hold an earlier decision about create entry.
    ⚠️ So a governing decision can exist that this design has not seen. Check for one before adopting this.

- **Not rendered.** This answer reasons from platform documents. Visual sizes are given in platform units
  and were not measured on a screen.

---

## 3. First principles, three of them

1. **Creating is an action, not a place.** Apple's HIG says it directly: _"Use a tab bar to support
   navigation, not to provide actions."_ Material allows a navigation bar _"three to five destinations"_.
   Commise already has five planned (Home, Recipes, Discover, Meal Plan, Shopping). A create tab makes a
   sixth slot that neither platform allows. It also forces the "More" overflow tab that the HIG warns
   against. **This alone rules out the centre "+" tab.**
2. **Most sessions read. The control must be findable but must not compete with reading.** A floating
   button gives the main write action one fixed home that does not take space from the list. It is also
   reachable with the thumb. The corpus (`device-ergonomics`) says the bottom third of a phone is easy to
   reach. The top corners need a change of grip. It also calls _"a top-right primary action on a large phone"_ an
   ergonomic defect.
3. **No real choice, no chooser.** At two methods (scratch,
   or paste ingredients), pasting is really an **ingredients** action. It fits the Ingredients section of
   an editor that already exists. A chooser there only adds a tap to the common path. Imports (link,
   photo, video) are different. They fill the **whole** recipe (title, steps, photo), so they are a
   decision you make before the editor opens, and they need the chooser.
4. **The chooser is a dialog, not a menu.** The HIG's pull-down guidance asks for _"a minimum of three
   items"_ so a menu can _"feel worthwhile"_. It also says _"a view's primary actions need to be easily
   discoverable"_, so they do not belong hidden in a pull-down button. At method 3 the chooser holds only
   a paste box and "Start from scratch". As a menu, that is the two-item menu the HIG warns against. As a
   dialog that leads with a text box, it is a small form, and the count rule does not apply. A dialog is
   also the only form that can hold the paste box and the clipboard hint.

    ⚠️ **The platforms disagree here.** Material's FAB menu allows _"2–6 related actions"_, so Material
    accepts a two-item menu. I follow the stricter HIG rule. One dialog on every platform meets both.

---

## 4. Per-screen: who owns the floating slot

Material defines a FAB as _"the primary or the most common action on a screen"_. That means one per
screen, and the screen's own action. The slot is therefore **per screen, not global**. This table governs
the floating button on phones and tablets.

**Wide web is different, on purpose.** There the button sits in the sidebar. The sidebar is navigation
chrome on every screen, like Gmail's Compose or Drive's New. So on wide web it is **global**, including
Discover, recipe detail, the editor and Profile. It does not compete with Copy, because Copy sits in the
content area, not in the chrome. Leaving the editor through it is safe, because the editor autosaves.
Future Meal Plan and Shopping actions go in their own page headers on wide web, not in the sidebar.

| Screen                                    | Create control             | What holds the slot instead, and why                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**                                  | ✅ `New recipe`            | Recipes are the app's core thing, and Home is where most sessions start. Home keeps this permanently, even after Meal Plan ships. Meal-plan actions on Home live inline inside their own widgets.                                                                |
| **Recipes → My recipes**                  | ✅ `New recipe`            | This is the screen the button most belongs to.                                                                                                                                                                                                                   |
| **Recipes → Collections**                 | ✅ `New recipe`, unchanged | Switching sub-tabs does **not** turn the button into "New collection". A button that changes meaning on a sub-tab swipe sets up a mode error (judgement, Nielsen #4, consistency). `＋ New collection` is the **first tile** of the Collections grid instead.    |
| **Discover**                              | ❌ hidden                  | The write action here is _copy this recipe_, and it lives on the recipe. Two "make a recipe" meanings on one screen compete. When a Discover search finds nothing, the empty state carries an inline link, "Not here? Add your own", which opens the same entry. |
| **Recipe detail** (own or someone else's) | ❌ hidden                  | The slot belongs to the recipe's own actions: Cook, Edit, or Copy.                                                                                                                                                                                               |
| **Editor**                                | ❌ hidden                  | You are already creating. A second "new" risks leaving the current draft.                                                                                                                                                                                        |
| **Profile**                               | ❌ hidden                  | Settings surface. Nothing to create.                                                                                                                                                                                                                             |
| **Meal Plan** (future)                    | ❌ hidden                  | The slot is that tab's own primary action, for example "Add to plan".                                                                                                                                                                                            |
| **Shopping** (future)                     | ❌ hidden                  | The slot is that tab's own primary action, for example "Add item".                                                                                                                                                                                               |

**Transitions:** between two screens that share `New recipe`, the button does not animate. Between
screens with different actions, or to a screen with none, the button fades or scales out and the next
one comes in. With reduced motion on, it swaps instantly.

**The keyboard:** while any text field has the keyboard open, the floating button is **hidden**. Otherwise
an Android window that resizes for the keyboard floats the button over the field the cook is typing
in.

---

## 5. Per platform and size

### 5.1 Web 320 and 390 px (phone web)

- **Placement:** fixed to the bottom trailing corner, 16 px from the side, sitting above the tab bar. The
  bottom offset adds `env(safe-area-inset-bottom)`.
- **Form:** extended button `＋ New recipe`, about 140 px wide. That fits at 320 px with the tab bar
  under it, and nothing scrolls sideways (WCAG 1.4.10). Scrolling down shrinks it to the icon. Scrolling up
  or reaching the top grows it back.
- **List padding:** the list gets bottom padding equal to button height plus margin. Then the last card is
  never stuck under the button, and a focused card is never fully covered. Add `scroll-padding-bottom` for
  keyboard focus (WCAG 2.4.11).
- **Chooser (3 methods or more):** a bottom sheet. It is a modal dialog with a visible Close button, and
  tapping the backdrop also closes it. Swipe-to-dismiss is extra, never the only way out (WCAG 2.5.7).
- **No share sheet on web.** Mobile web cannot receive a share unless the app is an installed PWA with a
  share target, and browser support for that is partial. That makes the in-app **Paste a link** row the
  _main_ route on web for link and video imports.

### 5.2 Web 768 px

- **Assumption (⚠️ check against the agreed nav breakpoint):** the tab bar is used below 840 CSS px and
  the sidebar from 840 px up. 840 mirrors Android's medium/expanded boundary: medium is
  _"600dp ≤ width < 840dp"_ and covers _"93.73% of tablets in portrait"_. So 768 counts as a tablet in
  portrait and gets the tab bar.
- **The real rule does not depend on the number:** wherever the tab bar shows, use the floating button.
  Wherever the sidebar shows, use the sidebar button.
- **Form:** extended button that stays extended, inset 24 px from the trailing edge. The chooser is a
  popover anchored above the button, not a full-width sheet. A full-width sheet stretched across 768 px is
  the "stretched phone" failure the corpus names.

### 5.3 Web 1280 and 1920 px (sidebar)

- **Placement:** the first item in the sidebar, directly under the logo. It is a full-width primary button
  `＋ New recipe`, and it stays in view while content scrolls.
- **Prior art:** Google Drive puts **New** _"at the top left"_, and it opens a list of what to create.
  This design has the same position. Its chooser is a dialog rather than Drive's menu (§3, point 4).
- **Present on every screen** at this size, because the sidebar is global chrome (§4).
- **At 1920:** nothing moves. The sidebar width is fixed and the content column has a maximum width. The
  button does not grow with the viewport.
- **Collapsed sidebar (icon rail):** the button becomes a `＋` icon button at least 44×44 px. It has
  `aria-label="New recipe"` and a tooltip. The tooltip shows on hover **and** on keyboard focus. Escape
  dismisses it, and it stays while the pointer is over it (WCAG 1.4.13).
- **Chooser (3 methods or more):** a modal dialog anchored under the button. It leads with one large
  paste box and a Paste button. Below it are "From a photo or screenshot" (from method 4) and "Start from
  scratch". See §6.
- **Desktop extras (optional, not required):**
    - Dropping an image file anywhere on My recipes starts the photo import.
    - Ctrl/⌘+V on My recipes, with no field in focus, opens the paste dialog already filled in.
    - A keyboard shortcut is allowed in two forms only. One is a modifier combination that does not clash
      with the browser. The other is a single key (for example `n`) that the cook can turn off or remap
      (WCAG 2.1.4).

### 5.4 iOS phone

- **Decision: reach over convention.** The button floats at the bottom trailing corner, above the tab bar.
- **What this gives up:** the HIG's toolbar guidance puts the one primary action _"on the trailing side
  of the toolbar"_, and Paprika's iOS help puts its add control at _"the upper right corner of the recipes
  screen"_. A floating button is not a native iOS component, so cooks used to iOS lose a little
  familiarity. **I accept that cost.** The HIG has no rule _against_ a floating button. Its explicit
  prohibition is actions in the **tab bar**, which this design respects. The ergonomic case for the
  bottom corner on a 6.1" or larger phone is the corpus's thumb-zone rule.
- **Styling:** a tinted circular or capsule button, not a Material shape, so it reads as iOS.
- **Chooser:** a sheet with a medium detent and a grabber, plus an explicit Close button.
- **Clipboard:** on opening the chooser, the app checks `UIPasteboard.detectPatterns` for a link. Apple
  says this method _"only detects for the presence of patterns and does not read the contents of the
  pasteboard"_, so iOS shows no paste prompt. If a link is there, the Paste row shows a "Link on your
  clipboard" hint. The actual paste uses `UIPasteControl`. Apple documents it as the way _"to paste
  without a user prompt"_. The app never reads the clipboard by itself in code. Since iOS 16, that
  _"raises a user alert"_.
- **The share extension (adjacent, important):** for link and video imports, the cook's main door is the
  share sheet in Safari, Instagram or TikTok, not this button. ReciMe's Instagram and TikTok help articles
  describe import through the share sheet (_"tap Share to … Select ReciMe"_). I read only those
  articles, so ReciMe can have in-app routes too. Paprika ships a Safari share
  extension as well. A share must land in the **same** import flow the Paste row uses (§7), so there is
  one import flow, not two.

### 5.5 Android phone

- **Placement and form:** a Material 3 **extended FAB** at the bottom end corner, above the navigation
  bar. Material's doc shows `layout_gravity="bottom|end"`. The icon-only form is the standard 56 dp FAB.
  The extended FAB's documented `shrinkMotionSpec` and `extendMotionSpec` animate the collapse on scroll.
- **Chooser:** a modal bottom sheet. I chose it over Material's **FAB menu**, even though the FAB menu is
  allowed (_"2–6 related actions"_) and replaces the speed dial. See §8, alternative 4.
- **Share target:** an `ACTION_SEND` intent filter for text, URLs and images, routed to the same import
  flow as the Paste row.
- **RTL:** in right-to-left languages, the "end" corner mirrors to bottom-left automatically.

### 5.6 Tablets: iPad and Android tablet

- **⚠️ Raised once, then designed to the agreed nav.** The HIG text says that on iPadOS 18 and later
  _"the system displays a tab bar near the top of the screen"_, and that it can turn into a sidebar. The
  agreed nav puts a **bottom** tab bar on tablets, which is not the native iPad position. I design to the
  agreed nav and do not argue it further. Suppose the iPad later moves to the native top tab bar or
  sidebar. Then this button moves to the sidebar's top, the same as wide web (§5.3).
- **Placement:** the bottom trailing corner, inset 24 pt/dp, extended and labelled. On a tablet held in
  two hands the easy reach is the **lower side edges**, not the bottom centre (corpus,
  `device-ergonomics`). The trailing corner sits on that edge. Left-handed cooks get the mirrored corner
  only in RTL. That is an accepted gap, the same one every bottom-end FAB has.
- **Chooser:** a dialog anchored to the button, on iPad and Android tablets alike. It is never a
  full-width sheet.
- **Landscape and split view:** the button follows its own window's trailing edge, not the screen's.

---

## 6. The chooser, from 2 methods up to 5

| Methods shipped                           | Tapping `New recipe` does                                                                                     | What the cook sees                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 (today):** scratch, paste ingredients | Opens the **empty editor** right away. It creates no stored recipe until the first edit (see the note below). | The editor's Ingredients section, while empty, shows **"Paste a whole list"** next to "Add ingredient". Paste also stays usable after the recipe exists.               |
| **3:** + web link                         | Opens the **chooser**                                                                                         | The **paste box** (link or text), then **Start from scratch** as a secondary action. The in-editor paste stays. It is a small form, not a two-item menu (§3, point 4). |
| **4:** + photo / screenshot               | Chooser                                                                                                       | **Paste a link or text** · **From a photo or screenshot** · **Start from scratch**                                                                                     |
| **5:** + social video link                | Chooser, **unchanged**                                                                                        | Same three choices. The Paste row detects TikTok, Instagram or YouTube video links by domain and sends them to video import.                                           |

**Row details:**

- **Paste a link or text**
    - Has one multi-line field and a platform Paste button.
    - The detection rule (to specify later):
        - a single URL → web or video import, by host
        - several lines of text → parse as an ingredient list → open the editor with the rows filled in
        - anything else → open the editor with the text placed in Details, for the cook to sort
    - Hint under the label: "A recipe link, a video link, or an ingredient list".
- **From a photo or screenshot:** hands over to the platform picker (camera or library) on native, and to
  a file input with drag and drop on desktop web. No custom picker.
- **Start from scratch:** always the **last** row, in the same spot at every count. Order stays fixed:
  paste, photo, scratch. Moving rows around as methods ship undoes the learned position.

**Default and one-tap.** At 2 methods, the one tap is scratch, and paste sits inside it. From 3 methods
on, there is **no one-tap default**: the tap opens the chooser.

- The cost is one extra tap for scratch.
- I accept it because no method can be shown to dominate. Prior art leans toward import as the common
  path: ReciMe's and Paprika's help pages spend most of their pages on import routes. That is an
  **informed prior, not Commise data.**
- I **rejected** long-press on the button as a shortcut to scratch as the only path. A screen reader cannot
  find it, and the HIG warns that a gesture-revealed menu is hard to discover.

⚠️ **Behaviour flip at the third method.** With link import, the tap changes from "open editor" to "open
chooser". This is a two-way door: it adds a step and moves nothing. Note it in the release copy.

**Note for the editor spec (adjacent, not part of this question):** autosave must not create a stored
recipe until the cook enters something. If it does, every opened-then-abandoned "New recipe" leaves an
empty draft in My recipes.

---

## 7. States

| State                            | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First run / empty My recipes** | The empty state **is** the chooser, shown inline: large cards for each shipped method, headed "Add your first recipe", with one line on what each card does. The floating button still shows, so its position is learned from day one. This is where a new cook decides whether the app is for them.                                                                                                          |
| **Offline**                      | Scratch (and today's in-editor paste) stays available. Rows that need the network stay **visible** but cannot be used. Each shows its reason, "Needs a connection", in readable text. The row is not silently missing, because then the chooser layout jumps.                                                                                                                                                 |
| **Import running**               | Up to about 1 s: show a progress state in the sheet, then open the editor. Longer, as with video: the sheet closes. A placeholder card **"Importing…"** appears at the top of My recipes with Cancel. The cook can keep browsing. When it finishes, a message says "Recipe ready" with an Open link. (Latency budget from the agent brief, not looked up: past about 10 s, show progress and give a way out.) |
| **Import failed / partial**      | Open the editor with whatever came through. A banner says what is missing and offers "Paste the text instead". Never leave the cook in a dead end.                                                                                                                                                                                                                                                            |
| **Unsupported link**             | The Paste row explains it inline: "We cannot read recipes from this site yet. Paste the ingredient list instead." The pasted text is kept.                                                                                                                                                                                                                                                                    |
| **Keyboard open**                | The floating button is hidden (§4).                                                                                                                                                                                                                                                                                                                                                                           |
| **Overflow / i18n**              | Size the label for about 35% longer text. German "Neues Rezept" fits. If a label wraps at 320 px, the extended button shows the **icon only** and keeps the full accessible name. A button label never wraps or truncates, and the fix is never `nowrap`. Row labels in the chooser can wrap to 2 lines.                                                                                                      |

---

## 8. Alternatives rejected

1. **Centre "+" tab in the tab bar** (YouTube, Threads, and Instagram until it moved). Rejected:
    - The HIG says tab bars are _"for navigation, not to provide actions"_.
    - It makes a sixth slot once Meal Plan and Shopping ship, beyond Material's _"three to five"_.
    - Secondary sources report Instagram itself **moved** Create out of the centre of its tab bar to the
      top corner in its 2025–26 redesign, to give that slot to what people spend their time on. The
      reports disagree on dates (an Oct 2025 test, a Mar 2026 rollout), so this is **context, not
      a basis for the decision**.
2. **Top-trailing nav-bar "+"** (Paprika on iOS, and iOS convention). Rejected on phones: it is the
   top-corner reach defect. It is acceptable in spirit on desktop, where the sidebar top plays the same
   role and is the more prominent spot.
3. **Tap = scratch, long-press = method menu.** Rejected: a screen reader cannot find it, and the HIG says
   primary actions must not hide behind a menu that people must reveal.
4. **Material FAB menu (items fanning out from the FAB) on Android.** A legitimate native choice, and
   Material endorses it for 2–6 items. Rejected for this product:
    - The Paste row needs a text box and a clipboard hint, which a fan-out menu of buttons cannot hold.
    - The rows need one-line descriptions.
    - A sheet gives one structure on all three platforms.
5. **Split button on desktop, "New recipe | ▾".** Rejected: it makes scratch the main action. Once import
   is the common path, the main route becomes the small chevron.
6. **A row of buttons per method in the Recipes header.** Rejected: it grows to five, competes with the
   list, and goes against the "three, not five" collapse that makes this design work (Hick's law: decision
   time grows with the number of choices, corpus `human-factors`).
7. **Editor as hub** (always open a blank editor, offer imports inside it). Rejected for imports: an
   import fills the whole recipe, so offering it inside a half-typed draft raises an overwrite question.
   **Kept for paste-ingredients**, which is an Ingredients-section action anyway.
8. **A global create button on every screen** (Gmail-style). Rejected: it takes the slot that Meal Plan
   and Shopping need, and it competes with Copy on Discover and recipe detail.

---

## 9. Accessibility contract (WCAG 2.2 AA, plus platform rules)

**Target size** (the strictest rule that applies, per the corpus):

- the floating button is 56 dp/pt, extended height of at least 48
- the sidebar button is at least 44 px high
- chooser rows are at least 56 tall
- this satisfies Material 48 dp, HIG 44 pt and WCAG 2.5.8's 24 px

**Accessible name:** "New recipe" everywhere, never "plus" or "add".

- Visible label and accessible name match (WCAG 2.5.3).
- The icon-only form keeps the same name.
- Native: `accessibilityLabel` / `contentDescription`.

**Role and state (web):**

- **Today:** a plain `<button>` that opens the editor.
- **From 3 methods on:**
    - **Every size:** the button has `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`. The
      chooser is `role="dialog"` with `aria-modal="true"` and a heading "Add a recipe".
    - Enter or Space opens it. Tab moves between the paste box and the choices. Escape closes it and
      **returns focus to the button**.
    - It is **not** an ARIA menu. A menu cannot hold a text box, and arrow-key menu semantics fight
      the paste box.

**Focus:**

- Opening the chooser moves focus to the paste box. On touch, the keyboard does not open until the cook
  taps the box, so the other choices stay visible. Closing it returns focus to the button.
- The chooser traps focus while open, at every size.
- The focus ring meets 1.4.11's 3:1 contrast against both the button and the page.

**Focus Not Obscured (2.4.11):** bottom padding and scroll padding (§5.1) keep a focused row from being
_entirely_ hidden under the button or tab bar.

**Reading order:** screen readers reach the button **right after the screen heading**, not after a long
list.

- Web: put it early in the DOM and position it visually.
- Native: set the accessibility order to match.
- This keeps the order meaningful (1.3.2, 2.4.3) while the button sits visually at the bottom.

**Contrast:** the button container is at least 3:1 against the content behind it (1.4.11). The label
text is at least 4.5:1 against the container (1.4.3). Over photos, the button keeps a solid fill, never a
see-through glass layer with no fallback.

**Motion:** the shrink/grow and the sheet slide follow `prefers-reduced-motion` and the OS Reduce Motion
setting by switching to an instant change.

**Gestures:** swipe-to-dismiss always has a Close button and a backdrop tap as alternatives (2.5.7).

**Reflow and orientation:** no sideways scroll at 320 px (1.4.10). Works in both orientations (1.3.4).

**Announcements:** "Importing…" and "Recipe ready" use a polite live region on web and an
accessibility announcement on native (4.1.3).

---

## 10. How we will know it worked

- **Goal:** cooks who want to add a recipe start one quickly and finish it.
- **Signals and metrics:**
    - **create-start rate:** sessions that open "New recipe" or the chooser
    - **chooser completion:** opened, then a method chosen
    - **misfire rate:** opened and closed within 2 s without choosing
    - **method mix**
    - **abandon rate:** a draft opened but nothing entered
    - **time to first ingredient**
- **Guardrail:** Discover browse depth per session must not drop. The button is hidden there, but Home
  and Recipes changes can still shift attention.
- Every rate is reported with n and an interval.
- **A study that settles the open bets:** a 5-person think-aloud per platform on "save this recipe
  from a link" and "type in grandma's recipe" against the chooser prototype. It answers whether the
  smart Paste row is understood without the cook first sorting what they have. **Untested here.**

---

## Advocacy

- **The end user's interest and the brief match on placement.**
- **One quiet divergence, Situation B:** the brief lists five methods. Showing five equal choices is what
  a method list suggests, but it makes the cook classify their own input. Recommendation: at most three choices with
  detection, as above.
- **One raised conflict, Situation A-lite, raised once:** the agreed bottom tab bar on iPad is not the
  iPadOS position. I designed to the agreed nav.

## Evidence: verified · assumed · judgement

- **Verified (read today, 2026-10-08):**
    - HIG tab bars, toolbars and pull-down buttons (quoted)
    - Material Android docs for FAB, FAB menu, extended FAB, navigation bar, navigation rail and split button
    - Android window size classes
    - WAI-ARIA APG menu button (read, then not used: the chooser is a dialog)
    - Apple `UIPasteControl` / `detectPatterns`
    - Paprika iOS help, ReciMe Instagram import help, Google Drive upload help
- **Assumed:**
    - the 840 px nav breakpoint (§5.2)
    - that paste-ingredients can live in the editor's Ingredients section
    - that link detection by host is feasible
- **Judgement:**
    - not morphing the button between Recipes sub-tabs
    - Home keeping the button permanently
    - fixed row order
    - accepting a non-native floating button on iOS
    - collapsing to three choices

## References consulted

- **Corpus:** `ux-design-corpus` SKILL index, `device-ergonomics` (touch and reach, device classes),
  `cross-platform-translation` (translation table), `human-factors` (Hick, choice overload),
  `accessibility` (new AA criteria). I did not open `interaction-motion`. The 1 s and 10 s steps in §7
  come from the agent brief's latency budget.
- **Live sources** (fetched 2026-10-08). m3.material.io returned no content, so the Material quotes come
  from the `material-components-android` docs, which link to that spec. An NN/g FAB URL returned 404 and
  is not cited.:
    - Apple HIG: Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
    - Apple HIG: Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars
    - Apple HIG: Pull-down buttons: https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons
    - Material (Android): FAB: https://github.com/material-components/material-components-android/blob/master/docs/components/FloatingActionButton.md
    - Material: FAB menu: https://github.com/material-components/material-components-android/blob/master/docs/components/FloatingActionButtonMenu.md
    - Material: Extended FAB: https://github.com/material-components/material-components-android/blob/master/docs/components/ExtendedFloatingActionButton.md
    - Material: Bottom navigation ("three to five destinations"): https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md
    - Material: Navigation rail (FAB in header): https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md
    - Android window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
    - WAI-ARIA APG Menu Button: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
    - Apple UIPasteControl: https://developer.apple.com/documentation/uikit/uipastecontrol
    - Apple UIPasteboard detectPatterns: https://developer.apple.com/documentation/uikit/uipasteboard/detectpatterns(for:initemset:completionhandler:)-29iwn
    - Paprika iOS help: https://www.paprikaapp.com/help/ios/
    - ReciMe: Import from Instagram: https://recime.app/help/en/articles/11596425-import-from-instagram
    - Google Drive: upload: https://support.google.com/drive/answer/2424368
    - Instagram nav change (secondary, dates disagree): https://storrito.com/resources/what-instagrams-navigation-redesign-actually-changed/
    - Pibernik, Dolić, Miličević, Kanižaj (2019), "The Effects of the Floating Action Button on Quality of
      Experience", _Future Internet_ 11(7):148. **Abstract only was read.** It reports that the FAB did not
      improve usability over a toolbar but raised hedonic and aesthetic ratings. Its N and method were not
      read, so no decision here rests on it.

## Validation run (§6c)

- **Against publication:** HIG, Material and APG were quoted from the fetched text.
    - Changed as a result: the 2-method case moved from "chooser now" to "paste in the editor".
    - Changed as a result: the chooser became a dialog, not a menu, because of the HIG's minimum of three
      menu items.
    - Changed as a result: the sidebar button is stated as global chrome on wide web.
    - Changed as a result: I added the iPad top-tab-bar conflict.
- **Against prior art:** Paprika (top-right "+", plus a share extension), ReciMe (share-sheet import),
  Google Drive (a "New" menu at top left), Instagram (moved Create out of the tab bar).
    - Changed as a result: the share target is now named as the main door for link and video imports.
- **Adversarial:** _"A floating button on iOS is foreign, and Pibernik et al. found no usability gain from
  FABs, so a top-right '+' is the safer native choice."_
    - My answer: that study's gain was measured against a **toolbar**, not against a top-corner control on a
      large phone, and the reach cost of the top corner is documented.
    - I kept the floating button and listed the cost openly (§5.4).

## Artefacts written

- `/home/brandon/Development/KitchenSink/docs/design/uiOverhaul/createEntryD.md` (design artefact, §9).

## Questions blocking this

- None block it. Two open requests:
    - Check the web breakpoint where the tab bar becomes the sidebar (I assumed 840 px).
    - Check that the iPad stays on the bottom tab bar (agreed nav) rather than the iPadOS top tab bar.

## Hand-off

- **Next actor:** the requester, to compare this with the other designer's answer.
- **Then:** `staff-ux-engineer` SPECIFY for the chosen direction. That covers tokens, the bottom-padding
  rule in the shared list primitive, the copy keys and the detection rule.
- **Facts to carry forward:**
    - the slot is per screen
    - no chooser before 3 methods
    - the chooser is a dialog with at most three choices at 3 to 5 methods
    - the sidebar button is global on wide web, and the floating button is per screen
    - paste-ingredients lives in the editor
    - the share target feeds the same import flow
