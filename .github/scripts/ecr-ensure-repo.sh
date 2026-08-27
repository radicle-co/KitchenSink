#!/usr/bin/env bash
#
# Ensure an ECR repository exists AND carries the retention policy.
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
#   ecr-ensure-repo.sh <repositoryName>
set -euo pipefail

REPO="${1-}"
POLICY="$(dirname "${BASH_SOURCE[0]}")/ecr-lifecycle-policy.json"

if [ -z "$REPO" ]; then
    echo 'usage: ecr-ensure-repo.sh <repositoryName>' >&2
    exit 2
fi
if [ ! -f "$POLICY" ]; then
    echo "::error::ecr-ensure-repo: retention policy not found at ${POLICY}" >&2
    exit 1
fi

aws ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$REPO" >/dev/null

# Idempotent: `put-lifecycle-policy` replaces whatever is there, so re-running is how a policy change
# reaches every repository without a separate migration.
aws ecr put-lifecycle-policy --repository-name "$REPO" --lifecycle-policy-text "file://${POLICY}" >/dev/null
echo "[ecr] ${REPO}: exists, retention policy applied"
