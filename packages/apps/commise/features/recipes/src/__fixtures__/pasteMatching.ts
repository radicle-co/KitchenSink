/**
 * @module @commise/features-recipes/__fixtures__ — `make*` factories for the paste's session and its Mediator
 * (`usePasteIntoIngredients`, `usePasteMatching`), for the tests that double them. Each accepts a `Partial<T>`; the
 * defaults are a paste that is offered and has not started: no job, no line, nothing sending.
 */
import { emptyPasteMatchSession } from '../editor/pasteMatchSession.js';
import type { PasteIntoIngredients } from '../editor/usePasteIntoIngredients.js';
import type { PasteMatching } from '../editor/usePasteMatching.js';
import { emptySendLedger } from '../ingredientMatching/sendLedger.js';

/** A paste that is offered and has not started. */
export function makePasteIntoIngredients(overrides: Partial<PasteIntoIngredients> = {}): PasteIntoIngredients {
    return {
        available: true,
        submit: () => undefined,
        submitting: false,
        failed: false,
        clearFailure: () => undefined,
        acceptedCount: 0,
        quota: undefined,
        jobId: undefined,
        job: undefined,
        sessionKey: undefined,
        lines: [],
        joined: new Set(),
        failedAt: undefined,
        matchesGone: false,
        pollPaused: false,
        markJoined: () => undefined,
        markJoinFailed: () => undefined,
        retryLookup: () => undefined,
        retryParse: () => undefined,
        addAsWritten: () => undefined,
        addRestAsWritten: () => undefined,
        focusSignal: 0,
        retryFailed: false,
        focusRow: undefined,
        onRowFocusHandled: () => undefined,
        added: undefined,
        ...overrides,
    };
}

/** A Mediator with no line, nothing sending and every command a no-op. */
export function makePasteMatching(overrides: Partial<PasteMatching> = {}): PasteMatching {
    return {
        session: emptyPasteMatchSession,
        lines: [],
        drawn: [],
        ownedKeys: new Set(),
        pending: new Map(),
        failed: new Set(),
        ledger: emptySendLedger,
        joining: false,
        paused: false,
        draftKeyOfFood: () => undefined,
        expandTo: () => undefined,
        moveTo: () => undefined,
        pick: () => undefined,
        useProposal: () => undefined,
        retryPick: () => undefined,
        saved: undefined,
        retryOptions: () => undefined,
        search: () => undefined,
        ...overrides,
    };
}
