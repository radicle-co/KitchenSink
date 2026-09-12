#!/usr/bin/env bash
#
# The postcondition on a LOCAL e2e run: it executed at least one test, failed none, and skipped none.
#
# ⛔ WHY IT EXISTS. `docs/CODING_STANDARDS.md` §7.1a says a LOCAL-target e2e suite never skips, because there is
# always a container to run. Vitest cannot hold that on its own. Every LOCAL suite here gates on
# `describe.skipIf(!hasTestDatabase)`, so a job whose `DATABASE_ADMIN_URL` is missing or misspelled skips every
# test and exits 0: a green check over a tier that never ran. `passWithNoTests: false` does not catch it either,
# because a skipped test is still a test. This script reads vitest's JSON report and refuses that run.
#
# ⚠️ It refuses ANY skip, not only an empty run. A check that asked only for "more than zero" would pass a run
# that skipped 40 of 41 tests.
# ⚠️ It refuses a failed test too, although vitest has already failed the step by then, so an excused test
# step still cannot reach green through here.
#
# Usage:  assertLocalTierRan.sh <vitestJsonReport> <label>
# Exit:   0  at least one test executed, and none failed, was skipped or was left todo
#         1  anything else, with a GitHub `::error::` line saying which
#         2  misuse: wrong arguments, or no `jq` to read the report with
#
# `packages/infra/global/__tests__/testTierWiring.test.ts` runs this file over fixture reports, and checks that
# every LOCAL job runs it, after its tests, on the report its test step writes.

set -euo pipefail

if [ "$#" -ne 2 ] || [ -z "${1}" ] || [ -z "${2}" ]; then
    echo "usage: assertLocalTierRan.sh <vitestJsonReport> <label>" >&2
    exit 2
fi

report=$1
label=$2

if ! command -v jq > /dev/null 2>&1; then
    echo "::error::assertLocalTierRan.sh needs jq to read ${report}"
    exit 2
fi

if [ ! -f "${report}" ]; then
    echo "::error::the ${label} LOCAL e2e run wrote no report at ${report}, so nothing shows that it ran"
    exit 1
fi

# One program reads the four counts vitest's JSON reporter writes, and yields nothing unless all four are
# non-negative whole numbers. `-e` turns "nothing" into a non-zero exit, and a parse error is one already.
if ! counts=$(jq -er '
    [.numPassedTests, .numFailedTests, .numPendingTests, .numTodoTests]
    | if all(type == "number" and . >= 0 and . == floor)
      then "\(.[0] + .[1]) \(.[1]) \(.[2] + .[3])"
      else empty
      end
' "${report}" 2> /dev/null); then
    echo "::error::${report} is not a vitest JSON report: numPassedTests, numFailedTests, numPendingTests and numTodoTests must all be whole numbers"
    exit 1
fi

read -r executed failed not_run <<< "${counts}"

if [ "${executed}" -eq 0 ]; then
    echo "::error::the ${label} LOCAL e2e run executed no test. A LOCAL suite never skips (docs/CODING_STANDARDS.md §7.1a): check that the job starts its database and passes DATABASE_ADMIN_URL to the test step"
    exit 1
fi

if [ "${failed}" -ne 0 ]; then
    echo "::error::the ${label} LOCAL e2e run failed ${failed} test(s)"
    exit 1
fi

if [ "${not_run}" -ne 0 ]; then
    echo "::error::the ${label} LOCAL e2e run did not run ${not_run} test(s) (skipped or todo) beside ${executed} it did. A LOCAL suite never skips (docs/CODING_STANDARDS.md §7.1a)"
    # The names, so the log says which gate fired. The list is a courtesy and the verdict is the exit below,
    # so a report whose per-test detail cannot be read still fails with status 1.
    jq -r '
        [.testResults[]?.assertionResults[]? | select(.status? != "passed" and .status? != "failed")]
        | .[:20][]
        | "::error::  not run: \(.fullName? // .title? // "(unnamed)")"
    ' "${report}" 2> /dev/null || true
    exit 1
fi

echo "${label} LOCAL e2e: ${executed} test(s) executed, none failed, none skipped"
