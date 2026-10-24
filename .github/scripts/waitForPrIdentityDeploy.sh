#!/usr/bin/env bash
#
# Wait until no PULL REQUEST run of `sandbox-identity-deploy.yml` is in progress.
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0060-sandbox-starts-only-by-hand.md before changing this.
#
# Sandbox Up calls `sandbox-identity-deploy.yml` to rebuild the shared tier, and a push to a PR runs the same workflow
# directly. They share ONE long-lived stack set, so they must not deploy at the same time. They used to be serialised
# by a literal concurrency group, and that is the defect: GitHub keeps one PENDING run per group, so a PR push
# arriving while Sandbox Up's run was pending REPLACED it (cancelled it), and the press that asked for the tier died
# without a word. The called path now has a group of its own (per run, so nothing can replace it) and calls this
# script first, which does the serialising by waiting rather than by cancelling.
#
# Only PR runs are waited for. A called run is listed under its CALLER (`sandboxUp.yml`), not under this workflow, and
# a dispatch run does not race a PR push often enough to earn a poll; CloudFormation itself refuses a second update of
# a stack that is mid-update, so the residual overlap fails loudly instead of corrupting anything.
#
# Unknown is not idle: a `gh` that fails stops the wait with an error, because "could not ask" must never read as
# "nothing is running".
#
#   WAIT_TIMEOUT_SECONDS  default 2400 (the job's own timeout is 180 minutes)
#   WAIT_POLL_SECONDS     default 30
set -uo pipefail

timeout="${WAIT_TIMEOUT_SECONDS:-2400}"
poll="${WAIT_POLL_SECONDS:-30}"
deadline=$((SECONDS + timeout))

while :; do
    if ! count=$(gh run list --workflow sandbox-identity-deploy.yml --event pull_request --status in_progress \
        --limit 1 --json databaseId --jq 'length'); then
        echo "::error::could not ask GitHub whether a pull-request identity deploy is running — refusing to deploy over one"
        exit 1
    fi
    if [ "${count:-0}" = '0' ]; then
        echo 'no pull-request identity deploy is in progress'
        exit 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
        echo "::error::a pull-request identity deploy was still running after ${timeout}s — not deploying over it. Press Sandbox Up again when it has finished."
        exit 1
    fi
    echo "a pull-request identity deploy is in progress — waiting ${poll}s"
    sleep "$poll"
done
