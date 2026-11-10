import { describe, expect, it } from "vitest";
import { createAwsSecretsManagerProvider } from "../secrets/aws-secrets-manager-provider.js";

const RETIRED_REF = "arn:aws:secretsmanager:us-east-1:123456789012:secret:paperclip/prod-use1";

const config = {
  region: "us-east-1",
  endpoint: "https://secretsmanager.us-east-1.amazonaws.com",
  deploymentId: "prod-use1",
  prefix: "wardmote",
  kmsKeyId: "arn:aws:kms:us-east-1:123456789012:key/test",
  environmentTag: "production",
  providerOwnerTag: "wardmote",
  deleteRecoveryWindowDays: 30,
};

const unused = async () => {
  throw new Error("not used");
};

describe("awsSecretsManagerProvider secrets written before the rename", () => {
  it("still refuses to link a managed secret under the retired default prefix as an external reference", async () => {
    const provider = createAwsSecretsManagerProvider({ config });

    await expect(
      provider.linkExternalSecret({
        externalRef: `${RETIRED_REF}/company-2/openai-api-key`,
        providerVersionRef: "linked-version-7",
      }),
    ).rejects.toThrow(/Wardmote-managed namespace/i);
  });

  it("keeps rotating a managed secret stored under the retired default prefix", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = createAwsSecretsManagerProvider({
      config,
      gateway: {
        createSecret: unused,
        async putSecretValue(input) {
          calls.push(input);
          return { ARN: `${RETIRED_REF}/company-1/openai-api-key`, VersionId: "aws-version-2" };
        },
        getSecretValue: unused,
        deleteSecret: unused,
      },
    });

    await provider.createVersion({
      value: "rotated-secret-value",
      externalRef: `${RETIRED_REF}/company-1/openai-api-key`,
      context: { companyId: "company-1", secretKey: "openai-api-key", secretName: "OpenAI API Key", version: 2 },
    });

    expect(calls.map((call) => call.SecretId)).toEqual([`${RETIRED_REF}/company-1/openai-api-key`]);
  });

  it("rejects a retired-prefix ref that belongs to another company", async () => {
    const provider = createAwsSecretsManagerProvider({
      config,
      gateway: { createSecret: unused, putSecretValue: unused, getSecretValue: unused, deleteSecret: unused },
    });

    await expect(
      provider.createVersion({
        value: "rotated-secret-value",
        externalRef: `${RETIRED_REF}/company-2/openai-api-key`,
        context: { companyId: "company-1", secretKey: "openai-api-key", secretName: "OpenAI API Key", version: 2 },
      }),
    ).rejects.toThrow(/drifted outside the derived deployment\/company scope/i);
  });

  it("skips another company's secrets tagged with the retired managed tags during discovery", async () => {
    const provider = createAwsSecretsManagerProvider({
      config,
      gateway: {
        createSecret: unused,
        putSecretValue: unused,
        getSecretValue: unused,
        deleteSecret: unused,
        async listSecrets() {
          return {
            SecretList: [
              {
                ARN: `${RETIRED_REF}/company-2/stripe`,
                Name: "paperclip/prod-use1/company-2/stripe",
                Tags: [
                  { Key: "paperclip:managed-by", Value: "paperclip" },
                  { Key: "paperclip:company-id", Value: "company-2" },
                ],
              },
            ],
          };
        },
      },
    });

    const preview = await provider.discoverProviderConfigs?.({
      companyId: "company-1",
      providerConfig: { id: "draft", provider: "aws_secrets_manager", status: "ready", config: { region: "us-east-1" } },
      query: "",
      pageSize: 25,
    });

    expect(preview).toMatchObject({ sampledSecretCount: 0, skippedForeignWardmoteSampleCount: 1 });
    expect(JSON.stringify(preview)).not.toContain("company-2/stripe");
  });
});
