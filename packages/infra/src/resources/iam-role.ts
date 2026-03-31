import type { Context } from "alchemy";
import { Resource } from "alchemy";

export interface IamInlinePolicy {
  policyName: string;
  policyDocument: unknown;
}

export interface IamRoleProps {
  roleName: string;
  assumeRolePolicy: unknown;
  description?: string;
  tags?: Record<string, string>;
  managedPolicyArns?: string[];
  policies?: IamInlinePolicy[];
  destroyOnDelete?: boolean;
}

export interface IamRole extends IamRoleProps {
  arn: string;
  adopted?: boolean;
}

function asPolicyJson(policy: unknown): string {
  return typeof policy === "string" ? policy : JSON.stringify(policy);
}

export const IamRole = Resource(
  "stackpanel::IamRole",
  async function (
    this: Context<IamRole>,
    _id: string,
    props: IamRoleProps,
  ): Promise<IamRole> {
    const {
      IAMClient,
      CreateRoleCommand,
      GetRoleCommand,
      UpdateAssumeRolePolicyCommand,
      UpdateRoleDescriptionCommand,
      TagRoleCommand,
      ListAttachedRolePoliciesCommand,
      AttachRolePolicyCommand,
      PutRolePolicyCommand,
    } = await import("@aws-sdk/client-iam");

    const client = new IAMClient({});

    if (this.phase === "delete") {
      return this.destroy();
    }

    let adopted = this.output?.adopted ?? false;

    const getExistingRole = async () => {
      try {
        const existing = await client.send(new GetRoleCommand({ RoleName: props.roleName }));
        return existing.Role;
      } catch (err: any) {
        if (err.name === "NoSuchEntityException") {
          return undefined;
        }
        throw err;
      }
    };

    let role = await getExistingRole();

    if (!role) {
      const created = await client.send(
        new CreateRoleCommand({
          RoleName: props.roleName,
          AssumeRolePolicyDocument: asPolicyJson(props.assumeRolePolicy),
          Description: props.description,
          Tags: Object.entries(props.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
        }),
      );
      role = created.Role;
    } else {
      adopted = true;
    }

    await client.send(
      new UpdateAssumeRolePolicyCommand({
        RoleName: props.roleName,
        PolicyDocument: asPolicyJson(props.assumeRolePolicy),
      }),
    );

    if (props.description) {
      await client.send(
        new UpdateRoleDescriptionCommand({
          RoleName: props.roleName,
          Description: props.description,
        }),
      );
    }

    if (props.tags && Object.keys(props.tags).length > 0) {
      await client.send(
        new TagRoleCommand({
          RoleName: props.roleName,
          Tags: Object.entries(props.tags).map(([Key, Value]) => ({ Key, Value })),
        }),
      );
    }

    const managedPolicyArns = props.managedPolicyArns ?? [];
    if (managedPolicyArns.length > 0) {
      const attached = await client.send(
        new ListAttachedRolePoliciesCommand({
          RoleName: props.roleName,
        }),
      );
      const attachedArns = new Set((attached.AttachedPolicies ?? []).map((policy) => policy.PolicyArn));

      for (const arn of managedPolicyArns) {
        if (!attachedArns.has(arn)) {
          await client.send(
            new AttachRolePolicyCommand({
              RoleName: props.roleName,
              PolicyArn: arn,
            }),
          );
        }
      }
    }

    for (const policy of props.policies ?? []) {
      await client.send(
        new PutRolePolicyCommand({
          RoleName: props.roleName,
          PolicyName: policy.policyName,
          PolicyDocument: asPolicyJson(policy.policyDocument),
        }),
      );
    }

    const finalRole = await client.send(new GetRoleCommand({ RoleName: props.roleName }));
    const finalArn = finalRole.Role?.Arn ?? role?.Arn;

    if (!finalArn) {
      throw new Error(`Unable to resolve ARN for IAM role ${props.roleName}`);
    }

    return {
      ...props,
      arn: finalArn,
      adopted,
    };
  },
);
