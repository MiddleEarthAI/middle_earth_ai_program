use anchor_lang::prelude::*;

/// Holds basic information for an agent.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct AgentInfo {
    pub key: Pubkey,
    pub name: String,
}

// Manually implement the `Space` trait for `AgentInfo`
impl anchor_lang::Space for AgentInfo {
    // Here, we assume the maximum size for the `name` field is 36 bytes.
    // Total space = 32 (Pubkey) + 4 (string length) + 32 (max name bytes) = 68 bytes.
    const INIT_SPACE: usize = 32 + 4 + 32;
}
