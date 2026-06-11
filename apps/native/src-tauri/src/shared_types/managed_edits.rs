use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct HomebrewCaskItem {
    pub name: String,
    pub version: Option<String>,
}
