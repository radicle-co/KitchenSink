---
title: 'chore: finish PR 91, every open item, to a green CI, a merge and a working production'
type: chore
date: 2026-10-13
---

# Finish PR 91

## Owner ruling (2026-10-13, verbatim)

"The plan needs to finish everything. This has been dragging on for two months now. We need it done. I don't mean cut
things out, but done."

## Definition of done

1. Every item below is built, tested in every tier it touches, reviewed, and committed on PR 91.
2. CI on PR 91 is green, including the deployed web tier and every Android and iOS Maestro shard, on a live sandbox.
3. The owner merges PR 91. `ci-main` is green, and the production deploy succeeds on the OIDC roles.
4. Every post-merge check below has run and passed.
5. Nothing is left open except the items the owner keeps for later on purpose. Those are listed by name in the last
   section, each with its reason.

## Wave 0: in progress

| Item                                                                                    | Plan or source | Done when                                                   |
| --------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Narrow `kitchensink-gha-nonprod` to the teardown boundary the reclaim role already owns | GATE round 2   | GATE passes, the stack is redeployed, and its diff is shown |
| Push the zizmor fix, the roles code and the Maestro fixes                               | n/a            | A CI run starts on the pushed head                          |
| Stuck save after Discard, and keeping a phone's saves on session expiry                 | Plan 004       | Built in a worktree, merged, all tiers green                |

## Wave 1: CI green on PR 91

| Item                                                                                                            | Done when                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| iOS: the rename-collection sheet closes the keyboard but does not save (`collections`, `collectionsPull`)       | Fixed in the shared sheet, test-first. IOS green  |
| iOS: Discover filter suggestions sit under the keyboard (`discoverIngredientCap`, `landscape`)                  | Fixed, test-first. IOS green                      |
| A swipe that starts in an open ingredient list sometimes closes it (`ingredientRemoteFoods`, `edit`)            | Root cause found and fixed. Both flows stable     |
| `recipes/landscape` fails intermittently on Android                                                             | Root cause found and fixed. Stable over runs      |
| A new ingredient row lands just above the screen after a food is picked                                         | staff-ux-engineer spec, then built on both apps   |
| `SyncProvider`'s re-arm keeps the old cook's closure, so a drain after a cook switch mid-flight is lost         | A failing test first, then fixed                  |
| A Discard on the entity path never reports `mayStand` when it withdraws a parked create with an unknown outcome | Fixed or recorded as accepted after code-reviewer |
| `awsCredentialsFederated.test.ts` guard helpers have cognitive complexity 30 and 35                             | Per-rule predicates extracted                     |
| Cuisine: the mobile combobox cannot carry a field error, so the error shows as an alert under the field         | Design-system decision, then built                |
| Cuisine: a long custom cuisine in a Discover chip (2-line clamp) is unchecked                                   | Checked on both apps                              |
| Cuisine: a server refusal from an older queued save shows the general save failure, not field copy              | The outbox passes the error to the editor         |
| Cuisine device checks: the 5-row list at font scale 2.0, and the list closing on Android Back                   | Run on emulator-5556                              |
| `readViewerAppId` in `web/tests/e2e/utils/recipeApi.ts` blames a claim that is present                          | The message names the real cause                  |
| Whatever the first CI run with the iOS fixes shows                                                              | Each failure fixed at its root                    |
| CI on the OIDC roles, sandbox half (commit B)                                                                   | Plan 005. Proven on PR 91 by real runs            |
| Faster iOS shards                                                                                               | Plan 006. Savings shown in the run logs           |

## Wave 2: the approved builds

Each one gets its plan doc before code, built on web and mobile in lock-step, test-first in every tier.

| Item                                                                                                      | Source                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Cuisine field: 90-entry list, free text, required to publish in the app and recipe-service                | `docs/design/uiOverhaul/cuisineField.md` |
| Roles and the paid-feature gate, two GitHub variables (both false), the role test pool, the owner account | Owner rulings 2026-10-13                 |
| Usernames as the public byline                                                                            | Owner rulings 2026-10-13                 |
| Google sign-in on mobile, plus Sign in with Apple (owner approved 2026-10-13)                             | Owner rulings 2026-10-13                 |
| Live per-line parse statuses (server phases and both clients)                                             | Owner rulings 2026-10-13                 |
| Maestro screenshot baselines: re-record on emulator-5556, camelCase names, enable the visual flows        | Owner rulings 2026-10-13                 |
| The ten UI-walk defects whose cause needs a device or the sandbox                                         | UI walk register                         |

## Wave 3: before the merge

| Item                                                                                                      | Done when                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------- |
| CI on the OIDC roles, prod half (commit C)                                                                | Plan 005. Guards green           |
| Security review of the three CI roles                                                                     | sec-aud-1 findings fixed         |
| Staff reviews at plan end: staff-architect, code-reviewer, staff-code-quality, staff-ux-engineer EVALUATE | Findings fixed                   |
| Written web and mobile parity audit, then Playwright and Maestro on the finished tree                     | Audit written, both suites green |
| `cdk diff` of every app against production                                                                | No unexpected change             |
| A final green CI run on the finished head                                                                 | All jobs green                   |

## Wave 4: the merge and after

| Item                                                                                                        | Done when                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| The owner merges PR 91                                                                                      | Merged                                         |
| `ci-main` and the first production deploy on the OIDC roles                                                 | Green. If the prod tier fails, revert commit C |
| A forced production alarm reaches Sentry (it needs the owner's go-ahead, because it writes to a prod alarm) | The Sentry issue is seen                       |
| Delete the GitHub secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`                                   | Deleted after one green prod deploy            |
| Delete the old `*-queue-check-sandbox` Sentry monitors                                                      | Deleted                                        |
| Tune the webhooks alarm thresholds on real data                                                             | Thresholds set from a week of data             |
| The midnight reclaim deletes the idle `pr-91` stacks and the shared tier                                    | Seen in the morning after a midnight stop      |

## Owner decisions and actions

| Item                                                                           | Needed for |
| ------------------------------------------------------------------------------ | ---------- |
| Confirm the prod web client ID (the two prod IDs sent were the same)           | Wave 2     |
| Clerk Native applications entries on both instances                            | Wave 2     |
| Sign in with Apple: build it beside Google, or not                             | Wave 2     |
| Phase 2 of the AWS separation: KitchenSink's own CDK qualifier or own accounts | Wave 3     |
| Whether `main` requires pull requests                                          | Wave 3     |
| Delete the unused root key ending 3MEB                                         | Any time   |
| The merge itself, and when                                                     | Wave 4     |

## Kept for later on purpose

- Flipping `PAID_FEATURES_GATE_SANDBOX` and `PAID_FEATURES_GATE_PROD`: the owner decides when ("I will say when to
  flip the flags").
- The prod Android Google client: it needs the release signing key, which exists only after the first store build.
