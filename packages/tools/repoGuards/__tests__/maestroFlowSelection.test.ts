// @vitest-environment node
/**
 * Repo-wide guard: **Maestro flow selection** and the flow INVENTORY behind it.
 *
 * ## Why this exists (the measurement, not a hunch)
 *
 * Nightly run 31471786779 of `e2e-mobile-maestro` took **52.75m**, of which only **17.3m** is fixed setup
 * (12.9m Gradle release-APK build + ~1.5m emulator/AVD boot + install + ~2.9m checkout/deps/service
 * build/seed) and **35.5m is FLOW EXECUTION**. The variable half dominates the fixed half 2:1, so caching
 * the fixed half is the small lever (Gradle/AVD caching targeted ~2.8% of the tier while the build sat in every
 * shard; the Gradle home is cached now that the build is hoisted, see `_mobileAppBuild.yml`); choosing FEWER FLOWS is the big one. `recipes/collectionsPagination` alone is 7.75m — 22% of all
 * flow time — and the top five flows are 48% of it.
 *
 * The impact selector (`@kitchensink/e2e-plan`, ADR-0086) names the flows a change can reach, and hands them to the
 * runner as `flow:<path>=true` keys; everything else is skipped LOUDLY (`skipped=` lines in the job log), never
 * silently. REWRITTEN 2026-11-07 (owner direction: "Delete the old per-area selector keys now"): the per-area keys
 * (`auth=true`, `recipes=true`, …) and the area labels in the plan are gone, so the plan is a list of flows with one
 * `spine:` label, and a retired area key is an unknown key that widens the run.
 *
 * ## The two failure modes this file exists to prevent
 *
 * 1. **Silently running LESS.** A selector that under-selects turns the one tier that drives the real app on
 *    a real device into a green check over work that never happened — the exact class this repo has already
 *    paid four weeks of production for. So every rule here is asymmetric: anything the runner cannot
 *    honour falls back to the FULL set. "No flow was named" is treated as "attribution failed", not as
 *    "nothing to run".
 * 2. **A flow that exists and never runs.** `recipes/ingredientCatalogBlend.yaml` was committed, reviewed,
 *    and then never executed by CI, because `runMaestroFlows.sh` iterates an explicit list and nobody added
 *    it — invisible for months behind a green job. The inventory assertion below makes that impossible to
 *    repeat: EVERY `.maestro` flow must be in the plan, or be a `runFlow` sub-flow, or be inert-by-
 *    construction (a `visual/` screenshot flow with no committed baseline), or be named in
 *    `KNOWN_UNRUN_FLOWS` with a reason. An unclassified flow fails this suite.
 *
 * ## Why the decision is executed as real `bash`
 *
 * Same reason as `prScope.test.ts` and `deployGate.test.ts`: a TypeScript re-implementation would be a
 * SECOND copy of the decision that drifts from the one CI runs. These tests shell out to the committed
 * script. The selection is a PURE function of `(plan, selector pairs)` — no adb, no emulator, no network —
 * which is what makes it testable at all; every impure step lives in the script's run path.
 *
 * ## Mutation evidence
 *
 *   - dropping the "no flow named ⇒ full" clause ⇒ "runs everything when the selector names no flow" fails with an
 *     EMPTY selection, i.e. a green Maestro job that ran nothing;
 *   - accepting an unknown or retired key silently ⇒ the unknown-key and retired-area-key cases fail;
 *   - matching a flow key with a bare prefix instead of the whole name ⇒ the `home`/`homeRecentRecipeTap` and
 *     `recipes/edit`/`recipes/editorSections` trap cases fail;
 *   - emitting the keys in the order they arrived instead of filtering the ordered plan ⇒ the ordering
 *     assertions fail (loginFlow first, `accountDangerZone` before `recipes/delete`, erasure last).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { scalarText } from './workflowScalar.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MOBILE = join(REPO_ROOT, 'packages/apps/commise/mobile');
const SCRIPT = join(MOBILE, 'tests/e2e/runMaestroFlows.sh');
const MAESTRO_DIR = join(MOBILE, '.maestro');
const WORKFLOW_DIR = join(REPO_ROOT, '.github/workflows');

/** The caller that holds the selection job and passes its answer on. */
const CALLER_FILE = '_ci.yml';

/** The reusable workflow that owns the emulator job. */
const CALLEE_FILE = '_ci-heavy.yml';

/** The emulator job id, as `_ci-heavy.yml` names it. */
const MAESTRO_JOB = 'e2e-mobile-maestro';

/** The iOS Simulator job id — the same plan, through the same script, on the other platform. */
const IOS_MAESTRO_JOB = 'e2e-mobile-maestro-ios';

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

/** The committed plan in execution order: one flow per entry, the spine labelled `spine:`. */
const PLAN: readonly string[] = lines('plan');

/** The plan's flows, in order — the FULL set the emulator runs when nothing is narrowed. */
const ALL_FLOWS: readonly string[] = PLAN.map((entry) => entry.replace(/^spine:/u, ''));

/** Flows every narrowed run must still include, whatever changed. */
const SPINE: readonly string[] = PLAN.filter((entry) => entry.startsWith('spine:')).map((entry) =>
    entry.replace(/^spine:/u, ''),
);

/** Every planned flow but the spine: what a flow key can name and the packer can place. */
const NON_SPINE: readonly string[] = ALL_FLOWS.filter((flow) => !SPINE.includes(flow));

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
 * Discovered rather than listed: `auth/signin.yaml` and `auth/signinHome.yaml` are the credential/landing
 * sub-flows every story composes, and a third one added tomorrow must not have to be registered here to
 * avoid tripping the inventory assertion. Both `runFlow:` forms count: the bare path, and the map form whose
 * `file:` key a flow needs to pass `env:` (`recipes/common/scrollOpenList.yaml` is only ever reached that way).
 */
function discoverSubFlows(files: readonly string[]): ReadonlySet<string> {
    const targets = new Set<string>();

    for (const flow of files) {
        const body = readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8');
        const directory = posix.dirname(flow);

        for (const match of body.matchAll(/runFlow:\s*(?:file:\s*)?([^\s#]+\.yaml)/g)) {
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
 * (same posture as `KNOWN_BUILDS_AFTER_PRUNE` in `workflowInvariants.test.ts`): the equality assertion
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
 *     back-stack.
 *   - `recipes/sourceTabs` — the My recipes ⇄ Discover round trip (L5). Its web pair caught a one-way trip
 *     that no per-surface test could see, so the mobile half is worth having.
 */
const KNOWN_UNRUN_FLOWS: readonly string[] = [
    // The two flows of the field reveal (`specSharedSystem.md` §16.2, §16.3): written with the slice and NOT run, because
    // the keyboard rising, the pinned footer and the title landing mid-screen are device behaviour that only an emulator
    // run can prove (this slice was built without a device). Promote both to FLOW_PLAN in the PR whose
    // Maestro tier is watched, once an emulator run has passed them.
    'auth/keyboardReveal',
    'recipes/refusedPublishField',
    // A paste the server reads as stalled (plan 2026-10-15-011): only a stage whose parse worker is STOPPED says so,
    // after 360 s of nothing moving, and every planned run drives a deployed stage whose worker answers first. Hand-run on
    // a local stage without `recipe-workers`; there is no planned stage it could pass on.
    'recipes/pasteListStalled',
    // Mark Private, then Publish (pre-push fix pass 2026-10-26): written with the fix that sends the visibility BEFORE the first
    // Publish and NOT run, because it was built without a device. Promote it to FLOW_PLAN once an emulator run has passed it.
    'recipes/publishPrivateDraft',
    // Publish with Private chosen, where the server will refuse Private, opens a sheet (owner ruling 2026-10-26): written NOT run. It needs a seeded
    // draft of an imported public-web recipe, held public, with a device draft saying Private, for a cook who is not entitled,
    // and the e2e seed does not mint that. Promote it to FLOW_PLAN once the seed carries it and an emulator run has passed it.
    'recipes/publishBlockedAsk',
    // The Suggested option in the add field (owner rulings 2026-11-03; designer ruling N2): a remembered answer is the first
    // option, tagged, never active, and only a tap binds it. Written test-first with the slice and NOT run (built without a
    // device); it needs the deployed stage's catalog and a food the cook has corrected before. Promote it to FLOW_PLAN, in the
    // sandbox-only list, once an emulator run has passed it.
    'recipes/ingredientSuggested',
    // The matched paste (ADR-0071; owner rulings 2026-10-25), the two flows still unplanned. Choosing a food and
    // publishing with open choices passed on the local Android stack and were promoted (2026-11-06). These two depend on
    // what the stage's catalog and review gate answer. `pasteMatchConfident` assumes a catalog food named "Egg, whole,
    // raw, fresh", and the curated catalog names it "eggs" (issue #140), so it cannot pass until its line is re-chosen.
    // `pasteMatchChecking` needs a review that answers late; it passed one local Android run (2026-11-06) and waits on the
    // lead's call to promote it. Promote `pasteMatchConfident` to FLOW_PLAN once an emulator run has passed it.
    'recipes/pasteMatchConfident',
    'recipes/pasteMatchChecking',
    // The offline write path: the editor saves through the outbox (ADR-0057), and these flows assert the cook-visible
    // half (a save that succeeds offline, a queued write surviving an app restart). Android-bound like their siblings
    // (`setAirplaneMode` has no iOS Simulator equivalent), so they run by hand on an emulator.
    //
    // ⛔ The restart flow is the ONLY test that can prove the outbox is genuinely durable: everything else about offline
    // is reproducible with an in-memory queue. It CANNOT pass on the shipped app: an offline cold start waits on the
    // sign-in gate until Clerk loads (ADR-0069), so the relaunch never shows the pending change. Keep it: it is the test
    // ADR-0069 requires before Clerk's resource cache may come back.
    'offline/offlineSave',
    'offline/offlineSurvivesRestart',
    // Discard while offline (plan 2026-10-13-004): Android-bound like its siblings (`setAirplaneMode`), manual-only.
    'offline/discardWhileOffline',
    // Sign out while offline fails and keeps the cook signed in (ADR-0068): Android-bound like its siblings, manual-only.
    'offline/signOutWhileOffline',
    'homeRecentRecipeTap',
    // Slice 3: the iOS edge swipe needs the iOS Simulator, which does not run on Linux (blueprint Q4); it runs by name on
    // a Mac until an iOS lane exists.
    'shell/iosSwipeBack',
    // The window overlay dismiss routes (OverlayHost). Back order is Android only; swipe-dismiss runs on BOTH platforms. Neither
    // is planned, so no planned suite runs them on either platform; run by name. The QA engineer's device run decides whether
    // either joins FLOW_PLAN.
    'shell/overlayBackOrder',
    'recipes/sourceTabs',
    // Plan 012: the native Google sign-in's cancel (iOS) / no-Play-services error (Android) path. It must start signed
    // OUT, so planning it costs one more Clerk email-code sign-in per platform per run (to restore the session the next
    // flow needs) against the budget the describe below pins to two, and it has never run on a device. The buttons'
    // PRESENCE is asserted by the spine (`auth/loginFlow`); the states are `useSocialSignIn.native.test.tsx`'s.
    'auth/socialCancel',
    // The native sign-up journey (plan 012 D8): it CREATES a Clerk user per run — a fresh username and a `+clerk_test`
    // email — outside the fixed test pool, and nothing reclaims those users yet. Planning it needs a cleanup story for
    // them (the owner's test-data scoping rule) and one more email-code verification per platform against the budget
    // below. The same journey is proven on web by `signUp.spec.ts`; its states are `signup.native.test.tsx`'s.
    'auth/signUpFlow',
];

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
    readonly run?: unknown;
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

/**
 * The workflow that RELAYS the selector: every deployed tier moved into it, so `_ci.yml` computes the selector
 * and hands it to that workflow, whose Maestro job hands it on to `_ci-heavy.yml` unchanged.
 */
const RELAY_FILE = 'deployedE2eTiers.yml';
const relay = loadWorkflow(RELAY_FILE);

/**
 * The selector expression the caller passes to the reusable workflow.
 *
 * REWRITTEN when the Maestro call moved into the relay: the expression is read where it is COMPUTED (the
 * caller's call of the relay), and the relay hop is asserted here, in the one helper every case goes through,
 * so a relay that drops the input fails every case rather than none.
 */
function selectorExpression(): string {
    const relayCall = Object.entries(caller.jobs ?? {}).find(
        ([, job]) => job.uses === `./.github/workflows/${RELAY_FILE}`,
    );
    const value = relayCall?.[1].with?.[SELECTOR_INPUT];

    if (value === undefined) {
        throw new Error(
            `${CALLER_FILE} passes no \`${SELECTOR_INPUT}\` input to ${RELAY_FILE}, so the emulator job can never be ` +
                'told which flows a change reaches and every run pays the full 35.5m of flows.',
        );
    }

    const relayed = scalarText(relay.jobs?.[MAESTRO_JOB]?.with?.[SELECTOR_INPUT]);
    const declared = (relay.on?.['workflow_call'] as { inputs?: Record<string, { default?: unknown }> } | undefined)
        ?.inputs?.[SELECTOR_INPUT];

    if (relayed !== `\${{ inputs.${SELECTOR_INPUT} }}` || declared === undefined || (declared.default ?? '') !== '') {
        throw new Error(
            `${RELAY_FILE}::${MAESTRO_JOB} does not relay \`${SELECTOR_INPUT}\` verbatim from a fail-safe (empty) input ` +
                `— it passes '${relayed}'.`,
        );
    }

    return scalarText(value);
}

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
                'FLOW_PLAN in runMaestroFlows.sh, or record it in KNOWN_UNRUN_FLOWS ' +
                'with the reason it cannot run yet.',
        ).toEqual([]);
    });

    /**
     * ⛔ EXISTENCE IS NOT RUNNABILITY, and this test used to assert only the former.
     *
     * `recipes/createAuthoredFood.yaml` was committed as a ZERO-BYTE file and sat in `FLOW_PLAN` for its
     * whole life. `existsSync` was true, so this suite passed; Maestro answered `Config Section Required at
     * …:1:1` on every heavy run, and the U16 vertical had no on-device coverage at all while the inventory
     * reported it covered. A guard that asks whether a test FILE is present, rather than whether it contains
     * a test, cannot tell "written" from "planned" — which is the one distinction this inventory exists for.
     *
     * So the assertion is now the flow's own structure: the config document Maestro requires (an `appId`),
     * the `---` separator, and at least one command after it. Parsed, not pattern-matched — a file whose
     * commands are a comment block would satisfy a grep and still run nothing.
     */
    it('plans only flows that exist on disk AND actually contain a runnable flow', () => {
        for (const flow of ALL_FLOWS) {
            const path = join(MAESTRO_DIR, `${flow}.yaml`);

            expect(existsSync(path), `${flow}.yaml is planned but missing`).toBe(true);

            const source = readFileSync(path, 'utf-8');

            expect(source.trim(), `${flow}.yaml is empty — it is planned but was never written`).not.toBe('');

            const separator = /^---[ \t]*$/m.exec(source);

            expect(
                separator,
                `${flow}.yaml has no '---' separator, so Maestro reads no config section ` +
                    '(it fails with "Config Section Required")',
            ).not.toBeNull();

            const header: unknown = parse(source.slice(0, separator?.index ?? 0));
            const commands: unknown = parse(source.slice((separator?.index ?? 0) + (separator?.[0].length ?? 0)));

            expect(header, `${flow}.yaml's config section must declare a string appId`).toMatchObject({
                appId: expect.any(String),
            });
            expect(
                Array.isArray(commands) && commands.length > 0,
                `${flow}.yaml declares an appId but no commands — it would run nothing`,
            ).toBe(true);
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
            'visual baselines are now committed — add the `visual/*` flows to FLOW_PLAN ' +
                'and give them a filter key, per .maestro/config.yaml’s activation note.',
        ).toBe(false);

        for (const flow of visual) {
            expect(ALL_FLOWS).not.toContain(flow);
        }
    });

    it('never plans a sub-flow as a story (a `runFlow` target is not a test)', () => {
        const subFlows = discoverSubFlows(discoverFlowFiles());

        // `auth/loginFlow` deliberately `runFlow`s `signin.yaml`, so the sub-flows ARE covered — as part of
        // the stories that compose them, which is why running one on its own would prove nothing new.
        expect(subFlows.size).toBeGreaterThan(0);

        for (const flow of subFlows) {
            expect(ALL_FLOWS, `${flow} is a runFlow target, not a story`).not.toContain(flow);
        }
    });
});

describe('the plan — ordering invariants the flows depend on', () => {
    it('starts with the only signed-out flow, so a cleared session is re-established first', () => {
        expect(ALL_FLOWS[0]).toBe('auth/loginFlow');
        expect(SPINE).toEqual(['auth/loginFlow']);
    });

    it('runs accountErasure last, after recipes/delete, with the cancel-only flow before both', () => {
        // ⛔ `accountErasure` is last because it REALLY ERASES now. Against the runner-local stack its
        // identity leg hit a stub that destroyed nothing; a deployed stage has no stub, and re-introducing
        // one is the local stand-in the 2026-09-05 ruling removed. So it erases its own run-scoped subject
        // for real, ends that Clerk session and leaves the app signed out — a state no flow may inherit.
        expect(ALL_FLOWS.at(-1)).toBe('accountErasure');
        expect(ALL_FLOWS.indexOf('recipes/delete')).toBeLessThan(ALL_FLOWS.indexOf('accountErasure'));
        expect(ALL_FLOWS.indexOf('accountDangerZone')).toBeLessThan(ALL_FLOWS.indexOf('recipes/delete'));
    });

    /**
     * ⛔ The per-area labels were retired with the per-area keys (2026-11-07). A label nothing reads is a second,
     * unchecked statement of which flows belong together, so the plan carries exactly one: the spine.
     */
    it('labels nothing but the spine — the plan is a list of flows', () => {
        expect(PLAN.filter((entry) => entry.includes(':') && !entry.startsWith('spine:'))).toEqual([]);
    });

    it('refuses a plan that labels a flow with anything but the spine, rather than running a flow named by its label', () => {
        const selection = selectFromPlan('spine:auth/loginFlow recipes:recipes/create', 'full=true');

        expect(selection.status).toBe(2);
        expect(selection.flows).toEqual([]);
    });
});

/**
 * The Maestro tier's share of Clerk's EMAIL-CODE verification budget: up to seven per platform per full run before `sessionHandoff`, ten with it, and only on
 * purpose.
 *
 * The deployed k6 pool failed on Clerk refusing its email-code steps, and that counter's window and scope are
 * unmeasured (possibly instance-wide, shared with every tier signing in against the sandbox dev instance). On
 * the device a sign-in goes through `LoginScreen`: email, password, then a new-device email code — one
 * verification. The credential block in `auth/signinHome.yaml` runs only when the login form is showing, and
 * the app's session persists in `expo-secure-store` between flows (the runner reinstalls the DRIVER, never the
 * app, and `e2e-seed reset` resets the database), so the form shows only after a clear (`auth/launchCleared.yaml`, the
 * one way a flow clears, `maestroLaunchAfterClear.test.ts`). Four planned flows
 * clear it, and each is a UI sign-in on purpose:
 *
 *   - `auth/loginFlow` — the spine, and the mobile sign-in UI test itself (one);
 *   - `accountErasure` — must sign in as a DIFFERENT identity (the run's erasure subject) (one);
 *   - `recipes/paidFeaturesByRole` — the paid features by ROLE (plan 2026-10-14-009 D12): it must sign in as the `roles`
 *     tier's default, premium, vip and superuser users (four), and its `onFlowComplete` clears the device so the next
 *     flow signs back in as the shard's signer (one more). It runs on both platforms, for the reason
 *     `runMaestroFlows.sh` gives beside `FLOW_PLAN`;
 *   - `recipes/makePublicConfirm` — the make-public confirm (plan 2026-10-14-009 Q5): it must sign in as the `roles`
 *     tier's downgraded owner, the one cook who holds private work without an entitled role (one), and the next flow
 *     signs back in as the shard's signer (one more).
 *
 * ⚠️ Replacing `accountErasure`'s UI sign-in with `e2e-seed`'s stored session is NOT available: that handle
 * belongs to the runner's Clerk client (a dev-browser JWT on the host), and nothing lets `@clerk/expo` on the
 * device adopt it without a new, test-only sign-in entry point shipped in the release APK. It would save one
 * verification per run; it is recorded as the option, not built.
 *
 * ⚠️ Scope is the PLANNED flows. Three `visual/*` flows also `clearState` (and so would each spend one), but they are
 * excluded from the plan while `assertScreenshot` has no baselines — activating them grows the budget, and the
 * first assertion below will say so the moment one is planned.
 *
 * ⚠️ A flow that LOSES its session mid-run (an app crash that also loses secure storage, a revoked session) would
 * silently re-sign-in through the same guarded block and spend another verification. That cannot be counted
 * statically; it shows up as an extra `Verification code` step in the flow's log.
 */
describe('the Clerk email-code budget — only the flows that test sign-in clear the session', () => {
    const planned = (): readonly { readonly flow: string; readonly body: string }[] =>
        ALL_FLOWS.map((flow) => ({ flow, body: readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8') }));

    it('clears app state only in the sign-in UI test, the erasure flow, the session handoff and the two role flows', () => {
        const clearing = planned()
            .filter(({ body }) => /^\s*- runFlow:\s*\S*launchCleared\.yaml\s*$/mu.test(body))
            .map(({ flow }) => flow);

        expect(
            clearing.sort(),
            'a flow that clears state forces a UI sign-in, which spends a shared Clerk email-code verification',
        ).toEqual([
            'accountErasure',
            'auth/loginFlow',
            'recipes/makePublicConfirm',
            'recipes/paidFeaturesByRole',
            'sessionHandoff',
        ]);
    });

    it('types the fixed email code only in the guarded credential sub-flow — and the unplanned sign-up', () => {
        const typing = discoverFlowFiles().filter((flow) =>
            /^\s*-\s*inputText:\s*['"]?424242/mu.test(readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8')),
        );

        // `auth/signUpFlow` cannot avoid the code — verifying the new email IS the journey — and it spends nothing from
        // this budget because it is NOT planned (KNOWN_UNRUN_FLOWS says why). Planning it is the moment this list must
        // be argued again.
        expect(typing).toEqual(['auth/signUpFlow', 'auth/signinHome']);
        expect(KNOWN_UNRUN_FLOWS).toContain('auth/signUpFlow');
    });

    // REWRITTEN 2026-11-01: the guard keys on the login form's TITLE, its first element, not the email placeholder. At
    // the system's largest text the fields sit below the first screen, where Android does not report them visible, so a
    // placeholder guard skipped the sign-in of a signed-out cook. The title is unique to the login form.
    it('keeps that credential block guarded on the login form being visible', () => {
        const body = readFileSync(join(MAESTRO_DIR, 'auth/signinHome.yaml'), 'utf8');
        const guard = body.indexOf("visible: 'Sign in to Commise'");

        expect(guard, 'without the guard every flow would sign in again').toBeGreaterThan(0);
        expect(body.indexOf("inputText: '424242'")).toBeGreaterThan(guard);
    });

    it('never wipes the app between flows — only the Maestro driver is reset', () => {
        const script = readFileSync(SCRIPT, 'utf8');

        expect(script).not.toMatch(/pm\s+clear\b/u);
        expect(script).not.toMatch(/pm\s+uninstall\s+["']?io\.commise/u);
        expect(script).toMatch(/adb install -r/u);
        // The iOS half: an app uninstall, a Simulator erase or a privacy reset would each sign every later flow
        // out (or re-prompt), exactly like `pm clear`. Only the driver bundle may be uninstalled.
        expect(script).not.toMatch(/simctl\s+(?:erase|privacy)\b/u);
        expect(script).not.toMatch(/simctl\s+uninstall\s+\S+\s+["']?io\.commise/u);
        expect(script).toMatch(/simctl install "\$MAESTRO_IOS_UDID" "\$MAESTRO_IOS_APP"/u);
    });
});

/**
 * A flow recognises the sign-in screen by its TITLE, its first element (GATE 2026-11-01). At the system's largest text the
 * fields sit below the first screen, where Android reports nothing visible, so a wait or a guard on the email placeholder
 * skipped a sign-in, timed out, or (as `assertNotVisible`) passed when it should not. Scrolling to the placeholder and
 * tapping it stay allowed: only a VISIBILITY condition keyed on it is refused, in either selector form (`visible: x`
 * or a nested `text: x`), quoted or not. `notVisible` is named, since `visible` does not match its capital V.
 */
const PLACEHOLDER_VISIBILITY =
    /(?:visible|notVisible|assertVisible|assertNotVisible):\s*(?:text:\s*)?['"]?you@example/mu;

describe('the sign-in screen is recognised by its title, never by the email placeholder', () => {
    it.each([
        ['a quoted wait', "- extendedWaitUntil:\n      visible: 'you@example.com'", true],
        ['a double-quoted assert', '- assertVisible: "you@example.com"', true],
        ['an unquoted assert', '- assertVisible: you@example.com', true],
        ['a nested text selector', "- assertVisible:\n      text: 'you@example.com'", true],
        ['a nested guard', '- runFlow:\n      when:\n          notVisible:\n              text: you@example.com', true],
        ['a scroll target', "      env:\n          TARGET: 'you@example.com'", false],
        ['a tap', "- tapOn: 'you@example.com'", false],
        ['the title', "- extendedWaitUntil:\n      visible: 'Sign in to Commise'", false],
    ])('%s → refused: %s', (_case, body, refused) => {
        expect(PLACEHOLDER_VISIBILITY.test(body)).toBe(refused);
    });

    it('holds for every committed flow', () => {
        const keyed = discoverFlowFiles().filter((flow) =>
            PLACEHOLDER_VISIBILITY.test(readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8')),
        );

        expect(keyed).toEqual([]);
    });
});

describe('selection — the full set is the default and the fallback', () => {
    it('runs everything when the selector says so', () => {
        const selection = select('full=true', 'flow:home=false');

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

    it('runs everything when the selector names no flow (attribution FAILED, so widen)', () => {
        // The single most important case in this file. A selector that names nothing must mean the full suite,
        // never an empty run reporting green.
        const selection = select('full=false', 'flow:home=false', 'flow:accountErasure=false');

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/no flow|attribut/i);
    });

    it('never selects an empty set, whatever it is handed', () => {
        for (const pairs of [[], ['full=false'], ['flow:home=false'], ['nonsense'], ['flow:home='], ['full=maybe']]) {
            expect(select(...pairs).flows.length, `selector \`${pairs.join(' ')}\` selected nothing`).toBeGreaterThan(
                0,
            );
        }
    });
});

describe('selection — malformed input widens LOUDLY rather than narrowing quietly', () => {
    it.each([
        ['an unknown key', 'catalog=true'],
        ['a retired area key', 'recipes=true'],
        ['another retired area key', 'auth=true'],
        ['the spine, which is not selectable', 'spine=true'],
        ['a pair with no `=`', 'flow:home'],
        ['an empty key', '=true'],
        ['an empty value', 'flow:home='],
        ['a non-boolean value', 'flow:home=yes'],
        ['a capitalised boolean', 'flow:home=TRUE'],
    ])('falls back to the full set on %s', (_label, pair) => {
        const selection = select('full=false', 'flow:recipes/edit=true', pair);

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/malformed|unknown|invalid/i);
    });

    it('does not treat a valid selector as malformed (the negative control)', () => {
        expect(select('full=false', 'flow:home=true').reason).not.toMatch(/malformed|unknown|invalid/i);
    });
});

describe('selection — a narrowed run is a SUBSEQUENCE of the plan, never a re-ordering', () => {
    it('runs each flow, named alone, as exactly the spine and that flow', () => {
        for (const flow of NON_SPINE) {
            expect(select(`flow:${flow}=true`).flows, flow).toEqual([...SPINE, flow]);
        }
    });

    it('reports every flow it did not run, so a narrowed run can never be mistaken for a complete one', () => {
        const selection = select('flow:accountDangerZone=true', 'flow:accountErasure=true');

        expect(selection.skipped.length).toBe(ALL_FLOWS.length - selection.flows.length);
        expect(selection.skipped).toContain('recipes/collectionsPagination');
    });

    it('keeps plan order however the keys arrive (order is load-bearing, not cosmetic)', () => {
        // `recipes/delete` must stay ahead of `accountErasure` and `accountDangerZone` ahead of both; a selector that
        // emitted the keys in arrival order would hold the same set and still break that.
        const flows = select(
            'flow:accountErasure=true',
            'flow:recipes/delete=true',
            'flow:accountDangerZone=true',
            'flow:home=true',
        ).flows;

        expect(flows).toEqual(['auth/loginFlow', 'home', 'accountDangerZone', 'recipes/delete', 'accountErasure']);
    });

    it('naming every flow is exactly the full set', () => {
        expect(select(...NON_SPINE.map((flow) => `flow:${flow}=true`)).flows).toEqual(ALL_FLOWS);
    });

    it('refuses an empty plan rather than reporting an empty, green run', () => {
        const selection = selectFromPlan('', 'full=true');

        expect(selection.status).toBe(2);
        expect(selection.flows).toEqual([]);
    });
});

/**
 * ⛔ FLOW KEYS (`flow:<path>=true`) — the impact selector's answer, one flow at a time. The CI switch and the local lane
 * orchestrator hand the selector's flow list to the runner as these keys, the only narrowing key there is: a key the
 * runner cannot honour WIDENS the run and says so, and only a key it can honour narrows it.
 */
describe('selection — flow keys select exactly those flows plus the spine', () => {
    it('selects one named flow and the spine, and nothing else', () => {
        const selection = select('flow:recipes/edit=true');

        expect(selection.status).toBe(0);
        expect(selection.flows).toEqual(['auth/loginFlow', 'recipes/edit']);
        expect(selection.skipped.length).toBe(ALL_FLOWS.length - 2);
        expect(selection.reason).toMatch(/flows:.*recipes\/edit/u);
    });

    it('keeps plan order whatever order the keys arrive in', () => {
        const flows = select('flow:accountErasure=true', 'flow:home=true', 'flow:recipes/edit=true').flows;

        expect(flows).toEqual(['auth/loginFlow', 'home', 'recipes/edit', 'accountErasure']);
    });

    it('dedupes a flow named twice', () => {
        expect(select('flow:home=true', 'flow:recipes/edit=true', 'flow:home=true').flows).toEqual([
            'auth/loginFlow',
            'home',
            'recipes/edit',
        ]);
    });

    it('widens, naming the retired key, when an old per-area key rides beside a flow key', () => {
        const selection = select('home=true', 'flow:recipes/edit=true');

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/unknown selector key 'home'/u);
    });

    it('lets full=true win over any flow key', () => {
        expect(select('full=true', 'flow:recipes/edit=true').flows).toEqual(ALL_FLOWS);
    });

    it('treats flow:<path>=false as naming nothing, so a selector of only false keys widens', () => {
        const selection = select('flow:recipes/edit=false');

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(/no flow|attribut/iu);
    });

    it('matches a flow key on the WHOLE flow name, never a prefix', () => {
        const plan = 'spine:auth/loginFlow home homeRecentRecipeTap recipes/edit recipes/editorSections';

        expect(selectFromPlan(plan, 'flow:home=true').flows).toEqual(['auth/loginFlow', 'home']);

        expect(selectFromPlan(plan, 'flow:recipes/edit=true').flows).toEqual(['auth/loginFlow', 'recipes/edit']);
        expect(selectFromPlan(plan, 'flow:recipes/editorSections=true').flows).toEqual([
            'auth/loginFlow',
            'recipes/editorSections',
        ]);
    });

    it.each([
        ['a flow the plan does not run', 'flow:recipes/doesNotExist=true', /unknown flow/iu],
        ['a prefix of a planned flow', 'flow:recipes/edi=true', /unknown flow/iu],
        ['an empty flow name', 'flow:=true', /unknown flow|malformed/iu],
        ['a flow path with no flow: prefix', 'recipes/create=true', /unknown selector key/iu],
        ['a non-boolean flow value', 'flow:recipes/edit=yes', /invalid/iu],
    ])('widens to the full set, loudly, on %s', (_label, pair, reason) => {
        const selection = select('flow:recipes/edit=true', pair);

        expect(selection.flows).toEqual(ALL_FLOWS);
        expect(selection.reason).toMatch(reason);
    });

    it('names the two key shapes in the unknown-key message, so a caller learns them', () => {
        expect(select('nonsense=true').reason).toMatch(/expected full or flow:<path>/u);
    });
});

describe('the workflow thread — caller → reusable workflow → job env → script', () => {
    it('takes the selector from select-e2e and from nowhere else', () => {
        // REWRITTEN for ADR-0087. This and the two cases that followed it pinned the hand-typed `dorny/paths-filter`
        // of `detect-mobile-flows` (a pair per vertical, a filter key per pair, `full=false`). That job is gone: the
        // selector is the one in `@kitchensink/e2e-plan`, so which flows a path implies is tested there
        // (`planChange`, `impactPolicy`, `maestroFlows`), and `selectE2eWiring.test.ts` pins this hop. What is left
        // for this file is that the expression is the job output and nothing a person typed.
        expect(selectorExpression().replace(/\s+/gu, '')).toBe('${{needs.select-e2e.outputs.maestro_selector}}');
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
        expect(scalarText(step?.with?.['script'])).not.toContain('${{');
        expect(readFileSync(SCRIPT, 'utf8')).toContain(SELECTOR_ENV);
    });

    it('hands the SAME selector to the iOS Simulator job, through step env, never into its `run:` body', () => {
        // The iOS job runs the script from an ordinary `run:` step — the same injection class, the same answer.
        // A selector the iOS job did not receive would make it run the FULL suite on a narrowed PR, which is
        // safe but is not the tier the caller asked for; one it received through the body would be injectable.
        const steps = callee.jobs?.[IOS_MAESTRO_JOB]?.steps ?? [];
        const step = steps.find((candidate) => /e2e:maestro/u.test(scalarText(candidate.run)));

        expect(step, `${CALLEE_FILE}::${IOS_MAESTRO_JOB} has no step that runs the flows`).toBeDefined();
        expect(step?.env?.[SELECTOR_ENV]).toBe(`\${{ inputs.${SELECTOR_INPUT} }}`);
        expect(scalarText(step?.run)).not.toContain('${{');
    });
});
