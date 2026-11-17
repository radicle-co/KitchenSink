# Quickstart: check that Flow Steps works

A run guide for after the build. It names the checks, not the code. Contracts: `contracts/rewrittenSteps.api.md`. Data:
`data-model.md`.

## Before you start

- Local stack up (`npm run local:up`, after any restart). LOCAL e2e needs `DATABASE_ADMIN_URL`.
- A test cook on Pro with AI with uses left, and one on Free.
- A saved recipe (not a draft) with at least 3 steps, one with a time ("bake 25 minutes"), one with a temperature
  ("180°C") and one safety line ("cook until the chicken reaches 74°C").
- Bedrock reachable from the worker through a scoped profile (never root).

## Checks

1. **Attach (US1).** Request Flow Steps. Expect `202` then `ready`. The use count drops by one. Every amount,
   temperature and time from the recipe appears in the result, and no other appears.
2. **Cache hit (US1-2).** Request again. Expect `200 ready` at once. No new job row, no model call, the use count
   unchanged.
3. **Two devices (US1-4).** Send two requests at once. Expect one job id and one use.
4. **Out of date (US2).** Edit one step. `GET` shows `ready` + `stale`. Cooking Mode opens on Original steps.
   Restore the old text. `GET` shows `fresh` again with no job.
5. **Replace (US3).** Apply with the current `expectedVersion` and digest. Expect the recipe's steps to change and a
   new version in its history. Apply again with the old digest. Expect `409` and no change. Restore the old version.
6. **Label stays (US3-5, FR-032).** Replace the steps of a public version of an imported recipe. Expect the wording
   check of 003B-FR-050 to run, and the rights label and the credit line to stay as they were.
7. **Budget (US4-2).** Set the ceiling to zero in the local stack. Request. Expect `budgetSpent`, no use taken, the
   message not redelivered.
8. **Out of uses (US4-1).** Use the cook with none left. Expect `409 outOfUses` and no job.
9. **Check refused (US4-4).** Use the writer stub that drops one duration. Expect `checkRefused` / `factMissing`,
   no version, no use.
10. **Offline (US4-3).** With a fresh version cached, cut the network and start Cooking Mode on web and mobile.
    Expect Flow Steps with working timers, and every request control in the offline state.
11. **Other owner.** As a second cook, `GET` the first cook's recipe Flow Steps. Expect `404`.

## Test doors

- Unit and integration: `npm run test` (affected only).
- LOCAL e2e (migration, index, cascade): `npm run test:e2e --workspace=packages/services/recipe-service`.
- Web and mobile: `npm run test:e2e:web`, `npm run test:e2e:mobile` (the script selects the specs and flows).

## Clean up

Delete the test recipes and jobs the run made. Stop the local stack you started. Remove any screenshots.
