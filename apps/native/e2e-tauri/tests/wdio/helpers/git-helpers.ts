// oxlint-disable no-unused-expressions
import { expect } from 'chai';

interface GitDiff {
  raw: string;
  files: Array<{ status: string; path: string }>;
}

function extractFileDiffContent(rawDiff: string, targetFilePath: string): string {
  const lines = rawDiff.split('\n');
  const fileDiffLines: string[] = [];
  let foundFile = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      line.startsWith('diff --git ') &&
      line.includes(targetFilePath)
    ) {
      foundFile = true;
    }

    if (foundFile) {
      fileDiffLines.push(line);

      if (
        fileDiffLines.length > 1 &&
        line.startsWith('diff --git ') &&
        !line.includes(targetFilePath)
      ) {
        fileDiffLines.pop();
        break;
      }
    }
  }

  return fileDiffLines.join('\n');
}

export function assertDiffContains(gitDiff: GitDiff, filePath: string, searchString: string): void {
  const fileDiffContent = extractFileDiffContent(gitDiff.raw, filePath);

  if (!fileDiffContent) {
    console.error('[wdio:test-env] Full git diff:\n' + (gitDiff.raw || '[no raw diff available]'));
    expect.fail(
      `Could not find diff section for file: ${filePath}. Available files: ${gitDiff.files.map((f) => f.path).join(', ')}`,
    );
  }

  try {
    expect(
      fileDiffContent.includes(searchString),
      `Expected diff for ${filePath} to contain "${searchString}"`,
    ).to.be.true;
  } catch (err) {
    console.error('[wdio:test-env] Assertion failed; full git diff:\n' + (gitDiff.raw || '[no raw diff available]'));
    throw err;
  }
}

export function assertDiffDoesNotContain(gitDiff: GitDiff, filePath: string, searchString: string): void {
  const fileDiffContent = extractFileDiffContent(gitDiff.raw, filePath);

  if (!fileDiffContent) {
    console.error('[wdio:test-env] Full git diff:\n' + (gitDiff.raw || '[no raw diff available]'));
    expect.fail(
      `Could not find diff section for file: ${filePath}. Available files: ${gitDiff.files.map((f) => f.path).join(', ')}`,
    );
  }

  try {
    expect(
      !fileDiffContent.includes(searchString),
      `Expected diff for ${filePath} to NOT contain "${searchString}"`,
    ).to.be.true;
  } catch (err) {
    console.error('[wdio:test-env] Assertion failed; full git diff:\n' + (gitDiff.raw || '[no raw diff available]'));
    throw err;
  }
}
