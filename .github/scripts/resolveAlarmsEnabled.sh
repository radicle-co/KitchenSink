#!/usr/bin/env bash
# Resolve the alarm feature flag for one stage and export it as ALARMS_ENABLED for the steps after this one.
#
# Usage: resolveAlarmsEnabled.sh STAGE
#
# The per-stage truth is SSM `/kitchensink/{stage}/observability/alarms-enabled`. Every CDK app that owns alarms
# reads `process.env['ALARMS_ENABLED'] === 'true'` at synth (`packages/infra/global/bin/app.ts` says why it cannot read
# SSM itself), so every deploy path runs this before it deploys one; `alarmFeatureFlag.test.ts` holds them to it.
# An ABSENT parameter resolves to `false`: a stage that never set it deploys no alarms. Any other failure (a throttle,
# a denied read) stops the step, because reading it as `false` would have CloudFormation delete the stage's live alarms.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
    echo "::error::usage: resolveAlarmsEnabled.sh STAGE" >&2
    exit 2
fi

stage="$1"
parameter="/kitchensink/${stage}/observability/alarms-enabled"
errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

if value=$(aws ssm get-parameter --name "$parameter" --query 'Parameter.Value' --output text 2>"$errors"); then
    :
elif grep -q 'ParameterNotFound' "$errors"; then
    value='false'
else
    echo "::error::could not read ${parameter}: $(head -c 300 "$errors")" >&2
    exit 1
fi
bash "$(dirname "$0")/safeEnv.sh" ALARMS_ENABLED "${value}"
echo "alarms for ${stage}: ${value}"
