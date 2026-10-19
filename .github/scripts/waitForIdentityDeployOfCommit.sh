#!/usr/bin/env bash
#
# Before a PR's deployed e2e tiers run, wait for the sandbox identity deploy of the SAME commit.
#
# ⚠️  DELIBERATE — do not replace this with a retry or a sleep in the tiers.
#
# One push to a PR starts two workflows: `sandbox-identity-deploy.yml` redeploys the SHARED sandbox identity service,
# and `_ci.yml` runs the deployed tiers against it. A workflow cannot `needs:` another workflow, and
# `waitForPrIdentityDeploy.sh` serialises two DEPLOYS (it asks "is any PR deploy running?", not "did mine finish?").
# So nothing ordered the tiers after the identity rollout, and a tier whose e2e-seed reset calls an endpoint that
# push introduced met the OLD server (404, red build) or one mid-rollout. Identity is shared across every preview, so
# the tiers must test the identity the push delivered or fail saying it was not delivered.
#
# The verdict, per the runs of that workflow for the PR's HEAD sha (`--event pull_request`, newest judged):
#   no run                       → proceed. The push did not touch identity's paths, so no run exists.
#   any run not completed        → wait (queued, pending and in_progress are all "not finished").
#   newest completed: success    → proceed.
#   newest completed: skipped    → proceed. The run decided it had nothing to deliver.
#   newest completed: anything else (failure, cancelled, timed_out, …) → FAIL, naming the run: the tiers would test an
#       identity this push did not deliver. A `cancelled` run is usually GitHub replacing a pending run in the shared
#       concurrency group; re-run that workflow, then re-run this job.
#
# Unknown is not idle: a `gh` that errors, or an answer that is not the JSON asked for, fails the job. "Could not ask"
# must never read as "nothing is running" (the same rule as waitForPrIdentityDeploy.sh).
#
# THE RACE THIS CANNOT RULE OUT, AND HOW IT IS BOUNDED. Both runs come from one event, but GitHub does not promise they
# are created at the same instant. "No run" is therefore only believed after NO_RUN_GRACE_SECONDS of seeing none. The
# calling job needs nothing slow, so it starts beside `deploy-preview` (tens of minutes); the grace costs the critical
# path nothing, and a run registering later than the grace after this job starts is not a case seen in practice.
#
# `decide` is PURE (runs in, verdict out); `evaluate` holds every I/O. Tested by
# packages/tools/repoGuards/__tests__/waitForIdentityDeployOfCommit.test.ts and
# packages/tools/repoGuards/tests/waitForIdentityDeployOfCommit.integration.test.ts (stubbed `gh`).
#
# Usage:
#     waitForIdentityDeployOfCommit.sh decide   <status,conclusion,url> […]      (newest first)
#     waitForIdentityDeployOfCommit.sh evaluate <headSha>                         (needs GITHUB_REPOSITORY, GH_TOKEN)
#
# Environment (evaluate):
#   WAIT_TIMEOUT_SECONDS   default 2700 — how long a run may stay unfinished before the job fails
#   WAIT_POLL_SECONDS      default 30
#   NO_RUN_GRACE_SECONDS   default 90  — how long "no run yet" is re-asked before it is believed
#
# Exit status: 0 = proceed, 1 = fail (the tiers must not run), 2 = misuse. `decide` exits 0 with `verdict=` on stdout.
set -uo pipefail

WORKFLOW='sandbox-identity-deploy.yml'

# identity_wait_decide <status,conclusion,url> […]
#
# Prints `verdict=proceed|wait|fail` and `reason=…`. Pure. Returns 2 on a run that is not three comma fields.
identity_wait_decide() {
    local run status conclusion url first_inflight='' newest=''

    for run in "$@"; do
        IFS=',' read -r status conclusion url extra <<<"$run"
        if [ -z "${status:-}" ] || [ -z "${url:-}" ] || [ -n "${extra:-}" ] || [[ "$run" != *,*,* ]]; then
            echo "malformed run: '$run' (want status,conclusion,url)" >&2
            return 2
        fi
        if [ -z "$newest" ]; then
            newest="$run"
        fi
        if [ "$status" != 'completed' ] && [ -z "$first_inflight" ]; then
            first_inflight="$status $url"
        fi
    done

    if [ "$#" -eq 0 ]; then
        echo 'verdict=proceed'
        echo 'reason=no identity deploy run for this commit'
        return 0
    fi

    if [ -n "$first_inflight" ]; then
        echo 'verdict=wait'
        echo "reason=identity deploy run is ${first_inflight% *}: ${first_inflight#* }"
        return 0
    fi

    IFS=',' read -r status conclusion url <<<"$newest"
    case "$conclusion" in
        success | skipped)
            echo 'verdict=proceed'
            echo "reason=identity deploy $url concluded $conclusion"
            ;;
        *)
            echo 'verdict=fail'
            echo "reason=identity deploy $url concluded '${conclusion}', so the deployed tiers would test an identity this push did not deliver"
            ;;
    esac
}

# identity_wait_evaluate <headSha>
#
# @sideEffect Calls `gh`, sleeps, writes to stdout. Exit 0 = proceed, 1 = fail.
identity_wait_evaluate() {
    local sha="${1-}"
    local repo="${GITHUB_REPOSITORY-}"
    local timeout="${WAIT_TIMEOUT_SECONDS:-2700}"
    local poll="${WAIT_POLL_SECONDS:-30}"
    local grace="${NO_RUN_GRACE_SECONDS:-90}"
    local deadline=$((SECONDS + timeout))
    local grace_deadline=$((SECONDS + grace))
    local raw lines verdict reason out
    local runs

    if [ -z "$sha" ] || [ -z "$repo" ]; then
        echo 'usage: evaluate <headSha> (with GITHUB_REPOSITORY set)' >&2
        return 2
    fi

    while :; do
        if ! raw=$(gh run list --repo "$repo" --workflow "$WORKFLOW" --event pull_request --commit "$sha" \
            --limit 30 --json status,conclusion,url,createdAt); then
            echo "::error::could not ask GitHub for the identity deploy runs of $sha — refusing to assume none is running"
            return 1
        fi
        if ! lines=$(jq -r 'sort_by(.createdAt) | reverse | .[] | [.status, (.conclusion // ""), .url] | join(",")' <<<"$raw"); then
            echo "::error::GitHub's answer about the identity deploy runs of $sha was not the list asked for — refusing to assume none is running"
            return 1
        fi

        runs=()
        while IFS= read -r line; do
            if [ -n "$line" ]; then
                runs+=("$line")
            fi
        done <<<"$lines"

        if ! out=$(identity_wait_decide "${runs[@]+"${runs[@]}"}"); then
            echo "::error::could not read the identity deploy runs of $sha"
            return 1
        fi
        verdict=$(sed -n 's/^verdict=//p' <<<"$out")
        reason=$(sed -n 's/^reason=//p' <<<"$out")

        case "$verdict" in
            proceed)
                if [ "${#runs[@]}" -eq 0 ] && [ "$SECONDS" -lt "$grace_deadline" ]; then
                    echo "no identity deploy run for $sha yet — asking again in ${poll}s (grace ${grace}s)"
                    sleep "$poll"
                    continue
                fi
                echo "$reason"
                return 0
                ;;
            fail)
                echo "::error::$reason"
                return 1
                ;;
        esac

        if [ "$SECONDS" -ge "$deadline" ]; then
            echo "::error::$reason — still unfinished after ${timeout}s, so the deployed tiers will not run against it"
            return 1
        fi
        echo "$reason — waiting ${poll}s"
        sleep "$poll"
    done
}

case "${1-}" in
    decide)
        shift
        identity_wait_decide "$@"
        ;;
    evaluate)
        shift
        identity_wait_evaluate "$@"
        ;;
    *)
        echo 'usage: waitForIdentityDeployOfCommit.sh decide|evaluate …' >&2
        exit 2
        ;;
esac
