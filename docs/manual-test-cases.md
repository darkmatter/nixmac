# Manual Test Cases

Please use these scripts while following the tests:

- **`./docs/testscripts/check-state.sh`** — show both state files in the terminal and copy them to clipboard
- **`echo $TEST1; echo $TEST2; echo $TEST3`** — run in a **new** terminal **outside** the devenv shell

Outside the repo, check state with:
```bash
{ echo '```javascript'; echo "// evolve-state.json"; cat ~/Library/Application\ Support/com.darkmatter.nixmac/evolve-state.json; echo; echo '```'; echo; echo '```javascript'; echo "// build-state.json"; cat ~/Library/Application\ Support/com.darkmatter.nixmac/build-state.json; echo; echo '```'; } | tee >(pbcopy)
```
______________________________________________________________________

## 1. Manual changes

### Step 1: A manual edit surfaces

**Steps:**

1. In your config dir, type `git status`
1. In a terminal **outside the nixmac dir**, run `echo $TEST1; echo $TEST2; echo $TEST3`
1. Open your nix config and add `environment.variables.TEST1 = "success";`

**Expected:**

- repo says: "nothing to commit, working tree clean" make sure your repo is clean otherwise
- echo prints three empty lines, or you need to rebuild without these env vars in your config:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3



➜  ~
```

- Widget transitions to **Manual Changes** step
- The change is visible in diffs

______________________________________________________________________

### Step 2: Build a manual change

**Steps:**

1. Click **Build**
1. After build completes, open a terminal **outside the nixmac dir** and run `echo $TEST1; echo $TEST2; echo $TEST3`

**Expected:**

- The build overlay appears
- TEST1 prints `success`, TEST2 and TEST3 are empty:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3
success


➜  ~
```

______________________________________________________________________

### Step 3: Summarize

**Steps:**

1. Click **Summarize**

**Expected:**

- The change is summarized in the widget

______________________________________________________________________

### Step 4: Roll back your build

**Steps:**

1. Click **Undo last build** in the widget
1. After rollback completes, open a terminal **outside the nixmac dir** and run `echo $TEST1; echo $TEST2; echo $TEST3`

**Expected:**

- The activation overlay appears
- All three vars print empty lines:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3



➜  ~
```

- The repo state is not changed, but you are no longer on the commit step.

______________________________________________________________________

### Step 5: Undo the config edit manually

**Steps:**

1. Run `git restore .` in your config directory

**Expected:**

- Widget transitions back to **Begin** step

______________________________________________________________________

### Step 6: Readd the change and another one

**Steps:**

1. `Control+z` in the file or simply re-add `environment.variables.TEST1 = "success";`
1. Also add a line to `README.md` describing the variable, e.g. `TEST1: set to "success" for testing`
1. Press summarize again

**Expected:**

- Widget transitions back to **Manual Changes** step
- Existing summary is shown
- Unsummarize changes detected is also shown
- Once summarized, the two items are are shown (extra happy if categorized together)
- Two diffs are shown

### Step 7: Close and reopen the app

**Steps:**

1. Quit the app and reopen it

**Expected:**

- Widget opens directly on **Manual Changes** step with your changes summarized

______________________________________________________________________

### Step 8: Build, Commit and check history

**Steps:**

1. Click **Build and Test** again, then **Commit**
1. Open the **History** tab

**Expected:**

- Something like `feat(env): add TEST1 environment variable and update documentation` show in commit
- Toast shows "Committed Succesfully" in a green box
- The commit appears at the top of history marked **[current]**

______________________________________________________________________

## 2. Continue with some AI changes in the mix

### Step 1: Add another testable environment variable

**Steps:**

1. In your config dir run `git reset HEAD~1`
1. Run `./docs/testscripts/check-state.sh` to verify initial state
1. Write a prompt like: add an environment variable called TEST2 with a value of "success"
1. Run the prompt
1. Run `./docs/testscripts/check-state.sh` to check state after evolve

**Expected:**

- Summarized changes and diffs shown again
- State before evolve:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": null,
    "committable": false,
    "currentChangesetId": null,
    "evolutionId": null,
    "rollbackBranch": null,
    "rollbackChangesetId": null,
    "rollbackStorePath": null,
    "step": "manualEvolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776350830,
    "changesetId": null,
    "currentNixStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "headCommitHash": "5c515433b4e820dc379c28fc09b205b32cc75012",
    "nixmacBuiltStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4"
  }
}
```

- Evolve overlay shows up and closes (on success)
- The summary is updated with the change
- The state file shows an evolutionId
- A discard button appears
- State after evolve:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution29-changeset0",
    "committable": false,
    "currentChangesetId": 97,
    "evolutionId": 29,
    "rollbackBranch": "nixmac-evolve/evolution29-changeset0",// I hold the snapshot taken right before evolution started making changes
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4", // I am the last built thing before AI was prompted
    "step": "evolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776350830,
    "changesetId": null,
    "currentNixStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "headCommitHash": "5c515433b4e820dc379c28fc09b205b32cc75012",
    "nixmacBuiltStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4"
  }
}
```

______________________________________________________________________

### Step 2: Discard the AI changes

**Steps:**

1. Click **Discard** in the widget
1. Run `./docs/testscripts/check-state.sh` to verify state after discard

**Expected:**

- Only the AI change is discarded
- The evolve-state.json is reset again
- State after discard:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": null,
    "committable": false,
    "currentChangesetId": null,
    "evolutionId": null,
    "rollbackBranch": null,
    "rollbackChangesetId": null,
    "rollbackStorePath": null,
    "step": "manualEvolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776350830,
    "changesetId": null,
    "currentNixStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "headCommitHash": "5c515433b4e820dc379c28fc09b205b32cc75012",
    "nixmacBuiltStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4"
  }
}
```

______________________________________________________________________

### Step 3: Reprompt and Build this time

**Steps:**

1. From **My History** under the input, select: add an environment variable called TEST2 with a value of "success"
1. Run the prompt
1. Run `./docs/testscripts/check-state.sh` to check state after evolve
1. Press **Build and Test**
1. Run `./docs/testscripts/check-state.sh` to check state after build
1. After build completes, open a terminal **outside the nixmac dir** and run `echo $TEST1; echo $TEST2; echo $TEST3`

**Expected:**

- More or less the same result (summarization likely instant)
- State after evolve:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution30-changeset0",
    "committable": false,
    "currentChangesetId": 97, // I am still the same (if the AI put the edit in the same place)
    "evolutionId": 30, // incremented from last evolution, we undid that one when we discarded
    "rollbackBranch": "nixmac-evolve/evolution30-changeset0",
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "step": "evolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776350830,
    "changesetId": null,
    "currentNixStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "headCommitHash": "5c515433b4e820dc379c28fc09b205b32cc75012",
    "nixmacBuiltStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4"
  }
}
```

- After build, TEST1 and TEST2 print `success`, TEST3 is empty:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3
success
success

➜  ~
```

- State after build:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution30-changeset0",
    "committable": true,
    "currentChangesetId": 97,
    "evolutionId": 30,
    "rollbackBranch": "nixmac-evolve/evolution30-changeset0",
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4", // I am still the same
    "step": "commit"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776351699,
    "changesetId": 98,
    "currentNixStorePath": "/nix/store/64ci53xsnri9x7k4w09iv9k4ac7m1ks4-darwin-system-26.05.06648f4", // I am now different
    "headCommitHash": "215bd098633e2e29a2469e16ee96e27c6cddca64",
    "nixmacBuiltStorePath": "/nix/store/64ci53xsnri9x7k4w09iv9k4ac7m1ks4-darwin-system-26.05.06648f4" // Me too
  }
}
```

______________________________________________________________________

### Step 4: Continue editing

**Steps:**

1. Press continue editing
1. Write an unrelated simple prompt like: add a cool font
1. Run the prompt
1. Run `./docs/testscripts/check-state.sh` to check state after evolve
1. Press **Build and Test**
1. Run `./docs/testscripts/check-state.sh` to check state after build

**Expected:**

- The evolve succeeds, and a new change appears in a new category
- State after evolve:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution30-changeset97", // on 2nd, 3d .. AI evolve, I reference changesets, if one prompt / evolve fails, this restores
    "committable": false,
    "currentChangesetId": 99,
    "evolutionId": 30,
    "rollbackBranch": "nixmac-evolve/evolution30-changeset0", // rollback stays where it was, it undoes post-AI everything
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "step": "evolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776351699,
    "changesetId": 98,
    "currentNixStorePath": "/nix/store/64ci53xsnri9x7k4w09iv9k4ac7m1ks4-darwin-system-26.05.06648f4",
    "headCommitHash": "215bd098633e2e29a2469e16ee96e27c6cddca64",
    "nixmacBuiltStorePath": "/nix/store/64ci53xsnri9x7k4w09iv9k4ac7m1ks4-darwin-system-26.05.06648f4"
  }
}
```

- You are back at build step when evolve completes
- You see a commit message after build completes
- State after build:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution30-changeset97",
    "committable": true,
    "currentChangesetId": 99,
    "evolutionId": 30,
    "rollbackBranch": "nixmac-evolve/evolution30-changeset0",
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "step": "commit"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776352144,
    "changesetId": 100,
    "currentNixStorePath": "/nix/store/y9fbz74b1mskcvpwj56ncd2raxqqz9jy-darwin-system-26.05.06648f4",
    "headCommitHash": "215bd098633e2e29a2469e16ee96e27c6cddca64",
    "nixmacBuiltStorePath": "/nix/store/y9fbz74b1mskcvpwj56ncd2raxqqz9jy-darwin-system-26.05.06648f4"
  }
}
```

______________________________________________________________________

### Step 5: Add a manual change after build

**Steps:**

1. Add `environment.variables.TEST3 = "success";` to your config somewhere
1. Press **Build and Test**
1. After build completes, open a terminal **outside the nixmac dir** and run `echo $TEST1; echo $TEST2; echo $TEST3`

**Expected:**

- You move to the build step
- You arrive back at commit after build
- All three vars print `success`:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3
success
success
success
➜  ~
```

- State after build:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": "nixmac-evolve/evolution30-changeset97",
    "committable": true,
    "currentChangesetId": 99,
    "evolutionId": 30,
    "rollbackBranch": "nixmac-evolve/evolution30-changeset0",
    "rollbackChangesetId": null,
    "rollbackStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4",
    "step": "commit"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776352304,
    "changesetId": 101,
    "currentNixStorePath": "/nix/store/gi1di5gslpyqvxfclb72clccaavz0mjc-darwin-system-26.05.06648f4", // we changed again
    "headCommitHash": "215bd098633e2e29a2469e16ee96e27c6cddca64",
    "nixmacBuiltStorePath": "/nix/store/gi1di5gslpyqvxfclb72clccaavz0mjc-darwin-system-26.05.06648f4"
  }
}
```

______________________________________________________________________

### Step 6: Undo all

**Steps:**

1. Click **Undo all**
1. After rollback completes, open a terminal **outside the nixmac dir** and run `echo $TEST1; echo $TEST2; echo $TEST3`

**Expected:**

- Back on manual changes
- TEST1 prints `success`, TEST2 and TEST3 are empty:

```bash
➜  ~ echo $TEST1; echo $TEST2; echo $TEST3
success


➜  ~
```
- this means everything done since the first AI prompt got rolled back
- this is what the AI evolution UI allows for now, but the plumbing for smaller steps is in place

- State after undo all:

```javascript
// evolve-state.json
{
  "evolveState": {
    "backupBranch": null,
    "committable": false,
    "currentChangesetId": null,
    "evolutionId": null,
    "rollbackBranch": null,
    "rollbackChangesetId": null,
    "rollbackStorePath": null,
    "step": "manualEvolve"
  }
}
```

```javascript
// build-state.json
{
  "buildState": {
    "builtAt": 1776352374,
    "changesetId": null,
    "currentNixStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4", // we are right where we back here
    "headCommitHash": "215bd098633e2e29a2469e16ee96e27c6cddca64",
    "nixmacBuiltStorePath": "/nix/store/xbqcqrjk4hca78g4dvqw4mb6m7fsarby-darwin-system-26.05.06648f4"
  }
}
```

______________________________________________________________________

------ TEMPLATE ------

### Step X:

**Steps:**
1\.

## **Expected:**

______________________________________________________________________
