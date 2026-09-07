# CR-002 — provisioning the service-erasure keypair + fan-out URLs

The CR-002 cross-service erasure fan-out is gated on four per-stage values. Until they exist, the
identity deletion-worker and the recipe/food internal erasure routes **fail closed** (SQS DLQ + the
`ErasureIncomplete` alarm; the routes 401) — never silently open. CloudFormation resolves the SSM
references at **deploy** time, so a missing parameter also **fails the stack deploy** with
`Unable to fetch parameters […] from parameter store for this account`.

| Value                                                         | Where                                                                                | Holder                                                                       | Secret? |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------- |
| `SERVICE_ERASURE_SIGNING_KEY` (EdDSA **private**, PKCS#8 PEM) | Secrets Manager `kitchensink/{prod\|sandbox}/erasure/keys`, JSON field `SIGNING_KEY` | identity deletion-worker + erasure-reconciliation Lambdas — **nothing else** | **YES** |
| recipe verification key (EdDSA **public**, SPKI PEM)          | SSM `/kitchensink/{stage}/recipe/service-principal-jwt-public-key`                   | recipe-service API task                                                      | no      |
| food verification key (same public key)                       | SSM `/kitchensink/{stage}/food/service-principal-jwt-public-key`                     | food-service API task                                                        | no      |
| recipe / food origins                                         | SSM `/kitchensink/{stage}/erasure/recipe-base-url`, `…/food-base-url`                | identity deletion-worker                                                     | no      |

One keypair per **platform stage** (`prod`, `sandbox`) — a `pr-{N}` preview shares the sandbox key via
`baseStage`, matching the shared-service model. The private key must never leave Secrets Manager; the
public half is deliberately non-secret.

## Status

- **sandbox — DONE** (provisioned 2026-07-26, this session). All four values exist; verified the stored
  public key round-trips and that the secret holds a PKCS#8 PEM under `SIGNING_KEY`.
- **prod — DONE** (verified 2026-08-16, plan U1). All four values exist AND the halves were checked
  against each other, not merely counted: the public key derived from the stored PKCS#8 private key
  (`ed25519`) is byte-identical to **both** the recipe and the food SSM parameter, and those two are
  identical to each other. Evidence: `docs/reviews/2026-08-16-u1-erasure-diagnosis.md` §Symptom 1.

    ⛔ **Do not re-run the provisioning steps below for prod.** Minting a second keypair over a working
    one silently invalidates every token the deployed verifiers accept — every in-flight erasure would
    `401` onto the DLQ until all three services were redeployed. This line previously read "NOT DONE"
    long after provisioning had happened, which is precisely the trap; if you need to change the prod
    key, use **Rotation** below, which redeploys the verifiers as part of the procedure.

## Provisioning a stage (the prod procedure)

Run with credentials for the target account and `AWS_REGION` set. `STAGE=prod`.

```bash
STAGE=prod
umask 077
WORK="$(mktemp -d)"

# 1. Generate the Ed25519 keypair. EdDSA is pinned by the shared contract
#    (@kitchensink/recipe-core → serviceErasureToken.ts); the verifiers use jose `importSPKI`, the
#    minter `importPKCS8`, so the PEM encodings below are exactly what they expect.
node -e '
const {generateKeyPairSync}=require("crypto"),fs=require("fs");
const {publicKey,privateKey}=generateKeyPairSync("ed25519",{
  publicKeyEncoding:{type:"spki",format:"pem"},
  privateKeyEncoding:{type:"pkcs8",format:"pem"}});
fs.writeFileSync(process.env.WORK+"/pub.pem",publicKey,{mode:0o600});
fs.writeFileSync(process.env.WORK+"/secret.json",JSON.stringify({SIGNING_KEY:privateKey}),{mode:0o600});
'

# 2. The PRIVATE key → Secrets Manager (identity Lambdas only).
aws secretsmanager create-secret \
  --name "kitchensink/${STAGE}/erasure/keys" \
  --description "CR-002: EdDSA PRIVATE signing key for service-erasure tokens; held ONLY by the identity deletion-worker + erasure-reconciliation Lambdas" \
  --secret-string "file://${WORK}/secret.json"

# 3. The PUBLIC key → SSM, once per verifying service.
for svc in recipe food; do
  aws ssm put-parameter --type String --overwrite \
    --name "/kitchensink/${STAGE}/${svc}/service-principal-jwt-public-key" \
    --value "$(cat "${WORK}/pub.pem")" \
    --description "CR-002: PUBLIC EdDSA key verifying service-erasure tokens (private half in Secrets Manager)"
done

# 4. The fan-out origins → SSM. Hosts follow {svc}.{stage}.commise.app for a base stage; prod drops the
#    stage label (see recipeSubdomainForStage / foodSubdomainForStage).
aws ssm put-parameter --type String --overwrite \
  --name "/kitchensink/${STAGE}/erasure/recipe-base-url" --value "https://recipe.commise.app" \
  --description "CR-002 U4b: recipe origin the identity deletion-worker fans erasure out to"
aws ssm put-parameter --type String --overwrite \
  --name "/kitchensink/${STAGE}/erasure/food-base-url" --value "https://food.commise.app" \
  --description "CR-002 U4b: food origin the identity deletion-worker fans erasure out to"

# 5. Destroy the local private key material.
shred -u "${WORK}/secret.json" "${WORK}/pub.pem" 2>/dev/null || rm -f "${WORK}/secret.json" "${WORK}/pub.pem"
rmdir "${WORK}"
```

### Verify before deploying

```bash
# Params present (values not printed for the key):
aws ssm get-parameters --names \
  "/kitchensink/${STAGE}/erasure/recipe-base-url" \
  "/kitchensink/${STAGE}/erasure/food-base-url" \
  --query 'Parameters[].[Name,Value]' --output text
aws ssm get-parameter --name "/kitchensink/${STAGE}/recipe/service-principal-jwt-public-key" --query 'Parameter.Name'
aws ssm get-parameter --name "/kitchensink/${STAGE}/food/service-principal-jwt-public-key"   --query 'Parameter.Name'

# The secret parses and carries a PKCS#8 PEM (no key material echoed):
aws secretsmanager get-secret-value --secret-id "kitchensink/${STAGE}/erasure/keys" \
  --query SecretString --output text |
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);
    console.log("SIGNING_KEY present:",typeof j.SIGNING_KEY==="string",
                "| PKCS#8:",j.SIGNING_KEY.startsWith("-----BEGIN PRIVATE KEY-----"));});'
```

Then deploy in order: **identity-webhooks** (mints) and **recipe-service** / **food-service** (verify) can
go in any order, but all three must be on a build that reads these values.

### Rotation

Generate a new keypair and repeat steps 2–3, then redeploy all three services. Tokens are single-target
and live ≤120s, so a rotation window shorter than that needs no dual-key support — but during the gap
between updating the secret and redeploying the verifiers, in-flight erasures 401 and land on the DLQ,
where the nightly `erasure-reconciliation` sweep re-drives them. Rotate off-peak.

### Failure modes (what you'll see)

| Symptom                                                     | Cause                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stack deploy fails: `Unable to fetch parameters […]`        | An SSM parameter above is missing for that stage.                                                     |
| Internal erasure route returns 401 for every service call   | The verifying service has no/incorrect public key, or its key doesn't match the minter's private key. |
| Erasures queue then hit the DLQ + `ErasureIncomplete` alarm | The worker cannot mint (missing secret) or cannot reach an origin (wrong/missing base URL).           |
