#!/usr/bin/env bash
# The CloudFormation stack statuses that mean "a deploy is RUNNING on this stack and has not settled".
#
# The complement of `cfnRestingStates.sh` (resting) on the "still exists" side, minus DELETE_IN_PROGRESS: a stack that
# is being deleted creates nothing, so a teardown has no reason to wait for it. Everything else here can still create
# resources — a per-PR logical database among them — after a teardown has decided there is nothing left to drop.
#
# ⛔ `REVIEW_IN_PROGRESS` is deliberately NOT here. It is a stack whose first change set was created and never
# executed: it holds no resources and can create none, and CloudFormation keeps it indefinitely, so waiting on it
# timed out every teardown of that PR after 1800 s and recorded its database drop as owed, forever. It is a RESTING
# state (`cfnRestingStates.sh`), which `delete-stack` removes, and the midnight reclaim (`reclaim.ts`) reads it the same
# way. `cfnStateLists.test.ts` holds the two lists apart.
#
# Sourced, never executed: it defines a variable and does nothing else.

# shellcheck disable=SC2034 — consumed by the sourcing script, not by this one.
CFN_IN_PROGRESS_STATES=(
    CREATE_IN_PROGRESS
    ROLLBACK_IN_PROGRESS
    UPDATE_IN_PROGRESS UPDATE_COMPLETE_CLEANUP_IN_PROGRESS
    UPDATE_ROLLBACK_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS
    IMPORT_IN_PROGRESS IMPORT_ROLLBACK_IN_PROGRESS
)
