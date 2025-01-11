use anchor_lang::prelude::*;

#[event]
pub struct AgentMoved {
    pub agent_id: u8,
    pub old_x: i32,
    pub old_y: i32,
    pub new_x: i32,
    pub new_y: i32,
}

#[event]
pub struct BattleInitiated {
    pub agent_id: u8,
    pub opponent_agent_id: u8,
}
