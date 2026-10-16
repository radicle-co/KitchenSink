#!/usr/bin/env bash
# Decide the `CI verdict` of `_ci.yml`: the ONE stable check name a branch ruleset can require.
#
# Usage: NEEDS_JSON='<needs context>' SANDBOX_MAY_SKIP='job-a job-b' ciVerdict.sh
#
# NEEDS_JSON is `toJSON(needs)` of the verdict job: { "<job id>": { "result": "...", "outputs": {...} }, ... }.
# SANDBOX_MAY_SKIP is the space-separated list of job ids allowed to skip because they depend on the sandbox.
#
# Green means every needed job is `success`, or `skipped` AND listed in SANDBOX_MAY_SKIP. Everything else is red:
# `failure`, `cancelled`, any other or missing result, and a skip of a job that does not depend on the sandbox
# (owner rule 2026-10-03: a check may skip only for the sandbox; a green over a job that never ran claims
# something false). An empty or unreadable needs set fails closed, so a verdict wired to nothing cannot pass.
set -euo pipefail

needs_json="${NEEDS_JSON-}"
may_skip=" ${SANDBOX_MAY_SKIP-} "
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"

if ! jobs_tsv="$(printf '%s' "$needs_json" | jq -r 'to_entries | sort_by(.key)[] | [.key, (.value.result // "missing")] | @tsv' 2>/dev/null)" \
    || [ -z "$jobs_tsv" ]; then
    echo "::error::ciVerdict: NEEDS_JSON is empty or not a needs context; refusing to pass on no evidence" >&2
    exit 2
fi

failures=0
{
    echo "### CI verdict"
    echo
    echo "| Job | Result | Verdict |"
    echo "| --- | --- | --- |"
} >>"$summary_file"

while IFS=$'\t' read -r job result; do
    case "$result" in
        success)
            verdict='ok'
            ;;
        skipped)
            case "$may_skip" in
                *" $job "*) verdict='ok (skipped: depends on the sandbox)' ;;
                *)
                    verdict='FAIL: skipped, but this job does not depend on the sandbox'
                    failures=$((failures + 1))
                    ;;
            esac
            ;;
        *)
            verdict="FAIL: ${result}"
            failures=$((failures + 1))
            ;;
    esac
    echo "${job}: ${result} -> ${verdict}"
    echo "| ${job} | ${result} | ${verdict} |" >>"$summary_file"
done <<<"$jobs_tsv"

if [ "$failures" -gt 0 ]; then
    echo "::error::CI verdict: ${failures} job(s) not green" >&2
    echo "${failures} job(s) not green." >>"$summary_file"
    exit 1
fi

echo "CI verdict: green"
echo "Green." >>"$summary_file"
