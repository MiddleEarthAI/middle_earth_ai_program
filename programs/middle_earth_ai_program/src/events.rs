use anchor_lang::prelude::*;


#[event]
pub struct BattleInitiated {
    pub agent_id: u8,
    pub opponent_agent_id: u8,
}


#[event]
pub struct AgentMoved {
    pub agent_id: u8,
    pub old_x: i32,
    pub old_y: i32,
    pub new_x: i32,
    pub new_y: i32,
}

#[event]
pub struct BattleResolved {
    pub winner_id: u8,
    pub loser_id: u8,
    pub transfer_amount: u64,
}
