/**
 * Provision could not find a probe word for a role (or ran out of searches looking). It fails PROVISION, never a flow:
 * a stage whose catalog has outgrown every candidate is told here, with the words and the reasons, not at a labelled
 * wait on a device.
 */
import type { ProbeRejection, ProbeRole } from './remoteProbeWords.js';

/** Why the search for a word ended. */
export type ProbeExhaustionKind = 'candidates' | 'search-budget';

/** No candidate word of a role answered right, or the search budget ran out first. */
export class RemoteProbeExhaustedError extends Error {
    public readonly role: ProbeRole;
    public readonly rejections: readonly ProbeRejection[];
    public readonly stage: string;
    public readonly exhaustion: ProbeExhaustionKind;

    public constructor(
        role: ProbeRole,
        rejections: readonly ProbeRejection[],
        stage: string,
        exhaustion: ProbeExhaustionKind = 'candidates',
    ) {
        const listed =
            rejections.length === 0
                ? 'no word was judged'
                : rejections.map((each) => `${each.word} (${each.reason})`).join(', ');
        const why =
            exhaustion === 'candidates'
                ? `no candidate word answered right`
                : `the search budget ran out before one answered right`;

        super(`e2e-seed: the "${role}" remote probe word for ${stage}: ${why}; rejected: ${listed}`);
        this.name = 'RemoteProbeExhaustedError';
        this.role = role;
        this.rejections = rejections;
        this.stage = stage;
        this.exhaustion = exhaustion;
        Object.setPrototypeOf(this, RemoteProbeExhaustedError.prototype);
    }
}

/**
 * Whether a value is a {@link RemoteProbeExhaustedError}.
 *
 * @param error - Anything thrown.
 * @returns True for the error provision throws when no probe word answers right.
 */
export function isRemoteProbeExhaustedError(error: unknown): error is RemoteProbeExhaustedError {
    return error instanceof RemoteProbeExhaustedError;
}
