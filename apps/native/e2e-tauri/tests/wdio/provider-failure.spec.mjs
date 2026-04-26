import {
  submitPromptMessage,
  waitForFirstWindow,
  waitForWidgetErrorContaining,
} from './helpers/app-ui.mjs';
import { setMockVllmResponses } from './helpers/test-env.mjs';

describe('provider failure recovery', () => {
  it('surfaces a visible app error when the AI provider fails', async () => {
    await setMockVllmResponses({
      responses: [
        {
          __mockStatus: 402,
          __mockBody: {
            error: {
              message: 'E2E provider account is out of credits',
              code: 402,
            },
          },
        },
      ],
    });
    await waitForFirstWindow();
    await submitPromptMessage('Install vim');
    await waitForWidgetErrorContaining('billing limit', {
      timeout: 30000,
    });
  });
});
