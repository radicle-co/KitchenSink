#!/usr/bin/env bash
# The CloudFormation stack statuses that mean "a deploy is RUNNING on this stack and has not settled".
#
# The complement of `cfnRestingStates.sh` (resting) on the "still exists" side, minus DELETE_IN_PROGRESS: a stack that
# is being deleted creates nothing, so a teardown has no reason to wait for it. Everything else here can still create
# resources — a per-PR logical database among them — after a teardown has decided there is nothing left to drop.
#
# Sourced, never executed: it defines a variable and does nothing else.

# shellcheck disable=SC2034 — consumed by the sourcing script, not by this one.
CFN_IN_PROGRESS_STATES=(
    CREATE_IN_PROGRESS REVIEW_IN_PROGRESS
    ROLLBACK_IN_PROGRESS
    UPDATE_IN_PROGRESS UPDATE_COMPLETE_CLEANUP_IN_PROGRESS
    UPDATE_ROLLBACK_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS
    IMPORT_IN_PROGRESS IMPORT_ROLLBACK_IN_PROGRESS
)
