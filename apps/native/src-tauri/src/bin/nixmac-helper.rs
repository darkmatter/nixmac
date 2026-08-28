#![allow(dead_code)]

mod privileged_helper {
    pub mod protocol {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/protocol.rs"
        ));
    }

    pub mod peer_auth {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/privileged_helper/peer_auth.rs"
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
