//! Host-owned tool installation facts. These facts never grant project execution authority.
//! Native adapters supply verified recipes, storage, bytes and fresh package/window authority.

mod model;
pub use model::*;
mod coordinator;
pub use coordinator::*;
#[cfg(test)]
mod tests;
