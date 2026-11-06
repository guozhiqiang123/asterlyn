//! Host-owned tool installation facts. These facts never grant project execution authority.
//! Native adapters supply verified recipes, storage, bytes and fresh package/window authority.

mod model;
pub use model::*;
mod archive;
pub use archive::*;
mod download;
pub use download::*;
mod http_download;
pub use http_download::*;
mod installer;
pub use installer::*;
mod recipe;
pub use recipe::*;
mod storage;
pub use storage::*;
mod content_storage;
pub use content_storage::*;
mod coordinator;
pub use coordinator::*;
#[cfg(test)]
mod tests;
