#!/usr/bin/env bash
#
# The catalog seed step — ONE definition, which every deploy workflow that deploys food invokes from curated catalog
# plan U3 on (U2, R37, R38; KTD-4).
#
# ⚠️ Read docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md (KTD-1 to KTD-5) before changing this.
#
# ## What it proves
#
# The seed function applies the seed it was BUILT with: its asset directory holds the bundle and a copy of the
# committed `data/`. Invoked before the deploy that ships it, a function is the PREVIOUS release's and would apply
# the previous seed and report success. So this step digests the bundle the pipeline built and sends that digest;
# a function holding a different bundle refuses (`assertSeedBundleMatches` in `@kitchensink/db-schema-guard`).
#
# ## Why this is a SECOND implementation and not a call into the TypeScript one
#
# Deliberate, as for the migration manifest. A single shared helper can be wrong identically on both sides and still
# agree; two independent implementations cannot, because sha256 has exactly one right answer. Both render
# `<64 hex><space><space><path><newline>` per regular file, C-ordered by bundle-relative path, and digest the text.
# `packages/infra/global/__tests__/seedManifestAgreement.test.ts` runs both over the same trees and asserts they
# agree on the text as well as the digest.
#
# ⛔ The path contract makes that possible: every path segment is plain ASCII from `[A-Za-z0-9._-]`, so C collation
# is byte order and `sha256sum` never escapes a name. A symlink, a special file, or a path outside the contract is
# REFUSED by both halves, never followed or skipped, and so is a tree with no file: `sha256('')` is a well-formed
# digest that proves nothing.
#
# ## Resolve, invoke and classify are `runMigrations.sh`'s
#
# Sourced, not copied: `run_migrations_resolve` (an absent stack is a stated skip, an unanswerable lookup fails
# closed), `run_migrations_invoke` (ONE attempt, read past Lambda's maximum) and `run_migrations_classify` (the one
# definition of whether a pipeline Lambda succeeded) are shared with the migrate step.
#
# ## Usage
#
#     runSeed.sh manifest <bundleDir>
#     runSeed.sh run      <region> <stackName> <outputKey> <label> <bundleDir>
#
# Exit status: 0 = the seed applied (or there is no stack to seed), 1 = the seed failed or could not be reached, 2 =
# misuse. A misuse NEVER exits 0.
set -uo pipefail

# shellcheck source=runMigrations.sh
source "$(dirname "${BASH_SOURCE[0]}")/runMigrations.sh"

# run_seed_render <bundleDir>
#
# The seed manifest TEXT of a bundle directory, or a refusal on stderr with exit 1.
run_seed_render() {
    local dir="${1-}"

    if [ "$#" -lt 1 ] || [ -z "$dir" ]; then
        echo "usage: runSeed.sh manifest <bundleDir>" >&2

        return 2
    fi

    if [ ! -d "$dir" ]; then
        echo "::error::seed bundle '${dir}' does not exist or is not a directory, so no seed can be named" >&2

        return 1
    fi

    local symlinks specials unsafe='' path
    symlinks=$(cd "$dir" && find . -mindepth 1 -type l -printf '%P\n' | LC_ALL=C sort | tr '\n' ' ')
    specials=$(cd "$dir" && find . -mindepth 1 ! -type f ! -type d ! -type l -printf '%P\n' | LC_ALL=C sort | tr '\n' ' ')

    if [ -n "$symlinks" ]; then
        echo "::error::seed bundle '${dir}' holds a symlink, which would be digested differently by the two halves: ${symlinks}" >&2

        return 1
    fi

    if [ -n "$specials" ]; then
        echo "::error::seed bundle '${dir}' holds a special file: ${specials}" >&2

        return 1
    fi

    # ⛔ NUL-delimited: a name holding a newline is exactly one this must refuse, so it must not split it first.
    while IFS= read -r -d '' path; do
        if ! LC_ALL=C bash -c '[[ "$1" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]]' _ "$path"; then
            unsafe="${unsafe}$(printf '%q' "$path") "
        fi
    done < <(cd "$dir" && find . -type f -printf '%P\0')

    if [ -n "$unsafe" ]; then
        echo "::error::seed bundle '${dir}' holds a path outside the seed path contract ([A-Za-z0-9._-] segments): ${unsafe}" >&2

        return 1
    fi

    local rendered
    rendered=$(cd "$dir" && find . -type f -printf '%P\0' | LC_ALL=C sort -z | xargs -0 -r sha256sum --) || {
        echo "::error::could not read every file in seed bundle '${dir}', so no seed can be named" >&2

        return 1
    }

    if [ -z "$rendered" ]; then
        echo "::error::seed bundle '${dir}' holds no regular file — an empty bundle proves nothing" >&2

        return 1
    fi

    printf '%s\n' "$rendered"
}

# run_seed_manifest <bundleDir>
#
# The seed digest of a bundle directory: the sha256 of its manifest text.
run_seed_manifest() {
    local rendered status=0

    rendered=$(run_seed_render "$@") || status=$?

    if [ "$status" -ne 0 ]; then
        return "$status"
    fi

    printf '%s\n' "$rendered" | sha256sum | cut -d' ' -f1
}

# run_seed_run <region> <stackName> <outputKey> <label> <bundleDir>
#
# Digest the bundle, resolve the seed function from the stack's own output, invoke `apply` with the digest, and
# classify the answer.
#
# ⛔ The digest is computed BEFORE the stack is looked up, so a bad bundle path fails on EVERY run rather than only
# on stages that have a stack.
#
# @sideEffect Calls CloudFormation and Lambda, and writes temp files.
run_seed_run() {
    local region="${1-}" stack="${2-}" output_key="${3-}" label="${4-}" bundle_dir="${5-}"

    if [ "$#" -lt 5 ] || [ -z "$region" ] || [ -z "$stack" ] || [ -z "$output_key" ] || [ -z "$label" ] ||
        [ -z "$bundle_dir" ]; then
        echo "usage: runSeed.sh run <region> <stackName> <outputKey> <label> <bundleDir>" >&2

        return 2
    fi

    local expect_seed
    expect_seed=$(run_seed_manifest "$bundle_dir") || return 1

    local resolved=0
    run_migrations_resolve "$region" "$stack" "$output_key" "$label" seed || resolved=$?

    case "$resolved" in
        0) ;;
        3) return 0 ;;
        *) return 1 ;;
    esac

    echo "[${label}] invoking seed function ${RESOLVED_FUNCTION}, expecting seed manifest ${expect_seed}"

    # ⛔ `action` and `expectSeedSha` and NOTHING else: the function parses its event strictly.
    local verdict reason
    verdict=$(run_migrations_invoke "$region" "$RESOLVED_FUNCTION" \
        "{\"action\":\"apply\",\"expectSeedSha\":\"${expect_seed}\"}") || return 2
    reason=$(printf '%s' "$verdict" | sed -n 's/^reason=//p')

    case "$verdict" in
        verdict=ok*)
            echo "[${label}] ${reason}"

            return 0
            ;;
        *)
            echo "::error::[${label}] catalog seed FAILED — ${reason}"

            return 1
            ;;
    esac
}

# CLI dispatch — only when executed directly, never when sourced.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        manifest)
            shift
            run_seed_manifest "$@"
            ;;
        run)
            shift
            run_seed_run "$@"
            ;;
        *)
            echo "usage: runSeed.sh manifest|run …" >&2
            exit 2
            ;;
    esac
fi
