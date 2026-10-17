/**
 * @module refreshIamCatalogue — regenerates `manifests/iamCatalogue.json`: the IAM actions and resource-ARN formats of
 * every service the policy tables mention, taken from AWS's machine-readable Service Authorization Reference.
 *
 * ## Why this exists
 *
 * Two classes of defect only surfaced in IAM, at the end of the first real deploy of the policy stack: an action
 * that does not exist (`cloudfront:CreateDistributionWithTags`, `logs:AllowVendedLogDeliveryForResource`) and an ARN
 * whose region/vendor field breaks IAM's grammar. Both are decidable offline against the reference, so the guards
 * (`actionCatalogue.test.ts`, `arnGrammar.test.ts`) read this committed snapshot instead of trusting an author's
 * memory of the Service Authorization Reference.
 *
 * ## What is read
 *
 * `https://servicereference.us-east-1.amazonaws.com/` — the index lists one JSON document per service
 * (`/v1/<service>/<service>.json`) with `Actions[].Name` and `Resources[].ARNFormats`. The services fetched are
 * DERIVED from the rendered policy documents (every action prefix and every ARN service), so a new service in a
 * table is picked up by re-running this script and a missing one fails the guard.
 *
 * Run: `npm run bootstrap:catalogue --workspace=packages/infra/bootstrap`. Review the diff: an action removed from
 * the reference is a policy that is about to fail.
 *
 * @sideEffect Performs HTTPS GETs against the public reference and rewrites the committed snapshot.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { renderedPolicies } from '../src/policySet.js';
import { catalogueServicesOf, type IamCatalogue } from '../src/iamCatalogue.js';

const INDEX_URL = 'https://servicereference.us-east-1.amazonaws.com/';

/** The reference is a third-party document: its shape is checked at this boundary, not assumed. */
const indexSchema = z.array(z.object({ service: z.string(), url: z.string() }));

const referenceSchema = z.object({
    Actions: z.array(
        z.object({
            Name: z.string(),
            Annotations: z
                .object({
                    Properties: z
                        .object({
                            IsWrite: z.boolean().optional(),
                            IsPermissionManagement: z.boolean().optional(),
                            IsTaggingOnly: z.boolean().optional(),
                        })
                        .optional(),
                })
                .optional(),
        }),
    ),
    Resources: z.array(z.object({ Name: z.string(), ARNFormats: z.array(z.string()) })).optional(),
});

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`GET ${url} answered ${response.status}`);
    }

    return schema.parse(await response.json());
}

const index = await getJson(INDEX_URL, indexSchema);
const documents = renderedPolicies({ account: '000000000000', region: 'us-east-1' }).map((policy) => policy.document);
const services = catalogueServicesOf(documents);

async function catalogueEntry(service: string): Promise<readonly [string, IamCatalogue['services'][string]]> {
    const entry = index.find((candidate) => candidate.service === service);

    if (entry === undefined) {
        throw new Error(`the Service Authorization Reference has no service "${service}"`);
    }

    const reference = await getJson(entry.url, referenceSchema);

    return [
        service,
        {
            actions: reference.Actions.map((action) => action.Name).sort(),
            // Access level Read or List: the reference marks every other action as write, permissions or tagging.
            readOnly: reference.Actions.filter((action) => {
                const properties = action.Annotations?.Properties;

                return (
                    properties !== undefined &&
                    properties.IsWrite !== true &&
                    properties.IsPermissionManagement !== true &&
                    properties.IsTaggingOnly !== true
                );
            })
                .map((action) => action.Name)
                .sort(),
            resources: Object.fromEntries(
                (reference.Resources ?? [])
                    .map((resource) => [resource.Name, [...resource.ARNFormats].sort()] as const)
                    .sort(([left], [right]) => left.localeCompare(right)),
            ),
        },
    ];
}

const catalogue: IamCatalogue = { services: Object.fromEntries(await Promise.all(services.map(catalogueEntry))) };

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '../manifests/iamCatalogue.json');

writeFileSync(output, `${JSON.stringify(catalogue, null, 4)}\n`);
console.log(`wrote ${output} for ${services.length} services`);
