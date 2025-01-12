use anchor_lang::prelude::*;

/// Define terrain types that affect movement.
/// Note: Make sure to declare the enum as public.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum TerrainType {
    Plain,
    Mountain,
    River,
}
