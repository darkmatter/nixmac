import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { analyzeReportVisualProofs } from './visual-analysis.mjs';

const execFileAsync = promisify(execFile);

async function assertFileExists(filePath) {
  await access(filePath);
}

async function createSyntheticVideo(videoPath) {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=white:s=320x180:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x180:d=1',
      '-filter_complex',
      '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p',
      '-movflags',
      '+faststart',
      videoPath,
    ],
    { timeout: 30000 },
  );
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nixmac-visual-analysis-'));
  const artifactRoot = path.join(tempRoot, 'artifacts');
  const artifactDir = path.join(artifactRoot, 'visual_self_test');
  await mkdir(artifactDir, { recursive: true });

  try {
    const videoPath = path.join(artifactDir, 'recording.mp4');
    await createSyntheticVideo(videoPath);

    const proof = {
      kind: 'video',
      path: 'visual_self_test/recording.mp4',
      url: null,
      thumbnailUrl: null,
      timestampMs: null,
      phase: 'synthetic visual changes',
      caption: 'Synthetic visual analysis recording',
      isPrimary: true,
      isFailureProof: false,
    };
    const report = {
      schemaVersion: 1,
      repo: 'darkmatter/nixmac',
      prNumber: null,
      headSha: 'synthetic',
      baseSha: null,
      workflowRunId: null,
      attempt: null,
      lane: 'tauri-wdio',
      scenario: 'visual_self_test',
      runnerId: 'local',
      runnerKind: 'local',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 3000,
      status: 'passed',
      htmlReportUrl: null,
      primaryProofUrl: proof.path,
      failureProofUrl: null,
      failureScreenshotUrl: null,
      failureVideoUrl: null,
      replayCommand: 'node e2e-tauri/scripts/visual-analysis-self-test.mjs',
      localReproCommand: 'node e2e-tauri/scripts/visual-analysis-self-test.mjs',
      captureLimitations: [],
      phases: [
        {
          name: 'synthetic visual changes',
          status: 'passed',
          startedAt: null,
          finishedAt: null,
          durationMs: 3000,
          assertions: ['Visual analyzer extracts meaningful frames'],
          proof: [{ ...proof }],
          error: null,
        },
      ],
      proof: [proof],
    };

    const { report: analyzed } = await analyzeReportVisualProofs(report, {
      artifactRoot,
      artifactDir,
    });
    const analysis = analyzed.proof[0]?.visualAnalysis;
    if (analysis?.status !== 'completed') {
      throw new Error(`Expected completed visual analysis, got ${JSON.stringify(analysis)}`);
    }
    if ((analysis.frames ?? []).length < 2) {
      throw new Error(`Expected at least 2 unique frames, got ${analysis.frames?.length ?? 0}`);
    }
    for (const frame of analysis.frames) {
      await assertFileExists(path.join(artifactRoot, frame.path));
    }
    if (!analyzed.phases[0].proof[0].visualAnalysis) {
      throw new Error('Expected visual analysis to be synced onto phase proof entry');
    }

    await writeFile(
      path.join(artifactDir, 'e2e-report.json'),
      `${JSON.stringify(analyzed, null, 2)}\n`,
      'utf-8',
    );
    console.log(`Visual analysis self-test passed: ${analysis.frames.length} frames`);
  } finally {
    if (process.env.NIXMAC_E2E_KEEP_VISUAL_SELF_TEST !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

await main();
