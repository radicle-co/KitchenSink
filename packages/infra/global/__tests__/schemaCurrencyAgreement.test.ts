// @vitest-environment node
/**
 * Repo-wide guard: the TWO readings of `SCHEMA_CURRENCY_MODE` agree.
 *
 * ## Why there are two, and why that is not laziness
 *
 * `schemaCurrencyMode` in `@kitchensink/db-schema-guard` is what the RUNNING service calls to decide
 * whether a stale schema refuses a boot. `schemaCurrencyEnvironment` in `@kitchensink/infra-security` is
 * what the DEPLOY calls to write the value onto a task definition.
 *
 * ⛔ The infra one cannot simply import the runtime one, and trying was a real failure. Shared packages
 * export raw `./src/*.ts`; an INFRA package exports `./dist/*.js`, because `prod-deploy.yml` runs the CDK
 * app as `node dist/bin/app.js` — plain node, no loader. The import resolved under every `tsx` synth and
 * died with `ERR_MODULE_NOT_FOUND` on the compiled path, which is the one that deploys production.
 *
 * So the rule is written twice, and this is what makes that safe — the same shape the migration manifest's
 * bash and TypeScript halves already use. A disagreement here is not cosmetic: a deploy that writes a value
 * the runtime does not recognise gets `warn` at runtime, so the flip to `enforce` silently does not happen
 * and every signal stays green. That is precisely the silent-success class this repository keeps paying for.
 */
import { describe, expect, it } from 'vitest';

import { schemaCurrencyEnvironment } from '@kitchensink/infra-security';
import { schemaCurrencyMode } from '@kitchensink/db-schema-guard';

/**
 * Inputs chosen for the ways the two could diverge, not for coverage: the happy value, the casing and
 * whitespace a CI variable really arrives with, the near-misses a human types, and absence.
 */
const INPUTS: readonly (string | undefined)[] = [
    'enforce',
    'ENFORCE',
    '  enforce  ',
    '\tEnForCe\n',
    'warn',
    'WARN',
    'enforced',
    'enforce ', // trailing space only
    'strict',
    'true',
    '1',
    'yes',
    'off',
    '',
    ' ',
    undefined,
];

describe('the deploy and the runtime read SCHEMA_CURRENCY_MODE the same way', () => {
    it('⛔ agrees on every input, including the ones a human gets wrong', () => {
        const disagreements = INPUTS.filter(
            (raw) =>
                schemaCurrencyEnvironment({ SCHEMA_CURRENCY_MODE: raw })['SCHEMA_CURRENCY_MODE'] !==
                schemaCurrencyMode(raw),
        ).map(
            (raw) =>
                `${JSON.stringify(raw)}: deploy writes ` +
                `${schemaCurrencyEnvironment({ SCHEMA_CURRENCY_MODE: raw })['SCHEMA_CURRENCY_MODE']}, ` +
                `runtime reads ${schemaCurrencyMode(raw)}`,
        );

        expect(disagreements).toStrictEqual([]);
    });

    it('is not vacuous — the table really does exercise both outcomes', () => {
        // A table that only ever produced `warn` would agree trivially and prove nothing about `enforce`,
        // which is the value the whole soak exists to reach.
        const written = new Set(
            INPUTS.map((raw) => schemaCurrencyEnvironment({ SCHEMA_CURRENCY_MODE: raw })['SCHEMA_CURRENCY_MODE']),
        );

        expect([...written].sort()).toStrictEqual(['enforce', 'warn']);
    });

    it('⛔ an unrecognised value is WARN on both sides, never enforce', () => {
        // Failing toward the observing mode is the direction where being wrong is cheap: a typo in a deploy
        // variable must not arm a check that can crash-loop three services at once.
        for (const raw of ['enforced', 'strict', 'true', '1', 'ENFORCE_ALL']) {
            expect(schemaCurrencyEnvironment({ SCHEMA_CURRENCY_MODE: raw })['SCHEMA_CURRENCY_MODE']).toBe('warn');
            expect(schemaCurrencyMode(raw)).toBe('warn');
        }
    });
});
