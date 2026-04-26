import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'question_answer_followup',
  specs: ['./tests/wdio/question-answer.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
