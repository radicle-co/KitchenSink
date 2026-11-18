# Recipe importing: where the design lives

This feature has no screen designs of its own. Build every import screen from the two design specs and the two canvases
below, in this order of authority: the design spec, then the boards.

## Design specs

- [Whole-page paste import](../../docs/design/pasteImport/spec.md): the paste screen, its refusals and errors, the
  review with its holds, duplicates and Replace, and success.
- [Public version at import](../../docs/design/publicVersion/spec.md): the choice between a private copy and a public
  version, the writing wait, the public review, the private-only reasons, the dead end with the Pro panel, and the age
  check.
- [Public version on recipe detail](../../docs/design/publicVersion/detailSpec.md): how recipe detail shows a public
  version and an import's private copy: the credit, hidden views, "Share a public version" and "Report a problem".

**Do not build the paste design spec's "Add a recipe" (§3.1) presentation.** A change in review replaces it. Build the
chooser rows only.

## Canvases

Both are registered in [`docs/design/canvases/registry.json`](../../docs/design/canvases/registry.json) with
`source: repo-canvas`. The boards are files in their folders.

- `recipeImportingWeb` (web, 1280, 1024, 768 and 390)
- `recipeImportingMobile` (iPhone 390, Android 384, iPad 820, 834 and 1194)
- `recipeDetailWeb` and `recipeDetailMobile`: recipe detail, including the public version and the private copy of an
  import
- `reportsRulesAndYourRightsWeb` and `reportsRulesAndYourRightsMobile`: "Report a problem" on a public version

## Channels

| Channel                               | Design                                                                                                  | Boards                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Paste (text or a whole web page)      | Paste design spec                                                                                       | `ImportPaste*`                                                                                                                      |
| Public version choice (every channel) | Public version design spec                                                                              | `ImportPublic*`                                                                                                                     |
| Link                                  | Partly designed. The server AI fallback for a link import has no states yet.                            | `ImportLinkProgress*`, `ImportImportFailed*`, `ImportLinkPasteInstead*`, `ImportLinkPrivateOnly*`, `ImportReviewDraft*`             |
| File and library (bulk)               | Designed                                                                                                | `ImportModeChoice*`, `ImportWizard*`, `ImportLibrary*`, `ImportLibraryAlreadyInLibrary*`, `ImportFlaggedLine*`, `ImportStatements*` |
| Shared link from a social app         | Gated only on the Instagram official-API path (D-002). Check the boards against FR-009 before building. | `ImportVideo*`, `ImportShareCapture*`                                                                                               |
| "Save to Commise" button              | No design yet (FR-053)                                                                                  | none                                                                                                                                |
| Photo                                 | Not this feature: spec 011 owns it.                                                                     | none                                                                                                                                |

## Owed designs

Each needs a design spec section and boards on both canvases before it is built:

- The on-device AI account setting (FR-064): label, help line, default per platform (on for mobile, off for web), and
  the on, off and unavailable states.
- Ownership claim at import and later (FR-014a item 4, FR-055): offered, in progress, verified, failed and declined.
- The paid-list admin screen (FR-014): designed with the server link fetch.
- The statement block's rows for statements 1a, 2 and 6 (`FR-014a`), and the bulk "Needs your statement" group. Until
  then the block offers only the paste design spec's §7.4 statements. The wording is confirmed before launch
  (`016-FR-050`).

## Rules that hold on every import screen

- Choose each surface by the [modal ruling](../../docs/design/modalUsage.md): a centred modal only when the task must block
  everything, such as a destructive confirm. The Replace confirm (paste design spec S31) and the confirms in the public version
  design spec stay centred modals.
- Save is never disabled. A missing value is a hold in "Needed before saving" (paste design spec D7).
- The cook never reviews the extraction. The review shows holds, the statement and the food matches.
- The chooser lists only methods that have shipped. Paste and link are separate methods, and a pasted link is never
  opened.
- A private copy shows the source page's main photo (gated, spec 004 D-020). The device fetches it and syncs it to the copy. If that fails,
  the photo is shown from the source page and never saved. If that fails too, a link to the page shows instead. The
  cook's own photo always comes first. A public version never uses a source photo. The states and copy are in the paste
  design spec ("Photo from the page").
