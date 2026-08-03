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

/// Info.plist key carrying the build ID of the bundle **on disk**.
///
/// A running GUI compares its own compiled build ID against this key read from
/// the bundle it would register, which is how it notices that its bundle was
/// replaced underneath it. The value is the same string that is compiled in —
/// one build, one identity — and is opaque: no syntax, no length rule.
pub const BUNDLE_BUILD_ID_KEY: &str = "NixmacBuildId";

/// Tracked plist whose keys the bundle's Info.plist inherits, relative to the
/// crate directory. Named away from `Info.plist` so the bundler does not also
/// merge it by convention: the stamped copy below is the one merged, and it
/// carries every key from here, so one file reaches the bundle rather than two
/// that could disagree.
pub const INFO_PLIST_TEMPLATE_PATH: &str = "Info.template.plist";

/// Where the build writes the stamped copy of [`INFO_PLIST_TEMPLATE_PATH`],
/// relative to the crate directory. Generated output, hence under the ignored
/// `gen/` directory, and it must stay equal to `bundle.macOS.infoPlist` in
/// `tauri.conf.json` — a test pins that, because a bundle whose Info.plist
/// carries no stamp would make every GUI consider itself displaced.
pub const STAMPED_INFO_PLIST_PATH: &str = "gen/Info.stamped.plist";

/// The `Info.plist` inside an installed `.app`. Fixed by macOS, unlike the
/// repository paths above, which are this project's choice.
pub const BUNDLE_INFO_PLIST_PATH: &str = "Contents/Info.plist";

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

/// Writes `template`'s keys plus the [`BUNDLE_BUILD_ID_KEY`] stamp to
/// `destination`. Called from `build.rs` with the same resolved build ID that
/// is compiled into the binaries, so the stamp and the compiled constant can
/// never disagree for one build.
///
/// The file is left untouched when its contents would not change, so a rebuild
/// that resolves the same build ID does not perturb the bundler's inputs.
pub fn write_stamped_info_plist(
    template: &std::path::Path,
    destination: &std::path::Path,
    build_id: &str,
) -> Result<(), String> {
    let mut keys = match plist::Value::from_file(template) {
        Ok(plist::Value::Dictionary(keys)) => keys,
        Ok(_) => return Err(format!("{} is not a plist dictionary", template.display())),
        Err(error) => return Err(format!("cannot read {}: {error}", template.display())),
    };
    keys.insert(
        BUNDLE_BUILD_ID_KEY.to_string(),
        plist::Value::String(build_id.to_string()),
    );

    let mut stamped = Vec::new();
    plist::to_writer_xml(&mut stamped, &plist::Value::Dictionary(keys))
        .map_err(|error| format!("cannot serialize the stamped Info.plist: {error}"))?;
    if std::fs::read(destination).is_ok_and(|current| current == stamped) {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    std::fs::write(destination, &stamped)
        .map_err(|error| format!("cannot write {}: {error}", destination.display()))
}

/// Reads the build ID stamped into an installed bundle's `Info.plist`.
///
/// Caller-less for now: the consumer is the GUI's helper reconciliation, which
/// compares this against [`crate::privileged_helper::protocol::BUILD_ID`]
/// before it mutates anything. It lives beside the writer so the two can never
/// disagree about the key or the format.
///
/// `bundle` is a `.app` directory. Every failure — no bundle, no plist, no
/// stamp, a stamp that is not a string, or an empty stamp — is an error the
/// caller reports as such. It must never be flattened into an empty string:
/// that would compare unequal to the compiled build ID forever and freeze
/// every decision that consults it.
pub fn read_bundle_build_id(bundle: &std::path::Path) -> Result<String, String> {
    read_stamped_build_id(&bundle.join(BUNDLE_INFO_PLIST_PATH))
}

/// [`read_bundle_build_id`] against an explicit plist path.
pub fn read_stamped_build_id(info_plist: &std::path::Path) -> Result<String, String> {
    let keys = match plist::Value::from_file(info_plist) {
        Ok(plist::Value::Dictionary(keys)) => keys,
        Ok(_) => {
            return Err(format!(
                "{} is not a plist dictionary",
                info_plist.display()
            ));
        }
        Err(error) => return Err(format!("cannot read {}: {error}", info_plist.display())),
    };
    match keys.get(BUNDLE_BUILD_ID_KEY).map(plist::Value::as_string) {
        Some(Some(stamp)) if !stamp.is_empty() => Ok(stamp.to_string()),
        Some(Some(_)) => Err(format!(
            "{} carries an empty {BUNDLE_BUILD_ID_KEY}",
            info_plist.display()
        )),
        Some(None) => Err(format!(
            "{} carries a non-string {BUNDLE_BUILD_ID_KEY}",
            info_plist.display()
        )),
        None => Err(format!(
            "{} carries no {BUNDLE_BUILD_ID_KEY}",
            info_plist.display()
        )),
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

    fn crate_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn write_plist(path: &std::path::Path, keys: Vec<(&str, plist::Value)>) {
        let dictionary: plist::Dictionary = keys
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect();
        plist::to_file_xml(path, &plist::Value::Dictionary(dictionary)).expect("write plist");
    }

    #[test]
    fn this_build_stamped_its_own_compiled_build_id() {
        // The whole point of the stamp: the value in the plist the bundler
        // merges is the value the binaries compiled in. If these ever diverge,
        // a running GUI reads the bundle it was built from as somebody else's
        // and refuses every helper mutation forever. Test builds are
        // development builds, so this also pins the fallback literal.
        let stamped = read_stamped_build_id(&crate_dir().join(STAMPED_INFO_PLIST_PATH))
            .expect("the build stamped a plist");

        assert_eq!(stamped, crate::privileged_helper::protocol::BUILD_ID);
    }

    #[test]
    fn the_stamped_plist_carries_every_template_key() {
        // The bundler is pointed at the stamped copy, so anything the tracked
        // template declares (the usage descriptions macOS shows in its access
        // prompts) survives the copy on its own — without relying on the
        // bundler also merging the template by convention.
        let template = plist::Value::from_file(crate_dir().join(INFO_PLIST_TEMPLATE_PATH))
            .expect("read the tracked template")
            .into_dictionary()
            .expect("the template is a dictionary");
        let stamped = plist::Value::from_file(crate_dir().join(STAMPED_INFO_PLIST_PATH))
            .expect("read the stamped copy")
            .into_dictionary()
            .expect("the stamped copy is a dictionary");

        for (key, value) in &template {
            assert_eq!(stamped.get(key), Some(value), "template key {key}");
        }
        assert!(stamped.contains_key(BUNDLE_BUILD_ID_KEY));
    }

    #[test]
    fn no_unstamped_info_plist_sits_next_to_the_tauri_config() {
        // A file with this exact name would be merged by convention, on top of
        // nothing that stamps it — reintroducing a second, unstamped source of
        // bundle keys. The template is named away from it for that reason.
        assert!(!crate_dir().join("Info.plist").exists());
    }

    #[test]
    fn the_bundler_is_pointed_at_the_stamped_plist() {
        // The stamp only reaches the installed bundle through this config path;
        // a rename on either side would silently ship an unstamped bundle.
        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(crate_dir().join("tauri.conf.json")).expect("read config"),
        )
        .expect("parse config");

        assert_eq!(
            config
                .pointer("/bundle/macOS/infoPlist")
                .and_then(|value| value.as_str()),
            Some(STAMPED_INFO_PLIST_PATH)
        );
    }

    #[test]
    fn stamping_preserves_the_build_id_byte_for_byte() {
        // Opaque string: whatever the build supplies is what a later GUI reads
        // back, XML metacharacters and all.
        let directory = tempfile::tempdir().expect("temp dir");
        let template = directory.path().join("Info.plist");
        let stamped = directory.path().join("gen").join("Info.stamped.plist");
        write_plist(
            &template,
            vec![(
                "NSDesktopFolderUsageDescription",
                plist::Value::String("because".to_string()),
            )],
        );

        for build_id in [
            "0123456789abcdef0123456789abcdef01234567",
            DEVELOPMENT_BUILD_ID,
            "release <2026> & \"quoted\"",
            " padded ",
        ] {
            write_stamped_info_plist(&template, &stamped, build_id).expect("stamp");

            assert_eq!(read_stamped_build_id(&stamped).as_deref(), Ok(build_id));
        }
    }

    #[test]
    fn restamping_the_same_build_id_leaves_the_file_alone() {
        // The bundler and cargo both key off this file; rewriting it on every
        // build would churn their inputs for nothing.
        let directory = tempfile::tempdir().expect("temp dir");
        let template = directory.path().join("Info.plist");
        let stamped = directory.path().join("Info.stamped.plist");
        write_plist(&template, vec![("Key", plist::Value::String("v".into()))]);

        write_stamped_info_plist(&template, &stamped, "build-a").expect("stamp");
        let first = std::fs::metadata(&stamped).expect("metadata");
        write_stamped_info_plist(&template, &stamped, "build-a").expect("restamp");
        let second = std::fs::metadata(&stamped).expect("metadata");

        assert_eq!(
            first.modified().expect("mtime"),
            second.modified().expect("mtime")
        );
    }

    #[test]
    fn a_bundle_stamp_is_read_from_the_bundles_own_info_plist() {
        let directory = tempfile::tempdir().expect("temp dir");
        let bundle = directory.path().join("nixmac.app");
        std::fs::create_dir_all(bundle.join("Contents")).expect("bundle layout");
        write_plist(
            &bundle.join("Contents").join("Info.plist"),
            vec![(
                BUNDLE_BUILD_ID_KEY,
                plist::Value::String("build-on-disk".to_string()),
            )],
        );

        assert_eq!(
            read_bundle_build_id(&bundle).as_deref(),
            Ok("build-on-disk")
        );
    }

    #[test]
    fn an_unreadable_stamp_is_an_error_and_never_an_empty_string() {
        // Each of these has to reach the caller as a report ("restart the
        // app", "this bundle is broken"), never as a build ID that happens to
        // compare unequal to everything.
        let directory = tempfile::tempdir().expect("temp dir");
        let missing_key = directory.path().join("missing-key.plist");
        write_plist(
            &missing_key,
            vec![("Other", plist::Value::String("v".into()))],
        );
        let empty = directory.path().join("empty.plist");
        write_plist(
            &empty,
            vec![(BUNDLE_BUILD_ID_KEY, plist::Value::String(String::new()))],
        );
        let wrong_type = directory.path().join("wrong-type.plist");
        write_plist(
            &wrong_type,
            vec![(BUNDLE_BUILD_ID_KEY, plist::Value::Integer(7.into()))],
        );
        let not_a_dictionary = directory.path().join("not-a-dictionary.plist");
        plist::to_file_xml(&not_a_dictionary, &plist::Value::String("nope".into()))
            .expect("write plist");

        for path in [&missing_key, &empty, &wrong_type, &not_a_dictionary] {
            assert!(read_stamped_build_id(path).is_err(), "{}", path.display());
        }
        assert!(read_stamped_build_id(&directory.path().join("absent.plist")).is_err());
        assert!(read_bundle_build_id(&directory.path().join("absent.app")).is_err());
    }
}
