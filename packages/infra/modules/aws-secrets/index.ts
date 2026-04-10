import { AccountId } from "alchemy/aws";
import AWS from "alchemy/aws/control";
import { GitHubOIDCProvider } from "alchemy/aws/oidc";
import Infra from "@stackpanel/infra";
import { IamRole } from "@stackpanel/infra/resources/iam-role";
import {
  buildAssumeRolePolicy,
  buildKmsKeyPolicy,
  buildRoleKmsInlinePolicy,
  githubActionsProviderArn,
} from "./policies";

const infra = new Infra("aws-secrets");
const inputs = infra.inputs(process.env.STACKPANEL_INFRA_INPUTS_OVERRIDES);

const accountId = await AccountId();
const assumeRolePolicy = buildAssumeRolePolicy(inputs.oidc, accountId) as any;

const roleTags = {
  Project: inputs.projectName,
  ManagedBy: "stackpanel-infra",
};

const rolePolicyName = `${inputs.iam.roleName}-kms-policy`;

const role = await IamRole(infra.id("role"), {
  roleName: inputs.iam.roleName,
  assumeRolePolicy,
  description: `IAM role for ${inputs.projectName} secrets access`,
  tags: roleTags,
  managedPolicyArns: inputs.iam.additionalPolicies ?? [],
});

let resolvedOidcProviderArn = githubActionsProviderArn(accountId);

if (inputs.oidc.provider === "github-actions") {
  const oidcProvider = await GitHubOIDCProvider(infra.id("oidc"), {
    adopt: true,
    owner: inputs.oidc.githubActions.org,
    repository: inputs.oidc.githubActions.repo,
    roleArn: role.arn,
  } as any);
  resolvedOidcProviderArn = oidcProvider.providerArn;
}

const kmsKey = await AWS.KMS.Key(infra.id("kms-key"), {
  Description: `KMS key for encrypting ${inputs.projectName} secrets`,
  EnableKeyRotation: true,
  PendingWindowInDays: inputs.kms.deletionWindowDays,
  KeyPolicy: JSON.parse(buildKmsKeyPolicy(accountId, role.arn)),
  Tags: Object.entries({
    Name: inputs.kms.alias,
    ...roleTags,
  }).map(([Key, Value]) => ({ Key, Value })),
  adopt: true,
});

const kmsAlias = await AWS.KMS.Alias(infra.id("kms-alias"), {
  AliasName: `alias/${inputs.kms.alias}`,
  TargetKeyId: kmsKey.KeyId,
  adopt: true,
});

await IamRole(infra.id("role"), {
  roleName: inputs.iam.roleName,
  assumeRolePolicy,
  description: `IAM role for ${inputs.projectName} secrets access`,
  tags: roleTags,
  managedPolicyArns: inputs.iam.additionalPolicies ?? [],
  policies: [
    {
      policyName: rolePolicyName,
      ...buildRoleKmsInlinePolicy(inputs.kms.alias, kmsKey.Arn),
    },
  ],
});

export default {
  roleArn: role.arn,
  roleName: role.roleName,
  kmsKeyArn: kmsKey.Arn,
  kmsKeyId: kmsKey.KeyId,
  kmsAliasName: kmsAlias.AliasName,
  oidcProviderArn: resolvedOidcProviderArn,
};
