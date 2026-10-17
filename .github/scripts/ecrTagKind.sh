#!/usr/bin/env bash
#
# Sourced, never run. Answers one question for the ECR release scripts: is this tag a PREVIEW tag?
#
# The previews are the retention policy's own tag prefixes (`sandbox-`, `pr-`), read from ecrLifecyclePolicy.json so
# `ecrPushVerdict.sh` and `ecrRecordRelease.sh` share ONE authority with `ecrEnsureRepo.sh`. Any other tag is a RELEASE
# tag.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/ecrTagKind.sh"
#   if ecr_tag_is_preview "$TAG"; then …; fi
#
# @sideEffect Reads ecrLifecyclePolicy.json.

ecr_tag_is_preview() {
    local tag="$1" prefix policy
    policy="$(dirname "${BASH_SOURCE[0]}")/ecrLifecyclePolicy.json"
    while IFS= read -r prefix; do
        case "$tag" in
            "${prefix}"*) return 0 ;;
        esac
    done < <(jq -r '[.rules[].selection.tagPrefixList // [] | .[]] | unique | .[]' "$policy")
    return 1
}

# Where production records the digest it pushed under a release tag. Only the production CI role can write under
# /kitchensink/prod/ (the non-prod role has no write there), so an entry is proof that PRODUCTION pushed the image.
ecr_release_ledger_name() {
    printf '/kitchensink/prod/releaseImages/%s/%s' "$1" "$2"
}
