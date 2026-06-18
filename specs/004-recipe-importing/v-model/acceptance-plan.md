# Acceptance Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/requirements.md`

---

## Overview

This document defines the Acceptance Test Plan for the Recipe Importing feature. Acceptance tests verify that the system satisfies user-facing requirements from the perspective of a real user interacting with the product. Each test case maps directly to one or more requirements from `requirements.md` and is expressed as a BDD scenario (Given/When/Then) that a QA engineer or product owner can execute.

Coverage spans three import paths (web URL, Instagram, physical copy/OCR), attribution and visibility rules, deduplication, subscription gating, and accessibility constraints.

**Dependencies**: Feature 001 (Recipe entity model), Feature 002 (Clerk authentication), Feature 010 (subscription visibility rules).

---

## ID Schema

| Identifier               | Pattern      | Meaning                                                 |
| ------------------------ | ------------ | ------------------------------------------------------- |
| Acceptance Test Case     | `AT-NNN-X`   | NNN = parent REQ number, X = letter suffix (A, B, C...) |
| Acceptance Test Scenario | `ATS-NNN-X#` | Nested under parent AT; # = numeric suffix (1, 2, 3...) |

**Example**: `ATS-001-A2` = Scenario 2 of Test Case A verifying REQ-001.

---

## Acceptance Test Cases (Tier 1–3 Structure)

---

### Tier 1 — Epic: Recipe Importing

---

#### Tier 2 — User Story: Web URL Import (REQ-001)

> _As a user, I want to import a recipe from a public website URL so that I don't have to retype it manually._

---

##### AT-001-A: Successful Web URL Import

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. Target URL is publicly reachable and contains schema.org/Recipe markup.
**Pass Criteria**: Recipe is created with title, ingredients, instructions, and at least one photo populated. Source attribution is visible.

- **ATS-001-A1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter a valid public URL containing schema.org/Recipe markup and submit
    - **Then** a new recipe is created with title, ingredients, instructions, and photos extracted from the page, and the recipe detail screen shows source attribution including the original URL and author

- **ATS-001-A2**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter a valid public URL that has no schema.org markup but has identifiable recipe content in HTML
    - **Then** a new recipe is created with at minimum title and ingredients populated via heuristic extraction, and source attribution is displayed

##### AT-001-B: Unreachable or Invalid URL

**Technique**: Boundary Value Analysis
**Pre-condition**: User is authenticated.
**Pass Criteria**: Import is rejected with a user-facing error message. No recipe record is created.

- **ATS-001-B1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter a URL that returns a 404 or is otherwise unreachable
    - **Then** the system displays an error message explaining the URL could not be reached, and no recipe is created

- **ATS-001-B2**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they submit a string that is not a valid URL
    - **Then** the system displays a validation error before attempting any network request

---

#### Tier 2 — User Story: Instagram Import (REQ-002, REQ-003)

> _As a user, I want to import a recipe from an Instagram post so that I can save recipes I discover on social media._

---

##### AT-002-A: Successful Instagram Caption Import

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. Target Instagram post is public and has recipe text in the caption.
**Pass Criteria**: Recipe is created from caption content. Attribution shows Instagram as platform and links to the original post.

- **ATS-002-A1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter a public Instagram post URL whose caption contains recipe text (ingredients and instructions)
    - **Then** a new recipe is created with content extracted from the caption, and the recipe detail screen shows attribution including the Instagram post URL, original author handle, and "Instagram" as the platform

##### AT-003-A: Unsupported Instagram Post Rejection

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. Target Instagram post is video-only or image-only with no recipe text in the caption.
**Pass Criteria**: Import is rejected with a clear explanation. No recipe record is created.

- **ATS-003-A1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter an Instagram post URL for a video-only post with no caption text
    - **Then** the system rejects the import and displays a message explaining that only posts with recipe text in the caption are supported

- **ATS-003-A2**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter an Instagram post URL for an image-only post with no recipe text in the caption
    - **Then** the system rejects the import and displays a message explaining that only posts with recipe text in the caption are supported

---

#### Tier 2 — User Story: Source Attribution Display (REQ-004)

> _As a user viewing an imported recipe, I want to see where it came from so that I can credit the original creator._

---

##### AT-004-A: Attribution Visibility on Imported Recipes

**Technique**: Equivalence Partitioning
**Pre-condition**: A recipe has been imported from a public website or Instagram.
**Pass Criteria**: Recipe detail screen prominently shows source URL, original author, and platform name.

- **ATS-004-A1**
    - **Given** a recipe imported from a public website URL
    - **When** any user views the recipe detail screen
    - **Then** the screen prominently displays the source URL, original author name, and platform (e.g., "AllRecipes")

- **ATS-004-A2**
    - **Given** a recipe imported from an Instagram post
    - **When** any user views the recipe detail screen
    - **Then** the screen prominently displays the Instagram post URL, the original author handle, and "Instagram" as the platform

---

#### Tier 2 — User Story: Automatic Public Visibility (REQ-005)

> _As a platform operator, I want web and Instagram imports to be automatically public so that attribution integrity is maintained._

---

##### AT-005-A: Imported Recipes Default to Public

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated.
**Pass Criteria**: Newly imported recipe is visible to unauthenticated users immediately after import.

- **ATS-005-A1**
    - **Given** an authenticated user who successfully imports a recipe from a public website URL
    - **When** the import completes
    - **Then** the recipe is immediately visible to unauthenticated users browsing the platform

- **ATS-005-A2**
    - **Given** an authenticated user who successfully imports a recipe from an Instagram post
    - **When** the import completes
    - **Then** the recipe is immediately visible to unauthenticated users browsing the platform

---

#### Tier 2 — User Story: Privacy Restriction on Public Imports (REQ-006)

> _As a platform operator, I want to prevent users from hiding imported public recipes so that attribution rules cannot be circumvented._

---

##### AT-006-A: Standard User Cannot Make Imported Recipe Private

**Technique**: Equivalence Partitioning
**Pre-condition**: A recipe was imported from a public URL. User is authenticated as a standard (non-premium) user.
**Pass Criteria**: The "Make Private" action is unavailable or blocked with an explanation.

- **ATS-006-A1**
    - **Given** a standard user viewing an imported public recipe they own
    - **When** they attempt to change the recipe visibility to private
    - **Then** the system blocks the action and displays an explanation that public imported recipes cannot be made private

##### AT-006-B: Premium User Cannot Make Unedited Clone Private

**Technique**: Equivalence Partitioning
**Pre-condition**: A premium user has cloned an imported public recipe but has not made substantive edits.
**Pass Criteria**: The "Make Private" action is blocked until substantive edits are made.

- **ATS-006-B1**
    - **Given** a premium user who has cloned an imported public recipe without editing it
    - **When** they attempt to change the recipe visibility to private
    - **Then** the system blocks the action and informs them that substantive edits are required before the recipe can be made private

---

#### Tier 2 — User Story: Clone Imported Recipe (REQ-007)

> _As a user, I want to clone an imported recipe so that I can personalise it without affecting the original._

---

##### AT-007-A: Clone Creates Editable Copy with Attribution

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. An imported public recipe exists.
**Pass Criteria**: Clone is created as a separate recipe record. Attribution from the original is retained. Clone is public by default.

- **ATS-007-A1**
    - **Given** an authenticated user viewing an imported public recipe
    - **When** they select "Clone Recipe"
    - **Then** a new recipe record is created in their account, the clone retains the source attribution from the original, and the clone is marked public

##### AT-007-B: Premium User Can Make Substantively Edited Clone Private

**Technique**: Equivalence Partitioning
**Pre-condition**: A premium user has cloned an imported recipe and made substantive edits (e.g., changed ingredients or instructions meaningfully).
**Pass Criteria**: The "Make Private" action succeeds.

- **ATS-007-B1**
    - **Given** a premium user who has cloned an imported recipe and changed at least one ingredient and one instruction step
    - **When** they change the recipe visibility to private
    - **Then** the system accepts the change and the recipe is no longer publicly visible

---

#### Tier 2 — User Story: Deduplication by Source URL (REQ-008)

> _As a user, I want the system to detect duplicate imports so that the same recipe doesn't appear multiple times._

---

##### AT-008-A: Duplicate URL Surfaces Existing Recipe

**Technique**: Equivalence Partitioning
**Pre-condition**: A recipe from a given URL has already been imported.
**Pass Criteria**: No new recipe record is created. The existing recipe is surfaced. The user is offered a clone option.

- **ATS-008-A1**
    - **Given** a recipe from `https://example.com/pasta-recipe` has already been imported
    - **When** an authenticated user attempts to import the same URL
    - **Then** the system does not create a new recipe, surfaces the existing public recipe, and offers the user the option to clone it

---

#### Tier 2 — User Story: Physical Copy Import via OCR (REQ-009, REQ-010, REQ-011)

> _As a user, I want to photograph a physical recipe and have it imported so that I can digitise my cookbook collection._

---

##### AT-009-A: Successful Physical Copy Import

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. Photo contains legible recipe text.
**Pass Criteria**: OCR extracts text. User can review and correct before saving. Saved recipe is private with no attribution.

- **ATS-009-A1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they capture or upload a photo of a physical recipe with legible text
    - **Then** the system extracts text via OCR and presents it in an editable review screen before saving

##### AT-010-A: Physical Copy Import Defaults to Private

**Technique**: Equivalence Partitioning
**Pre-condition**: User has completed a physical copy import.
**Pass Criteria**: Saved recipe is private. No source attribution is displayed.

- **ATS-010-A1**
    - **Given** an authenticated user who has completed a physical copy import and saved the recipe
    - **When** they view the recipe detail screen
    - **Then** the recipe is marked private, is not visible to other users, and no source attribution section is shown

##### AT-011-A: OCR Review and Correction Before Save

**Technique**: Equivalence Partitioning
**Pre-condition**: OCR extraction has completed.
**Pass Criteria**: User can edit any extracted field before saving.

- **ATS-011-A1**
    - **Given** an authenticated user on the OCR review screen after a physical copy import
    - **When** they edit the extracted title, ingredients, or instructions
    - **Then** the saved recipe reflects the corrected content, not the raw OCR output

---

#### Tier 2 — User Story: Paywalled Source Rejection (REQ-012)

> _As a platform operator, I want to block imports from paywalled sources so that the platform does not redistribute paid content._

---

##### AT-012-A: Known Paywalled Source is Rejected

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated. URL belongs to a known paywalled recipe source.
**Pass Criteria**: Import is rejected with a clear explanation. No recipe record is created.

- **ATS-012-A1**
    - **Given** an authenticated user on the Import Recipe screen
    - **When** they enter a URL from a known paywalled recipe source
    - **Then** the system rejects the import before extraction and displays a message explaining that paywalled sources cannot be imported

---

#### Tier 2 — User Story: Manual Entry Paid Source Flag (REQ-013)

> _As a platform operator, I want to flag manually entered recipes from paid sources so that copyright compliance is maintained._

---

##### AT-013-A: Manual Entry Paid Source Flagging

**Technique**: Equivalence Partitioning
**Pre-condition**: User is authenticated.
**Pass Criteria**: When a user indicates the recipe originates from a paid source, the system flags it appropriately.

- **ATS-013-A1**
    - **Given** an authenticated user manually entering a recipe
    - **When** they indicate the recipe originates from a paid source (e.g., a cookbook)
    - **Then** the system flags the recipe and applies appropriate visibility restrictions per platform policy

---

#### Tier 2 — User Story: Unauthenticated Import Rejection (REQ-IF-004)

> _As a platform operator, I want all import actions to require authentication so that anonymous users cannot create content._

---

##### AT-IF004-A: Unauthenticated Import Attempt is Rejected

**Technique**: Equivalence Partitioning
**Pre-condition**: User is not authenticated.
**Pass Criteria**: Import attempt is rejected. User is redirected to authentication.

- **ATS-IF004-A1**
    - **Given** an unauthenticated user who attempts to access the Import Recipe screen or submit an import request directly
    - **When** the request reaches the system
    - **Then** the system rejects the request and redirects the user to the authentication flow

---

#### Tier 2 — User Story: Accessibility (REQ-NF-004, REQ-NF-005)

> _As a user with assistive technology, I want all import UI components to be accessible so that I can use the feature regardless of ability._

---

##### AT-NF004-A: Import UI Components Have Accessible Names

**Technique**: Equivalence Partitioning
**Pre-condition**: Import Recipe screen is rendered.
**Pass Criteria**: All interactive elements are queryable by role or label in Playwright.

- **ATS-NF004-A1**
    - **Given** the Import Recipe screen is rendered in a browser
    - **When** a Playwright test queries all interactive elements by role or label
    - **Then** every button, input, and control has an accessible name and is reachable without mouse interaction

##### AT-NF005-A: State is Not Conveyed by Color Alone

**Technique**: Inspection
**Pre-condition**: Import UI is rendered in various states (error, success, loading).
**Pass Criteria**: Every state change includes an icon or text label alongside any color change.

- **ATS-NF005-A1**
    - **Given** the Import Recipe screen in an error state
    - **When** a reviewer inspects the UI
    - **Then** the error state is communicated by both color and an icon or text label, not color alone

---

## Acceptance Criteria per REQ

| REQ        | Description (summary)                           | Pre-condition                                                                        | Success Condition                                                                   | Technique                |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------ |
| REQ-001    | Import recipe from public website URL           | Authenticated user; reachable URL with recipe content                                | Recipe created with title, ingredients, instructions, photos; attribution displayed | Equivalence Partitioning |
| REQ-002    | Import recipe from Instagram post caption       | Authenticated user; public post with recipe text in caption                          | Recipe created from caption; attribution shows Instagram URL, author, platform      | Equivalence Partitioning |
| REQ-003    | Reject video-only or image-only Instagram posts | Authenticated user; post has no recipe text in caption                               | Import rejected; user-facing error message shown; no recipe created                 | Equivalence Partitioning |
| REQ-004    | Display source attribution prominently          | Imported recipe exists                                                               | Recipe detail shows source URL, original author, and platform name                  | Equivalence Partitioning |
| REQ-005    | Auto-mark web/Instagram imports as public       | Import completes successfully                                                        | Recipe is immediately visible to unauthenticated users                              | Equivalence Partitioning |
| REQ-006    | Block making public imported recipe private     | Imported public recipe exists; user is standard or premium without substantive edits | "Make Private" action is blocked; explanation shown                                 | Equivalence Partitioning |
| REQ-007    | Clone imported recipe with attribution retained | Authenticated user; imported public recipe exists                                    | Clone created; attribution retained; clone is public by default                     | Equivalence Partitioning |
| REQ-008    | Deduplicate by source URL                       | Recipe from URL already imported                                                     | No new record created; existing recipe surfaced; clone option offered               | Equivalence Partitioning |
| REQ-009    | Import from physical copy via OCR               | Authenticated user; legible photo of recipe                                          | OCR extracts text; review screen presented before save                              | Equivalence Partitioning |
| REQ-010    | Physical copy imports default to private        | Physical copy import completed                                                       | Recipe is private; no attribution shown                                             | Equivalence Partitioning |
| REQ-011    | User can review and correct OCR output          | OCR extraction complete                                                              | User can edit any field; saved recipe reflects corrections                          | Equivalence Partitioning |
| REQ-012    | Reject imports from paywalled sources           | Authenticated user; URL is a known paywalled source                                  | Import rejected before extraction; clear explanation shown                          | Equivalence Partitioning |
| REQ-013    | Flag manually entered paid-source recipes       | Authenticated user manually entering recipe                                          | System flags recipe; appropriate visibility restrictions applied                    | Equivalence Partitioning |
| REQ-IF-004 | Reject unauthenticated import attempts          | User is not authenticated                                                            | Request rejected; user redirected to authentication                                 | Equivalence Partitioning |
| REQ-NF-004 | All import UI components have accessible names  | Import screen rendered                                                               | All interactive elements queryable by role or label in Playwright                   | Equivalence Partitioning |
| REQ-NF-005 | State not conveyed by color alone               | Import UI in any state                                                               | Every state change includes icon or text label alongside color                      | Inspection               |

---

## Feature Test Summary Matrix

| REQ        | Description (summary)                  | BDD Scenarios                                      | Test Method                 | Pass Criteria                                                     |
| ---------- | -------------------------------------- | -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| REQ-001    | Web URL import                         | 4 (ATS-001-A1, ATS-001-A2, ATS-001-B1, ATS-001-B2) | Automated E2E (Playwright)  | Recipe created with required fields; error shown on failure       |
| REQ-002    | Instagram caption import               | 1 (ATS-002-A1)                                     | Automated E2E (Playwright)  | Recipe created; attribution correct                               |
| REQ-003    | Reject unsupported Instagram posts     | 2 (ATS-003-A1, ATS-003-A2)                         | Automated E2E (Playwright)  | Import rejected; error message shown                              |
| REQ-004    | Attribution display                    | 2 (ATS-004-A1, ATS-004-A2)                         | Automated E2E (Playwright)  | Attribution visible with URL, author, platform                    |
| REQ-005    | Auto-public visibility                 | 2 (ATS-005-A1, ATS-005-A2)                         | Automated E2E (Playwright)  | Recipe visible to unauthenticated users                           |
| REQ-006    | Block privacy change on public imports | 2 (ATS-006-A1, ATS-006-B1)                         | Automated E2E (Playwright)  | Action blocked; explanation shown                                 |
| REQ-007    | Clone with attribution                 | 2 (ATS-007-A1, ATS-007-B1)                         | Automated E2E (Playwright)  | Clone created; attribution retained; premium edit unlocks privacy |
| REQ-008    | Deduplication by source URL            | 1 (ATS-008-A1)                                     | Automated E2E (Playwright)  | No duplicate created; existing recipe surfaced; clone offered     |
| REQ-009    | Physical copy OCR import               | 1 (ATS-009-A1)                                     | Automated E2E (Playwright)  | OCR text extracted; review screen shown                           |
| REQ-010    | Physical copy defaults to private      | 1 (ATS-010-A1)                                     | Automated E2E (Playwright)  | Recipe private; no attribution shown                              |
| REQ-011    | OCR review and correction              | 1 (ATS-011-A1)                                     | Manual / Automated E2E      | Corrections saved correctly                                       |
| REQ-012    | Paywalled source rejection             | 1 (ATS-012-A1)                                     | Automated E2E (Playwright)  | Import rejected; explanation shown                                |
| REQ-013    | Manual paid-source flagging            | 1 (ATS-013-A1)                                     | Manual / Automated E2E      | Recipe flagged; visibility restricted                             |
| REQ-IF-004 | Unauthenticated import rejection       | 1 (ATS-IF004-A1)                                   | Automated E2E (Playwright)  | Request rejected; redirect to auth                                |
| REQ-NF-004 | Accessible UI components               | 1 (ATS-NF004-A1)                                   | Automated (Playwright a11y) | All elements queryable by role or label                           |
| REQ-NF-005 | State not color-only                   | 1 (ATS-NF005-A1)                                   | Manual inspection           | Icon or text label accompanies every color-based state            |

**Total BDD Scenarios**: 23

---

## Exit Criteria

The Recipe Importing feature is accepted when all of the following conditions are met:

1. **All P1 acceptance test scenarios pass.** Every `ATS-*` scenario mapped to a P1 requirement executes without failure in the target environment.

2. **No open P1 defects.** Zero unresolved defects that block, break, or misrepresent any P1 requirement. P2 defects may remain open if documented and accepted by the product owner.

3. **Attribution is present on all web and Instagram imports.** Manual spot-check of at least three imported recipes (two web, one Instagram) confirms source URL, author, and platform are displayed on the recipe detail screen.

4. **Deduplication is verified.** Importing the same URL twice results in no new recipe record and the existing recipe is surfaced with a clone option.

5. **Physical copy imports are private.** At least one physical copy import is verified to be private and free of attribution data after save.

6. **Accessibility gate passes.** Playwright accessibility queries confirm all interactive import UI elements have accessible names. No state is conveyed by color alone (verified by inspection).

7. **Unauthenticated access is blocked.** Direct API and UI attempts to import without authentication are rejected and redirect to the auth flow.

8. **Paywalled source list is enforced.** At least one URL from the known paywalled source list is rejected at the import step with a user-facing explanation.

9. **Premium gating is correct.** A standard user cannot make any imported public recipe private. A premium user can make a substantively edited clone private.

10. **Product owner sign-off.** The product owner or designated representative has reviewed the acceptance test results and approved the feature for release.
