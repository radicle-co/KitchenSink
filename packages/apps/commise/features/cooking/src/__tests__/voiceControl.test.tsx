import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_CONSECUTIVE_RESTARTS, startWebVoiceControl } from '../voiceControl';

/**
 * T-014 — web voice-control adapter (US-006, FR-033/FR-034).
 *
 * Three regressions are guarded here:
 *
 * 1. A module-scope `window` reference, which throws `ReferenceError` on an SSR import and takes down
 *    the whole Cooking Mode route rather than merely disabling voice.
 * 2. A false positive — an utterance that is not a command reaching `onCommand` and losing the cook's
 *    place mid-recipe.
 * 3. An unbounded restart loop: Chrome ends recognition on its own after silence, so the adapter
 *    restarts it; without a budget and a fatal-error latch, a microphone that cannot start spins the
 *    CPU forever.
 */

interface RecordedListener {
    readonly type: string;
    readonly listener: (event?: unknown) => void;
}

/** Stand-in for the browser `SpeechRecognition`, recording every interaction the adapter has with it. */
class FakeSpeechRecognition {
    public static instances: FakeSpeechRecognition[] = [];

    public continuous = false;
    public interimResults = true;
    public lang = '';
    public startCount = 0;
    public stopCount = 0;
    public startThrows = false;
    public listeners: RecordedListener[] = [];

    public constructor() {
        FakeSpeechRecognition.instances.push(this);
    }

    public start(): void {
        this.startCount += 1;

        if (this.startThrows) {
            throw new Error('InvalidStateError: recognition has already started');
        }
    }

    public stop(): void {
        this.stopCount += 1;
    }

    public addEventListener(type: string, listener: (event?: unknown) => void): void {
        this.listeners.push({ type, listener });
    }

    public removeEventListener(type: string, listener: (event?: unknown) => void): void {
        this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.listener === listener));
    }

    /** Dispatches to every listener currently attached for `type`. */
    public emit(type: string, event?: unknown): void {
        for (const entry of [...this.listeners]) {
            if (entry.type === type) {
                entry.listener(event);
            }
        }
    }
}

/** Installs the fake under the given global name and returns the class. */
function installRecognition(name: 'SpeechRecognition' | 'webkitSpeechRecognition'): typeof FakeSpeechRecognition {
    FakeSpeechRecognition.instances = [];
    Object.defineProperty(window, name, { value: FakeSpeechRecognition, configurable: true, writable: true });

    return FakeSpeechRecognition;
}

/** The single recogniser the adapter constructed. Fails loudly rather than returning `undefined`. */
function onlyInstance(): FakeSpeechRecognition {
    expect(FakeSpeechRecognition.instances).toHaveLength(1);

    return FakeSpeechRecognition.instances[0]!;
}

/** Builds a `result` event shaped like the browser's, from `resultIndex` onward. */
function resultEvent(
    transcripts: readonly string[],
    options: { resultIndex?: number; isFinal?: boolean } = {},
): unknown {
    const results = transcripts.map((transcript) => ({
        isFinal: options.isFinal ?? true,
        length: 1,
        0: { transcript },
    }));

    return { resultIndex: options.resultIndex ?? 0, results };
}

afterEach(() => {
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        if (name in window) {
            Reflect.deleteProperty(window as unknown as Record<string, unknown>, name);
        }
    }

    FakeSpeechRecognition.instances = [];
    vi.restoreAllMocks();
});

describe('startWebVoiceControl — capability detection', () => {
    it('degrades to a no-op disposer when the Speech Recognition API is absent', () => {
        const onCommand = vi.fn();

        const stop = startWebVoiceControl(onCommand);

        expect(stop).toBeTypeOf('function');
        expect(() => {
            stop();
        }).not.toThrow();
        expect(onCommand).not.toHaveBeenCalled();
        expect(FakeSpeechRecognition.instances).toHaveLength(0);
    });

    it('uses the unprefixed window.SpeechRecognition when present', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());

        expect(onlyInstance().startCount).toBe(1);
    });

    it('falls back to window.webkitSpeechRecognition', () => {
        installRecognition('webkitSpeechRecognition');

        startWebVoiceControl(vi.fn());

        expect(onlyInstance().startCount).toBe(1);
    });

    it('reads no browser global at module scope (structural — SSR import safety)', () => {
        // A behavioural spy cannot prove this: the module is imported before any spy can be installed.
        // A top-level `window.` reference throws `ReferenceError` on the server and takes down the
        // route, so assert it on the source — every access must sit inside a function body.
        const source = readFileSync(resolve(process.cwd(), 'src/voiceControl.ts'), 'utf8');
        const topLevelAccess = source
            .split('\n')
            .some((line) => /^\s{0,3}(window|document|navigator)\s*[.[]/.test(line));

        expect(topLevelAccess).toBe(false);
    });

    it('does not touch window when it is undefined (SSR)', () => {
        const original = globalThis.window;
        Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'window');

        try {
            expect(() => startWebVoiceControl(vi.fn())).not.toThrow();
        } finally {
            Object.defineProperty(globalThis, 'window', { value: original, configurable: true });
        }
    });
});

describe('startWebVoiceControl — recognition configuration', () => {
    it('listens continuously for final results only', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();

        // Non-continuous recognition stops after the first phrase — one command per session. Interim
        // results would deliver the same phrase repeatedly as it is refined.
        expect(recognition.continuous).toBe(true);
        expect(recognition.interimResults).toBe(false);
        expect(recognition.lang).toBe('en-US');
    });

    it('does not propagate a start() that the browser rejects', () => {
        installRecognition('SpeechRecognition');
        const proto = FakeSpeechRecognition.prototype;
        const spy = vi.spyOn(proto, 'start').mockImplementation(function (this: FakeSpeechRecognition) {
            this.startCount += 1;
            throw new Error('InvalidStateError');
        });

        expect(() => startWebVoiceControl(vi.fn())).not.toThrow();
        expect(spy).toHaveBeenCalled();
    });
});

describe('startWebVoiceControl — command delivery', () => {
    it('delivers the matched command for a recognised phrase', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        onlyInstance().emit('result', resultEvent(['Next step']));

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith('next');
    });

    it.each([
        ['go back', 'back'],
        ['start timer', 'start-timer'],
        ['pause', 'pause-timer'],
        ['say again', 'repeat'],
    ])('delivers %j as %j', (transcript, command) => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        onlyInstance().emit('result', resultEvent([transcript]));

        expect(onCommand).toHaveBeenCalledWith(command);
    });

    it('does not invoke the callback at all for an unrecognised utterance', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        onlyInstance().emit('result', resultEvent(['next door neighbour']));

        expect(onCommand).not.toHaveBeenCalled();
    });

    it('ignores interim (non-final) results', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        onlyInstance().emit('result', resultEvent(['next'], { isFinal: false }));

        expect(onCommand).not.toHaveBeenCalled();
    });

    it('processes only the results new since resultIndex', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        // The browser keeps earlier results in the list; re-reading them would replay old commands.
        onlyInstance().emit('result', resultEvent(['next', 'back'], { resultIndex: 1 }));

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith('back');
    });

    it('delivers every new command in one batch, in order', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);
        onlyInstance().emit('result', resultEvent(['next', 'timer']));

        expect(onCommand.mock.calls).toEqual([['next'], ['start-timer']]);
    });

    it('survives a malformed result with no alternatives', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        startWebVoiceControl(onCommand);

        expect(() => {
            onlyInstance().emit('result', { resultIndex: 0, results: [{ isFinal: true, length: 0 }] });
        }).not.toThrow();
        expect(onCommand).not.toHaveBeenCalled();
    });
});

describe('startWebVoiceControl — disposal', () => {
    it('stops recognition and detaches every listener it attached', () => {
        installRecognition('SpeechRecognition');

        const stop = startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();
        expect(recognition.listeners.length).toBeGreaterThan(0);

        stop();

        // A surviving listener would keep restarting recognition — and keep the microphone live — long
        // after the cook left Cooking Mode.
        expect(recognition.listeners).toEqual([]);
        expect(recognition.stopCount).toBe(1);
    });

    it('is idempotent — disposing twice stops recognition once', () => {
        installRecognition('SpeechRecognition');

        const stop = startWebVoiceControl(vi.fn());
        stop();

        expect(() => {
            stop();
        }).not.toThrow();
        expect(onlyInstance().stopCount).toBe(1);
    });

    it('delivers no command from an event that arrives after disposal', () => {
        installRecognition('SpeechRecognition');
        const onCommand = vi.fn();

        const stop = startWebVoiceControl(onCommand);
        const recognition = onlyInstance();
        const resultListener = recognition.listeners.find((entry) => entry.type === 'result')?.listener;
        stop();

        // Re-invoke the detached listener directly: the browser can dispatch an event that was already
        // queued when `stop()` ran, so detaching alone is not the whole guarantee.
        resultListener?.(resultEvent(['next']));

        expect(onCommand).not.toHaveBeenCalled();
    });
});

describe('startWebVoiceControl — restart behaviour', () => {
    it('restarts recognition when the browser ends it while the session is live', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();
        recognition.emit('end');

        // Chrome ends recognition after a few seconds of silence; without the restart, voice control
        // dies partway through the recipe with no visible cause.
        expect(recognition.startCount).toBe(2);
    });

    it('does NOT restart after the session has been disposed', () => {
        installRecognition('SpeechRecognition');

        const stop = startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();
        stop();
        recognition.emit('end');

        expect(recognition.startCount).toBe(1);
    });

    it('does NOT restart after a fatal error such as a denied microphone', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();
        recognition.emit('error', { error: 'not-allowed' });
        recognition.emit('end');

        expect(recognition.startCount).toBe(1);
    });

    it('still restarts after a transient error such as silence', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();
        recognition.emit('error', { error: 'no-speech' });
        recognition.emit('end');

        expect(recognition.startCount).toBe(2);
    });

    it('bounds consecutive restarts so a recogniser that cannot start cannot spin', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();

        for (let attempt = 0; attempt < MAX_CONSECUTIVE_RESTARTS + 5; attempt += 1) {
            recognition.emit('end');
        }

        expect(recognition.startCount).toBe(MAX_CONSECUTIVE_RESTARTS + 1);
    });

    it('replenishes the restart budget once a result proves the recogniser is alive', () => {
        installRecognition('SpeechRecognition');

        startWebVoiceControl(vi.fn());
        const recognition = onlyInstance();

        for (let attempt = 0; attempt < MAX_CONSECUTIVE_RESTARTS; attempt += 1) {
            recognition.emit('end');
        }

        recognition.emit('result', resultEvent(['next']));
        recognition.emit('end');

        expect(recognition.startCount).toBe(MAX_CONSECUTIVE_RESTARTS + 2);
    });
});
