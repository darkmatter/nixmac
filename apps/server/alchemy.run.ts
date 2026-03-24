import alchemy from "alchemy";
import { IAMClient } from "@aws-sdk/client-iam";
import { Ec2Server } from "./deploy/ec2-server";

const region = alchemy.env("AWS_REGION", "us-west-2");
process.env.AWS_REGION ??= region;
process.env.AWS_DEFAULT_REGION ??= region;
await seedAwsCredentialEnv(region);

const app = await alchemy("nixmac-server");
const stage = process.env.STAGE ?? app.stage;
const httpCidrBlocks = splitCsv(process.env.EC2_HTTP_CIDRS) ?? ["0.0.0.0/0"];
const sshCidrBlocks = splitCsv(process.env.EC2_SSH_CIDRS) ?? [];
const artifactBucket = requireEnv("EC2_ARTIFACT_BUCKET");
const artifactKey = requireEnv("EC2_ARTIFACT_KEY");
const artifactVersion = process.env.EC2_ARTIFACT_VERSION;

export const server = await Ec2Server("server", {
  region,
  availabilityZone: alchemy.env("EC2_AVAILABILITY_ZONE", `${region}a`),
  imageId: process.env.EC2_IMAGE_ID,
  instanceType: alchemy.env("EC2_INSTANCE_TYPE", "t3.small"),
  keyName: process.env.EC2_KEY_NAME,
  artifactBucket,
  artifactKey,
  artifactVersion,
  parameterPath: alchemy.env(
    "EC2_PARAMETER_PATH",
    `/nixmac/${stage}/server-runtime`,
  ),
  httpCidrBlocks,
  sshCidrBlocks,
  environment: {
    DATABASE_URL: alchemy.secret.env("DATABASE_URL"),
    BETTER_AUTH_SECRET: alchemy.secret.env("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: alchemy.env("BETTER_AUTH_URL"),
    POLAR_ACCESS_TOKEN: alchemy.secret.env("POLAR_ACCESS_TOKEN"),
    POLAR_SUCCESS_URL: alchemy.env("POLAR_SUCCESS_URL"),
    CORS_ORIGIN: alchemy.env("CORS_ORIGIN"),
  },
  tags: {
    App: "nixmac",
    Stage: stage,
  },
});

console.log(`Server -> ${server.url}`);
console.log(`SSH    -> ${server.publicDnsName}`);
console.log(`Artifact -> s3://${artifactBucket}/${artifactKey}`);

await app.finalize();

function splitCsv(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : undefined;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

async function seedAwsCredentialEnv(region: string) {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    process.env.AWS_SESSION_TOKEN ??= "";
    return;
  }

  const client = new IAMClient({ region });
  const credentialProvider = client.config.credentials;

  if (!credentialProvider) {
    throw new Error("Unable to resolve AWS credentials provider.");
  }

  const credentials = await credentialProvider();
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  process.env.AWS_SESSION_TOKEN = credentials.sessionToken ?? "";

  delete process.env.AWS_PROFILE;
  delete process.env.AWS_DEFAULT_PROFILE;
}
