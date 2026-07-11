import assert from "node:assert/strict";
import test from "node:test";

import * as notifier from "./notify-new-issue.mjs";
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

test("extractLinearIssueLink uses the newest Linear backlink", () => {
  const result = extractLinearIssueLink([
    {
      body: '<!-- linear-linkback -->\n<p><a href="https://linear.app/darkmatterlabs/issue/ENG-100">ENG-100</a></p>',
      user: { login: "linear-code[bot]" },
    },
    {
      body: '<!-- linear-linkback -->\n<p><a href="https://linear.app/darkmatterlabs/issue/ENG-200">ENG-200</a></p>',
      user: { login: "linear-code[bot]" },
    },
  ]);

  assert.deepEqual(result, {
    identifier: "ENG-200",
    url: "https://linear.app/darkmatterlabs/issue/ENG-200",
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

test("buildSlackMessage describes an external issue comment", () => {
  const githubIssue = {
    html_url: "https://github.com/darkmatter/nixmac/issues/510",
    number: 510,
    title: "Login fails",
    user: {
      html_url: "https://github.com/issue-author",
      login: "issue-author",
    },
  };
  const linearIssue = {
    identifier: "ENG-593",
    url: "https://linear.app/darkmatterlabs/issue/ENG-593",
  };
  const githubComment = {
    body: "Still broken <@channel> & waiting",
    html_url: "https://github.com/darkmatter/nixmac/issues/510#issuecomment-123",
    user: {
      html_url: "https://github.com/comment-author",
      login: "comment-author",
    },
  };

  const message = buildSlackMessage(githubIssue, linearIssue, githubComment);
  const serializedBlocks = JSON.stringify(message.blocks);

  assert.match(message.text, /New GitHub comment on issue #510/);
  assert.match(message.text, /issues\/510#issuecomment-123/);
  assert.match(message.text, /issues\/510/);
  assert.match(message.text, /linear\.app\/darkmatterlabs\/issue\/ENG-593/);
  assert.match(serializedBlocks, /Commented by/);
  assert.match(serializedBlocks, /@comment-author/);
  assert.match(serializedBlocks, /Still broken &lt;@channel&gt; &amp; waiting/);
  assert.doesNotMatch(serializedBlocks, /Still broken <@channel> & waiting/);
});

test("shouldNotifyActivity excludes members, owners, bots, and pull request comments", () => {
  assert.equal(typeof notifier.shouldNotifyActivity, "function");

  const cases = [
    {
      expected: true,
      label: "external issue",
      value: {
        actorType: "User",
        authorAssociation: "NONE",
        eventName: "issues",
        isPullRequest: false,
      },
    },
    {
      expected: true,
      label: "external comment on a team-created issue",
      value: {
        actorType: "User",
        authorAssociation: "CONTRIBUTOR",
        eventName: "issue_comment",
        isPullRequest: false,
      },
    },
    {
      expected: true,
      label: "outside collaborator",
      value: {
        actorType: "User",
        authorAssociation: "COLLABORATOR",
        eventName: "issue_comment",
        isPullRequest: false,
      },
    },
    {
      expected: false,
      label: "organization member",
      value: {
        actorType: "User",
        authorAssociation: "MEMBER",
        eventName: "issue_comment",
        isPullRequest: false,
      },
    },
    {
      expected: false,
      label: "repository owner",
      value: {
        actorType: "User",
        authorAssociation: "OWNER",
        eventName: "issues",
        isPullRequest: false,
      },
    },
    {
      expected: false,
      label: "bot",
      value: {
        actorType: "Bot",
        authorAssociation: "NONE",
        eventName: "issue_comment",
        isPullRequest: false,
      },
    },
    {
      expected: false,
      label: "pull request comment",
      value: {
        actorType: "User",
        authorAssociation: "NONE",
        eventName: "issue_comment",
        isPullRequest: true,
      },
    },
    {
      expected: true,
      label: "manual dispatch",
      value: {
        actorType: "",
        authorAssociation: "",
        eventName: "workflow_dispatch",
        isPullRequest: false,
      },
    },
  ];

  for (const { expected, label, value } of cases) {
    assert.equal(notifier.shouldNotifyActivity(value), expected, label);
  }
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

test("waitForLinearIssue retries after a comments fetch failure", async () => {
  const responses = [
    new Error("temporary GitHub API failure"),
    [
      {
        body: '<!-- linear-linkback -->\n<p><a href="https://linear.app/darkmatterlabs/issue/ENG-593">ENG-593</a></p>',
        user: { login: "linear-code[bot]" },
      },
    ],
  ];
  let calls = 0;
  let sleeps = 0;

  const result = await waitForLinearIssue({
    attempts: 3,
    fetchComments: async () => {
      const response = responses[calls++];
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    sleep: async () => {
      sleeps += 1;
    },
  });

  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
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
