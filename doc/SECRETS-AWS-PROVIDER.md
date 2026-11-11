# AWS Secrets Manager Provider

Operational contract for the `aws_secrets_manager` secret provider.

## Scope

- Provider for Wardmote-managed company and user-scoped secrets on AWS.
- Source of truth for secret values is AWS Secrets Manager, not Postgres.
- Wardmote stores only metadata needed for ownership, bindings, version selection, audit, and runtime resolution.
- AWS provider bootstrap credentials are deployment/runtime credentials, not Wardmote-managed company secrets.
- Remote import for existing AWS secrets is metadata-only. Preview/import uses
  AWS inventory metadata and creates Wardmote external references; it does not
  copy plaintext into Wardmote.
- Per-company AWS provider vaults (named instances of `aws_secrets_manager`
  with their own region, namespace, prefix, KMS key id, and tags) are managed
  in the board UI under `Company Settings → Secrets → Provider vaults`. See
  [Provider Vaults](../docs/deploy/secrets.md#provider-vaults) for the operator
  model and [Provider Vaults API](../docs/api/secrets.md#provider-vaults) for
  the routes. The bootstrap trust model in this document still applies — vault
  config carries non-sensitive routing metadata only, never AWS credentials.

## Bootstrap Trust Model

The AWS provider has a chicken-and-egg boundary: Wardmote cannot use
`company_secrets` to unlock the AWS provider that stores those secrets. The
initial AWS trust must exist before the Wardmote server starts.

Allowed bootstrap locations:

- Infrastructure IAM or workload identity attached to the Wardmote server
  runtime.
- Process environment or orchestrator secret store used to start the Wardmote
  server.
- Local AWS SDK sources such as `AWS_PROFILE`, AWS SSO/shared config, web
  identity, container metadata, or instance metadata.
- Short-lived shell credentials for local development only.

Do not ask operators to paste AWS root credentials or long-lived IAM user access
keys into the Wardmote board UI. Do not store those bootstrap keys in
`company_secrets`.

## Deployment Bootstrap

The operator must provision the AWS backing resources before any board user
can create AWS-backed company secrets:

1. Create or select the deployment KMS key.
2. Create the Wardmote server runtime role for the deployment.
3. Attach a minimum IAM policy scoped to the deployment Secrets Manager prefix
   and the configured KMS key.
4. Configure the server runtime with the non-secret provider environment
   variables below.
5. Run `wardmote doctor` or the provider health endpoint from the deployed
   runtime and confirm that the provider reports the expected region, prefix,
   deployment id, KMS setting, and AWS SDK credential source.

Once this is in place, the board UI can create Wardmote-managed AWS secrets and
Wardmote will write them under the deployment/company namespace.

## Self-Hosted And Local Bootstrap

Self-hosted AWS deployments should use the AWS SDK default credential provider
chain. Preferred sources are role-based:

- EC2 instance profile.
- ECS task role.
- EKS IRSA or another OIDC web identity role.
- AWS SSO/shared config via `AWS_PROFILE`.

Local development can use:

```sh
aws sso login --profile wardmote-dev
AWS_PROFILE=wardmote-dev \
WARDMOTE_SECRETS_PROVIDER=aws_secrets_manager \
WARDMOTE_SECRETS_AWS_REGION=us-east-1 \
WARDMOTE_SECRETS_AWS_DEPLOYMENT_ID=dev-local \
WARDMOTE_SECRETS_AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/abcd-... \
pnpm dev
```

Temporary `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` environment credentials
are acceptable only as a local break-glass or short-lived test source. They
should not be written to Wardmote config, committed to `.env` files, stored in
`company_secrets`, or used as the default bootstrap path.

## Deployment Config

Required environment variables:

```sh
WARDMOTE_SECRETS_PROVIDER=aws_secrets_manager
WARDMOTE_SECRETS_AWS_REGION=us-east-1
WARDMOTE_SECRETS_AWS_DEPLOYMENT_ID=prod-us-1
WARDMOTE_SECRETS_AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/abcd-...
```

Optional environment variables:

```sh
WARDMOTE_SECRETS_AWS_PREFIX=wardmote
WARDMOTE_SECRETS_AWS_ENVIRONMENT=production
WARDMOTE_SECRETS_AWS_PROVIDER_OWNER=wardmote
WARDMOTE_SECRETS_AWS_ENDPOINT=
WARDMOTE_SECRETS_AWS_DELETE_RECOVERY_DAYS=30
```

Naming convention for Wardmote-managed secrets:

```text
wardmote/{deploymentId}/{companyId}/{secretKey}
```

Tag set for Wardmote-managed secrets:

- `wardmote:managed-by=wardmote`
- `wardmote:provider-owner=<owner tag>`
- `wardmote:deployment-id=<deployment id>`
- `wardmote:company-id=<company id>`
- `wardmote:secret-key=<secret key>`
- `wardmote:environment=<environment tag>`

When the user-secret service creates Wardmote-managed AWS values, keep them
under the same deployment/company namespace. The secret-key segment should be
non-sensitive and collision-safe for the user-secret value, normally derived
from the definition key plus an opaque credential-owner subject. Do not put
emails, personal names, OAuth scopes, ticket identifiers, or plaintext
credential material in AWS secret names, descriptions, or tags.

For operator-owned external references, prefer a separate approved prefix such
as:

```text
wardmote-ext/<environment>/<company-id>/user-secrets/<definition-key>/<opaque-owner-id>
```

Wardmote stores the external ref and provider version as metadata. Treat those
fields as secret-adjacent: they must be redacted from comments, activity logs,
run transcripts, issue documents, and broad board views unless a route is
explicitly designed to show sanitized provider metadata.

## IAM And KMS Assumptions

Launch posture:

- One Wardmote app role per deployment.
- One deployment-scoped KMS key per deployment at launch.
- Future per-company KMS keys remain compatible because Wardmote stores provider refs and version metadata separately from values.

Minimum IAM boundary:

- Allow `secretsmanager:CreateSecret`, `PutSecretValue`, `GetSecretValue`, and `DeleteSecret`.
- Scope resources to the deployment prefix:

```text
arn:aws:secretsmanager:<region>:<account-id>:secret:wardmote/<deployment-id>/*
```

- Allow `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, and `kms:DescribeKey` for the configured deployment CMK.
- Deny wildcard access outside the deployment prefix.
- Prefer workload identity / role-based auth. Do not store AWS credentials inline in Wardmote config.

Example minimum policy shape:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WardmoteDeploymentSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DeleteSecret"
      ],
      "Resource": "arn:aws:secretsmanager:<region>:<account-id>:secret:wardmote/<deployment-id>/*"
    },
    {
      "Sid": "WardmoteDeploymentKms",
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:<region>:<account-id>:key/<key-id>"
    }
  ]
}
```

Operational expectation:

- Wardmote-managed secrets may be deleted only by Wardmote or an operator with equivalent break-glass access.
- External references may resolve through Wardmote runtime, but Wardmote should not delete the external secret resource.

## Remote Import Inventory IAM

Remote import preview needs one additional AWS permission:

```json
{
  "Sid": "WardmoteRemoteSecretInventory",
  "Effect": "Allow",
  "Action": "secretsmanager:ListSecrets",
  "Resource": "*"
}
```

This is intentionally separate from the managed create/rotate/delete policy.
AWS treats `ListSecrets` as an account/Region inventory action; do not document
secret ARNs, names, tags, or AWS request filters as an IAM boundary for it. Use
`Resource: "*"` and decide whether inventory exposure is acceptable for the AWS
account and Region behind each provider vault.

Remote import preview/import must not call:

- `secretsmanager:GetSecretValue`
- `secretsmanager:BatchGetSecretValue`
- `kms:Decrypt`

Those permissions are only needed later when a bound runtime resolves an
imported external reference. For imported refs, scope read permissions to the
operator-approved external prefixes that Wardmote is allowed to consume:

```json
{
  "Sid": "WardmoteResolveImportedExternalReferences",
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": [
    "arn:aws:secretsmanager:<region>:<account-id>:secret:<approved-external-prefix>/*"
  ]
}
```

If selected external secrets use customer-managed KMS keys, also grant
`kms:Decrypt` and `kms:DescribeKey` on those keys. Keep managed write/delete
permissions scoped to `wardmote/<deployment-id>/*`; do not broaden them for
remote import.

The same rule applies to user-scoped external refs. Wardmote derives the
responsible user and credential owner before resolution, but AWS IAM still
decides whether the runtime role can read the selected ARN/path. If the runtime
role can read a broad external prefix, that access is broader than Wardmote's
metadata policy. Use dedicated provider vaults, accounts, Regions, prefixes,
KMS keys, or runtime roles when provider-side isolation must match a
user-secret boundary.

Safe scoping guidance:

- Prefer one Wardmote runtime role per environment/account.
- Point provider vaults at the intended AWS account and Region instead of a
  broad central admin role.
- Enable `ListSecrets` only in accounts where inventory exposure is acceptable.
- Keep preview/import board-only; agent API keys must not call these routes.
- Treat AWS tag/name filters as search UX only, not permission enforcement.

Wardmote also blocks importing refs under its own managed namespace as
external references. Use the Wardmote-managed flow for
`wardmote/{deploymentId}/{companyId}/{secretKey}` resources.

## Existing AWS Secrets

V1 keeps existing AWS Secrets Manager entries as **linked external references**, not adopted
Wardmote-managed resources.

Use the Wardmote-managed flow when Wardmote should create and rotate the value. The AWS
secret name is derived from deployment and company scope:

```text
wardmote/{deploymentId}/{companyId}/{secretKey}
```

Use the external-reference flow when the secret already exists at an operator-owned path such
as:

```text
/platform-bench/anthropic_api_key
```

In that mode Wardmote stores only the path or ARN, resolves it at runtime, and records
redacted access events. Operators rotate the actual value in AWS. Update the Wardmote
reference only when the AWS path, ARN, or pinned provider version changes.

Wardmote does not currently offer an "adopt existing AWS secret" flow that takes over future
`PutSecretValue` writes for an arbitrary existing secret. Adding that later requires explicit
confirmation UX, scope validation, expected Wardmote tags, and security/cloud-ops review.

## Data Custody

- Wardmote stores `externalRef`, `providerVersionRef`, provider id, fingerprint hash, status, and binding metadata.
- Wardmote does not store AWS secret plaintext in `company_secret_versions.material`.
- Runtime resolution fetches the value from AWS only when a bound consumer needs it.

## Rotation Runbook

Manual Wardmote-managed rotation:

1. Write the new value through the Wardmote secret rotate flow.
2. Wardmote creates a new AWS secret version with `PutSecretValue`.
3. Wardmote records the new `providerVersionRef` in `company_secret_versions`.
4. Re-run or restart affected workloads that consume `latest`, or pin consumers to a specific Wardmote version before rollout when you need staged release safety.

Guidance:

- Prefer pinned Wardmote secret versions for risky rollouts.
- Treat provider-native automatic rotation as a later enhancement; current V1 flow is explicit create-new-version plus controlled rollout.

## Backup And Restore Runbook

What must survive:

- Wardmote database metadata for secret ownership, bindings, status, and provider version refs.
- User-secret definitions, declarations, `company_secrets.scope = 'user'`
  value rows, owner user ids, responsible-user snapshots, access-event
  metadata, and provider version refs.
- AWS Secrets Manager namespace under the configured deployment prefix.
- Any operator-owned external AWS prefixes linked by user-scoped external refs.
- The configured KMS key and its decrypt permissions.

Restore checklist:

1. Restore Wardmote database metadata.
2. Confirm the same AWS Secrets Manager namespace still exists.
3. Confirm any linked user-scoped external prefixes still exist.
4. Confirm the Wardmote runtime role can call `GetSecretValue` on the restored
   managed prefix and approved external prefixes.
5. Confirm the role still has decrypt access to the CMKs referenced by
   `WARDMOTE_SECRETS_AWS_KMS_KEY_ID` and by any external user-secret values.
6. Run the live smoke below or a targeted runtime secret resolution test for
   both a company secret and a user-secret value.

## Provider Outage Runbook

Symptoms:

- Secret create/rotate/resolve operations fail with AWS provider errors.
- Agent runs fail before adapter invocation on required secret resolution.
- Remote import preview fails to list AWS inventory.

Immediate actions:

1. Confirm AWS regional health and Secrets Manager availability.
2. Confirm the runtime role still has `GetSecretValue` and KMS decrypt permissions.
3. Check for accidental prefix, region, deployment id, or KMS key config drift.
4. Retry a single resolution after AWS service health is green.
5. If outage persists, pause high-risk runs that require secret access rather than churning retries.

Remote import-specific actions:

- Missing list permission: add `secretsmanager:ListSecrets` with
  `Resource: "*"` only when inventory import is approved for that vault's
  AWS account and Region.
- Throttling: narrow the search, wait briefly, and retry with backoff. Avoid
  full-account enumeration.
- Invalid or stale cursor: refresh the preview and discard the old
  `NextToken`.
- Large account: load pages intentionally, keep one in-flight preview request
  per vault/search, and do not run background full-account crawls.
- Runtime read failure after import: verify `GetSecretValue` and KMS decrypt
  on the selected external secret. Visibility in `ListSecrets` does not prove
  read permission.

## Incident Response Runbook

Potential incidents:

- Cross-company access caused by IAM scoping drift.
- KMS policy drift causing decrypt failures or over-broad access.
- Suspected secret exposure in logs, transcripts, or downstream agent output.

Response steps:

1. Stop or pause affected Wardmote runs.
2. Audit recent Wardmote secret access events for impacted secret ids and consumers.
   For user-scoped incidents, include `credentialOwnerUserId`,
   `responsibleUserId`, and `userSecretDefinitionId` in the review.
3. Audit AWS CloudTrail for `ListSecrets`, `GetSecretValue`,
   `PutSecretValue`, and `DeleteSecret` calls on the relevant vault account,
   Region, deployment prefix, and approved external prefixes.
4. Rotate impacted secrets in AWS through Wardmote-managed versioning.
5. Re-scope IAM and KMS policies before resuming normal traffic.
6. If a value may have reached an agent transcript or external system, treat it as exposed and rotate immediately.

## Optional Live Smoke

This is safe to skip locally. Run it only against a dedicated AWS test namespace.

Prerequisites:

- AWS credentials or workload identity with the deployment-scoped IAM permissions above.
- `WARDMOTE_SECRETS_PROVIDER=aws_secrets_manager`
- The required `WARDMOTE_SECRETS_AWS_*` environment variables set.

Suggested smoke:

1. Create a test secret through the Wardmote board or API under a throwaway company.
2. Confirm the resulting AWS secret name matches `wardmote/{deploymentId}/{companyId}/{secretKey}`.
3. Rotate the secret once and confirm a new `providerVersionRef` appears in Wardmote metadata.
4. Resolve the secret through a bound runtime path, not by adding a general-purpose reveal endpoint.
5. Delete the throwaway secret and confirm AWS schedules deletion with the configured recovery window.
