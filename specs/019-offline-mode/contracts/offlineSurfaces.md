# Contract: Offline surfaces

The committed design is `docs/design/offlineNotice.md`. Surfaces it does not cover yet go through `staff-ux-engineer`
SPECIFY before they are built (CLAUDE.md), with every state and its localisation key.

| Surface                            | State today              | Needed for     |
| ---------------------------------- | ------------------------ | -------------- |
| App-wide offline notice and count  | built (`SyncNoticeHost`) | FR-020, FR-021 |
| Error and mark on the item         | designed, not built      | FR-010, FR-017 |
| "Needs a choice" mark in lists     | not designed             | FR-016         |
| Conflict view                      | built                    | User Story 3   |
| Refusal with "save as new"         | not designed             | FR-017         |
| "Needs the network" before actions | not designed             | FR-007         |
| "This recipe needs the network"    | not designed             | User Story 1   |
| Sign-out warning for unsynced work | designed (R3)            | FR-024         |
| "Signing in needs the network"     | not designed             | FR-027         |

Every surface ships on web and mobile in the same release.
