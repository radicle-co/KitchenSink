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
# The SHARED tier that must PRE-EXIST for a preview to be deployable at all: the ALB a service attaches its
# host rule to, and the identity service every preview signs in against. It is deliberately NOT the per-PR
# preview — that is what the deploy CREATES, so testing for it would refuse the very first push of every PR.
#
# ⛔ AND IT IS NOT SIMPLY "everything the reclaim deletes". The reclaim allowlist answers a DIFFERENT
# question — what may be destroyed when the tier is released — and a stack can be reclaimable without being
# a precondition. `kitchensink-identity-schema-{stage}` is exactly that: it is reclaimed with the tier, and
# it is CREATED by the deploy this probe gates. Requiring it here is circular, and the circle closes:
# the tier reads down, the branch fails, the deploy never runs, the stack is never created, the tier never
# reads up. Measured — the first live run of this probe returned `up=false` against a sandbox whose ALB and
# identity service were both `UPDATE_COMPLETE`.
#
# So the precondition set is the allowlist MINUS what the deploy stands up, matched by shape rather than by
# name, so a second schema stack added to the allowlist tomorrow is excluded without anyone remembering to.
#
# ## The two outcomes
#
#   run   — the tier is up. Deploy this PR's preview, migrate it, then test against it.
#   skip  — the tier is down (it starts only by hand, via the Sandbox Up workflow), or `skip-e2e` is present, or
#           the event is not a pull request. A job that needs the sandbox SKIPS; it never fails for that.
#
# ⛔ OWNER RULING 2026-10-12 (docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md, D2): "A job that needs
# the sandbox SKIPS when it is down. It never fails for that reason." There used to be a third outcome, `fail`,
# for a tier that was down with nobody having said so; it turned a stopped sandbox, the normal resting state,
# into a red check on every PR. It is deleted rather than disabled. The reason a skip prints still says DOWN and
# names Sandbox Up, so a skip is never mistaken for a pass.
#
# ⚠️ `skip-e2e` wins even when the tier IS up. The label says "this change does not need e2e", which is a
# statement about the change rather than about the environment; honouring it only when the sandbox happens
# to be down would make its meaning depend on infrastructure state.
#
#   sandboxStatus.sh verdict <event> <tierUp:true|false> <skipLabel:true|false>   # pure
#   sandboxStatus.sh probe   <region> <stage>                             # impure: prints up=true|false
set -uo pipefail

# The stacks whose presence IS the shared tier. Read from the reclaim allowlist rather than restated, so
# the thing that raises it, the thing that deletes it and the thing that detects it cannot disagree.
SANDBOX_STATUS_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# sandbox_status_verdict <event> <tierUp> <skipLabel>
#
# Pure. Prints `branch=run|skip` and `reason=<one line>`.
sandbox_status_verdict() {
    if [ "$#" -lt 3 ]; then
        echo "usage: sandboxStatus.sh verdict <event> <tierUp> <skipLabel>" >&2

        return 2
    fi

    local event="$1" tier_up="$2" skip_label="$3"

    # ⛔ Only a pull request can be gated. `main` has no preview to deploy and no merge decision attached,
    # and a push or a schedule is not somebody proposing a change — failing those would red the default
    # branch for a property that has nothing to say about it.
    if [ "$event" != 'pull_request' ]; then
        printf 'branch=skip\nreason=%s\n' "not a pull request (${event}) — no preview to deploy, nothing to gate"

        return 0
    fi

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

    printf 'branch=skip\nreason=%s\n' \
        'the shared sandbox tier is DOWN, so nothing is deployed or tested here. It starts only by hand: run the Sandbox Up workflow for this PR. This is a skip, not a pass.'
}

# sandbox_status_probe <region> <stage>
#
# Is the shared tier up? Prints `up=true|false` and `reason=`, exit 0. Exit 1 when the status check ERRORS: an
# error is not an answer, and calling it "down" would turn an AWS outage into a silent skip.
#
# Two questions, in order: are the shared stacks healthy (CloudFormation), and are the database and NAT under
# them running (`sandboxWake.sh check`, read-only)? The second is the one the nightly stop changes: it leaves
# every stack `UPDATE_COMPLETE` while RDS and the NAT are stopped, so the first alone answers "up" for a sandbox
# that is down (2026-10-12 plan, finding 2).
#
# ⚠️ A stack in a FAILED or rolling-back resting state is NOT up. `describe-stacks` answers for those
# happily, so a bare existence check reads a wedged tier as healthy — which is the shape ADR-0010's gate
# was written after.
#
# @sideEffect Calls CloudFormation, RDS and EC2 (describe calls only).
sandbox_status_probe() {
    local region="${1-}" stage="${2-}"

    if [ "$#" -lt 2 ] || [ -z "$region" ] || [ -z "$stage" ]; then
        echo "usage: sandboxStatus.sh probe <region> <stage>" >&2

        return 2
    fi

    # ⚠️ An `*_IN_PROGRESS` status is not an answer yet, so it is WAITED OUT, bounded, and the probe judges
    # where the stack lands. A single snapshot failed unrelated PR runs whenever a concurrent deploy was
    # mid-flight — measured: run 34551502976 went red on `kitchensink-identity-service-sandbox
    # (UPDATE_IN_PROGRESS)` because the same push had triggered "Sandbox Identity Deploy". The bound matters as
    # much as the wait: a stack that never settles is NOT up, and a probe that could wait forever is a pipeline
    # that could hang forever. Absent and failed states are answers already and are never waited on.
    local settle="${SANDBOX_STATUS_SETTLE_SECONDS:-900}" poll="${SANDBOX_STATUS_POLL_SECONDS:-20}"
    local deadline=$((SECONDS + ${settle%.*}))
    local missing='' stack status
    for stack in $(bash "${SANDBOX_STATUS_SCRIPT_DIR}/sandboxSharedTier.sh" order); do
        # ⛔ A schema stack is reclaimed WITH the tier but CREATED BY the deploy this probe gates, so it is
        # not a precondition. See the header: requiring it deadlocks the pipeline against itself.
        case "$stack" in
            *-schema-*) continue ;;
        esac

        while :; do
            status=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
                --query 'Stacks[0].StackStatus' --output text 2>/dev/null) || status='ABSENT'

            case "$status" in
                *_IN_PROGRESS) ;;
                *) break ;;
            esac

            if [ "$SECONDS" -ge "$deadline" ]; then
                status="${status}, still after ${settle}s"
                break
            fi

            echo "sandbox-status: ${stack} is ${status}; waiting for it to settle" >&2
            sleep "$poll"
        done

        case "$status" in
            CREATE_COMPLETE | UPDATE_COMPLETE | IMPORT_COMPLETE | UPDATE_ROLLBACK_COMPLETE) ;;
            *) missing="${missing} ${stack}(${status})" ;;
        esac
    done

    if [ -n "$missing" ]; then
        printf 'up=false\nreason=%s\n' "shared tier not usable:${missing}"

        return 0
    fi

    local check_status=0
    bash "${SANDBOX_STATUS_SCRIPT_DIR}/sandboxWake.sh" check "$region" || check_status=$?

    case "$check_status" in
        0) ;;
        3)
            printf 'up=false\nreason=%s\n' \
                'the sandbox database or NAT is stopped (or the nightly stop is near) — shared tier stacks exist but nothing runs under them'

            return 0
            ;;
        *)
            printf 'up=error\nreason=%s\n' "the sandbox status check could not answer (exit ${check_status})"

            return 1
            ;;
    esac

    printf 'up=true\nreason=%s\n' "shared tier stacks are healthy and the database and NAT are running at stage ${stage}"
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
            echo "usage: sandboxStatus.sh verdict|probe …" >&2
            exit 2
            ;;
    esac
fi
