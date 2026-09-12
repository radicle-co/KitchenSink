/**
 * THE name of the message-substrate table for a stage (R1, plan U5) — one function, every consumer.
 *
 * It needs an owner because the name is the **teardown boundary**. ADR-0005 records that the per-PR cleanup
 * has no denylist: it deletes everything matching `pr-{N}` by tag OR name, and its safety depends entirely
 * on the delimiter rule in `.github/scripts/pr-scope.sh` (`pr-{N}` exactly, or `pr-{N}-…`, so `pr-1` never
 * matches `pr-15`). A table named by hand in two places is two chances to put a base-stage table inside
 * that match, or a per-PR table outside it — the first deletes production data, the second leaks a table
 * per closed pull request forever.
 *
 * Producers resolve the name from SSM at deploy time (plan U6) rather than calling this, so this is the
 * INFRASTRUCTURE authority; the runtime authority is the parameter the stacks publish.
 *
 * @param stage - The deploy stage (`prod`, `sandbox`, `pr-{N}`, …).
 * @returns The table name for that stage.
 */
export function messageTableNameForStage(stage: string): string {
    return `kitchensink-messages-${stage}`;
}

/** The SSM path a stage's producers read the table NAME from (plan U6). */
export function messageTableNameParameter(stage: string): string {
    return `/kitchensink/${stage}/messaging/table-name`;
}

/** The SSM path a stage's producers read the table ARN from (plan U6). */
export function messageTableArnParameter(stage: string): string {
    return `/kitchensink/${stage}/messaging/table-arn`;
}

/**
 * Which stage's SSM parameters hold the table a deploy should publish to. Pure.
 *
 * ⛔ There is ONE substrate table per stage, not one per producer — a consumer queries a group, and a group
 * must not be split across tables. But there are TWO producers per `pr-{N}` preview (food's resolution
 * pipeline and the recipe import processors), and both deploy their own stack. If each created a table they
 * would collide on the name; if each created a *differently* named one, a group would be split.
 *
 * So the food service OWNS the per-PR table and publishes its name/ARN to this stage's SSM paths, and every
 * other per-PR producer READS them. That ordering is already guaranteed: ADR-0010's `deploy-food` job gates
 * `deploy-recipe`, and food is ensure-exists deployed for every non-closed pull-request event, so the
 * parameters exist before any reader runs.
 *
 * A base stage resolves to itself, where `MessageSubstrateStack` is the owner.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The persistent platform stage this deploy rides.
 * @returns The stage whose SSM parameters name the table to publish to.
 */
export function messageTableStageFor(stage: string, baseStage: string): string {
    return stage === baseStage ? baseStage : stage;
}
