import { createOpenAiCompatibleSetupOptionsForSuite } from "../dist-e2e/tests/wdio/helpers/openai-compatible-test-mode.js";
import { createWdioConfig } from "./wdio.conf.base.mjs";

export const config = createWdioConfig({
  specs: ["../dist-e2e/tests/wdio/discard.spec.js"],
  setupOptions: createOpenAiCompatibleSetupOptionsForSuite({
    initializeConfigRepo: true,
  }),
});
