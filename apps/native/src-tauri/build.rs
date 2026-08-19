mod env_keys {
    #![allow(dead_code)]
    include!("src/env_keys.rs");
}

use std::path::Path;
use std::process::Command;

/// Embed `apps/native/env.{development,release,e2e}.json` selected by `NIXMAC_ENV`.
///
/// Accepted values must stay in sync with `apps/native/nixmac-profile.ts`.
/// Unset means development; anything else stops the build. Falling through to
/// the development profile is how a mistyped selector used to produce a build
/// that looked like a release but carried the development profile.
fn embed_build_profile() {
    let native_app_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let selector = std::env::var("NIXMAC_ENV").unwrap_or_else(|_| "development".to_string());
    let file = match selector.as_str() {
        "development" => "env.development.json",
        "production" => "env.release.json",
        "e2e" => "env.e2e.json",
        other => {
            panic!("NIXMAC_ENV must be unset or one of development, production, e2e; got {other:?}")
        }
    };
    let path = native_app_dir.join(file);

    println!("cargo:rerun-if-env-changed=NIXMAC_ENV");
    for name in ["env.development.json", "env.release.json", "env.e2e.json"] {
        println!(
            "cargo:rerun-if-changed={}",
            native_app_dir.join(name).display()
        );
    }

    // An unreadable or malformed profile stops the build. Degrading to "{}"
    // compiles an app whose every setting silently falls back to its default.
    let json = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    let value: serde_json::Value = serde_json::from_str(&json)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()));
    // The selector picks the file; the file names the same environment in its own
    // `NIXMAC_ENV` key. This embedded copy is what `crate::env::nixmac_env()`
    // resolves for telemetry and the startup log, so a profile mislabelled
    // `development` would have a release build report itself as a development
    // one. The frontend is baked from its own copy of the profile and makes the
    // same check there (`apps/native/nixmac-profile.ts`).
    let declared = value.get("NIXMAC_ENV");
    if declared.and_then(serde_json::Value::as_str) != Some(selector.as_str()) {
        panic!(
            "{} declares NIXMAC_ENV {}, but this build selected {selector:?}; the two must name the same environment",
            path.display(),
            declared.map_or_else(|| "no value at all".to_string(), ToString::to_string)
        );
    }

    let minified = serde_json::to_string(&value)
        .unwrap_or_else(|error| panic!("cannot re-encode {}: {error}", path.display()));
    println!("cargo:rustc-env=NIXMAC_ENV_PROFILE_JSON={minified}");
}

fn add_debug_swift_runtime_rpaths() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos")
        || std::env::var("PROFILE").as_deref() != Ok("debug")
    {
        return;
    }

    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");

    let Ok(output) = Command::new("xcrun")
        .args(["swift", "-print-target-info"])
        .output()
    else {
        return;
    };

    if !output.status.success() {
        return;
    }

    let Ok(target_info) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return;
    };

    let Some(paths) = target_info
        .pointer("/paths/runtimeLibraryPaths")
        .and_then(|value| value.as_array())
    else {
        return;
    };

    for path in paths.iter().filter_map(|value| value.as_str()) {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{path}");
    }
}

fn main() {
    embed_build_profile();
    add_debug_swift_runtime_rpaths();

    // Set up passthrough for relevant environment variables.
    // This allows configuration to be injected at build time (e.g. by CI)
    // or in development environments. Keys are defined in src/env_keys.rs.
    for key in env_keys::BUILD_EMBED_KEYS {
        println!("cargo:rerun-if-env-changed={key}");

        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    // Determine the version to embed. Prefer an explicit `NIXMAC_VERSION`
    // from the build environment (e.g. set by CI). If not present, fall
    // back to the Cargo package version, and finally to "unknown".
    let nixmac_version = std::env::var("NIXMAC_VERSION")
        .or_else(|_| std::env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=NIXMAC_VERSION={nixmac_version}");

    // Continue with the normal Tauri build
    tauri_build::build()
}
