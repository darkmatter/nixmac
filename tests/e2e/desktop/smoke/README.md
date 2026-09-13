# Nix Mac smoke helpers

These Python 3 programs belong to Nix Mac. The desktop testing CLI installs an
exact verified app build, prepares a disposable Mac guest, and drives the GUI
with its native exploration agent. These helpers provision inference and verify
the resulting product behavior. They do not substitute a provider, a Nix build,
privileged activation, or an app command.

The smoke completes onboarding and one evolution through **Build & Test** and
**Commit**. It leaves the configuration and running app in place for the report.
There is no history restore or offboarding. The desktop runtime can release the
disposable VM after evidence collection.

## Invocation contract

Stage all four runtime files together outside the run directory, for example
`/tmp/nixmac-smoke-tools/`. Run each command as the logged-in guest user. The
programs need Python 3, Git, the installed native app, real Nix, and a desktop
session. Bootstrap and launch require the app to be stopped.

```sh
python3 /tmp/nixmac-smoke-tools/bootstrap.py \
  --provider openrouter --model YOUR_PROVIDER_MODEL_ID
```

Providers are `openai`, `openrouter`, and `vllm`. For `vllm`, also pass
`--base-url https://YOUR_GATEWAY/v1`; the app's actual provider ID is
`openai_compatible`. URLs cannot contain credentials, query strings, or
fragments. Model selection is explicit; no model availability is assumed.

Bootstrap creates `/tmp/nixmac-smoke` with mode `0700`, plus fresh files beneath
`~/Library/Application Support/com.darkmatter.nixmac/`. It rejects an existing
smoke run, configuration destination, completed onboarding, or prior build. It
sets provider/model preferences and `loginDecided: true`; the report explicitly
says inference was provisioned and its UI entry was not tested. Completion,
scan decision, and build timestamps stay null. An existing valid
`helperPreference` is preserved; helper authorization is never fabricated.

Deliver the provider credential separately as the logged-in guest user's
regular, single-link file `/tmp/nixmac-smoke/provider-key`, mode `0600`, then:

```sh
python3 /tmp/nixmac-smoke-tools/launch.py
```

The token is never a command argument or JSON field. Launch reads it privately,
starts `/Applications/nixmac.app/Contents/MacOS/nixmac` with the appropriate
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or `VLLM_API_KEY` environment variable,
then removes the token file. It keeps only a small allowlist of inherited
environment variables, preventing inherited mock/test/system overrides.
The credential-bearing app environment must not be included in diagnostics.
`private-app.log` is mode `0600` and is **not an artifact**: app logs may contain
provider or user content. An uncertain launch must not be replayed in that VM.

Read `mission.json` for the exact host, configuration destination, prompt, and
nonsecret provider choice. Through the actual GUI:

1. Choose **Start from scratch**, name the Mac `desktop-test-mac`, and use the
   mission's `configDir` (`~/nixmac-smoke-config`, expanded to an absolute path).
2. Select **Create my configuration**, then **Skip** on Import Customizations.
   Inference was provisioned before launch, so proceed to First Build.
3. Select **Run build**, complete real activation, and select **Open nixmac**.
4. Invoke the trusted checkpoint hook before submitting any evolution:

   ```sh
   python3 /tmp/nixmac-smoke-tools/verify.py --checkpoint
   ```

5. Submit `mission.prompt` exactly. It requests only `ripgrep` in
   `environment.systemPackages`. Observe the real review, choose **Build &
   Test**, confirm when requested, then **Commit**.
6. Invoke the final verifier:

   ```sh
   python3 /tmp/nixmac-smoke-tools/verify.py
   ```

Each invocation prints one sanitized JSON object. Exit `0` means that helper's
specific stage passed; exit `1` means it could not verify the stage. Bootstrap
and launch success alone do not mean the product smoke passed. Native GUI
observations, screenshots, continuous video and live app attestation remain the
desktop runtime's responsibility.

## What the verifier establishes

The checkpoint requires fresh app-written onboarding timestamps, no previous
evolution, a clean committed configuration, and an app build record matching
the real active `/nix/var/nix/profiles/system` store. `ripgrep` must initially be
absent from both the configuration and that system's executable set.
If exporting that receipt fails, repeating the checkpoint revalidates the live
state and returns the original receipt only while the mission, commit, active
store and build metadata still match. It preserves the original checkpoint
time and never replaces a different checkpoint.

Final verification requires exactly one successful app evolution with the
expected prompt, fresh metadata, recorded provider tokens, a successful edit
tool and build check, one new clean commit adding the requested Nix package,
and a subsequent activated store containing a working `rg`. The app's build
record must identify that exact store and final Git HEAD. A narration-only
result, a reached model limit, an uncommitted edit, a stale build, or a
package merely available from Homebrew cannot satisfy these checks.

The implementation reads current and v0.33.1-compatible JSON representations:
`settings.json.evolveMetadata` may contain a JSON string or object; the
`build-state.json` wrapper is `buildState`. It avoids the incompatible SQLite
schemas. It does not require `evolve-state.json` to retain a committed session:
the real Commit action clears that slice.

Safe retained JSON files are `mission.json`, `launch.json`,
`onboarding-checkpoint.json`, and `verification.json`. Do not retain raw
`settings.json`, API credentials, process environment, or `private-app.log`.
The verifier emits selected counts and timestamps, commit IDs, a diff hash,
store paths and package version. It omits provider messages, arguments and
arbitrary app fields.

## Prerequisites and limits

The build needs network access to the actual Nix inputs/caches and sufficient
disk/time. The prepared VM must support genuine privileged activation. Release
v0.33.1 uses its authorized helper when available and otherwise requests an
administrator credential through macOS. Passwordless `sudo` does not replace
that app authorization path. Expected privilege setup must be resolved through
supported preparation or explicit authorized interaction; a blocked prompt is
a failed smoke, not permission to mock activation.

The verifier establishes the defined outcome rather than claiming every UI
frame or every unchanged Nix setting was inspected. Its package-only scope
check bounds changed files to Nix source; reviewing the actual diff and GUI
evidence remains part of the report. Fresh-build acceptance against another
release still requires running this journey on that exact binary.

Run the portable fixture tests with:

```sh
python3 -m unittest discover -s tests/e2e/desktop/smoke -p 'test_smoke.py' -v
```

These tests exercise real temporary files, processes, Git and profile symlinks
to check evidence acceptance and rejection. They do not claim to have run
macOS, the provider, or Nix activation.
