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
 * ## ⛔ Why this normalises the value itself instead of importing the runtime's function
 *
 * It did import it, and that broke the compiled deploy path. `@kitchensink/db-schema-guard` exports raw
 * `./src/*.ts` like every shared package, while an INFRA package exports `./dist/*.js` because
 * `prod-deploy.yml` runs the CDK app as `node dist/bin/app.js` — plain node, no loader. An infra package
 * depending on a src-exporting one therefore dies at `ERR_MODULE_NOT_FOUND` on the one path that matters
 * most, and only there: every `tsx` synth resolves it fine.
 *
 * So there are two implementations of one rule, and — exactly as with the migration manifest's bash and
 * TypeScript halves — that is made safe by a guard rather than by hope:
 * `packages/infra/global/__tests__/schemaCurrencyAgreement.test.ts` fires both at the same table of
 * inputs, including the ones that matter (an unrecognised value, casing, whitespace). A deploy that set a
 * value the runtime does not recognise would resolve to `warn`, the flip would silently not happen, and
 * every signal would stay green — which is the whole failure this pair is guarded against.
 *
 * ⚠️ An unset variable is `warn`, deliberately. A typo cannot arm a check that can crash-loop a service.
 *
 * @see docs/architecture/decisions/0035-schema-stacks-decoupled-from-service-deploys.md
 */

/** How the boot-time schema-currency check behaves when the schema is behind. */
export type SchemaCurrencyMode = 'warn' | 'enforce';

/**
 * Resolve the mode from the deploy's environment.
 *
 * @param environment - The process environment the CDK app was invoked with.
 * @returns The container environment fragment every DB-reading service spreads into its task definition.
 */
export function schemaCurrencyEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
    const raw = (environment['SCHEMA_CURRENCY_MODE'] ?? '').trim().toLowerCase();
    const mode: SchemaCurrencyMode = raw === 'enforce' ? 'enforce' : 'warn';

    return { SCHEMA_CURRENCY_MODE: mode };
}
