/**
 * The boot-time schema-currency check's mode, as a container environment fragment.
 *
 * ## Why this is settable at all, and why it defaults to observing
 *
 * Every service checks at boot that its database has applied the migrations its release ships (ADR-0035).
 * A boot assertion that fails closed can crash-loop a whole service, so it ships in `warn`: it reports and
 * lets the task serve. The flip to `enforce` happens once the reports read clean — and it must be a
 * SETTING rather than a code change, or the soak has no ending anybody will actually reach for.
 *
 * ⛔ THE LEGAL VALUES ARE NOT RESTATED HERE. `schemaCurrencyMode` in `@kitchensink/db-schema-guard` is the
 * one definition of what `enforce` means, and it is the same function the running service calls. Spelling
 * the comparison a second time in infra is how a deploy comes to set a value the runtime does not
 * recognise — which resolves to `warn`, so the flip would silently not happen and every signal would stay
 * green. Resolving it HERE means an unrecognised value is normalised at SYNTH, where the template shows
 * what the task will actually do.
 *
 * ⚠️ An unset variable is `warn`, deliberately. A typo cannot arm a check that can crash-loop a service.
 *
 * @see docs/architecture/decisions/0035-schema-stacks-decoupled-from-service-deploys.md
 */
import { schemaCurrencyMode } from '@kitchensink/db-schema-guard';

/**
 * Resolve the mode from the deploy's environment.
 *
 * @param environment - The process environment the CDK app was invoked with.
 * @returns The container environment fragment every DB-reading service spreads into its task definition.
 */
export function schemaCurrencyEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
    return { SCHEMA_CURRENCY_MODE: schemaCurrencyMode(environment['SCHEMA_CURRENCY_MODE']) };
}
