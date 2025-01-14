# Middle Earth AI Program

Middle Earth AI is an experimental strategy game built on the Solana blockchain using the Anchor framework. In this game, on-chain AI agents are created and managed through smart contracts. The program handles the initialization of a Game account and the registration of Agent accounts into a global agent list maintained in the Game account. The system enforces various rules such as a maximum of four agents per game and restricts access so that only the designated game authority can add or modify agents. In addition, agents store alliance tracking data so that off-chain logic can prevent recently allied agents from engaging in further actions until a cooldown period has elapsed.

## Features

- **Game Initialization:**  
  The program creates a Game account that holds key configuration values—such as map diameter, battle range, and an active flag—and maintains a global list of agents that are registered in the game. The Game account stores the authority that can later be used to perform sensitive operations.

- **Agent Registration:**  
  Agents are registered via a combined instruction that performs two tasks:
  - A new Agent account is initialized on-chain using program‑derived addresses (PDAs) generated from the game account and a unique agent identifier.
  - The agent’s metadata (its public key and a name up to 32 characters long) is added to the Game account’s global agent list, which is limited to a maximum of four agents.
  
- **Access Control:**  
  The program enforces access control by ensuring that only the game authority (the authority stored in the Game account) can register an agent. When registering an agent, the authority provided in the transaction must match the authority stored in the Game account. Similarly, other state‑changing operations (such as killing an agent) are restricted to the appropriate authority.

- **Alliance Tracking:**  
  In addition to core agent functionality, the Agent account tracks alliance details. It records the currently active alliance (if any) as well as the information about the last alliance break, including the public key of the last allied agent and the timestamp at which the alliance was broken. This information can be used by off-chain logic (or later on‑chain logic) to restrict certain interactions (for example, to prevent an agent from attacking a recently allied agent until after a cooldown period).

- **Other Game Operations:**  
  Although this README focuses on game and agent initialization, the project also includes instructions for agent movement, battle resolution, alliance formation/breaking, token staking/unstaking, and reward claiming.

## Directory Structure

- **Programs:**  
  The source code of the Solana program is in the `programs/middle_earth_ai_program/src` directory. This includes submodules for instructions, state definitions, error definitions, and event declarations.
  
- **State:**  
  The `state` module defines the data structures for key accounts such as Game, Agent, Alliance, and AgentInfo. The Game account holds a global list of agents (each with a public key and a name).

- **Instructions:**  
  The `instructions` folder contains modules implementing on-chain instructions. For example, the agent instruction module contains `register_agent` to initialize an Agent account and add it to the Game’s global list, and a `kill_agent` function to mark an agent as dead.

- **Tests:**  
  The repository includes test scripts (written in TypeScript and optionally in Python) that simulate the end‑to‑end workflow of the game. These tests initialize the Game account, register agents, and query on‑chain state to confirm correct behavior.

