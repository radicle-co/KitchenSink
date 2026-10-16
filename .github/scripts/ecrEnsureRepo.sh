#!/usr/bin/env bash
#
# Ensure an ECR repository exists, carries the retention policy, and keeps its RELEASE tags immutable.
#
# ⚠️  DELIBERATE — the second half is the point. These repositories are created ad-hoc by the deploy
# workflows (`describe || create`), never by CDK, so nothing ever gave them a lifecycle policy. By
# 2026-08-27 the three of them held **1,258 images and 716 GB** with no retention at all, billing ~$40/mo.
#
# The shape of that storage is what the policy exploits: 1,194 of those images were preview builds
# (`sandbox-*`, `pr-*`) and only 45 were prod. Every push to every PR builds and pushes into the SAME
# repository as prod, so previews outnumber releases ~26:1.
#
# ⛔ Prod images are tagged with a BARE 40-hex git SHA, which matches neither prefix, so no rule selects
# them. They are excluded STRUCTURALLY, not by counting — and that distinction is load-bearing: a naive
# "keep the newest N" would have deleted the images prod is running, which sat at ranks #202, #241 and #201
# by push date behind ~200 newer preview builds. Do not "simplify" this to a single `tagStatus: any` rule.
#
# Verify any change with `aws ecr start-lifecycle-policy-preview` before applying it. The preview reports
# exactly which images a policy would expire, and it is the only way to know a retention number is safe.
#
# AMENDED 2026-08-30 — retention 200 -> 50. Re-measured by preview against the live repositories before
# applying: 450 images and 272 GB selected (150 per repository), ECR $38.64 -> $11.40/month, and ZERO
# prod-shaped tags among them — the running releases (`kitchensink-identity:1422c4b8…`,
# `kitchensink-{food,recipes}:67f56925…`) were absent from all three expiry sets. keep-200 was chosen when
# the repositories held 716 GB and the safe floor was unknown; the structural exclusion is what makes 50 as
# safe as 200, which `packages/infra/global/__tests__/ecrRetentionPolicy.test.ts` now asserts directly.
#
# ⛔ RELEASE TAGS ARE IMMUTABLE (CI roles security review, MEDIUM-1). The non-prod CI role is assumable by any branch's
# workflow and pushes previews into these same repositories, so with MUTABLE tags a branch could re-point the tag
# production runs. Production pulls by tag and the tag is the commit (`<sha>`, `prod-<sha>`), while previews write
# `sandbox-<sha>` and `pr-<n>-<sha>`; so the repository is IMMUTABLE_WITH_EXCLUSION, and the exclusions (the tags that
# stay mutable) are exactly the retention policy's preview prefixes, read from ecrLifecyclePolicy.json so the two
# cannot disagree. ⚠️ A release push to an existing immutable tag fails, so a rerun of a production commit must skip
# its build: `ecrPushVerdict.sh` answers push or skip, and the workflows ask it first.
#
# Only the production role may CHANGE a repository's mutability (the non-prod role would otherwise be able to switch
# the protection off). A preview run that finds a repository not yet immutable warns and carries on; the next
# production deploy fixes it. A repository this script CREATES is immutable from the start.
#
#   ecrEnsureRepo.sh <repositoryName>
set -euo pipefail

REPO="${1-}"
POLICY="$(dirname "${BASH_SOURCE[0]}")/ecrLifecyclePolicy.json"

if [ -z "$REPO" ]; then
    echo 'usage: ecrEnsureRepo.sh <repositoryName>' >&2
    exit 2
fi
if [ ! -f "$POLICY" ]; then
    echo "::error::ecr-ensure-repo: retention policy not found at ${POLICY}" >&2
    exit 1
fi

# The tags that stay mutable: every prefix the retention policy expires, as a wildcard. One value per line, sorted.
MUTABLE_FILTERS="$(jq -r '[.rules[].selection.tagPrefixList // [] | .[] | . + "*"] | unique | .[]' "$POLICY")"
if [ -z "$MUTABLE_FILTERS" ]; then
    echo "::error::ecr-ensure-repo: ${POLICY} names no tag prefix, so no tag would be mutable and previews could not be rebuilt" >&2
    exit 1
fi

filter_args=()
while IFS= read -r filter; do
    filter_args+=("filterType=WILDCARD,filter=${filter}")
done <<<"$MUTABLE_FILTERS"

# Empty when the repository does not exist (or cannot be described, which is handled as absent, as it always was).
repository_json="$(aws ecr describe-repositories --repository-names "$REPO" --output json 2>/dev/null || true)"

if [ -z "$repository_json" ]; then
    aws ecr create-repository --repository-name "$REPO" \
        --image-tag-mutability IMMUTABLE_WITH_EXCLUSION \
        --image-tag-mutability-exclusion-filters "${filter_args[@]}" >/dev/null
else
    current_mutability="$(jq -r '.repositories[0].imageTagMutability // ""' <<<"$repository_json")"
    current_filters="$(jq -r '[.repositories[0].imageTagMutabilityExclusionFilters // [] | .[] | .filter] | sort | .[]' <<<"$repository_json")"

    if [ "$current_mutability" != 'IMMUTABLE_WITH_EXCLUSION' ] || [ "$current_filters" != "$MUTABLE_FILTERS" ]; then
        if ! aws ecr put-image-tag-mutability --repository-name "$REPO" \
            --image-tag-mutability IMMUTABLE_WITH_EXCLUSION \
            --image-tag-mutability-exclusion-filters "${filter_args[@]}" >/dev/null; then
            echo "::warning::ecr-ensure-repo: ${REPO} is ${current_mutability:-unknown}, not IMMUTABLE_WITH_EXCLUSION, and this role may not change that. The next production deploy does; until then a branch job can re-point a release tag." >&2
        fi
    fi
fi

# Idempotent: `put-lifecycle-policy` replaces whatever is there, so re-running is how a policy change
# reaches every repository without a separate migration.
aws ecr put-lifecycle-policy --repository-name "$REPO" --lifecycle-policy-text "file://${POLICY}" >/dev/null
echo "[ecr] ${REPO}: exists, release tags immutable, retention policy applied"
