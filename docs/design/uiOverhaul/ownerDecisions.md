# Owner decisions for the UI overhaul (2026-10-08)

This file records what the owner decided, and which recommendations were adopted with the owner's approval. Where
an earlier file in this folder disagrees, this file wins. The consolidated build spec (`buildSpec.md`) is derived
from it.

## Decided by the owner

| #   | Decision              | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Create and edit       | One scrolling editor page with a section index, autosave, and guided progress for a first recipe. A published recipe saves to the device until "Save changes". The four-step wizard is retired. Evidence: `editorResearch` notes in the conversation of 2026-10-08 (NN/g on wizards, Baymard on one-page checkout, Paprika and Mela).                                                                                                                                                             |
| D2  | Section index         | Keep the owner's vertical box as `SectionIndex`, as `editorNavA.md` and `editorNavB.md` agree: sticky rail at 960 px and wider, a one-row strip on tablets, a one-line bar that opens a sheet on phones; GOV.UK task-list statuses from the publish validator; a click scrolls to the section and moves focus to its heading; instant under reduced motion.                                                                                                                                       |
| D3  | Back to top           | Not in the editor. Kept only on long web lists (labelled, after about four screens). On native, re-tapping the active tab and the iOS status-bar tap do the job.                                                                                                                                                                                                                                                                                                                                  |
| D4  | Create entry          | As `createEntryC.md` and `createEntryD.md` agree: a labelled "New recipe" floating button on phones and tablets, on Home and Recipes only, shrinking to an icon on scroll on phones, and "New collection" on the Collections tab; "New recipe" first in the sidebar on wide web. With two methods, one tap opens the editor and paste lives in the Ingredients section. When link or photo import ships, the button opens a chooser that leads with one paste box, never more than three choices. |
| D5  | Navigation breakpoint | The sidebar replaces the tab bar at 840 px and wider.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | iPad                  | Keeps the bottom tab bar (owner directive of 2026-07-18), including landscape.                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Adopted from the joint recommendations (`resolutionA.md` §3, `resolutionB.md` §3)

The owner directed the two designers to resolve their proposals; where they agree, their recommendation is adopted.

- Tabs: Home, Recipes (My recipes, Collections), Discover. Profile opens from the avatar. Meal Plan and Shopping are reserved for tabs 4 and 5 and appear only when they ship. No "Soon" items in navigation, no dead search or bell buttons.
- "Community" is renamed "Discover". Profile, Settings and Account merge into one Profile page; `/settings` and `/account` are deleted with no redirects (nothing is live).
- Home: recent recipes first (a 2 × 2 photo grid on phones), then the required placeholders.
- Title limit 120 characters, a soft limit, never a silent cut.
- Step 4 becomes "Photos & publish", with visibility and Preview.
- "Clone" becomes "Save a copy", for recipes and collections; it stays on Discover cards as an icon.
- "Steps" replaces "Instructions" in en-US.
- Ingredient entry: the amount and a known unit are typed in front of the food search, and the food is always picked from a list. Quiet healthy rows; the row editor opens as a sheet on phones.
- "Screen on", tap-to-check ingredients and the current step ship with the recipe detail slice as the first slice of 008 FR-035. The full cook view follows the overhaul.
- Sign-in: email and password plus Google; the brand line "Your recipes, in one place."; a food photo panel at 1024 px and wider.
- Selected chips use a tint with a check; text inputs are rectangles and only pressable controls are pills; numbers use Inter with tabular digits; coral leaves every control.
- The canvas wash stays (issue #145). Screens never change behaviour for being offline (owner offline directive).
- One signature motion: the check-toggle overshoot, respecting reduced motion.
