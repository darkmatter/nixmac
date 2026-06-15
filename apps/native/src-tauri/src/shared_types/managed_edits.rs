use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HomebrewItemType {
    Tap,
    Cask,
    Brew,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HomebrewItem {
    pub name: String,
    pub version: Option<String>,
    pub item_type: HomebrewItemType,
}
