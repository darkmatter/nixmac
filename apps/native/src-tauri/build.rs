fn main() {
    // If `SENTRY_DSN` is provided in the build environment (set by CI),
    // expose it as a compile-time environment variable so it is embedded
    // into the binary via `env!` or `option_env!`.
    if let Ok(dsn) = std::env::var("SENTRY_DSN") {
        println!("cargo:rustc-env=SENTRY_DSN={}", dsn);
    }

    // Continue with the normal Tauri build
    tauri_build::build()
}
