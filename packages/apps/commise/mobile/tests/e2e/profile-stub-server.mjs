/**
 * Minimal stand-in for the IDENTITY service's `/api/v1/users/me` (+ `/api/v1/accounts/me`) used by the Maestro
 * mobile E2E job. The self-contained job boots only the recipe service; the mobile app also fetches the
 * viewer's PROFILE from the identity service to derive `viewerId` (client-side ownership → Edit/Delete/
 * clone) and the subscription tier. This server returns a fixed FREE profile whose `user.id` equals the
 * seed's FREE owner + the recipe dev-bypass user (01J0K6…), so ownership and tier resolve consistently.
 *
 * It ignores the bearer token (the recipe service's dev-bypass already governs auth). Bound to 0.0.0.0 so
 * the Android emulator reaches it at http://10.0.2.2:<PORT>.
 *
 * Usage: `PORT=4000 node packages/apps/commise/mobile/tests/e2e/profile-stub-server.mjs`
 */
import { createServer } from 'node:http';

const PORT = Number(process.env['PORT'] ?? 4000);
const VIEWER_ID = '01J0K6000000000000000000K6';
const NOW = '2026-01-01T00:00:00.000Z';

const profile = {
    user: {
        id: VIEWER_ID,
        email: 'commise-e2e-signin+clerk_test@example.com',
        displayName: 'Chef',
        avatarUrl: null,
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
    },
    account: {
        id: 'acct_e2e_free',
        userId: VIEWER_ID,
        subscriptionTier: 'free',
        createdAt: NOW,
        updatedAt: NOW,
    },
};

function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = createServer((req, res) => {
    const rawPath = (req.url ?? '').split('?')[0];

    // The real identity service serves every route at BOTH `/api/v1/*` (canonical) and the bare `/v1/*`
    // (a DEPRECATED ALIAS retained for the Clerk-dashboard webhook URL and already-shipped app builds,
    // whose endpoints were inlined at build time — see ADR-0011). Mirror that here by normalising the
    // legacy spelling onto the canonical one, so a Maestro run passes against whichever path the app
    // build under test dials. Match canonical only below.
    const path = rawPath.startsWith('/v1/') ? `/api${rawPath}` : rawPath;

    if (path === '/api/v1/users/me' && req.method === 'GET') {
        return send(res, 200, profile);
    }
    if (path === '/api/v1/users/me' && req.method === 'PATCH') {
        // Echo the merge so the profile screen's optimistic update lands; body is display-name/avatar only.
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            let patch = {};
            try {
                patch = raw ? JSON.parse(raw) : {};
            } catch {
                patch = {};
            }
            send(res, 200, { ...profile, user: { ...profile.user, ...patch } });
        });
        return undefined;
    }
    if (path === '/api/v1/users/me' && req.method === 'DELETE') {
        return send(res, 204);
    }
    if (path === '/api/v1/accounts/me' && req.method === 'GET') {
        return send(res, 200, profile.account);
    }

    return send(res, 404, { code: 'NOT_FOUND', message: `stub: ${req.method} ${rawPath}` });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`profile-stub: listening on 0.0.0.0:${PORT} (viewer ${VIEWER_ID}, tier free)`);
});
