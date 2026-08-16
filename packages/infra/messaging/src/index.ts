/**
 * `@kitchensink/infra-messaging` — the message substrate's INFRASTRUCTURE naming authority (plan U5/U6).
 *
 * Like `@kitchensink/infra-alb` (and unlike most `@kitchensink/*` packages) this exports BUILT JS, not
 * `./src`: its consumers are CDK app entrypoints, which prod-deploy and sandbox-deploy run as COMPILED JS
 * under plain node (`cdk deploy --app "node .../infra/dist/bin/app.js"`). A `main` of `./src/index.ts` makes
 * that path fail with `ERR_MODULE_NOT_FOUND` — node type-strips the entry but cannot resolve its `./x.js`
 * relative imports with no built `.js` beside them. See ADR-0013.
 *
 * It is deliberately SEPARATE from the runtime `@kitchensink/messaging` package: that one ships inside the
 * service container and must not drag CDK-shaped concerns along, while this one is only ever loaded at
 * synth. They share nothing — a table name is not a message.
 *
 * @module
 */
export {
    messageTableArnParameter,
    messageTableNameForStage,
    messageTableNameParameter,
    messageTableStageFor,
} from './messageTableName.js';
