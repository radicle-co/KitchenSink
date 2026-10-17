#!/usr/bin/env bash
# Resolve the paid-features gate for one stage and export it as PAID_FEATURES_GATE for the steps after this one.
#
# Usage: resolvePaidFeaturesGate.sh STAGE
#
# The truth is two GitHub repository variables the OWNER sets and flips (ruling 2026-10-13): PAID_FEATURES_GATE_PROD
# for `prod`, PAID_FEATURES_GATE_SANDBOX for `sandbox` — which is also every `pr-{N}` preview, because identity is
# shared and deploys only at those two stages. The workflow passes both through `env:`; nothing here sets them.
# Identity's CDK app reads `process.env['PAID_FEATURES_GATE'] === 'true'` at synth
# (plan docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md D9).
#
# Fails CLOSED: any other stage, an unset or empty variable, and anything but the exact string `true` resolve to
# `false`, the value that shows no upsell. The gate never decides who may USE a paid feature, so `false` never
# takes one away from an entitled user.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
    echo "::error::usage: resolvePaidFeaturesGate.sh STAGE" >&2
    exit 2
fi

stage="$1"

case "$stage" in
    prod) raw="${PAID_FEATURES_GATE_PROD-}" ;;
    sandbox) raw="${PAID_FEATURES_GATE_SANDBOX-}" ;;
    *) raw='' ;;
esac

if [ "$raw" = 'true' ]; then
    value='true'
else
    value='false'
fi

bash "$(dirname "$0")/safeEnv.sh" PAID_FEATURES_GATE "${value}"
echo "paid-features gate for ${stage}: ${value}"
