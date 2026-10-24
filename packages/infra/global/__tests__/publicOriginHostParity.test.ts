// @vitest-environment node
/**
 * The public-origin shape is derived in TWO places, and this is the guard that they still agree.
 *
 * ## Why there are two
 *
 * `publicServiceOriginForStage` is authored in `@radicle-co/infra-shared/alb`, beside the constructs that
 * create the Route 53 records and listener rules it describes. That package is CDK's, and CDK installs
 * outside the npm workspace on purpose — 149 MB of `aws-cdk-lib` stops being hoisted into the root tree and
 * shipped inside every service image.
 *
 * `@kitchensink/loadtest` is a workspace package on the other side of that boundary. `printPublicOrigin.mjs`
 * needs the same host to point k6 at a deployed service, and it cannot import the published package without
 * pulling the registry dependency and its peer CDK back into the root install.
 *
 * ⛔ The duplication is FORCED, not careless — and forced duplication still rots. A diverged host does not
 * fail as a wrong answer: k6 resolves a name nothing serves and reports a connection error, which reads like
 * a broken deploy rather than a broken constant. That is the failure this file exists to make impossible.
 *
 * ⚠️ It compares BEHAVIOUR across every service and stage shape, not source text. Two implementations spelled
 * differently but answering identically are not a defect; two spelled identically and both wrong is what a
 * text comparison would bless.
 *
 * DESIGN PATTERN: N-version comparison — two independent derivations of one fact, asserted equal.
 */
import { describe, expect, it } from 'vitest';

import {
    EPHEMERAL_SLOT_ORDER as sharedOrder,
    publicServiceOriginForStage as fromInfraPackage,
} from '@radicle-co/infra-shared/alb';

import {
    EPHEMERAL_SLOT_ORDER as workspaceOrder,
    publicServiceOriginForStage as fromWorkspaceCopy,
} from '../../../tools/loadtest/publicOriginHost.mjs';

/** Every stage shape the platform produces: prod, the base stages, and an ephemeral preview. */
const STAGES: readonly string[] = ['prod', 'sandbox', 'dev', 'test', 'local', 'pr-1', 'pr-91', 'pr-4242'];

const DOMAINS: readonly string[] = ['commise.app', 'sandbox.commise.app'];

describe('the public origin is derived identically on both sides of the workspace boundary', () => {
    it('is not vacuous: both implementations are reachable and answer', () => {
        expect(fromInfraPackage('recipe', 'prod', 'commise.app')).toMatch(/^https:\/\/\S+$/u);
        expect(fromWorkspaceCopy('recipe', 'prod', 'commise.app')).toMatch(/^https:\/\/\S+$/u);
    });

    it("registers the same services, in the same ORDER — the order IS a service's priority band", () => {
        expect([...workspaceOrder]).toStrictEqual([...sharedOrder]);
    });

    it('agrees on every service, stage and domain at once, naming every divergence rather than the first', () => {
        const diverged = sharedOrder.flatMap((service) =>
            STAGES.flatMap((stage) =>
                DOMAINS.filter(
                    (domain) => fromInfraPackage(service, stage, domain) !== fromWorkspaceCopy(service, stage, domain),
                ).map(
                    (domain) =>
                        `${service}/${stage}/${domain}: infra=${fromInfraPackage(service, stage, domain)} ` +
                        `workspace=${fromWorkspaceCopy(service, stage, domain)}`,
                ),
            ),
        );

        expect(diverged).toEqual([]);
    });
});
