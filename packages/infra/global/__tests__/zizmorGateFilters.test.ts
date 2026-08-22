// @vitest-environment node
/**
 * Repo-wide guard: the zizmor gate's own STRENGTH, which is set entirely by flags and comments that
 * nothing else in the repository checks.
 *
 * ## Why this file exists
 *
 * `zizmor.yml` has now been rebuilt twice for the same reason: a filter was set to a value that happened
 * to sit just above the findings of the day, so the step was green without auditing what it appeared to
 * audit. Two DIFFERENT filters produced that outcome, and neither is visible in a diff as a weakening:
 *
 * | filter | the silent pass it produced |
 * |---|---|
 * | `--min-severity medium` | measured to MISS a brand-new `artipacked` in online mode, because that audit is graded LOW online and MEDIUM offline — the gate's strength depended on whether a token was in the environment |
 * | `--persona` (left at the default `regular`) | 56 findings invisible at EVERY severity, including `informational`. On one tree, at one severity: regular → 0 shown, pedantic → 27, auditor → 56 |
 *
 * There is a THIRD way to weaken it that touches no flag at all: adding `# zizmor: ignore[<audit>]`
 * comments. Those are the sanctioned mechanism for a declared exception, which is exactly why their
 * number has to be a ratchet rather than a free variable — an exception nobody counted is a suppression.
 *
 * None of this is visible to `actionlint` (the YAML is valid), to zizmor itself (it cannot audit its own
 * invocation), or to CodeQL. So the invariants live here.
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * Asserted: the persona is at least `pedantic`; no severity floor excludes anything; every zizmor
 * invocation carries `--strict-collection`; and the declared per-site ignores match a checked-in
 * inventory exactly. NOT asserted: that zizmor currently reports zero findings — that is the gate's job,
 * running the real tool in CI, and duplicating it here with a parser would be a second, weaker oracle.
 *
 * ## Mutation evidence
 *
 * Each analyzer was watched fail against a mutated input, and the fixtures below keep that proof
 * permanent (a `toEqual([])` against a clean tree passes just as well when the analyzer is broken):
 * a `regular`-persona invocation, a `--min-severity low` invocation, an invocation with no
 * `--strict-collection`, and an extra ignore comment. The corresponding live mutations were also run
 * against the real zizmor: a new unpinned `services:` image, an undocumented `permissions` key, and one
 * unparseable workflow each red the real gate while passing the previous `regular --min-severity low`
 * configuration.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));
const ZIZMOR_WORKFLOW = 'zizmor.yml';

/**
 * Persona strength, ascending. `regular` is zizmor's default and therefore what an invocation with no
 * `--persona` flag runs — the case this guard exists to reject.
 */
const PERSONA_RANK: Readonly<Record<string, number>> = { regular: 0, pedantic: 1, auditor: 2 };

/** The weakest persona the gate may run. */
const MINIMUM_PERSONA = 'pedantic';

/** Severity floors, ascending. `informational` is the lowest, i.e. no filtering at all. */
const SEVERITY_RANK: Readonly<Record<string, number>> = { informational: 0, low: 1, medium: 2, high: 3 };

/** One `zizmor …` command line found in a workflow, with the flags that decide how much it audits. */
interface Invocation {
    /** The step's `name:`, for the violation message. */
    readonly step: string;
    readonly persona: string;
    readonly minSeverity: string;
    readonly strictCollection: boolean;
}

/**
 * Every `zizmor` command line in a workflow document, with its filters resolved to effective values.
 *
 * Parsed from the raw text rather than the YAML tree on purpose: the flags live inside `run:` script
 * bodies, so a structural walk would still end up string-matching the shell — and matching the shell
 * directly is what keeps this honest about continuation lines.
 *
 * Pure.
 *
 * @param source - The workflow file's text.
 */
export function zizmorInvocations(source: string): readonly Invocation[] {
    const lines = source.split('\n');
    const invocations: Invocation[] = [];
    let step = '(unnamed)';

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const named = line.match(/^\s*-\s+name:\s*(.+?)\s*$/);

        if (named !== null) {
            step = named[1] as string;
            continue;
        }

        // A shell COMMENT mentioning zizmor is not an invocation; the ledger is full of them.
        if (!/^\s*zizmor\s/.test(line)) {
            continue;
        }

        // Follow backslash continuations so a flag on the next line still counts.
        let command = line;

        while (command.trimEnd().endsWith('\\') && index + 1 < lines.length) {
            index += 1;
            command = `${command.trimEnd().slice(0, -1)} ${lines[index] ?? ''}`;
        }

        const persona = command.match(/--persona[\s=]+(\w+)/);
        const severity = command.match(/--min-severity[\s=]+(\w+)/);

        invocations.push({
            step,
            // No flag means zizmor's own default, which is the weak case — resolve it, do not skip it.
            persona: persona === null ? 'regular' : (persona[1] as string),
            // No floor is the STRONGEST setting, so an absent flag resolves to the lowest severity.
            minSeverity: severity === null ? 'informational' : (severity[1] as string),
            strictCollection: /--strict-collection\b/.test(command),
        });
    }

    return invocations;
}

/**
 * Invocations whose filters let something through that the gate is supposed to see.
 *
 * Pure.
 *
 * @param invocations - As returned by {@link zizmorInvocations}.
 */
export function weakenedInvocations(invocations: readonly Invocation[]): readonly string[] {
    const violations: string[] = [];

    for (const invocation of invocations) {
        const rank = PERSONA_RANK[invocation.persona];

        if (rank === undefined || rank < (PERSONA_RANK[MINIMUM_PERSONA] as number)) {
            violations.push(
                `${invocation.step} → runs the \`${invocation.persona}\` persona, which is weaker than ` +
                    `\`${MINIMUM_PERSONA}\`. Persona is a filter ORTHOGONAL to severity: on one measured tree ` +
                    'the regular persona showed 0 findings where pedantic showed 27, at the same severity.',
            );
        }

        const floor = SEVERITY_RANK[invocation.minSeverity];

        if (floor === undefined || floor > 0) {
            violations.push(
                `${invocation.step} → sets --min-severity ${invocation.minSeverity}, so anything graded below ` +
                    'it is invisible. artipacked is graded LOW online and MEDIUM offline on the same tree, so a ' +
                    "floor makes the gate's strength depend on whether a token is in the environment.",
            );
        }

        if (!invocation.strictCollection) {
            violations.push(
                `${invocation.step} → omits --strict-collection, so a workflow zizmor cannot PARSE drops out ` +
                    'of the audit with only a WARN and the run still exits 0 — an invalid file reads as a clean one.',
            );
        }
    }

    return [...violations].sort();
}

/**
 * Every declared `# zizmor: ignore[<audit>]` in a directory of workflows, as `file:audit` keys counted.
 *
 * ⚠️ Counts only comments TRAILING a line of real YAML. That is not a shortcut — it is what makes an
 * ignore functional: zizmor attaches the directive to the feature on that line, so a `#` line standing on
 * its own suppresses nothing. Without the distinction this analyzer counts `zizmor.yml`'s own ledger,
 * which quotes the syntax repeatedly while explaining it, and the inventory becomes a record of prose.
 *
 * @sideEffect Reads the workflow files.
 */
export function declaredIgnores(directory: string): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const file of readdirSync(directory)
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .sort()) {
        for (const line of readFileSync(join(directory, file), 'utf8').split('\n')) {
            const directive = line.match(/#\s*zizmor:\s*ignore\[([^\]]+)\]/);

            if (directive === null) {
                continue;
            }

            const before = line.slice(0, line.indexOf('#')).trim();
            const audit = directive[1] as string;

            if (before.length === 0) {
                continue;
            }

            // zizmor audit ids are kebab-case, so a PLACEHOLDER like `ignore[<audit>]` — which the gate
            // step's own `::error::` message contains, inside a shell string where `#` is not a YAML
            // comment at all — names no audit and suppresses nothing.
            if (!/^[a-z][a-z0-9-]*$/.test(audit)) {
                continue;
            }

            const key = `${file}:${audit}`;

            counts[key] = (counts[key] ?? 0) + 1;
        }
    }

    return counts;
}

/**
 * The declared exceptions, in full. A ratchet, not an allowance: this is the ONE way to weaken the gate
 * without touching a flag, so adding a suppression must be a deliberate edit to this record.
 *
 * Both entries are justified at their sites; the reasoning and the route to closing each is in
 * `zizmor.yml`'s ledger.
 */
const DECLARED_IGNORES: Readonly<Record<string, number>> = {
    // Deliberate: `dorny/paths-filter` falls back to `getChangedFilesFromGit` on push/workflow_dispatch.
    'prod-deploy.yml:artipacked': 1,
    'sandbox-identity-deploy.yml:artipacked': 1,
    // Deferred: pinning `services:` images by digest needs an owner for the bumps — dependabot.yml
    // declares no `docker` ecosystem, and `postgres:18` deliberately tracks the prod RDS engine minor.
    //
    // 11 → 12 (PR 91, plan U5/U6): `integration-food` gained a LocalStack service so the message
    // substrate's integration tier can exercise a real DynamoDB — the tier that caught a marshaller
    // option the unit tier structurally cannot see. Same `localstack/localstack:4.4.0` tag and the same
    // deferral as the five already declared here; this record is the ratchet, so it moves deliberately.
    //
    // 12 → 14: `e2e-cross-service-linkage` — the job that finally boots recipe-service and food-service
    // TOGETHER and proves a recipe's nutrition figures come from a live food lookup. It needs the same
    // two service containers every other tier here uses (`postgres:18` for the two logical databases,
    // `localstack/localstack:4.4.0` for the buckets and queue recipe boots against), so it inherits the
    // same two tag-tracked images and the same deferral. No new image, no new reason — two more sites.
    '_ci.yml:unpinned-images': 14,
    '_ci-heavy.yml:unpinned-images': 5,
};

describe('the zizmor gate cannot be weakened by a filter', () => {
    it('flags an invocation left on the default regular persona', () => {
        const violations = weakenedInvocations(
            zizmorInvocations(
                '            - name: Gate\n              run: |\n                  zizmor --min-severity informational --strict-collection .github/\n',
            ),
        );

        expect(violations.join('\n')).toMatch(/regular` persona/);
    });

    it('flags a severity floor above informational', () => {
        const violations = weakenedInvocations(
            zizmorInvocations(
                '            - name: Gate\n              run: |\n                  zizmor --persona pedantic --min-severity low --strict-collection .github/\n',
            ),
        );

        expect(violations.join('\n')).toMatch(/--min-severity low/);
    });

    it('flags an invocation missing --strict-collection', () => {
        const violations = weakenedInvocations(
            zizmorInvocations(
                '            - name: Gate\n              run: |\n                  zizmor --persona pedantic --min-severity informational .github/\n',
            ),
        );

        expect(violations.join('\n')).toMatch(/--strict-collection/);
    });

    it('does NOT flag the intended configuration, including across a continuation line', () => {
        const violations = weakenedInvocations(
            zizmorInvocations(
                '            - name: Gate\n              run: |\n' +
                    '                  zizmor --persona auditor \\\n' +
                    '                      --strict-collection .github/\n',
            ),
        );

        expect(violations).toEqual([]);
    });

    it('does NOT mistake the ledger prose for an invocation', () => {
        // The header discusses `zizmor --min-severity low` at length; treating that as a live invocation
        // would make this guard permanently and uselessly red.
        expect(zizmorInvocations('# measured: zizmor --min-severity low → exit 0, 56 suppressed\n')).toEqual([]);
    });

    it('is not vacuous: zizmor.yml really does invoke zizmor', () => {
        const invocations = zizmorInvocations(readFileSync(join(WORKFLOW_DIR, ZIZMOR_WORKFLOW), 'utf8'));

        // Two, deliberately: the SARIF run cannot gate (`--format sarif` always exits 0), so the gate is a
        // second invocation. Both must carry the same filters or the Security tab and the gate disagree.
        expect(invocations.map(({ step }) => step)).toEqual(['Run zizmor', 'Gate on all pedantic-persona findings']);
    });

    it('holds for the real zizmor.yml', () => {
        expect(
            weakenedInvocations(zizmorInvocations(readFileSync(join(WORKFLOW_DIR, ZIZMOR_WORKFLOW), 'utf8'))),
            'a filter set just above the findings of the day is how this step reported success for work it ' +
                'did not do — twice',
        ).toEqual([]);
    });
});

describe('every zizmor suppression in the repo is declared', () => {
    it('counts an ignore comment on any kind of YAML line', () => {
        // Both placements are used in the tree: trailing on the finding's own line (unpinned-images) and
        // on a step's `- name:` line (artipacked), so the matcher must not care which.
        expect(declaredIgnores(WORKFLOW_DIR)['_ci.yml:unpinned-images']).toBeGreaterThan(0);
        expect(declaredIgnores(WORKFLOW_DIR)['prod-deploy.yml:artipacked']).toBe(1);
    });

    it('does NOT count the ledger prose that explains the syntax', () => {
        // `zizmor.yml`'s header quotes `# zizmor: ignore[…]` several times while documenting it. Those
        // suppress nothing (zizmor attaches a directive to the feature on the line), so counting them
        // would fill the inventory with commentary and hide a real suppression among it.
        expect(declaredIgnores(WORKFLOW_DIR)['zizmor.yml:artipacked']).toBeUndefined();
        expect(declaredIgnores(WORKFLOW_DIR)['zizmor.yml:unpinned-images']).toBeUndefined();
        // …nor the `ignore[<audit>]` placeholder inside the gate's own `::error::` string, where the `#`
        // sits in a block scalar and is not a YAML comment in the first place.
        expect(Object.keys(declaredIgnores(WORKFLOW_DIR))).not.toContain('zizmor.yml:<audit>');
    });

    it('matches the checked-in inventory EXACTLY', () => {
        expect(
            declaredIgnores(WORKFLOW_DIR),
            'a `# zizmor: ignore[…]` comment suppresses a real finding without touching a single gate flag. ' +
                'If you added one, add it here with the reason; if you FIXED a site, delete its entry.',
        ).toEqual(DECLARED_IGNORES);
    });
});
