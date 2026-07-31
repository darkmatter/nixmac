// Build identity, shared between `build.rs` (which resolves the
// `NIXMAC_BUILD_ID` build input and embeds the result) and the crate (whose
// tests pin the resolution table).
//
// The value exists only to identify a build. The GUI, the helper, and the sync
// agent of one build compile in the same string, and two builds match only
// when the strings are byte-equal. Packaged builds normally supply a Git
// commit, but nothing here — or on the wire — requires or validates Git
// syntax.

/// Literal used when a development build (`NIXMAC_ENV` unset or anything but
/// `production`) supplies no build ID. Development rebuilds therefore share one
/// identity; developers swap helpers with the explicit Disable/Grant workflow.
pub const DEVELOPMENT_BUILD_ID: &str = "development";

/// Resolves the `NIXMAC_BUILD_ID` build input.
///
/// A supplied identifier is taken byte-for-byte — no trimming, parsing, length
/// rule, or character validation — because equality is the only operation
/// performed on it anywhere. What is enforced is that no binary silently
/// embeds an empty ID: packaged builds (`NIXMAC_ENV` = `production`, not the
/// cargo profile, which is `release` even for local sidecar builds) fail when
/// the value is missing or empty, and development builds fall back to the one
/// fixed [`DEVELOPMENT_BUILD_ID`] literal.
pub fn resolve_build_id(raw: Option<&str>, packaged: bool) -> Result<String, String> {
    match raw.filter(|value| !value.is_empty()) {
        Some(value) => Ok(value.to_string()),
        None if packaged => Err(
            "NIXMAC_BUILD_ID must be a non-empty value for packaged builds (NIXMAC_ENV=production); CI supplies it from the packaged source revision"
                .to_string(),
        ),
        None => Ok(DEVELOPMENT_BUILD_ID.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_supplied_build_id_is_embedded_byte_for_byte() {
        // The protocol only ever compares these strings for equality, so no
        // shape is rejected: a Git commit, an abbreviation, uppercase, and a
        // value that is not a commit at all are all embedded unchanged.
        for supplied in [
            "0123456789abcdef0123456789abcdef01234567",
            "0123456",
            "0123456789ABCDEF0123456789ABCDEF01234567",
            "not-a-commit",
            " padded ",
            "release-2026.07.31+1",
        ] {
            for packaged in [true, false] {
                assert_eq!(
                    resolve_build_id(Some(supplied), packaged).unwrap(),
                    supplied,
                    "packaged: {packaged}"
                );
            }
        }
    }

    #[test]
    fn a_packaged_build_fails_without_a_build_id() {
        // Never silently embed an empty identity into a shipped binary.
        assert!(resolve_build_id(None, true).is_err());
        assert!(resolve_build_id(Some(""), true).is_err());
    }

    #[test]
    fn a_development_build_falls_back_to_the_fixed_literal() {
        assert_eq!(resolve_build_id(None, false).unwrap(), DEVELOPMENT_BUILD_ID);
        assert_eq!(
            resolve_build_id(Some(""), false).unwrap(),
            DEVELOPMENT_BUILD_ID
        );
    }

    #[test]
    fn the_development_fallback_is_never_empty() {
        // An empty build ID would compare unequal to every peer's, including
        // another binary of the same build.
        assert!(!DEVELOPMENT_BUILD_ID.is_empty());
    }
}
