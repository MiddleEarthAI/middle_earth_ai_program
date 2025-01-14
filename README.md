
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

## Getting Started

1. **Build and Deploy:**  
   Build your Anchor program using the Anchor CLI. Then deploy the program to your local test validator (or appropriate cluster).

2. **Initialize a Game:**  
   Derive the Game account’s PDA using a seed based on a unique game identifier, and then call the `initialize_game` instruction with the PDA, game ID, and bump. This creates an active Game account and sets the game authority.

3. **Register an Agent:**  
   Derive the Agent account’s PDA using the Game account’s public key and a unique agent identifier (a single byte). Use the `register_agent` instruction to create the Agent account on-chain, initialize its fields (position, status, etc.), and register its metadata (public key and name) into the Game account’s global agent list. The system enforces a limit of 4 agents and checks that duplicate registrations do not occur.

4. **Interact with the Game:**  
   Once the game and its agents have been initialized, additional instructions allow you to move agents, form or break alliances, process battles, and manage token staking. Access control rules (ensuring that only the game authority or the agent’s designated authority can make state changes) are enforced on every instruction.

5. **Query On-Chain Data:**  
   After registration, you can query the on‑chain data of an Agent account to view its properties—including alliance information (such as the last allied agent and the timestamp when the alliance was broken)—using Anchor’s client libraries or other Solana client tools.

## Testing the Program

- **TypeScript Tests:**  
  Run your tests using the Anchor testing framework (with a tool such as ts‑mocha) to simulate end‑to‑end interactions. These tests will initialize the Game, register agents, attempt duplicate registrations, and fetch account data to verify correct state updates.

- **Python Tests (Optional):**  
  You may also use AnchorPy to test your program. This involves setting up a Python virtual environment, loading your IDL, and writing test scripts to interact with your deployed program.

## Contributing

Contributions are welcome. Fork the repository, implement your changes with corresponding tests, and open a pull request. Ensure that all state‑changing instructions enforce proper access control and that your tests cover edge cases.

## License

This project is licensed under the MIT License. See the LICENSE file for details.