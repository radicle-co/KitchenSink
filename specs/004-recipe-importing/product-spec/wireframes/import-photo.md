# Screen: Import from a Photo

**Journey**: J2 · **Story**: US-405 · **Requirements**: REQ-007, REQ-026
**Platforms**: mobile-primary; web supports file upload

## Purpose

Capture or select a photograph of a physical recipe and start OCR extraction.

## Tier gate (D-014)

Photo import produces a private recipe, so it is **premium-only**. A free-tier user does not see this screen:
the channel is absent from the picker, and calling the endpoint directly returns `IMPORT_REQUIRES_PREMIUM`
without any OCR call being made. Where the upgrade path is surfaced, it explains _why_ — private recipes are a
premium capability — rather than showing a bare paywall.

## Behaviour

| Aspect      | Specification                                                                          |
| ----------- | -------------------------------------------------------------------------------------- |
| Capture     | Mobile: camera or library. Web: file picker.                                           |
| Validation  | Type and size determined by **content**, not filename. JPEG/PNG/HEIC, ≤10 MB.          |
| Guidance    | Brief framing hint before capture — OCR quality depends heavily on it                  |
| Privacy     | States plainly that the photo is used to read the recipe and is **deleted afterwards** |
| Retake      | Offered before submitting                                                              |
| Result      | Always private, never attributed — there is no public source to credit                 |
| Permissions | Camera denial is a handled state with a route to settings, not a dead end              |

## States (component test each, both platforms)

`idle` · `permission-denied` · `captured-preview` · `uploading` · `invalid-type` · `too-large` · `submitted`

## Privacy note

Photographs of physical recipes routinely capture handwriting, faces, and surroundings (HAZ-035). The deletion
promise made on this screen is enforced by the draft lifecycle: the image is deleted on confirm, discard, or
expiry — whichever comes first — and it is never written to logs (HAZ-036).
