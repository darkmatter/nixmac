// oxlint-disable no-unused-expressions
import { expect } from 'chai';

function extractFileDiffContent(rawDiff, targetFilePath) {
  const lines = rawDiff.split('\n');
  const fileDiffLines = [];
  let foundFile = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Match unified diff file header lines like:
    // diff --git a/path/to/file b/path/to/file
    // +++ b/path/to/file
    if (
      line.startsWith('diff --git ') &&
      line.includes(targetFilePath)
    ) {
      foundFile = true;
    }

    if (foundFile) {
      fileDiffLines.push(line);

      // If we hit the next file header, stop collecting
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

export function assertDiffContains(gitDiff, filePath, searchString) {
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

export function assertDiffDoesNotContain(gitDiff, filePath, searchString) {
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
