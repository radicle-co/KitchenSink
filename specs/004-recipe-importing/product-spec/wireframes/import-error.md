# Screen: Import Error & Recovery

**Journey**: J5 and every failure path · **Story**: US-409 · **Requirements**: REQ-024, REQ-NF-005, REQ-NF-006
**Platforms**: web + mobile

## Purpose

Turn every failure into a specific explanation and a concrete next step. "Import failed" with no cause is the
pain point this screen exists to eliminate.

## Error catalogue — one distinct message and recovery per code

| Code                          | What the user is told                                     | Recovery offered                            |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `IMPORT_SOURCE_BLOCKED`       | This source requires a subscription and can't be imported | Try another link · Paste manually · Why?    |
| `IMPORT_SOURCE_UNREACHABLE`   | We couldn't reach that page                               | Retry · Try another link · Paste manually   |
| `IMPORT_NO_RECIPE_FOUND`      | We reached the page but couldn't find a recipe on it      | Paste manually · Try another link           |
| `IMPORT_NO_CAPTION`           | That post doesn't have a recipe written in its caption    | Try another post · Paste manually           |
| `IMPORT_UNSUPPORTED_FORMAT`   | That file type isn't supported                            | Choose another file · See supported formats |
| `IMPORT_PAYLOAD_TOO_LARGE`    | That file or photo is too large                           | Choose a smaller one                        |
| `IMPORT_OCR_FAILED`           | We couldn't read the text in that photo                   | Retake photo · Paste manually               |
| `IMPORT_PROVIDER_UNAVAILABLE` | That's temporarily unavailable — try again shortly        | Retry later · Use another method            |
| `IMPORT_DRAFT_EXPIRED`        | This draft expired                                        | Start the import again                      |
| `IMPORT_DRAFT_INCOMPLETE`     | _(inline on draft review, not this screen)_               | —                                           |

## Behaviour

| Aspect           | Specification                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Distinctness     | Each code renders distinct copy — no shared fallback message across codes                                                             |
| Exhaustiveness   | The renderer switches over the code union with a `never` default: a new code **cannot** be added without a branch, or the build fails |
| Accessibility    | Icon **and** text on every state; never colour alone (REQ-NF-005)                                                                     |
| Localization     | All copy from the shared catalogue (REQ-NF-006)                                                                                       |
| No internals     | Never surfaces stack traces, hostnames resolved, or internal identifiers                                                              |
| Blocked ≠ broken | A policy rejection reads clearly as policy, never as a technical failure                                                              |

## States (component test each, both platforms)

One per code in the catalogue above, plus `retrying` and `retry-exhausted`.

## Note on the blocked-source message

It explains that the source requires a subscription without disparaging the publisher and without revealing the
blocklist's contents. `GET /import/sources` exposes the blocked list to the client for proactive warnings, so
in the common case the user is told **before** submitting rather than after.
