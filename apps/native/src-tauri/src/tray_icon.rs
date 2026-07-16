use tauri::image::Image;

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/outline@2x.png");

pub(crate) fn load() -> tauri::Result<Image<'static>> {
    Image::from_bytes(TRAY_ICON_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_tray_icon_decodes_as_transparent_png() {
        let icon = load().expect("embedded tray icon should decode");

        assert!(icon.width() > 0, "tray icon must have a non-zero width");
        assert!(icon.height() > 0, "tray icon must have a non-zero height");

        let mut alpha = icon.rgba().chunks_exact(4).map(|pixel| pixel[3]);
        assert!(
            alpha.any(|value| value == 0),
            "template icon must contain transparent pixels"
        );
        assert!(
            alpha.any(|value| value > 0),
            "template icon must contain visible pixels",
        );
    }
}
