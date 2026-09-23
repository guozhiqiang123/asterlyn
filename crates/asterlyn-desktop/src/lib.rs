mod file_manager;
mod system_trash;

pub use file_manager::{RevealWorkspaceEntryResult, reveal_workspace_entry};
pub use system_trash::{move_all_to_system_trash, move_to_system_trash};
