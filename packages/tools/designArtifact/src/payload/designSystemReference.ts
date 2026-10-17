/**
 * @module payload/designSystemReference — which published design-system artifact the canvas is copied against.
 *
 * Publishing is manual, so the link is not known at build time; it comes from `DESIGN_SYSTEM_ARTIFACT_URL` and
 * `DESIGN_SYSTEM_ARTIFACT_VERSION`, and both are needed together or neither. There is no built-in default: a default
 * would name an artifact that may no longer be the one this tree was published as, and a canvas that links the wrong
 * revision is worse than one that links none. With neither set the canvas carries no design-system reference.
 *
 * A link that is not a claude.ai artifact is refused, so a mistyped variable cannot point every canvas at some other
 * site.
 */
import { DesignArtifactError } from '../errors.js';

/** The link a canvas carries. */
export interface DesignSystemReference {
    readonly artifact: string;
    readonly version: string;
}

function setValue(value: string | undefined): string | undefined {
    return value === undefined || value === '' ? undefined : value;
}

/**
 * @param env - The process environment (`DESIGN_SYSTEM_ARTIFACT_URL`, `DESIGN_SYSTEM_ARTIFACT_VERSION`). A blank
 * variable counts as unset.
 * @returns The artifact link and revision, or `undefined` when neither variable is set.
 * @throws DesignArtifactError `invalid-reference` when only one of the two is set, or when the URL is not an https
 * claude.ai address.
 */
export function designSystemReference(
    env: Readonly<Record<string, string | undefined>>,
): DesignSystemReference | undefined {
    const artifact = setValue(env['DESIGN_SYSTEM_ARTIFACT_URL']);
    const version = setValue(env['DESIGN_SYSTEM_ARTIFACT_VERSION']);

    if (artifact === undefined && version === undefined) {
        return undefined;
    }

    if (artifact === undefined || version === undefined) {
        throw new DesignArtifactError(
            'invalid-reference',
            'DESIGN_SYSTEM_ARTIFACT_URL and DESIGN_SYSTEM_ARTIFACT_VERSION are set together or not at all; ' +
                `got ${artifact === undefined ? 'only the version' : 'only the URL'}.`,
        );
    }

    const parsed = URL.canParse(artifact) ? new URL(artifact) : undefined;

    if (parsed?.protocol !== 'https:' || parsed.hostname !== 'claude.ai') {
        throw new DesignArtifactError(
            'invalid-reference',
            `DESIGN_SYSTEM_ARTIFACT_URL must be an https://claude.ai/ address, got ${JSON.stringify(artifact)}.`,
        );
    }

    return { artifact, version };
}
