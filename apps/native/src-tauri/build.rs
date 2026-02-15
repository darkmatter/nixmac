fn main() {
    // If `SENTRY_DSN` is provided in the build environment (set by CI),
    // expose it as a compile-time environment variable so it is embedded
    // into the binary via `env!` or `option_env!`.
    if let Ok(dsn) = std::env::var("SENTRY_DSN") {
        println!("cargo:rustc-env=SENTRY_DSN={}", dsn);
    }

    // If `NIXMAC_ENV` is provided in the build environment, embed it so the
    // binary can read it at compile time via `option_env!`.
    if let Ok(env) = std::env::var("NIXMAC_ENV") {
        println!("cargo:rustc-env=NIXMAC_ENV={}", env);
    }
    // Determine the version to embed. Prefer an explicit `NIXMAC_VERSION`
    // from the build environment (e.g. set by CI). If not present, fall
    // back to the Cargo package version, and finally to "unknown".
    let nixmac_version = std::env::var("NIXMAC_VERSION")
        .or_else(|_| std::env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=NIXMAC_VERSION={}", nixmac_version);

    // Continue with the normal Tauri build
    tauri_build::build()
}
