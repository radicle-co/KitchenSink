# Screen: Import Progress

**Journey**: J1, J2 · **Story**: US-401, US-405 · **Requirements**: REQ-024
**Platforms**: web + mobile

## Purpose

Imports are asynchronous — an outbound fetch or an OCR pass takes seconds. This screen keeps the user informed
without blocking them, and turns every terminal outcome into a clear next step.

## Behaviour

| Aspect       | Specification                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Progress     | Indeterminate with a plain-language stage ("Fetching the page…", "Reading your recipe…")       |
| Non-blocking | The user may navigate away; the job continues and the draft is waiting on return               |
| Polling      | Bounded backoff; stops at a terminal state or on unmount — never polls indefinitely            |
| Success      | Routes to `import-draft-review`                                                                |
| Duplicate    | Routes to `import-conflict`                                                                    |
| Failure      | Routes to `import-error` with the specific code — never a generic message                      |
| Slow import  | After a threshold, offers "we'll keep going — check back shortly" rather than an empty spinner |

## States (component test each, both platforms)

`queued` · `running` · `succeeded` · `duplicate-found` · `failed` (per error class) · `abandoned-on-unmount`

## Why this screen exists

Morgan's stated pain point is "no signal when a site blocks scraping, leaving me staring at a spinner". A
progress screen that never resolves is the failure this design exists to prevent — hence the bounded polling
and the explicit slow-import affordance.
