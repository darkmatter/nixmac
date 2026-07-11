import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSlackMessage,
  extractLinearIssueLink,
  postSlackWebhook,
  waitForLinearIssue,
} from "./notify-new-issue.mjs";

test("extractLinearIssueLink finds Linear's GitHub backlink", () => {
  const result = extractLinearIssueLink([
    {
      body: "Fake https://linear.app/darkmatter/issue/ENG-1/not-the-synced-issue",
      user: { login: "someone-else" },
    },
    {
      body: "This issue is synced to [ENG-593](https://linear.app/darkmatter/issue/ENG-593/nixmac-fails-to-start).",
      user: { login: "linear-code[bot]" },
    },
  ]);

  assert.deepEqual(result, {
    identifier: "ENG-593",
    url: "https://linear.app/darkmatter/issue/ENG-593/nixmac-fails-to-start",
  });
});

test("extractLinearIssueLink supports Linear's production linkback format", () => {
  const result = extractLinearIssueLink([
    {
      body: '<!-- linear-linkback -->\n<p><a href="https://linear.app/darkmatterlabs/issue/ENG-593">ENG-593</a></p>',
      user: { login: "linear-code[bot]" },
    },
  ]);

  assert.deepEqual(result, {
    identifier: "ENG-593",
    url: "https://linear.app/darkmatterlabs/issue/ENG-593",
  });
});

test("extractLinearIssueLink returns null when no Linear backlink exists", () => {
  assert.equal(
    extractLinearIssueLink([
      { body: "Still investigating", user: { login: "linear-code[bot]" } },
    ]),
    null,
  );
});

test("buildSlackMessage includes both issue links and escapes untrusted text", () => {
  const githubIssue = {
    html_url: "https://github.com/darkmatter/nixmac/issues/510",
    number: 510,
    title: "Nix <fails> & hangs",
    user: {
      html_url: "https://github.com/example-user",
      login: "example-user",
    },
  };
  const linearIssue = {
    identifier: "ENG-593",
    url: "https://linear.app/darkmatter/issue/ENG-593/nixmac-fails-to-start",
  };

  const message = buildSlackMessage(githubIssue, linearIssue);
  const serializedBlocks = JSON.stringify(message.blocks);

  assert.equal("channel" in message, false);
  assert.match(message.text, /https:\/\/github\.com\/darkmatter\/nixmac\/issues\/510/);
  assert.match(message.text, /https:\/\/linear\.app\/darkmatter\/issue\/ENG-593/);
  assert.doesNotMatch(message.text, /Nix <fails> & hangs/);
  assert.match(message.text, /Nix &lt;fails&gt; &amp; hangs/);
  assert.match(serializedBlocks, /Nix &lt;fails&gt; &amp; hangs/);
  assert.match(serializedBlocks, /github\.com\/darkmatter\/nixmac\/issues\/510/);
  assert.match(serializedBlocks, /linear\.app\/darkmatter\/issue\/ENG-593/);
});

test("waitForLinearIssue retries until the backlink appears", async () => {
  const responses = [
    [],
    [
      {
        body: "Synced to https://linear.app/darkmatter/issue/ENG-593/nixmac-fails-to-start",
        user: { login: "linear-code[bot]" },
      },
    ],
  ];
  let calls = 0;

  const result = await waitForLinearIssue({
    attempts: 3,
    fetchComments: async () => responses[calls++] ?? [],
    sleep: async () => {},
  });

  assert.equal(calls, 2);
  assert.equal(result.identifier, "ENG-593");
});

test("waitForLinearIssue fails instead of posting without a Linear link", async () => {
  await assert.rejects(
    waitForLinearIssue({
      attempts: 2,
      fetchComments: async () => [],
      sleep: async () => {},
    }),
    /Linear backlink did not appear/,
  );
});

test("postSlackWebhook requires Slack's explicit ok response", async () => {
  let request;
  await postSlackWebhook("https://hooks.slack.test/example", { text: "hello" }, async (...args) => {
    request = args;
    return {
      ok: true,
      status: 200,
      text: async () => "ok",
    };
  });

  assert.equal(request[0], "https://hooks.slack.test/example");
  assert.equal(JSON.parse(request[1].body).text, "hello");

  await assert.rejects(
    postSlackWebhook("https://hooks.slack.test/example", { text: "hello" }, async () => ({
      ok: false,
      status: 403,
      text: async () => "invalid_token",
    })),
    /Slack rejected the notification \(403\): invalid_token/,
  );
});
