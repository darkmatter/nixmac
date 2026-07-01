import { createWdioConfig } from "./wdio.conf.base.mjs";
import { createOpenAiCompatibleSetupOptionsForSuite } from "../dist-e2e/tests/wdio/helpers/openai-compatible-test-mode.js";

export const config = createWdioConfig({
  specs: ["../dist-e2e/tests/wdio/basic-prompts.spec.js"],
  setupOptions: createOpenAiCompatibleSetupOptionsForSuite({
    initializeConfigRepo: true,
  }),
});
