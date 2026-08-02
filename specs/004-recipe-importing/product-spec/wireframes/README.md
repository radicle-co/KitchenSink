# Wireframes — 004 Recipe Importing

**Regenerated**: 2026-08-02

Screen specifications for the import flow. Every screen ships to **web and mobile in the same release**
(`CODING_STANDARDS §14.1`); these documents describe shared behaviour, with platform differences called out
inline. All copy is drawn from the shared message catalogue — no screen defines literal strings.

| Screen                                             | Journey | Story              |
| -------------------------------------------------- | ------- | ------------------ |
| [import-url.md](./import-url.md)                   | J1, J6  | US-401, US-402     |
| [import-photo.md](./import-photo.md)               | J2      | US-405             |
| [import-paste.md](./import-paste.md)               | J3      | US-410, US-411     |
| [import-progress.md](./import-progress.md)         | J1, J2  | US-401, US-405     |
| [import-draft-review.md](./import-draft-review.md) | **all** | US-408 — the pivot |
| [import-conflict.md](./import-conflict.md)         | J4      | US-407             |
| [import-error.md](./import-error.md)               | J5      | US-409             |

## Changes in this revision

- **`import-preview.md` replaced by `import-draft-review.md`.** The old screen was an optional preview; the new
  one is a mandatory completion step every channel passes through, and it can block saving. Different
  responsibility, different name.
- **`import-progress.md` added** — imports are asynchronous, so there is a real waiting state to design.
- **`import-photo.md` added** — photo import is Must Have at launch (D-001) and previously had no screen.
- **`import-paste.md` extended** with the source attestation and citation controls (D-003).

## Accessibility rules for every screen

- Every interactive element has an accessible name reachable via `getByRole` / `getByLabel`.
- State is **never** conveyed by colour alone — an icon or text label always accompanies it.
- Full keyboard operation on web; correct focus order and screen-reader labelling on both platforms.
- Loading and error states are announced, not merely rendered.
