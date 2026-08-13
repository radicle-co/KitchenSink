/**
 * Print the food service's public origin for a stage — so a pipeline never has to know that host shape.
 *
 * The shape lives in exactly ONE place, {@link foodServiceOriginForStage} (over
 * `foodSubdomainForStage`): prod is the bare label `food`, every
 * other stage is the DASH form `food-{stage}` (a 3-label `food.pr-7.commise.app` matches no wildcard on the
 * shared ALB cert and fails the TLS handshake — see ADR-0003 / ADR-0006). This script exposes that one
 * definition to shell callers, which is what stops the deploy workflows from growing a second, drifting copy
 * of it in YAML.
 *
 * Its consumer is the recipe deploy (issue #120): recipe reads the food service's `/api/v1/foods/*` API, so both
 * `sandbox-deploy.yml` and `prod-deploy.yml` must tell the recipe service which food origin to call
 * (`RECIPE_FOOD_SERVICE_URL`). It prints the origin and NOTHING else on stdout (diagnostics go to stderr), so
 * a workflow can capture it directly.
 *
 * ```sh
 * npx tsx packages/services/food-service/infra/bin/print-food-host.ts pr-73 commise.app
 * # → https://food-pr-73.commise.app
 * ```
 *
 * NOTE: this prints the origin a food deploy at that stage WOULD serve. It does not check that the stack is
 * actually deployed — that is the caller's business (in CI, the food deploy job runs first). A stage with no
 * food service simply yields an unresolvable host, which the recipe service's `FoodCatalogGateway` degrades
 * to `catalogAvailability: 'unavailable'` rather than failing a request.
 *
 * @sideEffect Writes to stdout/stderr and sets a non-zero exit code on bad input.
 */
import { foodServiceOriginForStage } from '../lib/food-service-stack.js';

const stage = process.argv[2] ?? process.env['STAGE'];
const domainName = process.argv[3] ?? process.env['DOMAIN_NAME'];

if (!stage || !domainName) {
    process.stderr.write(
        'usage: print-food-host.ts <stage> <domainName>   (or set STAGE and DOMAIN_NAME)\n' +
            'example: print-food-host.ts pr-73 commise.app\n',
    );
    process.exitCode = 1;
} else {
    process.stdout.write(`${foodServiceOriginForStage(stage, domainName)}\n`);
}
