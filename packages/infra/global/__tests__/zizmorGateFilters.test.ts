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
const ACTIONS_DIR = fileURLToPath(new URL('../../../../.github/actions/', import.meta.url));
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
    return countIgnores(
        readdirSync(directory)
            .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
            .sort()
            .map((file) => ({ key: file, text: readFileSync(join(directory, file), 'utf8') })),
    );
}

/**
 * The same count over every composite action, keyed `actions/<name>/action.yml`.
 *
 * @sideEffect Reads the action files.
 */
export function declaredActionIgnores(directory: string): Readonly<Record<string, number>> {
    return countIgnores(
        readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()
            .flatMap((name) =>
                ['action.yml', 'action.yaml']
                    .map((file) => join(directory, name, file))
                    .filter((file) => {
                        try {
                            readFileSync(file);

                            return true;
                        } catch {
                            return false;
                        }
                    })
                    .map((file) => ({ key: `actions/${name}/action.yml`, text: readFileSync(file, 'utf8') })),
            ),
    );
}

/** Count the functional `# zizmor: ignore[…]` directives in each source, as `key:audit`. Pure. */
function countIgnores(
    sources: readonly { readonly key: string; readonly text: string }[],
): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const { key: file, text } of sources) {
        for (const line of text.split('\n')) {
            const directive = line.match(/#\s*zizmor:\s*ignore\[([^\]]+)\]/);

            if (directive === null) {
                continue;
            }

            const before = line.slice(0, line.indexOf('#')).trim();

            if (before.length === 0) {
                continue;
            }

            // ⚠️ A COMMA LIST suppresses every audit it names, so each is counted. Testing the whole bracket
            // against the audit-id pattern — which a comma fails — made a two-audit suppression count as
            // nothing at all.
            for (const audit of (directive[1] as string).split(',').map((part) => part.trim())) {
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
    // ⛔ NOT APPLICABLE rather than deferred, and it will never close. `use-trusted-publishing` asks for OIDC
    // trusted publishing instead of a token — an npmjs.com feature that GitHub Packages does not implement.
    // `@radicle-co/infra-shared` is published there because the scope must match the repository owner, so the
    // built-in GITHUB_TOKEN is the only mechanism that exists for it. Every site is a `packages:` grant or an
    // `npm publish` on the path that ships the shared CDK constructs.
    //
    // ⚠️ Counted per SITE, so the numbers say where the publishing surface is — and it GREW when CDK left
    // the npm workspace, because every job that installs a CDK package now reads the constructs from the
    // registry. `_ci.yml` has five (the prerelease job's grant, the publish step, and a `packages: read`
    // grant on each of `cdk-checks`, `integration-infra` and `integration-selfcontained`);
    // `publish-infra-shared.yml` two (its job grant and the publish step); the two callers one each, since a
    // caller can only DOWNGRADE a called workflow's permissions, so the grant has to be restated there; and
    // `prod-deploy.yml` / `sandbox-identity-deploy.yml` one each, on the job that installs and bundles
    // `packages/infra/global` before synthesizing it.
    // ⚠️ The count grew again when the CALLER chain was fixed. A reusable workflow can only downgrade its
    // caller's permissions, so every `packages:` grant a callee needs must be RESTATED at each call site —
    // `_ci.yml::deploy-preview`, `sandbox-deploy.yml::deploy-dispatch`, `ci-full.yml::base`, and
    // `_sandbox-preview.yml::deploy`. Each restatement is another site, not another decision.
    // ⚠️ `_sandbox-preview.yml` dropped from 2 to 1 when its two deploy JOBS became one call to
    // `deploy-infra.yml` — the grant is restated once per call site, and there is now one call site.
    '_ci.yml:use-trusted-publishing': 5,
    'prod-deploy.yml:use-trusted-publishing': 1,
    'sandbox-identity-deploy.yml:use-trusted-publishing': 1,
    '_sandbox-preview.yml:use-trusted-publishing': 1,
    'sandbox-router-deploy.yml:use-trusted-publishing': 1,
    'sandbox-deploy.yml:use-trusted-publishing': 1,
    'ci-full.yml:use-trusted-publishing': 1,

    // ⚠️ DEFERRED, NOT "not applicable" — the only entry here that names real work. `adhoc-packages` objects
    // to `npm install` in CI, and it is RIGHT to: install resolves ranges at deploy time, so two runs of the
    // same commit can deploy against different dependency trees. `npm ci` is the correct call and it needs a
    // committed lockfile in each CDK package, which cannot exist until `@radicle-co/infra-shared` has been
    // published and each package installed against it. Until then these four steps install the CDK toolchain
    // the deploy jobs cannot run without.
    //
    // ⛔ The fix is `npm ci` plus committed lockfiles, NOT deleting these suppressions.
    'prod-deploy.yml:adhoc-packages': 1,
    'sandbox-identity-deploy.yml:adhoc-packages': 1,
    // `integration-infra`'s "Install the CDK packages" (2026-09-11): `nagRulesAtZero` synthesizes EVERY app,
    // so the job now installs every CDK package with `prod-deploy.yml`'s own loop. Same deferral, same fix.
    // ⚠️ zizmor 1.29 flags only the `--prefix "${var}"` LOOP form — a plain `npm install` in a
    // `working-directory:` is not reported — which is why the single-directory installs elsewhere carry none.
    '_ci.yml:adhoc-packages': 1,
    // The composite action's food-origin step installs the food CDK package — the same deferral again, for
    // the same reason, on a shared step rather than a job.
    'actions/infra-package/action.yml:adhoc-packages': 1,
    // ⚠️ `_sandbox-preview.yml` is GONE from this list, and that is the fix landing rather than a
    // suppression being deleted: it no longer installs a CDK toolchain at all. The deploys moved to
    // `deploy-infra.yml`, whose composite action installs per `infra/` directory, and what remains here is
    // a root `npm ci` — the correct call this entry was deferring to.
    'sandbox-router-deploy.yml:adhoc-packages': 1,
    // ⚠️ JUSTIFIED, and made safe rather than merely declared. The composite action exports its platform
    // inputs, food origin and image tag under names the CALLER chooses; a step output cannot be re-exported
    // under a dynamic name, so `$GITHUB_ENV` is the only mechanism. What the audit protects against — a
    // newline in a value smuggling `NODE_OPTIONS=…` into every later step — is closed by routing every write
    // through `.github/scripts/safe-env.sh` (strict name, loader/runner-name denylist, no-whitespace value
    // charset), and `safeEnv.test.ts` fails if a suppressed step writes the file any other way.
    'actions/infra-package/action.yml:github-env': 4,
    'ci-main.yml:use-trusted-publishing': 1,
    'ci-pr.yml:use-trusted-publishing': 1,
    'publish-infra-shared.yml:use-trusted-publishing': 2,
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
    //
    // The 15th is `e2e-identity-boot` (ADR-0028), the job that proves identity actually stands up now that a
    // per-PR preview no longer deploys on every push. It needs one `postgres:18` service container, the same
    // tag-tracked image every other tier here already uses — again no new image and no new reason.
    //
    // The 16th is `integration-infra` (ADR-0031). The per-PR database reaper issues real `DROP DATABASE`
    // statements, and what that suite exists to prove — that `WITH (FORCE)` defeats a live session, that the
    // shared base database survives a reap, that the `LIKE … ESCAPE` narrowing claims nothing extra — are all
    // facts only a real server answers. One more `postgres:18` service container, same tag-tracked image,
    // same deferral.
    '_ci.yml:unpinned-images': 10,
    // The 6th is the `localstack/localstack:4.4.0` service container the MAESTRO tier gained: the
    // recipe-service container it boots has always been handed `SQS_ENDPOINT=http://localhost:4566` and a
    // `RECIPE_PARSE_QUEUE_URL`, and until now nothing listened there — so every pasted ingredient line came
    // back `failed_retryable` behind a `202` and `recipes/parse-ingredients` failed on `2 of 2 lines read`.
    // It is the SAME tag-tracked image, at the SAME pin, that this file's `load-test` job already declares
    // one job below: no new image, no new reason, one more site.
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

    it('counts EVERY audit in a comma-separated ignore list', () => {
        // `ignore[adhoc-packages,github-env]` suppresses both, so both must be counted. The first version of
        // this analyzer tested the whole bracket against the kebab-case audit-id pattern, which a comma fails
        // — so a two-audit suppression was silently counted as NOTHING, the one outcome a ratchet exists to
        // prevent.
        expect(declaredActionIgnores(ACTIONS_DIR)['actions/infra-package/action.yml:adhoc-packages']).toBe(1);
        expect(declaredActionIgnores(ACTIONS_DIR)['actions/infra-package/action.yml:github-env']).toBe(4);
    });

    it('matches the checked-in inventory EXACTLY — workflows AND composite actions', () => {
        // ⚠️ Actions are in scope: zizmor audits `.github/` whole, so a suppression inside a composite action
        // weakens the gate exactly as one in a workflow does, and an inventory that read only `workflows/`
        // made the action a place to hide one.
        expect(
            { ...declaredIgnores(WORKFLOW_DIR), ...declaredActionIgnores(ACTIONS_DIR) },
            'a `# zizmor: ignore[…]` comment suppresses a real finding without touching a single gate flag. ' +
                'If you added one, add it here with the reason; if you FIXED a site, delete its entry.',
        ).toEqual(DECLARED_IGNORES);
    });
});
