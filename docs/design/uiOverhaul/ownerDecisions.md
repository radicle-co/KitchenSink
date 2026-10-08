# Owner decisions for the UI overhaul (2026-10-08)

This file records the owner's rulings and the recommendations the owner approved. Where an earlier file in this
folder disagrees, this file wins. The build spec (`buildSpec.md`) follows it.

## Decided by the owner

- **D1, create and edit.** Create and edit use one scrolling editor page. The page has a section index, autosave, and
  guided progress for a first recipe. A published recipe saves to the device until the cook presses "Save changes".
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
