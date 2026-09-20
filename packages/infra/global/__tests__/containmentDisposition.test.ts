// @vitest-environment node
/**
 * ⛔ EVERY recipe-service write door and every queue it feeds carries a written ADR-0040 CONTAINMENT DISPOSITION.
 *
 * ## Why this gate exists — the defect already happened once
 *
 * ADR-0040 contains test principals by composing `containmentPolicy.ts` into the owning policies through REQUIRED
 * fields, so every EXISTING call site had to decide what a test principal means there. What that technique cannot see
 * is a write path that never passes through one of the composed policies. The architecture review of the containment
 * work found exactly that: `RecipesService.requestVerification` enqueued ingredient-verification work — which spends
 * ADR-0024's shared $100/month production LLM pool and writes the GLOBAL `ingredient_resolution_memos` tier that
 * answers for every future cook — with no containment check at all, and the ADR's own Consequences said "nothing else
 * it does reaches a real user's data". Nothing failed, because nothing could: the compiler only sees the call sites
 * of a policy, never the ones that should exist.
 *
 * ## What is asserted
 *
 * Two surfaces are DISCOVERED from the service's production source by the TypeScript parser, never enumerated:
 *
 *  1. every `@Post` / `@Put` / `@Patch` / `@Delete` handler on a `@Controller` class — the doors a principal writes
 *     through;
 *  2. every `.enqueue*()` call on a port (`this.verificationQueue.enqueue`, `this.queue.enqueue`, …) — the effects that
 *     leave the request and run somewhere a principal's claim can no longer be read. HIGH-2 was one of these.
 *
 * Each must have an entry in {@link CONTAINMENT_DISPOSITION}, and each entry must still be discovered — both directions,
 * as `natEgressConsumers.test.ts` does, because a register that keeps a deleted handler is the same drift pointing the
 * other way. An entry is one of three dispositions:
 *
 *  - `reaches` — the {@link ContainedAction}s the path can perform. Every name must be a member of the policy's own
 *    `CONTAINED_ACTIONS` tuple (read from its AST), and every member must be reached by at least one entry, so a new
 *    action cannot be added to the policy without being tied to the doors that exercise it.
 *  - `ownerScoped` — the path writes only the caller's own data; the reason says why.
 *  - `sharedByRuling` — the path does reach shared data, and an owner ruling or ADR accepts that; the reason cites it.
 *
 * A reason is mandatory and must be substantive (CODING_STANDARDS §16.3): a blank or one-word `why` fails.
 *
 * ⛔ One claim is checked in the code, not only recorded: an ENQUEUE entry that `reaches` a contained action must sit in
 * a function that itself calls `isContained`, `evaluateContainment` or `assertNotContained`. An enqueue runs in a
 * function the handler does not own, so "the handler's policy decided" is not evidence for it — removing the early
 * return in `requestVerification` turns this gate red on its own. A HANDLER's `reaches` is not traced through the call
 * graph (that needs type-level dataflow this parser does not do); it is a recorded decision the vocabulary checks keep
 * honest.
 *
 * ## Why the PARSER and not grep, and `presentFiles` and not `trackedFiles`
 *
 * `enqueue` and `@Post` appear in prose throughout these files — the docstring above `requestVerification` names the
 * port it calls. And the subjects are being written in the same change that adds this gate, so a guard that read only
 * the git index would pass vacuously over exactly the code it was written for (`serviceSources.ts` records that
 * measured failure).
 *
 * DESIGN PATTERN: Registry + Specification — {@link CONTAINMENT_DISPOSITION} is the one register of decisions, and
 * {@link dispositionFindings} is a pure verdict over discovered surfaces, fired at deliberately violating fakes below.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, parse, presentFiles, referenceText, repoRoot, visit, type SourceFile } from './serviceSources.js';

/** The service whose containment policy this gate keeps honest. */
const SERVICE_SOURCE = 'packages/services/recipe-service/src';

/** The policy module whose `CONTAINED_ACTIONS` tuple is the action vocabulary. */
const POLICY_FILE = `${SERVICE_SOURCE}/common/containmentPolicy.ts`;

/** The HTTP verbs that write. `@Get` is a read; a read that writes is a defect this gate does not look for. */
const WRITE_VERBS: ReadonlySet<string> = new Set(['Post', 'Put', 'Patch', 'Delete']);

/** The identifiers a function calls to decide containment. */
const CONTAINMENT_CHECKS: ReadonlySet<string> = new Set(['isContained', 'evaluateContainment', 'assertNotContained']);

/** A contained action's name, as the policy spells it. Kept a `string` here: the tuple is read from source. */
type ContainedAction = string;

/** One decision about one write door or one enqueue. */
type Disposition =
    | { readonly reaches: readonly [ContainedAction, ...ContainedAction[]] }
    | { readonly ownerScoped: string }
    | { readonly sharedByRuling: string };

/** A discovered write handler or enqueue call. */
interface Surface {
    /** `Class.method` for a handler; `Class.method → receiver.enqueueX` for an enqueue. */
    readonly key: string;
    /** Repo-relative file that declares it. */
    readonly file: string;
    /** Whether the enclosing function calls a containment check (meaningful for enqueues). */
    readonly checksContainment: boolean;
}

/**
 * THE REGISTER. Every write door on a recipe-service controller, and every queue it feeds, with its decision.
 *
 * Adding a handler or an enqueue without an entry here fails the gate. Choose the disposition by asking ADR-0040's one
 * question — "does this let TEST data reach REAL data on an enforcing stage?" — not by matching a neighbour.
 */
const CONTAINMENT_DISPOSITION: {
    readonly handlers: Readonly<Record<string, Disposition>>;
    readonly enqueues: Readonly<Record<string, Disposition>>;
} = {
    handlers: {
        'AccountController.requestErasure': { reaches: ['eraseAccount'] },
        'ServiceErasureController.eraseAccount': {
            sharedByRuling:
                'No user principal reaches it: identity’s service-authenticated erasure fan-out carries no testPrincipal ' +
                'claim to contain. ADR-0040 Residual risk "Service-principal erasure is not contained" accepts it — ' +
                'deleting a pool user in Clerk is an operator act that retires the slot.',
        },
        'ServiceErasureController.foodReferences': {
            ownerScoped:
                'Writes nothing: a service-authenticated read of which authored food ids live recipes still reference, ' +
                'issued as POST so the id list travels in the body.',
        },
        'TestResetController.requestReset': {
            ownerScoped:
                'The self-purge targets only the verified caller’s own rows and objects; nothing accepts a target, ' +
                'and anyone the claim-and-registry gate refuses receives 404.',
        },
        'AnalyticsIngestController.ingest': { reaches: ['recordAnalytics'] },
        'CollectionsController.create': { reaches: ['publish'] },
        'CollectionsController.update': { reaches: ['publish'] },
        'CollectionsController.remove': {
            ownerScoped: 'Deletes a collection the caller owns; the owner predicate is the authorization.',
        },
        'CollectionsController.addRecipe': {
            ownerScoped:
                'Adds a recipe the caller can already read to a collection the caller owns; the referenced recipe ' +
                'and its owner are untouched, and a contained principal’s collection cannot be public.',
        },
        'CollectionsController.clone': { reaches: ['cloneForeign'] },
        'CollectionsController.previewPull': {
            ownerScoped: 'Writes nothing: computes the diff a pull into the caller’s own clone would apply.',
        },
        'CollectionsController.pullFromSource': {
            ownerScoped:
                'Rewrites only the membership of the caller’s own cloned collection from its source; the source ' +
                'collection is read, never written.',
        },
        'CollectionsController.removeRecipe': {
            ownerScoped: 'Removes a membership row from a collection the caller owns; the recipe itself is untouched.',
        },
        'IngredientsController.create': {
            sharedByRuling:
                'Writes a user-entered row into the SHARED ownerless ingredient catalog that every cook searches. ' +
                'Accepted under ADR-0040 owner ruling 1 ("the only thing we don’t have to worry about is food"); ' +
                'whether a freeform name counts as food is recorded as an open question in ADR-0040 Residual risk.',
        },
        'IngredientsController.addByName': {
            sharedByRuling:
                'Imports a food by name through food-service and persists a shared catalog placeholder. ADR-0040 ' +
                'owner ruling 1: "if we import new food that’s fine".',
        },
        'IngredientsController.addByFood': {
            sharedByRuling:
                'Admits an existing catalog food as a shared ingredient row. ADR-0040 owner ruling 1: "if we import ' +
                'new food that’s fine; otherwise the food will already be imported".',
        },
        'IngredientsController.createAuthoredFood': {
            ownerScoped:
                'Creates a PRIVATE authored food bindable only by its author (ADR-0029); food-service’s ' +
                '`POST /api/v1/foods/authored/test-purge` removes a test principal’s authored foods on reset.',
        },
        'IngredientsController.resolve': {
            sharedByRuling:
                'Settles an UNRESOLVED shared catalog food from a candidate pick — food identity, which ADR-0040 ' +
                'owner ruling 1 places outside containment.',
        },
        'IngredientsController.recordCorrection': { reaches: ['promoteCorrection'] },
        'PhotosController.createUploadUrl': {
            ownerScoped: 'Presigns an upload under the caller’s own owner prefix for a recipe the caller owns.',
        },
        'PhotosController.confirm': {
            ownerScoped: 'Records a photo row on a recipe the caller owns, under the caller’s own owner prefix.',
        },
        'PhotosController.reorder': {
            ownerScoped: 'Reorders photos on a recipe the caller owns; no other principal’s row is written.',
        },
        'PhotosController.remove': {
            ownerScoped: 'Deletes a photo from a recipe the caller owns; the owner predicate is the authorization.',
        },
        'RatingsController.setRating': { reaches: ['rate'] },
        'RatingsController.deleteRating': {
            ownerScoped:
                'Removes only the caller’s own rating; deliberately not contained, because removing a rating only ' +
                'takes back what reached real data.',
        },
        'ParseJobsController.create': {
            sharedByRuling:
                'The job and its lines are the caller’s own, but the worker spends ADR-0024’s shared LLM pool and ' +
                'writes the shared parse cache. ADR-0040 Residual risk records this as accepted capacity sharing ' +
                'pending an owner decision.',
        },
        'ParseJobsController.retry': {
            sharedByRuling:
                'Re-runs the caller’s own failed lines through the same shared LLM pool and parse cache as ' +
                'ParseJobsController.create; the same ADR-0040 Residual risk entry covers it.',
        },
        'ParseJobsController.editLine': {
            sharedByRuling:
                'Re-parses one edited line of the caller’s own job through the shared LLM pool and parse cache; the ' +
                'same ADR-0040 Residual risk entry covers it.',
        },
        'RecipesController.create': { reaches: ['publish', 'requestVerification'] },
        'RecipesController.getNutritionBatch': {
            ownerScoped: 'Writes nothing: a batched nutrition read issued as POST so the id list travels in the body.',
        },
        'RecipesController.update': { reaches: ['requestVerification'] },
        'RecipesController.remove': {
            ownerScoped: 'Soft-deletes a recipe the caller owns; the owner predicate is the authorization.',
        },
        'RecipesController.clone': { reaches: ['cloneForeign'] },
        'RecipesController.setVisibility': { reaches: ['publish'] },
        'VersionsController.restore': { reaches: ['requestVerification'] },
    },
    enqueues: {
        'ErasureService.enqueue → this.queue.enqueue': {
            ownerScoped:
                'Sends an erasure job row already admitted by its door: the user door evaluates eraseAccount before ' +
                'the row exists, and the service door is covered by its own handler entry.',
        },
        'TestResetService.enqueue → this.queue.enqueue': {
            ownerScoped:
                'Sends the caller’s own reset job; the worker re-checks the registry and purges only that owner.',
        },
        'ParseJobsService.enqueueOrMark → this.queue.enqueue': {
            sharedByRuling:
                'Parse-line work for the caller’s own job, spending the shared LLM pool; the ADR-0040 Residual risk ' +
                'entry on parse jobs covers it.',
        },
        'RecipesService.requestVerification → this.verificationQueue.enqueue': { reaches: ['requestVerification'] },
        'VersionsService.enforceRetention → this.pendingArchives.enqueueMany': {
            ownerScoped:
                'Archives the caller’s own version history under its owner prefix, which the test reset sweeps in ' +
                'the archive bucket.',
        },
    },
};

/**
 * The names of every decorator on a node, as their callee renders (`Post`, `Controller`, `nest.Post`).
 *
 * @param node - A class or class member.
 * @returns The decorator callee names, in source order. Pure.
 */
function decoratorNames(node: ts.Node): readonly string[] {
    if (!ts.canHaveDecorators(node)) {
        return [];
    }

    return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
        const expression = ts.isCallExpression(decorator.expression)
            ? decorator.expression.expression
            : decorator.expression;
        const name = referenceText(expression);

        return name === undefined ? [] : [name.split('.').at(-1) ?? name];
    });
}

/**
 * The member name of a class element, when it is a plain identifier or string.
 *
 * @param member - The class element.
 * @returns Its name, or `undefined` for a computed key. Pure.
 */
function memberName(member: ts.ClassElement): string | undefined {
    if (member.name === undefined) {
        return ts.isConstructorDeclaration(member) ? 'constructor' : undefined;
    }

    return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : undefined;
}

/**
 * Whether a subtree calls one of {@link CONTAINMENT_CHECKS}.
 *
 * @param node - The function body to search.
 * @returns `true` when a containment check is CALLED (an import or a mention in prose does not count). Pure.
 */
function callsContainmentCheck(node: ts.Node): boolean {
    let found = false;

    visit(node, (child) => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
            found ||= CONTAINMENT_CHECKS.has(child.expression.text);
        }
    });

    return found;
}

/**
 * Every write handler declared on a `@Controller` class in one source.
 *
 * @param source - One production source file.
 * @returns One surface per `@Post`/`@Put`/`@Patch`/`@Delete` method. Pure.
 */
function writeHandlersIn(source: SourceFile): readonly Surface[] {
    const handlers: Surface[] = [];

    visit(parse(source), (node) => {
        if (!ts.isClassDeclaration(node) || node.name === undefined || !decoratorNames(node).includes('Controller')) {
            return;
        }

        for (const member of node.members) {
            const name = memberName(member);

            if (
                ts.isMethodDeclaration(member) &&
                name !== undefined &&
                decoratorNames(member).some((decorator) => WRITE_VERBS.has(decorator))
            ) {
                handlers.push({ key: `${node.name.text}.${name}`, file: source.file, checksContainment: false });
            }
        }
    });

    return handlers;
}

/**
 * Every `.enqueue*()` call on a port in one source, attributed to the function that makes it.
 *
 * A call whose receiver is bare `this` (`this.enqueue(...)`) is a private helper, not a port — the helper's own body
 * holds the port call, which is discovered there. Anything else ending in a member named `enqueue…` is a port call,
 * whatever the receiver is called, so a new queue cannot opt out by naming its field differently.
 *
 * @param source - One production source file.
 * @returns One surface per port call. Pure.
 */
function enqueueCallsIn(source: SourceFile): readonly Surface[] {
    const calls: Surface[] = [];

    const collect = (owner: string, body: ts.Node): void => {
        const checksContainment = callsContainmentCheck(body);

        visit(body, (node) => {
            if (
                !ts.isCallExpression(node) ||
                !ts.isPropertyAccessExpression(node.expression) ||
                !/^enqueue/u.test(node.expression.name.text) ||
                node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
            ) {
                return;
            }

            const receiver = referenceText(node.expression.expression) ?? '(expression)';

            calls.push({
                key: `${owner} → ${receiver}.${node.expression.name.text}`,
                file: source.file,
                checksContainment,
            });
        });
    };

    const walk = (node: ts.Node): void => {
        if (ts.isClassLike(node)) {
            const className = node.name?.text ?? '(anonymous class)';

            for (const member of node.members) {
                collect(`${className}.${memberName(member) ?? '(computed)'}`, member);
            }

            return;
        }

        if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
            collect(node.name.text, node);

            return;
        }

        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            collect(node.name.text, node.initializer);

            return;
        }

        ts.forEachChild(node, walk);
    };

    walk(parse(source));

    return calls;
}

/**
 * The action vocabulary, read from the policy's `CONTAINED_ACTIONS = [...] as const` declaration.
 *
 * @param source - The policy module.
 * @returns The tuple's string members, in order. Pure.
 */
function containedActionsIn(source: SourceFile): readonly ContainedAction[] {
    const actions: ContainedAction[] = [];

    visit(parse(source), (node) => {
        if (
            !ts.isVariableDeclaration(node) ||
            !ts.isIdentifier(node.name) ||
            node.name.text !== 'CONTAINED_ACTIONS' ||
            node.initializer === undefined
        ) {
            return;
        }

        const array = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;

        if (ts.isArrayLiteralExpression(array)) {
            for (const element of array.elements) {
                if (ts.isStringLiteral(element)) {
                    actions.push(element.text);
                }
            }
        }
    });

    return actions;
}

/**
 * Whether a written reason says something. Blank, one-word and placeholder reasons fail (§16.3).
 *
 * @param why - The reason.
 * @returns `true` when it is at least six words. Pure.
 */
function isSubstantive(why: string): boolean {
    return (
        why
            .trim()
            .split(/\s+/u)
            .filter((word) => word.length > 0).length >= 6
    );
}

/**
 * Every way the register disagrees with what was discovered. Pure — the whole gate is this function.
 *
 * @param discovered - The handlers and enqueues found in source.
 * @param register - The decisions.
 * @param actions - The policy's action vocabulary.
 * @returns One human-readable finding per disagreement; empty when the register is exact.
 */
function dispositionFindings(
    discovered: { readonly handlers: readonly Surface[]; readonly enqueues: readonly Surface[] },
    register: typeof CONTAINMENT_DISPOSITION,
    actions: readonly ContainedAction[],
): readonly string[] {
    const findings: string[] = [];
    const known = new Set(actions);
    const reached = new Set<ContainedAction>();

    for (const kind of ['handlers', 'enqueues'] as const) {
        const surfaces = new Map(discovered[kind].map((surface) => [surface.key, surface]));
        const entries = register[kind];

        for (const [key, surface] of surfaces) {
            if (!(key in entries)) {
                findings.push(`${kind}: ${key} (${surface.file}) has no containment disposition`);
            }
        }

        for (const [key, disposition] of Object.entries(entries)) {
            const surface = surfaces.get(key);

            if (surface === undefined) {
                findings.push(`${kind}: ${key} is registered but no longer discovered — delete the entry`);
            }

            if ('reaches' in disposition) {
                for (const action of disposition.reaches) {
                    reached.add(action);

                    if (!known.has(action)) {
                        findings.push(`${kind}: ${key} reaches '${action}', which CONTAINED_ACTIONS does not declare`);
                    }
                }

                if (kind === 'enqueues' && surface !== undefined && !surface.checksContainment) {
                    findings.push(
                        `enqueues: ${key} reaches a contained action but its function never calls any of ` +
                            [...CONTAINMENT_CHECKS].join(', '),
                    );
                }

                continue;
            }

            const why = 'ownerScoped' in disposition ? disposition.ownerScoped : disposition.sharedByRuling;

            if (!isSubstantive(why)) {
                findings.push(`${kind}: ${key} carries no substantive reason ("${why}")`);
            }
        }
    }

    for (const action of actions) {
        if (!reached.has(action)) {
            findings.push(`CONTAINED_ACTIONS member '${action}' is reached by no registered handler or enqueue`);
        }
    }

    return findings;
}

/**
 * The recipe service's production sources. `__testing__` holds shared fakes (one has an `enqueue` method), so it is
 * test code for this gate's purpose even though `isTestFile` predates it.
 *
 * @returns The sources, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function productionSources(): readonly SourceFile[] {
    return presentFiles([SERVICE_SOURCE])
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .filter((file) => !isTestFile(file) && !/(^|\/)__testing__\//u.test(file))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('ADR-0040 containment disposition register', () => {
    const sources = productionSources();
    const discovered = {
        handlers: sources.flatMap((source) => writeHandlersIn(source)),
        enqueues: sources.flatMap((source) => enqueueCallsIn(source)),
    };
    const actions = containedActionsIn({
        file: POLICY_FILE,
        contents: readFileSync(path.join(repoRoot, POLICY_FILE), 'utf8'),
    });

    it('discovers something on every surface (a gate that finds nothing passes vacuously)', () => {
        expect(discovered.handlers.length, 'no write handler found').toBeGreaterThan(10);
        expect(discovered.enqueues.length, 'no enqueue call found').toBeGreaterThan(0);
        expect(actions.length, 'CONTAINED_ACTIONS was not read from the policy').toBeGreaterThan(0);
    });

    it('matches the register exactly, in both directions', () => {
        expect(dispositionFindings(discovered, CONTAINMENT_DISPOSITION, actions)).toEqual([]);
    });

    it('reads handlers from decorators, not from prose', () => {
        const found = writeHandlersIn({
            file: 'fake/fake.controller.ts',
            contents: `
                /** A @Post handler is documented here but this class is not a controller. */
                class NotAController { @Post() public create(): void {} }
                @Controller('api/v1/things')
                class ThingsController {
                    /** @Post() in a comment is not a decorator. */
                    @Get(':id') public read(): void {}
                    @Post() public create(): void {}
                    @Delete(':id') @HttpCode(204) public remove(): void {}
                }
            `,
        });

        expect(found.map(({ key }) => key)).toEqual(['ThingsController.create', 'ThingsController.remove']);
    });

    it('attributes an enqueue to its function, skips private helpers, and sees the containment check', () => {
        const found = enqueueCallsIn({
            file: 'fake/fake.service.ts',
            contents: `
                class ThingsService {
                    /** Calls this.queue.enqueue(...) — prose, not a call. */
                    private async guarded(subject: ContainmentSubject): Promise<void> {
                        if (isContained(subject)) { return; }
                        await this.queue.enqueue([]);
                    }
                    private async asserted(subject: ContainmentSubject): Promise<void> {
                        assertNotContained(subject, 'requestVerification');
                        await this.assertedQueue.enqueue([]);
                    }
                    private async unguarded(): Promise<void> {
                        await this.otherQueue.enqueueMany([]);
                        await this.enqueue('helper');
                    }
                }
                const worker = async (deps: Deps): Promise<void> => { await deps.queue.enqueue([]); };
            `,
        });

        expect(found.map(({ key, checksContainment }) => [key, checksContainment])).toEqual([
            ['ThingsService.guarded → this.queue.enqueue', true],
            ['ThingsService.asserted → this.assertedQueue.enqueue', true],
            ['ThingsService.unguarded → this.otherQueue.enqueueMany', false],
            ['worker → deps.queue.enqueue', false],
        ]);
    });

    it('fails an unregistered surface, a stale entry, an unknown or unreached action, a bare reason and an unguarded enqueue', () => {
        const fakeDiscovered = {
            handlers: [
                { key: 'A.create', file: 'a.ts', checksContainment: false },
                { key: 'A.unlisted', file: 'a.ts', checksContainment: false },
            ],
            enqueues: [{ key: 'S.save → this.queue.enqueue', file: 's.ts', checksContainment: false }],
        };
        const fakeRegister = {
            handlers: {
                'A.create': { reaches: ['publish', 'invented'] },
                'A.deleted': { ownerScoped: 'Deletes the caller’s own rows only, keyed on the verified user.' },
            },
            enqueues: { 'S.save → this.queue.enqueue': { reaches: ['publish'] } },
        } satisfies typeof CONTAINMENT_DISPOSITION;
        const bareReason = {
            handlers: { 'A.create': { ownerScoped: 'fine' }, 'A.unlisted': { sharedByRuling: '' } },
            enqueues: {},
        } satisfies typeof CONTAINMENT_DISPOSITION;

        expect(dispositionFindings(fakeDiscovered, fakeRegister, ['publish', 'rate'])).toEqual([
            'handlers: A.unlisted (a.ts) has no containment disposition',
            "handlers: A.create reaches 'invented', which CONTAINED_ACTIONS does not declare",
            'handlers: A.deleted is registered but no longer discovered — delete the entry',
            'enqueues: S.save → this.queue.enqueue reaches a contained action but its function never calls any of isContained, evaluateContainment, assertNotContained',
            "CONTAINED_ACTIONS member 'rate' is reached by no registered handler or enqueue",
        ]);
        expect(dispositionFindings(fakeDiscovered, bareReason, [])).toEqual([
            'handlers: A.create carries no substantive reason ("fine")',
            'handlers: A.unlisted carries no substantive reason ("")',
            'enqueues: S.save → this.queue.enqueue (s.ts) has no containment disposition',
        ]);
    });
});
