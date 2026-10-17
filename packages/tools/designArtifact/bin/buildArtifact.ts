/**
 * @module bin/buildArtifact — the command that builds the two artifact payloads into `dist/`.
 *
 * @pattern Entry Point — the process boundary: it reads the environment, calls {@link buildArtifact} over the real
 * ports from `realBuildPorts` and turns the result or the failure into output and an exit code. All logic lives in
 * `src/buildArtifact.ts`.
 *
 * Usage: `npm run artifact:build --workspace=packages/tools/designArtifact`. To record the published design system in
 * the canvas, set `DESIGN_SYSTEM_ARTIFACT_URL` (its claude.ai link) and `DESIGN_SYSTEM_ARTIFACT_VERSION` (its
 * revision) together. Set neither and the canvas links no design system; setting only one is an error.
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
            'Nothing is published. To publish, use the Artifact tool by hand: publish the Design System payload first,',
            'copy its link into DESIGN_SYSTEM_ARTIFACT_URL and its revision into DESIGN_SYSTEM_ARTIFACT_VERSION, rebuild so',
            'the canvas records that link, then publish the canvas payload. Each directory is the whole project the',
            'artifact takes, with no other files needed.',
            '',
        ].join('\n'),
    );
} catch (error) {
    process.stderr.write(`${isDesignArtifactError(error) ? `[${error.code}] ` : ''}${String(error)}\n`);
    process.exitCode = 1;
}
