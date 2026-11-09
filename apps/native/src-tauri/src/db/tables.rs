//! Diesel table declarations for query-builder-backed database code.

diesel::table! {
    evolutions (id) {
        id -> BigInt,
        origin_branch -> Text,
    }
}

diesel::table! {
    patch_summaries (id) {
        id -> BigInt,
        change_hash -> Text,
        title -> Text,
        description -> Text,
        status -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    summary_groups (id) {
        id -> BigInt,
        group_key -> Text,
        title -> Text,
        description -> Text,
        status -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    summary_group_members (group_key, change_hash) {
        group_key -> Text,
        change_hash -> Text,
    }
}

diesel::table! {
    snapshots (id) {
        id -> BigInt,
        snapshot_key -> Text,
        generated_commit_message -> Nullable<Text>,
        evolution_id -> Nullable<BigInt>,
        created_at -> BigInt,
    }
}

diesel::table! {
    restore_commits (commit_hash) {
        commit_hash -> Text,
        origin_hash -> Text,
    }
}

diesel::joinable!(snapshots -> evolutions (evolution_id));

diesel::allow_tables_to_appear_in_same_query!(
    evolutions,
    patch_summaries,
    restore_commits,
    snapshots,
    summary_group_members,
    summary_groups,
);
