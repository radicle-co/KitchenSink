#!/usr/bin/env bash
# The CloudFormation stack statuses that mean "this stack still EXISTS and is not mid-operation".
#
# ⛔ ONE AUTHORITY, sourced by every sweep. It was three copies, and they had already drifted: the teardown
# enumerated eleven states while `sandbox-reap.yml` and `sandbox-reconcile.yml` enumerated six. The five
# missing ones are the FAILED variants — and that is the drift that matters, because a stack wedged in
# `UPDATE_ROLLBACK_FAILED` is precisely what a reaper exists to retry. `kitchensink-recipe-service-pr-91`
# reached exactly that state during this repository's history.
#
# The failure mode of the narrow list is silent and reads as success: discovery returns nothing, the reaper
# prints `no per-PR previews exist — nothing to reap`, and a wedged preview bills forever behind a green run.
#
# ⚠️ Deliberately NOT in `pr-scope.sh`. That file's contract is a pure scope MATCHER — "does this name belong
# to pr-{N}" — and a list of CloudFormation statuses is a different piece of knowledge that would have no
# reason to change at the same time.
#
# Sourced, never executed: it defines a variable and does nothing else.

# shellcheck disable=SC2034 — consumed by the sourcing script, not by this one.
CFN_RESTING_STATES=(
    CREATE_COMPLETE CREATE_FAILED
    ROLLBACK_COMPLETE ROLLBACK_FAILED
    UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED
    IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE IMPORT_ROLLBACK_FAILED
    DELETE_FAILED
)
