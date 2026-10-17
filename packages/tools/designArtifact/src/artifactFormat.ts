/**
 * @module artifactFormat — the artifact grammar in ONE place: the bundle header comment, the design-system card
 * marker, and the two index documents the host reads (`design-system.json`, `canvas.json`). Every other module
 * builds these through here, so a format change is one edit and one test table.
 *
 * @pattern Builder — pure constructors for the documents the host parses; they validate what would corrupt the
 * surrounding syntax (a comment terminator inside a comment) and refuse rather than emit it.
 */
import { DesignArtifactError } from './errors.js';

/** The bundle header revision the host understands. */
export const BUNDLE_FORMAT = 4;

/** The global the bundle publishes (`window.Commise`) and the design-system namespace. */
export const NAMESPACE = 'Commise';

/** The `design-system.json` / `canvas.json` revision the host understands. */
const INDEX_VERSION = 3;

/**
 * The header comment that opens the component bundle and tells the host which components it holds.
 *
 * @param components - Component names exported on `window.Commise`.
 * @returns A one-line block comment followed by a newline.
 * @throws DesignArtifactError `unsafe-header` when the JSON would contain a comment terminator.
 */
export function bundleHeader(components: readonly string[]): string {
    const json = JSON.stringify({
        format: BUNDLE_FORMAT,
        namespace: NAMESPACE,
        components: components.map((name) => ({ name })),
    });

    if (json.includes('*/')) {
        throw new DesignArtifactError(
            'unsafe-header',
            'The bundle header JSON contains "*/" and would end its comment.',
        );
    }

    return `/* @ds-bundle: ${json} */\n`;
}

/** What a component card says about itself to the host. */
export interface CardMarkerSpec {
    readonly group: string;
    readonly height: number;
}

/**
 * The first line of a component card page.
 *
 * @param spec - The group the card is listed under and its preview height in CSS pixels.
 * @returns The `<!-- @dsCard … -->` line.
 * @throws DesignArtifactError `unsafe-header` for an empty or unquotable group, or a height that is not a positive integer.
 */
export function cardMarker({ group, height }: CardMarkerSpec): string {
    if (group.length === 0 || group.includes('"') || group.includes('--')) {
        throw new DesignArtifactError(
            'unsafe-header',
            `Card group ${JSON.stringify(group)} cannot be written into a marker.`,
        );
    }

    if (!Number.isInteger(height) || height <= 0) {
        throw new DesignArtifactError('unsafe-header', `Card height ${String(height)} is not a positive integer.`);
    }

    return `<!-- @dsCard group="${group}" height=${String(height)} -->`;
}

/** A library the previews load from the host. */
export interface DesignSystemLibrary {
    readonly name: string;
    readonly version: string;
}

/** The `design-system.json` document. */
export interface DesignSystemIndex {
    readonly v: number;
    readonly assetGroups: Readonly<Record<string, never>>;
    readonly blobs: Readonly<Record<string, never>>;
    readonly createdOnFiles: { readonly at: string; readonly v: number };
    readonly docs: { readonly readme: string; readonly sections: readonly never[] };
    readonly groups: readonly never[];
    readonly lastChange: { readonly by: string; readonly at: string; readonly via: string; readonly note: string };
    readonly layout: 'files';
    readonly libraries: readonly DesignSystemLibrary[];
    readonly namespace: string;
    readonly sections: Readonly<Record<string, never>>;
    readonly title: string;
}

/** Inputs of {@link designSystemIndex}. */
export interface DesignSystemIndexSpec {
    readonly title: string;
    /** ISO-8601 instant, passed in so the builder stays pure. */
    readonly now: string;
    readonly libraries: readonly DesignSystemLibrary[];
}

/**
 * The design-system index.
 *
 * @param spec - Title, build instant and the libraries the previews expect.
 * @returns The document to serialise as `design-system.json`.
 */
export function designSystemIndex({ title, now, libraries }: DesignSystemIndexSpec): DesignSystemIndex {
    return {
        v: INDEX_VERSION,
        assetGroups: {},
        blobs: {},
        createdOnFiles: { at: now, v: 1 },
        docs: { readme: 'project/README.md', sections: [] },
        groups: [],
        lastChange: {
            by: 'Claude',
            at: now,
            via: 'Claude Code',
            note: 'Built from the component sources by @kitchensink/design-artifact',
        },
        layout: 'files',
        libraries: libraries.map((library) => ({ ...library })),
        namespace: NAMESPACE,
        sections: {},
        title,
    };
}

/** Where a board sits on the canvas. */
export interface CanvasBoard {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly title: string;
    readonly expand?: string;
}

/** A text note on the canvas, such as a row title. */
export interface CanvasNote {
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly kind: string;
    readonly maxW: number;
}

/** The design-system artifact a canvas was copied against. */
export interface CanvasDesignSystemRef {
    readonly title: string;
    readonly namespace: string;
    readonly artifact: string;
    readonly version: string;
    readonly copiedAt: string;
}

/** The `canvas.json` document. */
export interface CanvasIndex {
    readonly v: number;
    readonly createdOnFiles: { readonly v: number; readonly at: string };
    readonly title: string;
    readonly launch: { readonly view: 'canvas' };
    readonly pages: readonly never[];
    readonly boards: Readonly<Record<string, CanvasBoard>>;
    readonly order: readonly string[];
    readonly notes: Readonly<Record<string, CanvasNote>>;
    readonly designSystems: readonly CanvasDesignSystemRef[];
}

/** Inputs of {@link canvasIndex}. */
export interface CanvasIndexSpec {
    readonly title: string;
    /** ISO-8601 instant. */
    readonly now: string;
    /** Boards keyed by file name; the key order is the canvas order. */
    readonly boards: Readonly<Record<string, CanvasBoard>>;
    readonly notes: Readonly<Record<string, CanvasNote>>;
    /** Absent until the design system has been published and its link is known. */
    readonly designSystem?: CanvasDesignSystemRef | undefined;
}

/**
 * The canvas index.
 *
 * @param spec - Title, build instant, board placements, notes and the linked design system.
 * @returns The document to serialise as `canvas.json`.
 */
export function canvasIndex({ title, now, boards, notes, designSystem }: CanvasIndexSpec): CanvasIndex {
    return {
        v: INDEX_VERSION,
        createdOnFiles: { v: 1, at: now },
        title,
        launch: { view: 'canvas' },
        pages: [],
        boards,
        order: Object.keys(boards),
        notes,
        designSystems: designSystem === undefined ? [] : [designSystem],
    };
}
