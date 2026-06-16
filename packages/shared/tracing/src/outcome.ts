/** Auth/provisioning outcome for a single signup/auth flow. */
export type AuthOutcome = 'created' | 'resolved' | 'failed';

/** Which creation path produced the outcome. */
export type AuthPath = 'read-through' | 'webhook' | 'reconciliation';

/**
 * The always-on, sampling-proof signup/auth outcome signal (B3). Emitted once per provisioning flow
 * (read-through + webhook) so a failure is alarmable regardless of trace sampling. Dimensions are
 * STRICTLY low-cardinality — never a user id — to keep the CloudWatch metric bounded.
 */
export interface SignupOutcome {
    outcome: AuthOutcome;
    path: AuthPath;
}

export const OUTCOME_METRIC_NAME = 'SignupOutcome';

/** Low-cardinality metric dimensions for the outcome signal. Intentionally excludes any user id. */
export const outcomeDimensions = (o: SignupOutcome): Record<string, string> => ({
    outcome: o.outcome,
    path: o.path,
});
