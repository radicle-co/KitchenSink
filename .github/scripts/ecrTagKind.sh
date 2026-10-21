#!/usr/bin/env bash
#
# Sourced, never run. Answers one question for the ECR scripts: what KIND of tag is this — content, preview or release?
#
# A CONTENT tag starts with `ECR_CONTENT_TAG_PREFIX`. The previews are the retention policy's other tag prefixes
# (`sandbox-`, `pr-`), read from ecrLifecyclePolicy.json so `ecrPushVerdict.sh`, `ecrRecordRelease.sh` and
# `ecrEnsureRepo.sh` share ONE authority. Any other tag is a RELEASE tag.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/ecrTagKind.sh"
#   case "$(ecr_tag_kind "$TAG")" in content) …;; preview) …;; release) …;; esac
#
# @sideEffect Reads ecrLifecyclePolicy.json.

# The CONTENT tag prefix: `imageTag.sh content <key>` names an image by a hash of what it is built from
# (`deployKey.sh`), never by a commit. A content tag is IMMUTABLE: the retention policy keeps it under a rule of its
# own, and `ecrEnsureRepo.sh` leaves this prefix OUT of the mutable set it derives from that policy. ONE definition.
ECR_CONTENT_TAG_PREFIX='ck-'

# The preview prefixes: every retention-policy prefix except the content prefix, one per line.
ecr_preview_prefixes() {
    local policy
    policy="$(dirname "${BASH_SOURCE[0]}")/ecrLifecyclePolicy.json"
    jq -r --arg content "$ECR_CONTENT_TAG_PREFIX" \
        '[.rules[].selection.tagPrefixList // [] | .[] | select(. != $content)] | unique | .[]' "$policy"
}

ecr_tag_is_content() {
    case "$1" in
        "${ECR_CONTENT_TAG_PREFIX}"*) return 0 ;;
    esac
    return 1
}

ecr_tag_is_preview() {
    local tag="$1" prefix
    while IFS= read -r prefix; do
        case "$tag" in
            "${prefix}"*) return 0 ;;
        esac
    done < <(ecr_preview_prefixes)
    return 1
}

# One kind per tag: `content`, `preview` or `release`.
ecr_tag_kind() {
    if ecr_tag_is_content "$1"; then
        echo content
    elif ecr_tag_is_preview "$1"; then
        echo preview
    else
        echo release
    fi
}

# Where production records the digest it pushed under a release tag. Only the production CI role can write under
# /kitchensink/prod/ (the non-prod role has no write there), so an entry is proof that PRODUCTION pushed the image.
ecr_release_ledger_name() {
    printf '/kitchensink/prod/releaseImages/%s/%s' "$1" "$2"
}
