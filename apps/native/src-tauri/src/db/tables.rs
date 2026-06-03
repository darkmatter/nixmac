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

diesel::table! {
    evolutions (id) {
        id -> BigInt,
        origin_branch -> Text,
        merged -> Integer,
        builds -> Integer,
    }
}

diesel::table! {
    change_summaries (id) {
        id -> BigInt,
        title -> Text,
        description -> Text,
        status -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    changes (id) {
        id -> BigInt,
        hash -> Text,
        filename -> Text,
        diff -> Text,
        line_count -> Integer,
        created_at -> BigInt,
        own_summary_id -> Nullable<BigInt>,
    }
}

diesel::table! {
    group_summaries (change_id, change_summary_id) {
        change_id -> BigInt,
        change_summary_id -> BigInt,
    }
}

diesel::table! {
    change_sets (id) {
        id -> BigInt,
        commit_id -> Nullable<BigInt>,
        base_commit_id -> BigInt,
        commit_message -> Nullable<Text>,
        generated_commit_message -> Nullable<Text>,
        created_at -> BigInt,
        evolution_id -> Nullable<BigInt>,
    }
}

diesel::table! {
    set_changes (change_set_id, change_id) {
        change_set_id -> BigInt,
        change_id -> BigInt,
    }
}

diesel::table! {
    queued_summaries (id) {
        id -> BigInt,
        status -> Text,
        attempted_count -> Integer,
        prompt -> Text,
        model_response -> Nullable<Text>,
        group_summary_id -> Nullable<BigInt>,
        hash_own_summary_id_pairs -> Nullable<Text>,
        #[sql_name = "type"]
        type_ -> Text,
    }
}

diesel::table! {
    prompts (id) {
        id -> BigInt,
        text -> Text,
        commit_id -> Nullable<BigInt>,
        created_at -> BigInt,
    }
}

diesel::table! {
    restore_commits (commit_hash) {
        commit_hash -> Text,
        origin_hash -> Text,
    }
}

diesel::joinable!(changes -> change_summaries (own_summary_id));
diesel::joinable!(group_summaries -> changes (change_id));
diesel::joinable!(group_summaries -> change_summaries (change_summary_id));
diesel::joinable!(change_sets -> evolutions (evolution_id));
diesel::joinable!(set_changes -> change_sets (change_set_id));
diesel::joinable!(set_changes -> changes (change_id));
diesel::joinable!(prompts -> commits (commit_id));

diesel::allow_tables_to_appear_in_same_query!(
    change_sets,
    change_summaries,
    changes,
    commits,
    evolutions,
    group_summaries,
    prompts,
    queued_summaries,
    restore_commits,
    set_changes,
);
