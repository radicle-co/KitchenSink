/**
 * @module surface/surfaceChecks — the registry checks the build runs on every build, so a published artifact cannot
 * disagree with the source tree it claims to be built from.
 *
 * Four relations between the surface (what the bundle exports) and the things that name components:
 *   1. a card's `uses` against the surface, on each platform the card draws;
 *   2. a board's `Commise.X` / `Commise.Native.X` mounts against the surface;
 *   3. every discovered component against the cards plus `UNCARDED`, and `UNCARDED` against the surface and the
 *      cards (so an exception cannot outlive its reason);
 *   4. a card against the surface, the reverse of (1): a card folder for a component that is no longer exported.
 *
 * The check is a filter in the pipeline and not only a test: a test passes on a tree it never saw, and an artifact is
 * published from whatever tree the build ran on.
 *
 * Imports are not checked here on purpose. A bundle that imports a name a module does not export fails in esbuild
 * ("No matching export"), which is the real guard, and a second implementation of it would only be able to disagree.
 *
 * @pattern Specification — each relation is a predicate over the same input; {@link surfaceProblems} is their
 * conjunction, returned as a list of reasons, and {@link assertSurfaceChecks} is the fail-closed filter over it.
 */
import { artboardReferences } from '../canvas/artboardReferences.js';
import type { CardPageSpec } from '../cards/cardPage.js';
import { DesignArtifactError } from '../errors.js';

import type { Surface } from './discoverSurface.js';
import type { SurfaceKind } from './surfaceEntry.js';

/** What a card says about itself, with the folder it lives in. */
export interface CardClaim {
    /** The card's folder, which is the name of the component it documents. */
    readonly name: string;
    /** The components its `render` mounts. */
    readonly uses: readonly string[];
    readonly platforms: CardPageSpec['platforms'];
}

/** A canvas board and its text. */
export interface BoardClaim {
    readonly file: string;
    readonly html: string;
}

/** Everything the checks read. */
export interface SurfaceCheckInput {
    readonly surface: Surface;
    readonly cards: readonly CardClaim[];
    readonly boards: readonly BoardClaim[];
    /** Component name to why it has no card. */
    readonly uncarded: Readonly<Record<string, string>>;
}

type Platform = 'web' | 'native';

const PLATFORMS: readonly Platform[] = ['web', 'native'];

/** The shortest reason that can say why a component has no card. */
const MIN_REASON_LENGTH = 20;

/** The component names each platform exports. Hooks are on the surface too, and are not components. */
type Exported = Readonly<Record<Platform, ReadonlySet<string>>>;

/** What the rules read, prepared once. */
interface Facts extends SurfaceCheckInput {
    readonly exported: Exported;
    /** What a card may name in `uses`: the components, and the product values it reads. A hook is neither. */
    readonly usable: Exported;
    readonly cardNames: ReadonlySet<string>;
    readonly discovered: ReadonlySet<string>;
}

function drawn(platforms: CardClaim['platforms']): readonly Platform[] {
    return platforms === 'both' ? PLATFORMS : [platforms];
}

function namesOfKinds(surface: Surface, platform: Platform, kinds: readonly SurfaceKind[]): ReadonlySet<string> {
    return new Set(surface[platform].filter(({ kind }) => kinds.includes(kind)).map(({ name }) => name));
}

function factsOf(input: SurfaceCheckInput): Facts {
    const exported = {
        web: namesOfKinds(input.surface, 'web', ['component']),
        native: namesOfKinds(input.surface, 'native', ['component']),
    };
    const usable = {
        web: namesOfKinds(input.surface, 'web', ['component', 'value']),
        native: namesOfKinds(input.surface, 'native', ['component', 'value']),
    };

    return {
        ...input,
        exported,
        usable,
        cardNames: new Set(input.cards.map(({ name }) => name)),
        discovered: new Set([...exported.web, ...exported.native]),
    };
}

/** Rule 1: a card's `uses` against the surface, on each platform the card draws. */
function cardUsesProblems({ cards, usable }: Facts): readonly string[] {
    return cards.flatMap(({ name, uses, platforms }) =>
        uses.flatMap((used) =>
            drawn(platforms)
                .filter((platform) => !usable[platform].has(used))
                .map((platform) => `${name} uses ${used}, which the ${platform} surface does not export`),
        ),
    );
}

/** Rule 2: a board's mounts against the surface. */
function boardMountProblems({ boards, exported }: Facts): readonly string[] {
    return boards.flatMap(({ file, html }) =>
        artboardReferences(html)
            .filter(({ platform, name }) => !exported[platform].has(name))
            .map(
                ({ platform, name }) =>
                    `${file} mounts ${platform === 'web' ? 'Commise' : 'Commise.Native'}.${name}, which is not exported`,
            ),
    );
}

/** Rule 3a: every discovered component has a card or an `UNCARDED` entry. */
function uncardedComponentProblems({ discovered, cardNames, uncarded }: Facts): readonly string[] {
    return [...discovered]
        .sort()
        .filter((name) => !cardNames.has(name) && !(name in uncarded))
        .map((name) => `${name} has no card and no UNCARDED entry`);
}

/** Rule 3b: an `UNCARDED` entry cannot outlive its reason. */
function staleUncardedProblems({ discovered, cardNames, uncarded }: Facts): readonly string[] {
    return Object.entries(uncarded).flatMap(([name, reason]) => {
        if (!discovered.has(name)) {
            return [`UNCARDED lists ${name}, which is not a discovered component`];
        }

        if (cardNames.has(name)) {
            return [`UNCARDED lists ${name}, which has a card; remove the entry`];
        }

        return reason.length < MIN_REASON_LENGTH ? [`UNCARDED lists ${name} without a reason`] : [];
    });
}

/** Rule 4: a card for a component that is no longer exported. */
function orphanCardProblems({ cards, exported }: Facts): readonly string[] {
    return cards.flatMap(({ name, platforms }) =>
        drawn(platforms)
            .filter((platform) => !exported[platform].has(name))
            .map((platform) => `${name} is a card for a component the ${platform} surface does not export`),
    );
}

/**
 * Every way the cards, boards and `UNCARDED` disagree with the surface.
 *
 * @param input - The surface and the things that name its components.
 * @returns One sentence per problem; empty when everything agrees.
 */
export function surfaceProblems(input: SurfaceCheckInput): readonly string[] {
    const facts = factsOf(input);

    return [
        ...cardUsesProblems(facts),
        ...boardMountProblems(facts),
        ...uncardedComponentProblems(facts),
        ...staleUncardedProblems(facts),
        ...orphanCardProblems(facts),
    ];
}

/**
 * The fail-closed filter.
 *
 * @param input - The surface and the things that name its components.
 * @throws DesignArtifactError `surface-mismatch` listing every problem, so one build shows them all.
 */
export function assertSurfaceChecks(input: SurfaceCheckInput): void {
    const problems = surfaceProblems(input);

    if (problems.length > 0) {
        throw new DesignArtifactError(
            'surface-mismatch',
            `The artifact would disagree with the source tree:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
        );
    }
}
