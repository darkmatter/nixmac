// oxlint-disable no-unused-expressions
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'chai';
import { getConfigRepoDir } from './helpers/config-repo.js';
import {
  activateDiffTab,
  clickHunkPill,
  expandDiffRow,
  getDiffRow,
  getHunkPills,
  refreshGitStatus,
  waitForScrollChange,
} from './helpers/diff-row-ui.js';

describe('manual changes diff display', () => {
  it('renders manual changes correctly across change types', async () => {
    const repoDir = await getConfigRepoDir();

    const newFileRel = 'hosts/manual-new.nix';
    const removedFileRel = 'modules/darwin/sops.nix';
    const editedFileRel = 'flake.nix';
    const renameOldRel = 'modules/darwin/networking.nix';
    const renameNewRel = 'modules/networking.nix';

    await mkdir(path.join(repoDir, 'hosts'), { recursive: true });
    await writeFile(
      path.join(repoDir, newFileRel),
      '{ ... }: { /* manual-new placeholder */ }\n',
      'utf-8',
    );

    await rm(path.join(repoDir, removedFileRel));

    const editedAbs = path.join(repoDir, editedFileRel);
    const original = await readFile(editedAbs, 'utf-8');
    const lines = original.split('\n');
    lines[29] = `${lines[29]} # edit hunk A`;
    lines[94] = `${lines[94]} # edit hunk B`;
    await writeFile(editedAbs, lines.join('\n'), 'utf-8');

    await mkdir(path.dirname(path.join(repoDir, renameNewRel)), { recursive: true });
    await rename(path.join(repoDir, renameOldRel), path.join(repoDir, renameNewRel));

    await refreshGitStatus();
    await activateDiffTab();

    await expandDiffRow(newFileRel, 'monaco-file-view');

    const removedRow = await getDiffRow(removedFileRel);
    expect(
      await removedRow.$('button[title="Edit file"]').isExisting(),
      'removed file row should not expose an edit pencil',
    ).to.equal(false);

    const pills = await getHunkPills(editedFileRel);
    expect(pills.length, 'edited file should expose one pill per hunk').to.equal(2);

    // Rename across dirs with same basename: today the Diff tab does not
    // collapse the pair, so both rows should be present.
    await getDiffRow(renameNewRel);
    await getDiffRow(renameOldRel);
  });

  it('hunk pill scrolls to its change', async () => {
    const editedFileRel = 'flake.nix';
    await expandDiffRow(editedFileRel);

    const scrolledToHunkA = await waitForScrollChange(editedFileRel, 0);
    expect(scrolledToHunkA, 'editor should scroll to hunk A on open').to.be.greaterThan(0);

    await clickHunkPill(editedFileRel, 1);

    const scrolledToHunkB = await waitForScrollChange(editedFileRel, scrolledToHunkA);
    expect(
      scrolledToHunkB,
      'clicking hunk B pill should scroll further down',
    ).to.be.greaterThan(scrolledToHunkA);
  });
});
