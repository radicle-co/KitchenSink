/**
 * @module realBuildPorts — the real adapters behind every port of `buildArtifact`, wired once.
 *
 * The build command and the local e2e tier both need the same wiring, and a second copy of it would drift (a port added
 * to one and not the other). Nothing here decides anything; it only chooses the adapter for each port.
 *
 * @pattern Composition Root — the one place the real adapters are chosen and assembled into the build's ports.
 */
import { EsbuildBundler } from './bundle/esbuildBundler.js';
import type { BuildPorts } from './buildArtifact.js';
import { compileCard } from './cards/compileCard.js';
import { loadCardSpec } from './cards/loadCardSpec.js';
import { UNCARDED } from './cards/uncarded.js';
import { REPO_ROOT } from './config.js';
import { tailwindCssCompiler } from './css/tailwindCssCompiler.js';
import { fontFiles, fontLicences } from './fonts/fontFiles.js';
import { designSystemReference } from './payload/designSystemReference.js';
import { fsSourceFiles } from './sources/fsSourceFiles.js';
import { execGitHead } from './sources/gitHead.js';
import { discoverSurface } from './surface/discoverSurface.js';
import { fsArtifactWriter } from './write/artifactWriter.js';

/** The current instant without milliseconds, the form the host writes. */
function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/**
 * The build's ports, backed by the real file system, esbuild, Tailwind and git.
 *
 * @param env - The environment, read for `DESIGN_SYSTEM_ARTIFACT_URL`.
 * @returns Ports ready for `buildArtifact`.
 * @sideEffect None until a port is called; then they read and write the disk and run git.
 */
export function realBuildPorts(env: NodeJS.ProcessEnv): BuildPorts {
    return {
        files: fsSourceFiles(),
        bundler: new EsbuildBundler(),
        cssCompiler: tailwindCssCompiler(),
        writer: fsArtifactWriter(),
        now: nowIso,
        gitHead: execGitHead(REPO_ROOT),
        surface: discoverSurface,
        fonts: { files: () => fontFiles(), licences: () => fontLicences() },
        compileCard,
        loadCardSpec,
        uncarded: UNCARDED,
        designSystem: designSystemReference(env),
    };
}
