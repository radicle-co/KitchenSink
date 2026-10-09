/**
 * @module @commise/features-recipes — the cook-marks store (blueprint A13): one cook's marks per recipe, kept for the
 * session behind a small storage port, and readable through `useSyncExternalStore`.
 *
 * Marks are keyed by (cook, recipe) and never by screen, so a recipe open twice shows ONE set of marks. The storage
 * behind the port is the platform's choice (`cookMarksBackend.ts`): `sessionStorage` on web, memory on native.
 *
 * The session scope is the ADR-0054 rule applied to marks: when the cook changes from a cook to anyone else, every
 * mark is removed from storage — re-keying alone would leave them at rest; when a cook becomes known, every OTHER
 * cook's marks are removed; while no cook is known yet (a page still loading its session) nothing is removed, so a
 * reload keeps the cook's marks.
 *
 * @pattern Ports & Adapters — the store reads and writes through the `CookMarksBackend` port
 * @pattern Observer — subscribers hear every change, the `useSyncExternalStore` contract
 */
import {
    applyCookMark,
    cookMarksKey,
    hasCookMarks,
    isCookMarksKeyOf,
    parseCookMarks,
    serializeCookMarks,
    type CookMarkCommand,
    type CookMarks,
} from './cookMarks.js';

/** The storage the store needs: a string key–value map that can list its keys. */
export interface CookMarksBackend {
    readonly getItem: (key: string) => string | null;
    readonly setItem: (key: string, value: string) => void;
    readonly removeItem: (key: string) => void;
    readonly keys: () => readonly string[];
}

/** The cook-marks store. */
export interface CookMarksStore {
    /** One cook's marks on one recipe; the same object while they are unchanged. */
    readonly read: (subject: string | undefined, recipeId: string) => CookMarks;
    /** Apply what the cook did, store it and tell the subscribers. */
    readonly dispatch: (subject: string | undefined, recipeId: string, command: CookMarkCommand) => void;
    readonly subscribe: (listener: () => void) => () => void;
    /** Hold marks for this cook only (see the module note). */
    readonly scope: (subject: string | undefined) => void;
}

/**
 * A backend over a plain in-memory map — native's storage, and the fallback where a browser has none.
 *
 * @returns An empty backend.
 */
export function memoryCookMarksBackend(): CookMarksBackend {
    const items = new Map<string, string>();

    return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
            items.set(key, value);
        },
        removeItem: (key) => {
            items.delete(key);
        },
        keys: () => [...items.keys()],
    };
}

/**
 * Build a store over a backend.
 *
 * @param backend - Where marks are kept.
 * @returns The store.
 */
export function createCookMarksStore(backend: CookMarksBackend): CookMarksStore {
    const listeners = new Set<() => void>();
    /** The last snapshot per key, with the stored text it was read from, so an unchanged read returns the same object. */
    const snapshots = new Map<string, { readonly raw: string | null; readonly marks: CookMarks }>();
    let heldSubject: string | undefined;

    const emit = (): void => {
        for (const listener of listeners) {
            listener();
        }
    };

    const read = (subject: string | undefined, recipeId: string): CookMarks => {
        const key = cookMarksKey(subject ?? '', recipeId);
        const raw = backend.getItem(key);
        const cached = snapshots.get(key);

        if (cached !== undefined && cached.raw === raw) {
            return cached.marks;
        }

        const marks = parseCookMarks(raw);
        snapshots.set(key, { raw, marks });

        return marks;
    };

    const removeWhere = (doomed: (key: string) => boolean): void => {
        const keys = backend.keys().filter((key) => isCookMarksKeyOf(key) && doomed(key));

        for (const key of keys) {
            backend.removeItem(key);
            snapshots.delete(key);
        }

        if (keys.length > 0) {
            emit();
        }
    };

    return {
        read,
        dispatch: (subject, recipeId, command) => {
            const current = read(subject, recipeId);
            const next = applyCookMark(current, command);

            if (next === current) {
                return;
            }

            const key = cookMarksKey(subject ?? '', recipeId);

            if (hasCookMarks(next)) {
                backend.setItem(key, serializeCookMarks(next));
            } else {
                backend.removeItem(key);
            }

            emit();
        },
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        scope: (subject) => {
            if (subject !== undefined) {
                removeWhere((key) => !isCookMarksKeyOf(key, subject));
                heldSubject = subject;
            } else if (heldSubject !== undefined) {
                removeWhere(() => true);
                heldSubject = undefined;
            }
        },
    };
}
