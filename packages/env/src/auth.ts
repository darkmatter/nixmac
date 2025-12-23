import { parseEnv, z } from "znv";

export const env = parseEnv(process.env, {
  AUTH_JWT_SECRET: z.string().default("sup3rsecret!!"),
  AUTH_PASSWORD_SALT_ROUNDS: z.coerce.number().default(10),
  POLAR_SUCCESS_URL: z.string().min(1).default("https://your-app.com/success"),
  CORS_ORIGIN: z.string().min(1).default("https://nixmac.com"),
});
