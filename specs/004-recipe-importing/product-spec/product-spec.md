# Product Specification: Recipe Importing (004)

**Source**: [spec.md](../spec.md). The spec holds every rule. This file states the product goal and the story map, and
cites the spec for each rule.

## Product goal

A cook brings a recipe they already have elsewhere into Commise from a link, a paste, a file or a
social post. The cook keeps a private copy in the source's own wording, with the source named. A recipe from someone
else reaches the public by one of two routes only:

- the **Commise-written version**, which Commise writes and the cook confirms (`FR-065`, `003B-FR-015` door one), or
- the cook's own rewrite in their own words, labelled **"Adapted by you"** (`003B-FR-015` door two, `016-FR-015i`).
  This route is not open for a paid-site recipe.

The cook's own recipes ("I wrote this") publish as the cook's own work.

## Principles

- **The import never invents a value.** A missing yield, time or cuisine holds the item until the cook gives it
  (`FR-015`, `FR-021`). An ingredient line that cannot be parsed is kept as written (`FR-020`).
- **The cook never reviews the extraction.** The cook makes only the choices that only the cook can make: where the
  recipe is from, Private, Public or Both, what to do about a recipe already held, and the food matches (`FR-064`).
- **One pipeline, one allowance.** Every channel goes through the same import pipeline and spends the same import
  allowance (`FR-064`, `FR-067`).
- **The source stays named.** The private copy shows the source author's name, and the source survives the page being
  deleted (`FR-010`, `FR-017`, `FR-066`).

## Who it is for

- **The collector.** Has recipes on blogs, in notes apps and in another recipe app. Wants them in one place without
  retyping. Served by link, paste and file import.
- **The social cook.** Finds recipes in short videos and posts. Served by the social import of `FR-009`.
- **The creator.** Imports recipes from their own site or account and wants them credited as their own. Served by
  statement 1a and the later ownership claim (`FR-014a`, `FR-055`).

## Plans and limits

- Every channel is open to Free and paid cooks. No import channel needs Pro (`FR-028`).
- Every import spends the one import allowance (`FR-067` has the numbers).
- A recipe kept private uses a private slot on Free. Pro has no limit (`FR-028` has the numbers).

## Story map

Each story is one cook outcome, with one example. "Gated" means that the story is specified and waits on the named
gate.

### Must have

| ID     | Story                                                                                     | Example                                                                                                                                                                                         | Spec                                         |
| ------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| US-401 | As a cook, I import a recipe from a web page link, so I do not retype it.                 | Sam pastes a blog link into Link. Sam's phone reads the page, Sam chooses Private, finishes the food matches and saves. The recipe keeps the blog's wording.                                    | `FR-008`, `FR-064`, `FR-066`                 |
| US-415 | As a cook, I paste a recipe page or plain text, so a recipe with no link still comes in.  | Ana pastes a recipe from a notes app. No device tier reads it, so the server AI fallback finds the title, ingredient lines and steps in Ana's own lines.                                        | `FR-052`, `FR-056`, `FR-057`, `FR-061`       |
| US-411 | As a cook, I import one file or a whole export from another app.                          | Lee uploads an export with 300 recipes. Each recipe becomes one item. Two fail with a reason, and the other 298 are saved.                                                                      | `FR-019`, `FR-026`, `FR-027`                 |
| US-410 | As a cook, I say where each recipe is from, and the label follows from what I say.        | Mia pastes a recipe from a cookbook and chooses "From a cookbook or magazine". She cites the book. Her copy stays private.                                                                      | `FR-014a`, `FR-011`, `FR-052`                |
| US-416 | As a cook, a source the app guesses is only a question to me.                             | The paste holds a web address. The app suggests it as the source. The item waits under "Needs your statement" until Jo confirms or clears it.                                                   | `FR-060`                                     |
| US-417 | As a cook, I choose Private, Public or Both at import.                                    | Ravi imports a free blog recipe and chooses Both. He keeps his private copy, and the public recipe is the Commise-written version.                                                              | `FR-065`, `FR-066`. Public is gated on 003B. |
| US-418 | As a cook, I publish my own rewrite of an imported recipe as "Adapted by you".            | Kim rewrites the steps in her own words. The rewrite passes the similarity check and review, and it goes public as "Adapted by you".                                                            | `003B-FR-015`, `FR-054`                      |
| US-407 | As a cook, a page I already hold does not pile up as copies.                              | Tom imports a page he imported last week as a private copy. He chooses Duplicate, Replace or Cancel. Had his only copy been public, he would see only "Import as a new copy" and Cancel.        | `FR-008`, `SC-005`                           |
| US-419 | As a cook, a bulk import skips recipes already in my library unless I ask for a new copy. | Lee's export holds 12 recipes whose web addresses are already in his library. Each shows "Already in your library" and is skipped. He switches one to a copy.                                   | `FR-068`                                     |
| US-408 | As a cook, I fill in what the source left out, and nothing is guessed for me.             | A page has no yield. The item is held as "needs servings" until Sam enters 4.                                                                                                                   | `FR-015`, `FR-020`, `FR-021`                 |
| US-409 | As a cook, a failed import tells me why and what to do next.                              | A page answers 404. Sam sees that the page cannot be reached and is offered the paste path. No recipe is saved.                                                                                 | `FR-016`, `FR-058`, `FR-059`, `FR-063`       |
| US-420 | As a cook, I know when my allowance or my private slots run out, and when they come back. | A Free cook imports a file past the day's allowance. The rest wait and resume after the time shown.                                                                                             | `FR-022`, `FR-067`, `FR-028`                 |
| US-403 | As a cook, I always see where an imported recipe came from, on web and on mobile.         | Sam's private copy names the blog's author. The Commise-written public version names and links the site, with "Not affiliated."                                                                 | `FR-010`, `FR-066`                           |
| US-413 | As a cook, my recipe stays when its source page is deleted.                               | The blog removes the page. Sam's recipe stays, and its source shows as unverifiable.                                                                                                            | `FR-017`                                     |
| US-421 | As a creator, I mark a recipe as mine, at import or later.                                | Dee imports from her own blog and chooses "This is my recipe, from my site or account". The label is "Written by you". A recipe saved earlier can claim it too.                                 | `FR-014a` (1a), `FR-055`                     |
| US-402 | As a cook, I import a recipe from a public TikTok, Instagram, YouTube or Facebook post.   | Ana shares a TikTok link. Her phone reads the public video briefly and keeps nothing. Her private copy names the creator. The Instagram official-API path waits on the Meta credential (D-002). | `FR-009`                                     |

### Must have, gated

| ID     | Story                                                   | Example                                                                                                  | Spec     | Gate  |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | ----- |
| US-422 | As a cook, my private copy keeps the page's main photo. | Sam's phone saves the blog's main photo to his private copy. A public version never uses a source photo. | `FR-008` | D-020 |

### Should have

| ID     | Story                                                                     | Example                                                                                      | Spec     |
| ------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| US-412 | As a cook, an import I never finish is cleaned up, so my list stays tidy. | An item held for servings is never completed. It is deleted 30 days after the last activity. | `FR-018` |

### Could have

| ID     | Story                                                                        | Example                                                                                          | Spec              | Gate                               |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------- |
| US-414 | As an admin, I add a paid site to the paid list without a deploy.            | An admin adds a domain. The next server fetch for that domain is skipped.                        | `FR-014`, `D-004` | None                               |
| US-423 | As a reader of a food blog, I tap "Save to Commise" and the recipe comes in. | Ana taps the button under a recipe card, signs in and taps Save. One import of that page starts. | `FR-053`          | D-019. P3 in spec.md User Story 2. |

### Withdrawn ids

| ID     | Was                                            | Now                                                                              |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| US-404 | Imported-public recipes are public by default. | Withdrawn. The cook chooses Private, Public or Both (US-417).                    |
| US-405 | Photo import as a private recipe.              | Moved to spec 011 (`FR-012`, D-001).                                             |
| US-406 | A paid-site page is refused.                   | Withdrawn. A paid-site recipe is kept privately and is never refused (`FR-014`). |

## Out of scope

- Photo and OCR import. Spec 011 owns it (`FR-012`).
- Rendering JavaScript-only pages. Such a page reads as "no recipe found" (spec edge cases).
- The rewrite itself and its checks. Spec 003B owns them.

## Cross-platform

Every story ships to web and mobile in the same release (`CODING_STANDARDS.md` §14). One recorded exception: web
HTML paste goes live before the mobile paste row, which waits for the AI fallback (`FR-062`).
