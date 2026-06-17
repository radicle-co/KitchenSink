// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// CloudFront Function (JS runtime 2.0), viewer-request. Single-origin sandbox router: maps
// sandbox.commise.app/pr-{N}/* to that PR's running app by host-swap (updateRequestOrigin), URI
// preserved. The per-PR host + the project-wide Vercel bypass secret live in the attached KVS.
// `parsePrKey` is bundled in by esbuild (CFF has no module resolution at the edge).
// NOTE: the `cf` runtime API surface (kvs/updateRequestOrigin) is validated by the U4 deploy smoke.
import cf from 'cloudfront';

import { buildOriginUpdate, resolveRoute } from './resolve.js';

const kvs = cf.kvs();

const notFound = { statusCode: 404, statusDescription: 'Not Found' };

async function handler(event) {
    const request = event.request;

    // Decide via the unit-tested core. KVS.get throws on a missing key; normalize that to undefined so
    // resolveRoute treats unknown/closed PRs (and malformed paths) uniformly as a 404.
    const decision = await resolveRoute(request.uri, (key) => kvs.get(key).catch(() => undefined));

    if (decision.kind === 'notfound') {
        return notFound;
    }

    // Advertise the BROWSER's host to the app BEFORE we swap Host to the per-PR deployment below.
    // The app and Clerk build absolute / redirect URLs from x-forwarded-host (notably Clerk's
    // dev-instance handshake); without this they'd only ever see the swapped Vercel deployment host
    // and bounce the user there. Forwarding the real origin is what lets the SAME build serve BOTH
    // sandbox.commise.app and the raw Vercel preview host — each request advertises its own origin.
    // (We overwrite any client-supplied value, which also closes a host-header-injection vector.)
    if (request.headers.host && request.headers.host.value) {
        request.headers['x-forwarded-host'] = { value: request.headers.host.value };
    }

    // Host-swap to the per-PR app; the /pr-{N} URI is forwarded unchanged (the app owns the prefix).
    // updateRequestOrigin owns Host + SNI (do not set request.headers['host']); see buildOriginUpdate.
    cf.updateRequestOrigin(buildOriginUpdate(decision.host));

    // Vercel Deployment Protection: inject the project-wide bypass token (one fixed KVS key).
    try {
        const bypass = await kvs.get('vercel-bypass');

        if (bypass) {
            request.headers['x-vercel-protection-bypass'] = { value: bypass };
        }
    } catch (_err) {
        // No bypass seeded (e.g. post-Vercel) — forward without it.
        // NOTE: the catch MUST bind a parameter. CloudFront Functions JS 2.0 does not support the
        // optional catch binding (`catch {`), and esbuild's es2020 target preserves it — a bare
        // `catch {` deploys clean but throws "Token { not supported" at the edge (503 on every route).
    }

    return request;
}
