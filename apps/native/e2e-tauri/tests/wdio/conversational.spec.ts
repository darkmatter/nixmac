// oxlint-disable no-unused-expressions
import {
  assertConversationalPromptContains,
  assertPromptFlowReachedBegin,
  assertPromptFlowReachedEvolveReview,
  captureChangeMap,
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from "./helpers/app-ui.js";
import { getMockOpenAiCompatibleFixturePreset } from "./helpers/mock-openai-compatible-presets.js";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";

use(chaiAsPromised);

describe("conversational prompts", () => {
  registerPromptSuiteBeforeEach({
    fixtureByTestTitle: {
      "submits a conversational prompt on the Begin step": getMockOpenAiCompatibleFixturePreset(
        "conversationalPromptsOnBegin",
      ),
      "submits a conversational prompt on the Evolve step": getMockOpenAiCompatibleFixturePreset(
        "conversationalPromptsOnEvolve",
      ),
    },
  });

  it("submits a conversational prompt on the Begin step", async () => {
    await submitPromptMessage("can you help me add homebrew packages?");
    await assertPromptFlowReachedBegin();
    await assertConversationalPromptContains("Sure! Which Homebrew formulae");
  });

  it("submits a conversational prompt on the Evolve step", async () => {
    // Setup scenario.
    await submitPromptMessage("add a new programming font to my system");
    await assertPromptFlowReachedEvolveReview();

    const changeMapBefore = await captureChangeMap();

    // Ask a follow-up conversational question in the Evolve step and ensure it stays on Evolve.
    await submitPromptMessage("can you help me add homebrew packages?");
    await assertPromptFlowReachedEvolveReview();
    await assertConversationalPromptContains("Sure! Which Homebrew formulae");

    expect(await captureChangeMap()).to.equal(changeMapBefore);
  });
});
