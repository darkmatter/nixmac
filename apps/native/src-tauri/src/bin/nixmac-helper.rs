#![allow(dead_code)]

mod system {
    pub mod nix {
        pub fn get_nix_path() -> String {
            std::env::var("PATH").unwrap_or_else(|_| {
                "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
            })
        }
    }
}

mod privileged_helper {
    pub mod protocol {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/protocol.rs"
        ));
    }

    pub mod helper_runtime {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/helper_runtime.rs"
        ));
    }
}

fn main() {
    if let Err(error) = privileged_helper::helper_runtime::run_daemon() {
        eprintln!("nixmac-helper failed: {error:#}");
        std::process::exit(1);
    }
}
