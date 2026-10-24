/**
 * The dependency-injection token for this stage's test-principal containment mode (ADR-0040).
 *
 * Provided by `AuthModule` from the validated `TEST_PRINCIPAL_CONTAINMENT` config (default `enforce`) and consumed by
 * `AuthMiddleware`, which stamps it onto every `Principal` — so a policy call site reads the mode off the request it
 * is already handling instead of every service injecting config of its own.
 */
export const CONTAINMENT_MODE = 'RECIPE_TEST_PRINCIPAL_CONTAINMENT_MODE';
