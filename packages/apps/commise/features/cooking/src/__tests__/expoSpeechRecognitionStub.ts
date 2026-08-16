/**
 * Test stub for `expo-speech-recognition`.
 *
 * The real module bridges to an OS speech recogniser that has no jsdom runtime — and no microphone. The
 * stub records every call and lets a test drive `result` / `error` / `end`, so the native adapter's
 * contract (gate on permission, deliver only declared phrases, dispose cleanly, never spin) stays
 * falsifiable under component tests. A stub that silently succeeded would let a broken adapter pass.
 *
 * Whether the native module links, builds and captures audio on a physical device is out of reach here;
 * see the ⚠️ note in `../voiceControl.native.ts`.
 */

/** One recorded interaction with the stub, in the order it happened. */
export interface SpeechRecognitionCall {
    readonly kind: 'construct' | 'start' | 'stop' | 'abort' | 'request-permission';
}

/** A listener attached to a stub recogniser, kept with its type so detachment is observable. */
interface AttachedListener {
    readonly type: string;
    readonly listener: (event?: unknown) => void;
}

const calls: SpeechRecognitionCall[] = [];
const instances: ExpoWebSpeechRecognition[] = [];

let permissionGranted = true;
let permissionRequestRejects = false;
let constructionFails = false;

/** Returns every call recorded so far, in order. */
export function getSpeechRecognitionCalls(): readonly SpeechRecognitionCall[] {
    return calls;
}

/** Returns every recogniser the adapter constructed, in order. */
export function getRecognitionInstances(): readonly ExpoWebSpeechRecognition[] {
    return instances;
}

/**
 * Returns the single recogniser the adapter constructed.
 *
 * @throws {Error} When zero or more than one recogniser exists — a silent `undefined` would let a test
 * assert nothing at all.
 */
export function onlyRecognitionInstance(): ExpoWebSpeechRecognition {
    if (instances.length !== 1) {
        throw new Error(`Expected exactly one recogniser, found ${String(instances.length)}`);
    }

    return instances[0] as ExpoWebSpeechRecognition;
}

/** Clears recorded calls and instances, and restores the default (granted, constructible) state. */
export function resetSpeechRecognitionStub(): void {
    calls.length = 0;
    instances.length = 0;
    permissionGranted = true;
    permissionRequestRejects = false;
    constructionFails = false;
}

/** Decides what the next `requestPermissionsAsync()` resolves to. */
export function setSpeechRecognitionPermission(granted: boolean): void {
    permissionGranted = granted;
}

/** Makes the next `requestPermissionsAsync()` reject, as an unlinked or failing module would. */
export function setPermissionRequestRejects(rejects: boolean): void {
    permissionRequestRejects = rejects;
}

/** Makes constructing a recogniser throw, as an unlinked native module would. */
export function setRecognitionConstructionFails(fails: boolean): void {
    constructionFails = fails;
}

/**
 * Stubbed counterpart of the real `ExpoWebSpeechRecognition`.
 *
 * Mirrors the Web-Speech-compatible surface the adapter drives, and exposes {@link emit} so a test can
 * dispatch the events the OS would.
 */
export class ExpoWebSpeechRecognition {
    public continuous = false;
    public interimResults = true;
    public lang = '';
    public startCount = 0;
    public stopCount = 0;
    public abortCount = 0;
    public startThrows = false;
    public listeners: AttachedListener[] = [];

    public constructor() {
        if (constructionFails) {
            calls.push({ kind: 'construct' });
            throw new Error('ExpoWebSpeechRecognition: native module is not linked');
        }

        calls.push({ kind: 'construct' });
        instances.push(this);
    }

    /** Records a start, optionally throwing the way a double start does. */
    public start(): void {
        this.startCount += 1;
        calls.push({ kind: 'start' });

        if (this.startThrows) {
            throw new Error('InvalidStateError: recognition has already started');
        }
    }

    /** Records a stop. */
    public stop(): void {
        this.stopCount += 1;
        calls.push({ kind: 'stop' });
    }

    /** Records an abort. */
    public abort(): void {
        this.abortCount += 1;
        calls.push({ kind: 'abort' });
    }

    /** Attaches a listener, keeping it observable so detachment can be asserted. */
    public addEventListener(type: string, listener: (event?: unknown) => void): void {
        this.listeners.push({ type, listener });
    }

    /** Detaches exactly the given listener for the given type. */
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

    /** Returns the listener attached for `type`, or `undefined` — used to test post-dispose delivery. */
    public listenerFor(type: string): ((event?: unknown) => void) | undefined {
        return this.listeners.find((entry) => entry.type === type)?.listener;
    }
}

/** The permission shape the real module resolves with. */
interface StubPermissionResponse {
    readonly granted: boolean;
    readonly canAskAgain: boolean;
    readonly status: 'granted' | 'denied';
    readonly expires: 'never';
}

/** Builds the response for the stub's current permission state. */
function permissionResponse(): StubPermissionResponse {
    return {
        granted: permissionGranted,
        canAskAgain: !permissionGranted,
        status: permissionGranted ? 'granted' : 'denied',
        expires: 'never',
    };
}

/** Stubbed counterpart of the real `ExpoSpeechRecognitionModule`. */
export const ExpoSpeechRecognitionModule = {
    /** Records the request and resolves (or rejects) per the stub's configured state. */
    async requestPermissionsAsync(): Promise<StubPermissionResponse> {
        calls.push({ kind: 'request-permission' });

        if (permissionRequestRejects) {
            throw new Error('requestPermissionsAsync: unavailable');
        }

        return permissionResponse();
    },

    /** Resolves the stub's current permission state without recording a request. */
    async getPermissionsAsync(): Promise<StubPermissionResponse> {
        return permissionResponse();
    },
};
