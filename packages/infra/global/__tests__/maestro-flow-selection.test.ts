// @vitest-environment node
/**
 * Repo-wide guard: **per-vertical Maestro flow selection** and the flow INVENTORY behind it.
 *
 * ## Why this exists (the measurement, not a hunch)
 *
 * Nightly run 31471786779 of `e2e-mobile-maestro` took **52.75m**, of which only **17.3m** is fixed setup
 * (12.9m Gradle release-APK build + ~1.5m emulator/AVD boot + install + ~2.9m checkout/deps/service
 * build/seed) and **35.5m is FLOW EXECUTION**. The variable half dominates the fixed half 2:1, so caching
 * the fixed half is the small lever (Gradle/AVD caching targets ~2.8% and is REFUTED — do not re-propose
 * it); choosing FEWER FLOWS is the big one. `recipes/collections-pagination` alone is 7.75m — 22% of all
 * flow time — and the top five flows are 48% of it.
 *
 * Since commit `5832ce7c` the Maestro tier auto-triggers on the mobile surface, so a large share of PRs pay
 * the emulator. Selection is what makes that affordable: a change runs the flows it can plausibly break,
 * and everything else is skipped LOUDLY (`skipped=` lines in the job log), never silently.
 *
 * ## The two failure modes this file exists to prevent
 *
 * 1. **Silently running LESS.** A selector that under-selects turns the one tier that drives the real app on
 *    a real device into a green check over work that never happened — the exact class this repo has already
 *    paid four weeks of production for. So every rule here is asymmetric: anything the mapping cannot
 *    confidently attribute falls back to the FULL set. "No vertical was implicated" is treated as
 *    "attribution failed", not as "nothing to run".
 * 2. **A flow that exists and never runs.** `recipes/ingredient-catalog-blend.yaml` was committed, reviewed,
 *    and then never executed by CI, because `run-maestro-flows.sh` iterates an explicit list and nobody added
 *    it — invisible for months behind a green job. The inventory assertion below makes that impossible to
 *    repeat: EVERY `.maestro` flow must be in the plan, or be a `runFlow` sub-flow, or be inert-by-
 *    construction (a `visual/` screenshot flow with no committed baseline), or be named in
 *    `KNOWN_UNRUN_FLOWS` with a reason. An unclassified flow fails this suite.
 *
 * ## Why the decision is executed as real `bash`
 *
 * Same reason as `pr-scope.test.ts` and `deploy-gate.test.ts`: a TypeScript re-implementation would be a
 * SECOND copy of the decision that drifts from the one CI runs. These tests shell out to the committed
 * script. The selection is a PURE function of `(plan, selector pairs)` — no adb, no emulator, no network —
 * which is what makes it testable at all; every impure step lives in the script's run path.
 *
 * ## Mutation evidence (each assertion has been watched fail)
 *
 * Written test-first against a script with no `select` subcommand at all: every selection assertion failed
 * with a usage error, and the inventory assertion failed on `recipes/ingredient-catalog-blend` — the real
 * defect, reproduced as a red test before the fix. After implementation, targeted mutations:
 *   - dropping the "no vertical implicated ⇒ full" clause ⇒ "falls back to the FULL set when the selector
 *     names no vertical" fails with an EMPTY selection, i.e. a green Maestro job that ran nothing;
 *   - accepting an unknown selector key silently ⇒ the unknown-key and typo-trap cases fail;
 *   - matching vertical membership with a bare prefix instead of whole tokens ⇒ the `recipe`/`recipes` and
 *     `home`/`homeRecentRecipeTap` trap cases fail;
 *   - emitting the union of per-vertical lists instead of filtering the ordered plan ⇒ the ordering
 *     assertions fail (login-flow first, `account-danger-zone` before `recipes/delete`, delete last).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MOBILE = join(REPO_ROOT, 'packages/apps/commise/mobile');
const SCRIPT = join(MOBILE, 'tests/e2e/run-maestro-flows.sh');
const MAESTRO_DIR = join(MOBILE, '.maestro');
const WORKFLOW_DIR = join(REPO_ROOT, '.github/workflows');

/** The caller that owns the changed-path detection and composes the selector. */
const CALLER_FILE = 'heavy-e2e.yml';

/** The reusable workflow that owns the emulator job. */
const CALLEE_FILE = '_ci-heavy.yml';

/** The emulator job id, as `_ci-heavy.yml` names it. */
const MAESTRO_JOB = 'e2e-mobile-maestro';

/** The env var the job hands the script, and the workflow input behind it. */
const SELECTOR_ENV = 'MAESTRO_FLOW_SELECTOR';
const SELECTOR_INPUT = 'maestro_flow_selector';

// ---------------------------------------------------------------------------------------------------------
// Driving the real script
// ---------------------------------------------------------------------------------------------------------

/** One selection, as the script prints it. */
interface Selection {
    readonly flows: readonly string[];
    readonly skipped: readonly string[];
    readonly reason: string;
    readonly status: number;
}

/**
 * Run one of the script's PURE subcommands.
 *
 * @param args - The subcommand and its arguments.
 * @returns Parsed `flow=` / `skipped=` / `reason=` output plus the exit status.
 * @sideEffect Spawns `bash`. Touches no device and no network — that is the point of the pure/impure split.
 */
function run(...args: readonly string[]): Selection {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';
    const lines = stdout.split('\n');
    const valuesOf = (key: string): readonly string[] =>
        lines.flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));

    return {
        flows: valuesOf('flow'),
        skipped: valuesOf('skipped'),
        reason: valuesOf('reason')[0] ?? '',
        status: result.status ?? -1,
    };
}

/** Select against the COMMITTED plan — exactly what the emulator job does. */
const select = (...pairs: readonly string[]): Selection => run('select', ...pairs);

/**
 * Select against a caller-supplied plan.
 *
 * Exists so the adversarial cases below can drive plans the repo does not contain (a flow whose name is a
 * PREFIX of another, an empty plan) without inventing flow files. CI never uses this subcommand.
 */
const selectFromPlan = (plan: string, ...pairs: readonly string[]): Selection => run('select-plan', plan, ...pairs);

/**
 * Read one of the script's list subcommands as non-empty trimmed lines.
 *
 * @sideEffect Spawns `bash`.
 */
function lines(subcommand: string): readonly string[] {
    const result = spawnSync('bash', [SCRIPT, subcommand], { encoding: 'utf8' });

    return (result.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/** The committed plan, as `<vertical>:<flow>` entries in execution order. */
const PLAN: readonly string[] = lines('plan');

/** The vertical tokens the script accepts in a selector. */
const VERTICALS: readonly string[] = lines('verticals');

/** The plan's flows, in order — the FULL set the emulator runs when nothing is narrowed. */
const ALL_FLOWS: readonly string[] = PLAN.map((entry) => entry.slice(entry.indexOf(':') + 1));

/** The vertical each planned flow belongs to. */
const VERTICAL_OF = new Map(
    PLAN.map((entry) => [entry.slice(entry.indexOf(':') + 1), entry.slice(0, entry.indexOf(':'))]),
);

/** Flows every narrowed run must still include, whatever changed. */
const SPINE = ALL_FLOWS.filter((flow) => VERTICAL_OF.get(flow) === 'spine');

// ---------------------------------------------------------------------------------------------------------
// The flow inventory on disk
// ---------------------------------------------------------------------------------------------------------

/** Every `.yaml` under `.maestro/`, as a slash-separated name without the extension (`recipes/create`). */
function discoverFlowFiles(): readonly string[] {
    const found: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory)) {
            const full = join(directory, entry);

            if (statSync(full).isDirectory()) {
                walk(full);
                continue;
            }

            if (entry.endsWith('.yaml')) {
                found.push(
                    relative(MAESTRO_DIR, full)
                        .split('\\')
                        .join('/')
                        .replace(/\.yaml$/, ''),
                );
            }
        }
    };

    walk(MAESTRO_DIR);

    return found.sort();
}

/**
 * Flows that are only ever reached through another flow's `runFlow:`.
 *
 * Discovered rather than listed: `auth/signin.yaml` and `auth/signin-home.yaml` are the credential/landing
 * sub-flows every story composes, and a third one added tomorrow must not have to be registered here to
 * avoid tripping the inventory assertion.
 */
function discoverSubFlows(files: readonly string[]): ReadonlySet<string> {
    const targets = new Set<string>();

    for (const flow of files) {
        const body = readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8');
        const directory = posix.dirname(flow);

        for (const match of body.matchAll(/runFlow:\s*([^\s#]+\.yaml)/g)) {
            const target = match[1];

            if (target !== undefined) {
                targets.add(posix.normalize(posix.join(directory, target)).replace(/\.yaml$/, ''));
            }
        }
    }

    return targets;
}

/** Whether any reference PNG has been recorded for the `visual/` screenshot flows. */
function visualBaselinesExist(): boolean {
    const directory = join(MAESTRO_DIR, 'visual/baselines');

    return existsSync(directory) && readdirSync(directory).some((entry) => entry.toLowerCase().endsWith('.png'));
}

/**
 * Story flows that exist, are NOT sub-flows, and are still not executed by CI — a ratchet, not an excuse
 * (same posture as `KNOWN_BUILDS_AFTER_PRUNE` in `workflow-invariants.test.ts`): the equality assertion
 * below means a NEW dead flow fails the build, and a listed one that has been promoted must be deleted from
 * this list.
 *
 * Both entries below are REAL gaps found while implementing selection, and both are reported rather than
 * quietly fixed, because promoting a flow that has never executed on an emulator is a change whose only
 * proof is a run: it belongs in a PR whose Maestro tier is watched, not smuggled into a selection change.
 *
 *   - `homeRecentRecipeTap` — the Home recent-recipe CARD → detail hop (the mobile mirror of the web
 *     coverage for US-000/FR-046). `home.yaml` already asserts the widget renders and the "See all recipes"
 *     entry navigates, so what is missing is only the card tap, the detail assertions and the seeded
 *     back-stack. Belongs to the `home` vertical when promoted.
 *   - `recipes/source-tabs` — the My recipes ⇄ Discover round trip (L5). Its web pair caught a one-way trip
 *     that no per-surface test could see, so the mobile half is worth having. Belongs to the `discovery`
 *     vertical when promoted.
 */
const KNOWN_UNRUN_FLOWS: readonly string[] = ['homeRecentRecipeTap', 'recipes/source-tabs'];

// ---------------------------------------------------------------------------------------------------------
// The workflow side of the thread
// ---------------------------------------------------------------------------------------------------------

interface WorkflowStep {
    readonly id?: string;
    readonly name?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly outputs?: Readonly<Record<string, string>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly on?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

/** Parse one workflow from the real tree. */
function loadWorkflow(file: string): WorkflowDocument {
    return parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as WorkflowDocument;
}

const caller = loadWorkflow(CALLER_FILE);
const callee = loadWorkflow(CALLEE_FILE);

/** The selector expression the caller passes to the reusable workflow. */
function selectorExpression(): string {
    const value = caller.jobs?.['heavy']?.with?.[SELECTOR_INPUT];

    if (value === undefined) {
        throw new Error(
            `${CALLER_FILE}::heavy passes no \`${SELECTOR_INPUT}\` input, so the emulator job can never be ` +
                'told which vertical was implicated and every run pays the full 35.5m of flows.',
        );
    }

    return String(value);
}

/** The `dorny/paths-filter` filter map in the caller's `detect` job. */
function detectFilters(): Readonly<Record<string, readonly string[]>> {
    const step = (caller.jobs?.['detect']?.steps ?? []).find((candidate) =>
        /dorny\/paths-filter@/.test(candidate.uses ?? ''),
    );

    if (step === undefined) {
        throw new Error(`${CALLER_FILE}::detect has no pinned \`dorny/paths-filter\` step`);
    }

    return parse(String(step.with?.['filters'] ?? '')) as Readonly<Record<string, readonly string[]>>;
}

const FILTERS = detectFilters();

/** The filter key that admits the Maestro tier at all — every vertical pattern must be inside it. */
const TIER_FILTER_KEY = 'mobile';

/** The per-vertical filter keys, by the naming convention the caller uses. */
const filterKeyFor = (vertical: string): string => `flows_${vertical}`;

/** Does a path match a filter key's patterns? The same question `paths-filter` answers. */
function filterMatches(key: string, path: string): boolean {
    return (FILTERS[key] ?? []).some((pattern) => minimatch(path, pattern, { dot: true }));
}

/**
 * A representative REAL path for each vertical, used to prove the mapping end to end.
 *
 * Every entry is asserted to exist on disk: a filter that names a moved file matches nothing, forever, and
 * that failure mode is silent — the vertical simply stops being detected and the run quietly widens (safe)
 * or, for the tier filter, disappears (not safe).
 */
const VERTICAL_PROBES: Readonly<Record<string, readonly string[]>> = {
    auth: [
        'packages/apps/commise/features/account/src/session/signOutAndVerify.ts',
        'packages/apps/commise/mobile/src/screens/login.tsx',
        'packages/apps/commise/mobile/.maestro/account-danger-zone.yaml',
    ],
    home: [
        'packages/apps/commise/features/core/src/curateHomeWidgets.ts',
        'packages/apps/commise/mobile/src/screens/HomeScreen.tsx',
        'packages/apps/commise/mobile/.maestro/home.yaml',
    ],
    collections: [
        'packages/apps/commise/mobile/src/screens/CollectionsScreen.tsx',
        'packages/apps/commise/mobile/.maestro/recipes/collections-pagination.yaml',
    ],
    discovery: ['packages/apps/commise/mobile/src/screens/RecipeDiscoveryScreen.tsx'],
    recipes: [
        'packages/apps/commise/mobile/src/screens/RecipeCreateScreen.tsx',
        'packages/apps/commise/mobile/src/components/IngredientPicker.tsx',
    ],
};

/**
 * Paths that must NOT narrow the run — each is cross-cutting, so it has to reach the full set through the
 * fallback rather than through a vertical.
 *
 * These are the load-bearing half of the design. `@commise/ui` supplies the `Input`/`Button` primitives every
 * screen taps, `i18n` supplies the literal text every flow matches, the app shell (`AppRoot`, the auth gate,
 * providers, theme) underpins every screen, `auth/signin*.yaml` is composed by every story, and the harness
 * is what runs them. Attributing any of these to one vertical would silently drop coverage from the only
 * tier that drives the real app.
 */
const CROSS_CUTTING_PROBES: readonly string[] = [
    'packages/apps/commise/mobile/src/screens/AppRoot.tsx',
    'packages/apps/commise/mobile/src/i18n/messages.ts',
    'packages/apps/commise/mobile/.maestro/config.yaml',
    'packages/apps/commise/mobile/.maestro/auth/signin.yaml',
    'packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh',
    'packages/apps/commise/ui/src/tokens/colors.ts',
    'packages/apps/commise/i18n/src/index.ts',
    'packages/clients/recipe-service/src/queries.ts',
];

// ---------------------------------------------------------------------------------------------------------

describe('the flow inventory — every committed flow is accounted for', () => {
    it('runs every story flow, or classifies it as a sub-flow / inert / a recorded gap', () => {
        const files = discoverFlowFiles();
        const subFlows = discoverSubFlows(files);
        const planned = new Set(ALL_FLOWS);
        const unclassified = files.filter(
            (flow) =>
                flow !== 'config' &&
                !planned.has(flow) &&
                !subFlows.has(flow) &&
                !flow.startsWith('visual/') &&
                !KNOWN_UNRUN_FLOWS.includes(flow),
        );

        expect(
            unclassified,
            'a flow that is committed but executed by nothing is a test that does not exist. Add it to ' +
                'FLOW_PLAN in run-maestro-flows.sh (with its vertical), or record it in KNOWN_UNRUN_FLOWS ' +
                'with the reason it cannot run yet.',
        ).toEqual([]);
    });

    it('closes the ingredient-catalog-blend gap specifically (it was committed and never executed)', () => {
        // The regression guard for the defect that motivated the inventory: this flow sat in `.maestro` for
        // months while `FLOWS` never named it, so the F2 degradation contract had NO on-device coverage and
        // nothing said so. It asserts the path this job produces deterministically — the Maestro job boots
        // recipe-service and NOT the food service, so the blended typeahead genuinely degrades every time.
        expect(ALL_FLOWS).toContain('recipes/ingredient-catalog-blend');
        expect(VERTICAL_OF.get('recipes/ingredient-catalog-blend')).toBe('recipes');
    });

    it('plans only flows that exist on disk', () => {
        for (const flow of ALL_FLOWS) {
            expect(existsSync(join(MAESTRO_DIR, `${flow}.yaml`)), `${flow}.yaml is planned but missing`).toBe(true);
        }
    });

    it('keeps every recorded gap real — a promoted or deleted flow must leave the list', () => {
        for (const flow of KNOWN_UNRUN_FLOWS) {
            expect(
                existsSync(join(MAESTRO_DIR, `${flow}.yaml`)),
                `${flow} is recorded as unrun but does not exist`,
            ).toBe(true);
            expect(ALL_FLOWS, `${flow} is planned now — delete it from KNOWN_UNRUN_FLOWS`).not.toContain(flow);
        }
    });

    it('excludes the visual/ flows only while their baselines are genuinely absent', () => {
        // `assertScreenshot` has no record mode: a missing reference PNG is the hard error "Screenshot file
        // not found", so committing these assertions before their baselines would red the tier for everyone.
        // That is the ONLY reason they are excluded, so the exclusion is asserted against the live condition
        // rather than a comment — the day the PNGs land, this test fails and asks for the activation.
        const visual = discoverFlowFiles().filter((flow) => flow.startsWith('visual/'));

        expect(visual.length).toBeGreaterThan(0);
        expect(
            visualBaselinesExist(),
            'visual baselines are now committed — add the `visual/*` flows to FLOW_PLAN (vertical `visual`) ' +
                'and give them a filter key, per .maestro/config.yaml’s activation note.',
        ).toBe(false);

        for (const flow of visual) {
            expect(ALL_FLOWS).not.toContain(flow);
        }
    });

    it('never plans a sub-flow as a story (a `runFlow` target is not a test)', () => {
        const subFlows = discoverSubFlows(discoverFlowFiles());

        // `auth/login-flow` deliberately `runFlow`s `signin.yaml`, so the sub-flows ARE covered — as part of
        // the stories that compose them, which is why running one on its own would prove nothing new.
        expect(subFlows.size).toBeGreaterThan(0);

        for (const flow of subFlows) {
            expect(ALL_FLOWS, `${flow} is a runFlow target, not a story`).not.toContain(flow);
        }
    });
});

describe('the plan — ordering invariants the flows depend on', () => {
    it('starts with the only signed-out flow, so a cleared session is re-established first', () => {
        expect(ALL_FLOWS[0]).toBe('auth/login-flow');
        expect(SPINE).toEqual(['auth/login-flow']);
    });

    it('runs recipes/delete last and account-danger-zone before it', () => {
        expect(ALL_FLOWS.at(-1)).toBe('recipes/delete');
        expect(ALL_FLOWS.indexOf('account-danger-zone')).toBeLessThan(ALL_FLOWS.indexOf('recipes/delete'));
    });

    it('assigns every planned flow to a selectable vertical (or the spine)', () => {
        for (const [flow, vertical] of VERTICAL_OF) {
            expect([...VERTICALS, 'spine'], `${flow} is labelled \`${vertical}\``).toContain(vertical);
        }
    });

    it('gives every vertical at least one flow, so no selection can resolve to the spine alone by accident', () => {
        for (const vertical of VERTICALS) {
            const owned = ALL_FLOWS.filter((flow) => VERTICAL_OF.get(flow) === vertical);

            expect(owned.length, `vertical \`${vertical}\` owns no flow — it would select nothing`).toBeGreaterThan(0);
        }
    });
});

describe('selection — the full set is the default and the fallback', () => {
    it('runs everything when the selector says so', () => {
        const selection = select(
            'full=true',
            'auth=false',
            'home=false',
            'collections=false',
            'discovery=false',
            'recipes=false',
        );

        expect(selection.status).toBe(0);
        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.skipped).toEqual([]);
    });

    it('runs everything when handed NO selector at all (the ci-full.yml / recipe-loadtest.yml callers)', () => {
        // Neither caller passes the input, so its default reaches the script as the empty string. That must
        // mean "everything", never "nothing".
        const selection = select();

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/full|no selector/i);
    });

    it('runs everything when the selector names no vertical (attribution FAILED, so widen)', () => {
        // The single most important case in this file. A PR that touches the app shell, the harness, the
        // design system or anything else unattributable sets no vertical — and the answer must be the full
        // suite, not an empty run reporting green.
        const selection = select(
            'full=false',
            'auth=false',
            'home=false',
            'collections=false',
            'discovery=false',
            'recipes=false',
        );

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/no vertical|attribut/i);
    });

    it('never selects an empty set, whatever it is handed', () => {
        for (const pairs of [[], ['full=false'], ['auth=false'], ['nonsense'], ['auth='], ['full=maybe']]) {
            expect(select(...pairs).flows.length, `selector \`${pairs.join(' ')}\` selected nothing`).toBeGreaterThan(
                0,
            );
        }
    });
});

describe('selection — malformed input widens LOUDLY rather than narrowing quietly', () => {
    it.each([
        ['an unknown key', 'catalog=true'],
        ['a near-miss key (substring of a real vertical)', 'recipe=true'],
        ['a superstring of a real vertical', 'recipes_extra=true'],
        ['the spine, which is not selectable', 'spine=true'],
        ['a pair with no `=`', 'recipes'],
        ['an empty key', '=true'],
        ['an empty value', 'recipes='],
        ['a non-boolean value', 'recipes=yes'],
        ['a capitalised boolean', 'recipes=TRUE'],
    ])('falls back to the full set on %s', (_label, pair) => {
        const selection = select('full=false', pair);

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/malformed|unknown|invalid/i);
    });

    it('does not treat a valid selector as malformed (the negative control)', () => {
        expect(select('full=false', 'auth=true').reason).not.toMatch(/malformed|unknown|invalid/i);
    });
});

describe('selection — a narrowed run is a SUBSEQUENCE of the plan, never a re-ordering', () => {
    it('selects the spine plus the auth flows for an auth-only change', () => {
        const selection = select(
            'full=false',
            'auth=true',
            'home=false',
            'collections=false',
            'discovery=false',
            'recipes=false',
        );

        expect(selection.flows).toEqual(['auth/login-flow', 'account-danger-zone']);
        // What did NOT run is reported, in full, so a narrowed run can never be mistaken for a complete one.
        expect(selection.skipped.length).toBe(ALL_FLOWS.length - selection.flows.length);
        expect(selection.skipped).toContain('recipes/collections-pagination');
    });

    it('selects the spine plus home for a features-core / HomeScreen change', () => {
        expect(select('full=false', 'home=true').flows).toEqual(['auth/login-flow', 'home']);
    });

    it('selects the spine plus the five collections flows — the 22%-of-flow-time cluster', () => {
        const selection = select('full=false', 'collections=true');

        expect(selection.flows).toEqual([
            'auth/login-flow',
            'recipes/collections',
            'recipes/collections-pagination',
            'recipes/collections-visibility',
            'recipes/collections-clone',
            'recipes/collections-pull',
        ]);
    });

    it('selects the spine plus the discovery flows', () => {
        expect(select('full=false', 'discovery=true').flows).toEqual([
            'auth/login-flow',
            'recipes/discover-browse',
            'recipes/discover-recent-searches',
            'recipes/discover-clone',
        ]);
    });

    it('unions two verticals at once, deduped and in plan order', () => {
        const both = select('full=false', 'collections=true', 'discovery=true').flows;
        const collections = select('full=false', 'collections=true').flows;
        const discovery = select('full=false', 'discovery=true').flows;

        expect(new Set(both)).toEqual(new Set([...collections, ...discovery]));
        expect(both.length).toBe(new Set(both).size);
        expect(both).toEqual(ALL_FLOWS.filter((flow) => both.includes(flow)));
    });

    it('keeps EVERY selection a subsequence of the plan (order is load-bearing, not cosmetic)', () => {
        // `recipes/delete` must stay last and `account-danger-zone` ahead of it; a selector that concatenated
        // per-vertical lists would satisfy set equality and still break that.
        for (const vertical of VERTICALS) {
            const flows = select('full=false', `${vertical}=true`).flows;

            expect(flows).toEqual(ALL_FLOWS.filter((flow) => flows.includes(flow)));
            expect(flows[0]).toBe('auth/login-flow');
        }
    });

    it('selecting every vertical is exactly the full set', () => {
        const flows = select('full=false', ...VERTICALS.map((vertical) => `${vertical}=true`)).flows;

        expect(flows).toEqual(ALL_FLOWS);
    });
});

describe('selection — vertical membership is matched on WHOLE tokens', () => {
    // The pr-1-vs-pr-15 trap, one domain over: a prefix/substring match would make `home` select
    // `homeRecentRecipeTap` and `recipes` select `recipes-archive`, and both would be invisible until a flow
    // ran that should not have. Driven through `select-plan` so the trap can be posed with names the repo
    // does not (yet) contain.
    const TRAP_PLAN =
        'spine:auth/login-flow home:home home:homeRecentRecipeTap recipes:recipes/create recipesx:recipes-archive';

    it('does not let a vertical name match a longer vertical name', () => {
        const flows = selectFromPlan(TRAP_PLAN, 'full=false', 'recipes=true').flows;

        expect(flows).toEqual(['auth/login-flow', 'recipes/create']);
        expect(flows).not.toContain('recipes-archive');
    });

    it('selects both flows of one vertical without matching the other vertical`s prefix', () => {
        const flows = selectFromPlan(TRAP_PLAN, 'full=false', 'home=true').flows;

        expect(flows).toEqual(['auth/login-flow', 'home', 'homeRecentRecipeTap']);
    });

    it('refuses an empty plan rather than reporting an empty, green run', () => {
        const selection = selectFromPlan('', 'full=true');

        expect(selection.status).toBe(2);
        expect(selection.flows).toEqual([]);
    });
});

describe('the workflow thread — caller → reusable workflow → job env → script', () => {
    it('composes one selector pair per vertical the script accepts, and no others', () => {
        const expression = selectorExpression();
        const named = [...expression.matchAll(/(\w+)=\{\d+\}/g)].map((match) => match[1] ?? '');

        expect(named).toContain('full');
        expect([...named].sort()).toEqual([...VERTICALS, 'full'].sort());
    });

    it('feeds every pair from a paths-filter key that exists and has positive patterns', () => {
        // `dorny/paths-filter` answers "does ANY pattern match", so ONE leading-`!` negation is TRUE for every
        // unrelated file — which would make its vertical fire on every PR. Precision comes from narrow
        // positives only.
        for (const vertical of VERTICALS) {
            const key = filterKeyFor(vertical);
            const patterns = FILTERS[key] ?? [];

            expect(
                patterns.length,
                `no \`${key}\` filter, so the \`${vertical}\` vertical is never detected`,
            ).toBeGreaterThan(0);
            expect(selectorExpression()).toContain(`needs.detect.outputs.${key}`);

            for (const pattern of patterns) {
                expect(pattern.startsWith('!'), `${key} pattern \`${pattern}\` is a negation`).toBe(false);
            }
        }
    });

    it('keeps the full-set clause covering the label, the non-PR events and a dispatch', () => {
        // The `heavy-e2e` label stays a manual override that runs EVERYTHING, and schedule / dispatch runs
        // are the routine full regression — none of them has a PR diff to narrow against.
        const expression = selectorExpression();

        expect(expression).toContain("github.event_name != 'pull_request'");
        expect(expression).toContain("contains(github.event.pull_request.labels.*.name, 'heavy-e2e')");
    });

    it('declares the input on the reusable workflow with a fail-safe default', () => {
        const inputs = (
            callee.on?.['workflow_call'] as { inputs?: Record<string, { default?: unknown; type?: string }> }
        )?.inputs;
        const input = inputs?.[SELECTOR_INPUT];

        expect(input, `${CALLEE_FILE} declares no \`${SELECTOR_INPUT}\` input`).toBeDefined();
        expect(input?.type).toBe('string');
        // Empty is the fail-safe: `ci-full.yml` and `recipe-loadtest.yml` call this workflow WITHOUT the
        // input, and the default they inherit must mean "run every flow".
        expect(input?.default ?? '').toBe('');
        expect(select().flows).toEqual(ALL_FLOWS);
    });

    it('hands the input to the script through step env, never expanded into a shell body', () => {
        // zizmor `template-injection`: a `${{ … }}` expanded directly into a `run:`/`script:` body is the
        // injection class. The value crosses into the emulator runner as an environment variable instead.
        const step = (callee.jobs?.[MAESTRO_JOB]?.steps ?? []).find((candidate) =>
            /android-emulator-runner@/.test(candidate.uses ?? ''),
        );

        expect(step, `${CALLEE_FILE}::${MAESTRO_JOB} has no emulator-runner step`).toBeDefined();
        expect(step?.env?.[SELECTOR_ENV]).toBe(`\${{ inputs.${SELECTOR_INPUT} }}`);
        expect(String(step?.with?.['script'] ?? '')).not.toContain('${{');
        expect(readFileSync(SCRIPT, 'utf8')).toContain(SELECTOR_ENV);
    });
});

describe('the path mapping — narrow where it is provable, widen everywhere else', () => {
    it('names only paths that exist (a filter pointing at a moved file matches nothing, forever)', () => {
        for (const path of [...Object.values(VERTICAL_PROBES).flat(), ...CROSS_CUTTING_PROBES]) {
            expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
        }
    });

    it('routes each vertical`s own paths to that vertical', () => {
        for (const [vertical, probes] of Object.entries(VERTICAL_PROBES)) {
            for (const path of probes) {
                expect(
                    filterMatches(filterKeyFor(vertical), path),
                    `${path} should imply the ${vertical} vertical`,
                ).toBe(true);
            }
        }
    });

    it('keeps every vertical path INSIDE the tier filter, or the emulator never boots for it', () => {
        // A vertical is a narrowing of a run that already happens. A path that narrows but does not admit is
        // a mapping that can never fire — and reads, in the log, exactly like one that did.
        for (const path of Object.values(VERTICAL_PROBES).flat()) {
            expect(filterMatches(TIER_FILTER_KEY, path), `${path} does not enter the Maestro tier at all`).toBe(true);
        }
    });

    it('attributes NO cross-cutting path to a vertical, so each one widens to the full set', () => {
        for (const path of CROSS_CUTTING_PROBES) {
            for (const vertical of VERTICALS) {
                expect(
                    filterMatches(filterKeyFor(vertical), path),
                    `${path} is cross-cutting — attributing it to \`${vertical}\` would silently drop coverage`,
                ).toBe(false);
            }
        }
    });

    it('leaves the design system and the localized copy cross-cutting ON PURPOSE', () => {
        // The requested mapping was "visual/ flows ← UI package / design-token changes ONLY". It is NOT
        // implemented that way, and the deviation is deliberate: (a) `@commise/ui` supplies the primitives
        // every screen taps, so a token/primitive change can break any flow's interaction, not just its
        // pixels; and (b) the `visual/` flows are inert until baselines are recorded, so mapping a UI change
        // to them ALONE would run zero flows and report green. A UI change therefore runs everything.
        for (const path of [
            'packages/apps/commise/ui/src/tokens/colors.ts',
            'packages/apps/commise/i18n/src/index.ts',
        ]) {
            expect(filterMatches(TIER_FILTER_KEY, path)).toBe(true);

            for (const vertical of VERTICALS) {
                expect(filterMatches(filterKeyFor(vertical), path)).toBe(false);
            }
        }
    });

    it('does NOT give the food service a trigger — the catalog flow asserts the DEGRADED path', () => {
        // `recipes/ingredient-catalog-blend` now RUNS, and it still buys the food service no trigger: the
        // Maestro job never boots food (`FOOD_SERVICE_URL` points at nothing on purpose), and the flow
        // asserts the F2 degradation that absence produces. So no food-service change can alter its outcome,
        // and booting a ~50-minute emulator for one would buy zero coverage.
        const foodPaths = [
            'packages/services/food-service/src/foods/foods.service.ts',
            'packages/services/food-service/src/foods/dao/food-search.dao.ts',
        ];

        for (const path of foodPaths) {
            expect(existsSync(join(REPO_ROOT, path))).toBe(true);
            expect(filterMatches(TIER_FILTER_KEY, path)).toBe(false);

            for (const vertical of VERTICALS) {
                expect(filterMatches(filterKeyFor(vertical), path)).toBe(false);
            }
        }
    });
});
