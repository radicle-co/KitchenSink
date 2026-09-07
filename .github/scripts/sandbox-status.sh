#!/usr/bin/env bash
#
# Is the shared sandbox tier up, and therefore what should the e2e branch of the pipeline do?
#
# ⚠️  DELIBERATE — read docs/architecture/decisions/0028-on-demand-sandbox.md and
#     docs/architecture/decisions/0032-deployed-ecosystem-test-tier.md before changing this.
#
# ## Why a probe and not a label
#
# ADR-0028 made previews on-demand, and the switch was a `sandbox-up` label a human had to remember. A
# label is a single point of failure whose failure mode is SILENCE: forget it and every deployed tier
# skips, every check goes green, and the skip is indistinguishable from a pass. The pipeline can simply
# ASK whether the sandbox is up, so it does.
#
# ## What "up" means, precisely
#
# The SHARED tier — `kitchensink-alb-sandbox` and `kitchensink-identity-service-sandbox`, the two stacks
# `sandbox-shared-tier.sh` reclaims and `sandbox-up.yml` rebuilds — plus a database that is not in the
# nightly stopped window. It is deliberately NOT the per-PR preview: that is what the deploy CREATES, so
# testing for it would refuse the very first push of every PR.
#
# ## The three outcomes
#
#   run   — the tier is up. Deploy this PR's preview, migrate it, then test against it.
#   skip  — `skip-e2e` is present. An explicit human decision, recorded where a reviewer sees it.
#   fail  — the tier is down and nobody said that was intended.
#
# ⚠️ `skip-e2e` wins even when the tier IS up. The label says "this change does not need e2e", which is a
# statement about the change rather than about the environment; honouring it only when the sandbox happens
# to be down would make its meaning depend on infrastructure state.
#
# ⛔ `fail` is the point of the whole file. ADR-0032's ruling — a deployed tier SKIPS when the sandbox is
# not running, and a PR that ran none is GREEN — described a tier's behaviour, and it left the PR-level
# question unanswered: the ADR names the gap itself, "a PR merged without ever raising a sandbox has had no
# end-to-end test of any kind ... and neither is enforced by a check". This is that check. The tiers still
# skip; what changes is that the PIPELINE refuses to call that a pass unless somebody says so.
#
#   sandbox-status.sh verdict <tierUp:true|false> <skipLabel:true|false>   # pure
#   sandbox-status.sh probe   <region> <stage>                             # impure: prints up=true|false
set -uo pipefail

# The stacks whose presence IS the shared tier. Read from the reclaim allowlist rather than restated, so
# the thing that raises it, the thing that deletes it and the thing that detects it cannot disagree.
SANDBOX_STATUS_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# sandbox_status_verdict <tierUp> <skipLabel>
#
# Pure. Prints `branch=run|skip|fail` and `reason=<one line>`.
sandbox_status_verdict() {
    if [ "$#" -lt 2 ]; then
        echo "usage: sandbox-status.sh verdict <tierUp> <skipLabel>" >&2

        return 2
    fi

    local tier_up="$1" skip_label="$2"

    if [ "$skip_label" = 'true' ]; then
        printf 'branch=skip\nreason=%s\n' \
            'the skip-e2e label is present — no deployed testing for this change, recorded deliberately'

        return 0
    fi

    if [ "$tier_up" = 'true' ]; then
        printf 'branch=run\nreason=%s\n' \
            'the shared sandbox tier is up — deploying this preview, migrating it, then testing against it'

        return 0
    fi

    printf 'branch=fail\nreason=%s\n' \
        'the shared sandbox tier is DOWN, so nothing can be deployed or tested. Raise it with the sandbox-up workflow, or apply the skip-e2e label to record that this change does not need deployed testing.'
}

# sandbox_status_probe <region> <stage>
#
# Is the shared tier up? Prints `up=true|false` and `reason=`.
#
# ⚠️ A stack in a FAILED or rolling-back resting state is NOT up. `describe-stacks` answers for those
# happily, so a bare existence check reads a wedged tier as healthy — which is the shape ADR-0010's gate
# was written after.
#
# @sideEffect Calls CloudFormation.
sandbox_status_probe() {
    local region="${1-}" stage="${2-}"

    if [ "$#" -lt 2 ] || [ -z "$region" ] || [ -z "$stage" ]; then
        echo "usage: sandbox-status.sh probe <region> <stage>" >&2

        return 2
    fi

    local missing='' stack status
    for stack in $(bash "${SANDBOX_STATUS_SCRIPT_DIR}/sandbox-shared-tier.sh" order); do
        status=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
            --query 'Stacks[0].StackStatus' --output text 2>/dev/null) || status='ABSENT'

        case "$status" in
            CREATE_COMPLETE | UPDATE_COMPLETE | IMPORT_COMPLETE | UPDATE_ROLLBACK_COMPLETE) ;;
            *) missing="${missing} ${stack}(${status})" ;;
        esac
    done

    if [ -n "$missing" ]; then
        printf 'up=false\nreason=%s\n' "shared tier not usable:${missing}"

        return 0
    fi

    printf 'up=true\nreason=%s\n' "shared tier stacks are healthy at stage ${stage}"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1-}" in
        verdict)
            shift
            sandbox_status_verdict "$@"
            ;;
        probe)
            shift
            sandbox_status_probe "$@"
            ;;
        *)
            echo "usage: sandbox-status.sh verdict|probe …" >&2
            exit 2
            ;;
    esac
fi
