import alchemy from "alchemy";
import { Vite } from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });

const app = await alchemy("nixmac");

export const web = await Vite("web", {
  assets: "dist",
  bindings: {
    VITE_SERVER_URL: alchemy.env.VITE_SERVER_URL,
  },
});

console.log(`Web    -> ${web.url}`);

await app.finalize();
