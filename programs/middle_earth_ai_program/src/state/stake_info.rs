use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct StakeInfo {
    pub agent: Pubkey,             
    pub staker: Pubkey,            
    pub amount: u64,               
    pub last_reward_timestamp: i64,
    pub bump: u8,                  
    pub shares: u64,              
}
