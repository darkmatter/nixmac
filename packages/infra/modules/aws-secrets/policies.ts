const OIDC_PROVIDER_URL = "token.actions.githubusercontent.com";

type OidcInputs = {
  provider: "github-actions" | "flyio" | "roles-anywhere" | string;
  githubActions: {
    org: string;
    repo: string;
  };
  flyio: {
    orgId: string;
    appName: string;
  };
  rolesAnywhere: {
    trustAnchorArn: string;
  };
};

export function githubActionsProviderArn(accountId: string): string {
  return `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER_URL}`;
}

export function buildAssumeRolePolicy(inputs: OidcInputs, accountId: string): unknown {
  switch (inputs.provider) {
    case "github-actions": {
      const { org, repo } = inputs.githubActions;
      return {
        Version: "2012-10-17" as const,
        Statement: [
          {
            Effect: "Allow" as const,
            Principal: {
              Federated: githubActionsProviderArn(accountId),
            },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                [`${OIDC_PROVIDER_URL}:aud`]: "sts.amazonaws.com",
              },
              StringLike: {
                [`${OIDC_PROVIDER_URL}:sub`]: `repo:${org}/${repo}:*`,
              },
            },
          },
        ],
      };
    }

    case "flyio": {
      const { orgId, appName } = inputs.flyio;
      const flyOidcUrl = `oidc.fly.io/${orgId}`;
      return {
        Version: "2012-10-17" as const,
        Statement: [
          {
            Effect: "Allow" as const,
            Principal: {
              Federated: `arn:aws:iam::${accountId}:oidc-provider/${flyOidcUrl}`,
            },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                [`${flyOidcUrl}:aud`]: "sts.amazonaws.com",
              },
              StringLike: {
                [`${flyOidcUrl}:sub`]: `${orgId}:${appName}:*`,
              },
            },
          },
        ],
      };
    }

    case "roles-anywhere":
      return {
        Version: "2012-10-17" as const,
        Statement: [
          {
            Effect: "Allow" as const,
            Principal: {
              Service: "rolesanywhere.amazonaws.com",
            },
            Action: ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"],
            Condition: {
              ArnEquals: {
                "aws:SourceArn": inputs.rolesAnywhere.trustAnchorArn,
              },
            },
          },
        ],
      };

    default:
      return {
        Version: "2012-10-17" as const,
        Statement: [],
      };
  }
}

export function buildKmsKeyPolicy(accountId: string, roleArn: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          AWS: `arn:aws:iam::${accountId}:root`,
        },
        Action: "kms:*",
        Resource: "*",
      },
      {
        Effect: "Allow",
        Principal: {
          AWS: roleArn,
        },
        Action: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:DescribeKey"],
        Resource: "*",
      },
    ],
  });
}

export function buildRoleKmsInlinePolicy(alias: string, keyArn: string): { policyDocument: unknown } {
  return {
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:DescribeKey"],
          Resource: keyArn,
        },
        {
          Effect: "Allow",
          Action: ["kms:Decrypt"],
          Resource: "*",
          Condition: {
            StringLike: {
              "kms:RequestAlias": `alias/${alias}`,
            },
          },
        },
      ],
    },
  };
}
