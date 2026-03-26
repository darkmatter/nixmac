import { isSecret, type Secret } from "alchemy";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  InternetGateway,
  InternetGatewayAttachment,
  Role,
  Route,
  RouteTable,
  RouteTableAssociation,
  SecurityGroup,
  SecurityGroupRule,
  SSMParameter,
  Subnet,
  Vpc,
} from "alchemy/aws";
import AWS from "alchemy/aws/control";

const DEFAULT_IMAGE_ID =
  "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}";

type EnvironmentValue = string | Secret<string>;

export interface Ec2ServerProps {
  parameterPath: string;
  artifactBucket: string;
  artifactKey: string;
  artifactVersion?: string;
  environment: Record<string, EnvironmentValue>;
  region?: string;
  availabilityZone: string;
  imageId?: string;
  instanceType?: string;
  keyName?: string;
  port?: number;
  httpCidrBlocks?: string[];
  sshCidrBlocks?: string[];
  vpcCidrBlock?: string;
  subnetCidrBlock?: string;
  tags?: Record<string, string>;
}

export interface Ec2Server extends Ec2ServerProps {
  instanceId: string;
  publicIp: string;
  publicDnsName: string;
  url: string;
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  roleArn: string;
  instanceProfileArn: string;
}

export async function Ec2Server(
  id: string,
  props: Ec2ServerProps,
): Promise<Ec2Server> {
  const region = props.region ?? "us-west-2";
  const imageId = await resolveImageId(props.imageId ?? DEFAULT_IMAGE_ID, region);
  const instanceType = props.instanceType ?? "t3.small";
  const port = props.port ?? 80;
  const httpCidrBlocks = props.httpCidrBlocks ?? ["0.0.0.0/0"];
  const sshCidrBlocks = props.sshCidrBlocks ?? [];
  const vpcCidrBlock = props.vpcCidrBlock ?? "10.42.0.0/16";
  const subnetCidrBlock = props.subnetCidrBlock ?? "10.42.1.0/24";
  const namePrefix = props.tags?.Stage ? `${id}-${props.tags.Stage}` : id;
  const tags = {
    Name: id,
    ManagedBy: "alchemy",
    Service: "server",
    ...props.tags,
  };

  const role = await Role(`${id}-instance-role`, {
    roleName: `${namePrefix}-instance-role`,
    assumeRolePolicy: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "ec2.amazonaws.com",
          },
          Action: "sts:AssumeRole",
        },
      ],
    },
    description: "Allows the EC2 server to read boot-time config and artifacts.",
    managedPolicyArns: [
      "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    ],
    policies: [
      {
        policyName: `${id}-read-config`,
        policyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath",
              ],
              Resource: [
                `arn:aws:ssm:${region}:*:parameter${props.parameterPath}`,
                `arn:aws:ssm:${region}:*:parameter${props.parameterPath}/*`,
              ],
            },
            {
              Effect: "Allow",
              Action: ["s3:GetBucketLocation", "s3:ListBucket"],
              Resource: [`arn:aws:s3:::${props.artifactBucket}`],
              Condition: {
                StringLike: {
                  "s3:prefix": [props.artifactKey],
                },
              },
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject"],
              Resource: [
                `arn:aws:s3:::${props.artifactBucket}/${props.artifactKey}`,
              ],
            },
            {
              Effect: "Allow",
              Action: ["kms:Decrypt"],
              Resource: "*",
            },
          ],
        },
      },
    ],
    tags,
  });

  const instanceProfileName = `${namePrefix}-instance-profile`;
  const instanceProfile = await AWS.IAM.InstanceProfile(
    `${id}-instance-profile`,
    {
      InstanceProfileName: instanceProfileName,
      Roles: [role.roleName],
    },
  );

  await Promise.all(
    Object.entries(props.environment).map(([key, value]) => {
      const name = `${trimTrailingSlash(props.parameterPath)}/${key}`;

      if (isSecret(value)) {
        return SSMParameter(`${id}-env-${key.toLowerCase()}`, {
          name,
          description: `Runtime configuration for ${id}: ${key}`,
          type: "SecureString",
          value,
          tags,
        });
      }

      return SSMParameter(`${id}-env-${key.toLowerCase()}`, {
        name,
        description: `Runtime configuration for ${id}: ${key}`,
        value,
        tags,
      });
    }),
  );

  const vpc = await Vpc(`${id}-vpc`, {
    cidrBlock: vpcCidrBlock,
    enableDnsSupport: true,
    enableDnsHostnames: true,
    region,
    tags,
  });

  const internetGateway = await InternetGateway(`${id}-igw`, {
    region,
    tags,
  });

  await InternetGatewayAttachment(`${id}-igw-attachment`, {
    internetGateway,
    vpc,
    region,
  });

  const routeTable = await RouteTable(`${id}-public-rt`, {
    vpc,
    region,
    tags,
  });

  await Route(`${id}-default-route`, {
    routeTable,
    region,
    destinationCidrBlock: "0.0.0.0/0",
    target: {
      internetGateway,
    },
  });

  const subnet = await Subnet(`${id}-public-subnet`, {
    vpc,
    region,
    cidrBlock: subnetCidrBlock,
    availabilityZone: props.availabilityZone,
    mapPublicIpOnLaunch: true,
    tags,
  });

  await RouteTableAssociation(`${id}-public-association`, {
    routeTable,
    subnet,
  });

  const securityGroup = await SecurityGroup(`${id}-sg`, {
    vpc,
    region,
    description: `Ingress rules for ${id}`,
    tags,
  });

  await Promise.all(
    httpCidrBlocks.map((cidr, index) =>
      SecurityGroupRule(`${id}-http-${index}`, {
        securityGroup,
        type: "ingress",
        protocol: "tcp",
        fromPort: port,
        toPort: port,
        cidrBlocks: [cidr],
        description: `Allow HTTP traffic on port ${port}`,
      }),
    ),
  );

  if (props.keyName && sshCidrBlocks.length > 0) {
    await Promise.all(
      sshCidrBlocks.map((cidr, index) =>
        SecurityGroupRule(`${id}-ssh-${index}`, {
          securityGroup,
          type: "ingress",
          protocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrBlocks: [cidr],
          description: "Allow SSH access",
        }),
      ),
    );
  }

  const instance = await AWS.EC2.Instance(id, {
    AvailabilityZone: props.availabilityZone,
    IamInstanceProfile: instanceProfileName,
    ImageId: imageId,
    InstanceType: instanceType,
    KeyName: props.keyName,
    MetadataOptions: {
      HttpEndpoint: "enabled",
      HttpTokens: "required",
    },
    PropagateTagsToVolumeOnCreation: true,
    SecurityGroupIds: [securityGroup.groupId],
    SubnetId: subnet.subnetId,
    Tags: toAwsTags(tags),
    UserData: buildUserData({
      artifactBucket: props.artifactBucket,
      artifactKey: props.artifactKey,
      artifactVersion: props.artifactVersion,
      parameterPath: props.parameterPath,
      port,
      region,
    }),
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/xvda",
        Ebs: {
          DeleteOnTermination: true,
          VolumeSize: 20,
          VolumeType: "gp3",
        },
      },
    ],
  });

  const host = instance.PublicDnsName || instance.PublicIp;
  const url = `http://${host}${port === 80 ? "" : `:${port}`}`;

  return {
    ...props,
    instanceId: instance.InstanceId,
    publicIp: instance.PublicIp,
    publicDnsName: instance.PublicDnsName,
    url,
    vpcId: vpc.vpcId,
    subnetId: subnet.subnetId,
    securityGroupId: securityGroup.groupId,
    roleArn: role.arn,
    instanceProfileArn: instanceProfile.Arn,
  };
}

async function resolveImageId(imageId: string, region: string) {
  if (imageId.startsWith("ami-")) {
    return imageId;
  }

  const match = imageId.match(/^\{\{resolve:ssm:([^}:]+)(?::\d+)?\}\}$/);
  if (!match) {
    return imageId;
  }

  const parameterName = match[1];
  const client = new SSMClient({ region });
  const response = await client.send(
    new GetParameterCommand({
      Name: parameterName,
    }),
  );
  const resolvedImageId = response.Parameter?.Value;

  if (!resolvedImageId?.startsWith("ami-")) {
    throw new Error(
      `Resolved AMI from SSM parameter ${parameterName} was not a valid EC2 image id.`,
    );
  }

  return resolvedImageId;
}

function toAwsTags(tags: Record<string, string>) {
  return Object.entries(tags).map(([Key, Value]) => ({
    Key,
    Value,
  }));
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function shellString(value: string) {
  return JSON.stringify(value);
}

function buildUserData({
  artifactBucket,
  artifactKey,
  artifactVersion,
  parameterPath,
  port,
  region,
}: {
  artifactBucket: string;
  artifactKey: string;
  artifactVersion?: string;
  parameterPath: string;
  port: number;
  region: string;
}) {
  const script = `#!/bin/bash
set -euxo pipefail

export HOME=/root
export PATH=/usr/local/bin:/usr/bin:/bin

dnf update -y
dnf install -y jq unzip

cat >/usr/local/bin/nixmac-bootstrap <<'EOF'
#!/bin/bash
set -euo pipefail

export HOME=/root
export PATH=/usr/local/bin:/usr/bin:/bin
export AWS_REGION=${shellString(region)}

ARTIFACT_BUCKET=${shellString(artifactBucket)}
ARTIFACT_KEY=${shellString(artifactKey)}
ARTIFACT_VERSION=${shellString(artifactVersion ?? "unknown")}
PARAMETER_PATH=${shellString(trimTrailingSlash(parameterPath))}
APP_ROOT=/opt/nixmac
RELEASE_ROOT=$APP_ROOT/release
ENV_FILE=/etc/nixmac-server.env
ARCHIVE_PATH=/tmp/nixmac-server-release.tar.gz

rm -rf "$RELEASE_ROOT"
mkdir -p "$RELEASE_ROOT"

aws s3 cp "s3://$ARTIFACT_BUCKET/$ARTIFACT_KEY" "$ARCHIVE_PATH" --region "$AWS_REGION"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_ROOT"
install -m 0755 "$RELEASE_ROOT/server/server" /usr/local/bin/nixmac-server

cat >"$ENV_FILE" <<ENVEOF
NODE_ENV=production
PORT=${port}
STATIC_ROOT=$RELEASE_ROOT/web
ARTIFACT_BUCKET=$ARTIFACT_BUCKET
ARTIFACT_KEY=$ARTIFACT_KEY
ARTIFACT_VERSION=$ARTIFACT_VERSION
ENVEOF

aws ssm get-parameters-by-path \
  --path "$PARAMETER_PATH" \
  --recursive \
  --with-decryption \
  --output json \
  --region "$AWS_REGION" \
| jq -r '.Parameters[] | "\\(.Name | split("/")[-1])=\\(.Value)"' >>"$ENV_FILE"
EOF

chmod +x /usr/local/bin/nixmac-bootstrap
/usr/local/bin/nixmac-bootstrap

cat >/etc/systemd/system/nixmac-server.service <<'EOF'
[Unit]
Description=nixmac server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/nixmac/release
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/nixmac-server.env
ExecStart=/usr/local/bin/nixmac-server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nixmac-server.service
`;

  return Buffer.from(script, "utf8").toString("base64");
}
