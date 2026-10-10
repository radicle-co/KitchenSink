#!/usr/bin/env bash
set -euo pipefail

# LocalStack bootstrap script for identity service local development
# Provisions SQS queues, S3 buckets, Secrets Manager secrets, and EventBridge rules.

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

echo "=== Waiting for LocalStack... ==="
for i in {1..30}; do
    if curl -sf "${ENDPOINT}/_localstack/health" > /dev/null 2>&1; then
        echo "LocalStack is ready"
        break
    fi
    echo "  attempt $i/30..."
    sleep 2
done

echo "=== Creating SQS Deletion Queue ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" sqs create-queue \
    --queue-name kitchensink-identity-deletion-local \
    --attributes '{"VisibilityTimeout":"120","MessageRetentionPeriod":"345600"}'

echo "=== Creating SQS DLQ ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" sqs create-queue \
    --queue-name kitchensink-identity-deletion-dlq-local

echo "=== Creating S3 Media Bucket ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" s3 mb s3://kitchensink-identity-media-local

echo "=== Creating S3 Archive Bucket ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" s3 mb s3://kitchensink-identity-archive-local

echo "=== Creating Secrets Manager Secret ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" secretsmanager create-secret \
    --name kitchensink/local/identity/keys \
    --secret-string '{"secretKey":"sk_test_local","publishableKey":"pk_test_local","webhookSigningSecret":"whsec_local"}'

# No DB credentials secret: nothing reads one. The identity service and the webhook Lambdas locate the database
# by DATABASE_URL (or DB_HOST/DB_PORT/DB_NAME) and, deployed, authenticate by RDS IAM — see
# docs/plans/2026-09-11-database-role-split.md.

echo "=== Creating SSM Parameters ==="
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" ssm put-parameter \
    --name /kitchensink/auth/jwks-url/local \
    --type String \
    --value "https://api.clerk.com/.well-known/jwks.json"

aws --endpoint-url="${ENDPOINT}" --region="${REGION}" ssm put-parameter \
    --name /kitchensink/auth/issuer/local \
    --type String \
    --value "https://clerk.local"

aws --endpoint-url="${ENDPOINT}" --region="${REGION}" ssm put-parameter \
    --name /kitchensink/auth/audience/local \
    --type String \
    --value "local-audience"

echo "=== LocalStack bootstrap complete ==="
