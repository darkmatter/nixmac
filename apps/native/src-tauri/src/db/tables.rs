//! Diesel table declarations for query-builder-backed database code.

diesel::table! {
    commits (id) {
        id -> BigInt,
        hash -> Text,
        tree_hash -> Text,
        message -> Nullable<Text>,
        created_at -> BigInt,
    }
}
