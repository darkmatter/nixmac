import { fileURLToPath } from "node:url";

const GITHUB_API_URL = "https://api.github.com";
const LINEAR_BACKLINK_ATTEMPTS = 20;
const LINEAR_BACKLINK_INTERVAL_MS = 3_000;
const LINEAR_ISSUE_URL =
  /https:\/\/linear\.app\/[A-Za-z0-9_-]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/[A-Za-z0-9-]+)?/i;

function escapeSlackText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Request to ${url} failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

export function extractLinearIssueLink(comments) {
  for (const comment of comments) {
    if (comment.user?.login !== "linear-code[bot]") {
      continue;
    }

    const match = comment.body?.match(LINEAR_ISSUE_URL);
    if (match) {
      return {
        identifier: match[1].toUpperCase(),
        url: match[0],
      };
    }
  }

  return null;
}

export function buildSlackMessage(githubIssue, linearIssue) {
  const title = escapeSlackText(githubIssue.title);
  const author = escapeSlackText(githubIssue.user.login);

  return {
    text: [
      `New GitHub issue #${githubIssue.number}: ${title}`,
      `GitHub: ${githubIssue.html_url}`,
      `Linear ${linearIssue.identifier}: ${linearIssue.url}`,
    ].join("\n"),
    unfurl_links: false,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New GitHub issue #${githubIssue.number}*\n${title}\nOpened by <${githubIssue.user.html_url}|@${author}>`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*GitHub:* <${githubIssue.html_url}|#${githubIssue.number}>  |  *Linear:* <${linearIssue.url}|${linearIssue.identifier}>`,
          },
        ],
      },
    ],
  };
}

export async function postSlackWebhook(webhookUrl, message, fetchImpl = fetch) {
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(message),
  });
  const responseBody = await response.text();

  if (!response.ok || responseBody !== "ok") {
    throw new Error(
      `Slack rejected the notification (${response.status}): ${responseBody}`,
    );
  }
}

export async function waitForLinearIssue({
  fetchComments,
  attempts = LINEAR_BACKLINK_ATTEMPTS,
  intervalMs = LINEAR_BACKLINK_INTERVAL_MS,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const linearIssue = extractLinearIssueLink(await fetchComments());
    if (linearIssue) {
      return linearIssue;
    }

    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `Linear backlink did not appear after ${attempts} attempts; Slack notification was not sent`,
  );
}

async function main() {
  const githubToken = requiredEnvironment("GITHUB_TOKEN");
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const issueNumber = requiredEnvironment("ISSUE_NUMBER");
  const slackWebhookUrl = requiredEnvironment("SLACK_WEBHOOK_URL");
  const githubHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const issue = await requestJson(
    `${GITHUB_API_URL}/repos/${repository}/issues/${issueNumber}`,
    { headers: githubHeaders },
  );
  const linearIssue = await waitForLinearIssue({
    fetchComments: () =>
      requestJson(
        `${GITHUB_API_URL}/repos/${repository}/issues/${issueNumber}/comments?per_page=100`,
        { headers: githubHeaders },
      ),
  });
  const slackMessage = buildSlackMessage(issue, linearIssue);
  await postSlackWebhook(slackWebhookUrl, slackMessage);

  console.log(
    `Posted GitHub issue #${issue.number} and Linear issue ${linearIssue.identifier} to Slack`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
