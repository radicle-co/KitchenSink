/**
 * @module bin/buildArtifact — the command that builds the two artifact payloads into `dist/`.
 *
 * @pattern Entry Point — the process boundary: it reads the environment, calls {@link buildArtifact} over the real
 * ports from `realBuildPorts` and turns the result or the failure into output and an exit code. All logic lives in
 * `src/buildArtifact.ts`.
 *
 * Usage: `npm run artifact:build --workspace=packages/tools/designArtifact`. Only the Design System payload is ever
 * published. The canvas payload is for the LOCAL e2e render and is never published, because the screen canvases are
 * edited live (`docs/design/canvases/README.md`). `DESIGN_SYSTEM_ARTIFACT_URL` and `DESIGN_SYSTEM_ARTIFACT_VERSION`
 * still record a design system in the local canvas when set together; setting only one is an error.
 */
import { buildArtifact } from '../src/buildArtifact.js';
import { isDesignArtifactError } from '../src/errors.js';
import { realBuildPorts } from '../src/realBuildPorts.js';

try {
    const result = await buildArtifact(realBuildPorts(process.env));

    for (const warning of result.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
    }

    process.stdout.write(
        [
            `Design System: ${result.designSystemDir} (${String(result.cards)} component cards)`,
            `Canvas:        ${result.canvasDir} (${String(result.boards)} boards)`,
            '',
            'Nothing is published. Publish only the Design System payload, with the Artifact tool by hand.',
            'The canvas payload is for the LOCAL e2e render and is never published: the screen canvases are',
            'edited live (docs/design/canvases/README.md).',
            '',
        ].join('\n'),
    );
} catch (error) {
    process.stderr.write(`${isDesignArtifactError(error) ? `[${error.code}] ` : ''}${String(error)}\n`);
    process.exitCode = 1;
}
