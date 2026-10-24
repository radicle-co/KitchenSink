#!/usr/bin/env bash
#
# Preflight for every `cdk deploy` in CI (ADR-0065): is KitchenSink's OWN CDK bootstrap present for the qualifier
# this stage deploys through?
#
# Every CDK app synthesizes for a KitchenSink-owned qualifier (`ksnonprod`, `ksprod`, `ksaccount`), and those
# bootstrap stacks exist only after the owner runs `docs/runbooks/cdkBootstrapQualifiers.md`. A deploy before then
# dies at AssumeRole on a role that does not exist, with an error that names neither the qualifier nor the cure.
# This script turns that into one `::error::` that does.
#
# THE CHECK: assume the qualifier's DEPLOY role with the credentials the job already holds — the very call the CDK
# CLI makes next. It needs no grant the CI roles lack (they already hold `sts:AssumeRole` on these roles), and
# unlike an SSM or IAM read it also proves the trust policy admits THIS job's role, which is the other half of
# "ready to deploy". IAM answers AccessDenied for a missing role and for a role that does not trust the caller
# alike, so the message names both; it never claims to know which.
#
# ⛔ FAIL CLOSED. Success means `sts assume-role` exited 0 AND printed a role-session ARN. An empty answer, an
# unreadable account, a missing region or any other error is a failure, never "present".
#
# The stage→qualifier rule is a twin of `qualifierForStage` (packages/infra/bootstrap/src/qualifiers.ts). A shell
# copy is permitted only while `bootstrapPreflight.test.ts` holds it equal to the TypeScript module.
#
# Usage:
#     bootstrapPreflight.sh qualifier <stage|account>         prints the qualifier
#     bootstrapPreflight.sh check <stage|account> <region>    exit 0 = present, 1 = absent/unreadable, 2 = misuse

set -euo pipefail

RUNBOOK='docs/runbooks/cdkBootstrapQualifiers.md'

# qualifier_for <stage>: `account` is the stage-less account app; only the exact token `prod` is production.
qualifier_for() {
    case "${1-}" in
    '') return 1 ;;
    account) printf 'ksaccount\n' ;;
    prod) printf 'ksprod\n' ;;
    *) printf 'ksnonprod\n' ;;
    esac
}

fail() {
    printf '::error title=CDK bootstrap missing::%s\n' "$1" >&2
    exit 1
}

usage() {
    echo "usage: bootstrapPreflight.sh qualifier <stage|account> | check <stage|account> <region>" >&2
    exit 2
}

cmd="${1-}"
stage="${2-}"

case "$cmd" in
qualifier)
    qualifier_for "$stage" || usage
    ;;
check)
    region="${3-}"
    qualifier=$(qualifier_for "$stage") || usage
    if [[ -z $region ]]; then
        usage
    fi

    if ! account=$(aws sts get-caller-identity --query Account --output text) || [[ ! $account =~ ^[0-9]{12}$ ]]; then
        fail "Cannot read the AWS account to check the CDK bootstrap for qualifier '${qualifier}' (stage '${stage}'). Treating it as NOT bootstrapped. See ${RUNBOOK}."
    fi

    role="arn:aws:iam::${account}:role/cdk-${qualifier}-deploy-role-${account}-${region}"
    if ! assumed=$(aws sts assume-role --role-arn "$role" --role-session-name bootstrapPreflight \
        --duration-seconds 900 --query AssumedRoleUser.Arn --output text 2>&1) || [[ $assumed != arn:aws:sts::* ]]; then
        fail "CDK bootstrap qualifier '${qualifier}' (stage '${stage}') is not usable: this job could not assume ${role}. Either the bootstrap stack has not been deployed or the role does not trust this CI role. The owner runs ${RUNBOOK} before the first deploy through a new qualifier."
    fi
    echo "CDK bootstrap qualifier '${qualifier}' is present for stage '${stage}'."
    ;;
*)
    usage
    ;;
esac
