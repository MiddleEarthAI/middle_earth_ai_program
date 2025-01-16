import json
import os
from solders.keypair import Keypair
from solana.rpc.async_api import AsyncClient
from anchorpy import Provider, Wallet, Program, Context
from solders.pubkey import Pubkey as PublicKey
from solana.rpc.types import TxOpts

# 1) Load the IDL JSON (paste that JSON in an `idl.json` file).
with open("../target/idl/middle_earth_ai_program.json", "r") as f:
    idl_json = json.load(f)

# 2) Program ID from your IDL or Anchor.toml
PROGRAM_ID = PublicKey.from_string("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q")

# 3) Create a local provider. 
#    If using a local validator, set "http://127.0.0.1:8899" or use devnet if you like.
async def main():
    connection = AsyncClient("http://127.0.0.1:8899")
    # Generate a new authority Keypair or load from file
    authority_kp = Keypair()  
    
    # The Provider wraps the connection and the "wallet" (signer).
    provider = Provider(connection, Wallet(authority_kp), opts=TxOpts(skip_preflight=True))
    
    # 4) Create the Program object
    program = Program(idl_json, PROGRAM_ID, provider)
    
    # 5) Step A - Initialize the Game
    # We pass game_id, bump, and the necessary accounts in the context.
    
    game_id = 999
    bump = 123  # Example bump, must match your seeds logic

    # Derive the game PDA (the same seeds in your code: ["game", game_id.to_le_bytes()])
    # If you manually want to find the PDA:
    from anchorpy import utils
    GAME_SEED_PREFIX = b"game"
    seeds = [GAME_SEED_PREFIX, game_id.to_bytes(4, "little")]
    game_pda, game_bump = PublicKey.find_program_address(seeds, PROGRAM_ID)
    
    print("Derived game_pda =", game_pda, "with bump =", game_bump)

    # Call the initialize_game instruction
    print("Initializing game...")
    tx_signature = await program.rpc["initialize_game"](
        game_id,
        bump,
        ctx=Context(
            accounts={
                "game": game_pda,
                "authority": authority_kp.public_key,
                "system_program": PublicKey("11111111111111111111111111111111"),
            },
            signers=[authority_kp],  # The authority who pays the init cost
        ),
    )
    print("initialize_game tx sig:", tx_signature)
    
    # 6) Step B - Register an agent
    # For register_agent, we also need to derive the agent PDA 
    # seeds = ["agent", game_pda, [agent_id]] in your code.

    agent_id = 7
    agent_seeds = [
        b"agent",
        bytes(game_pda),
        bytes([agent_id])
    ]
    agent_pda, agent_bump = PublicKey.find_program_address(agent_seeds, PROGRAM_ID)
    
    print("Derived agent_pda =", agent_pda, "with bump =", agent_bump)

    # agent's x, y, name
    agent_x = 10
    agent_y = -4
    agent_name = "Gandalf"
    
    print("Registering agent...")
    tx_signature = await program.rpc["register_agent"](
        agent_id,
        agent_x,
        agent_y,
        agent_name,
        ctx=Context(
            accounts={
                "game": game_pda,
                "agent": agent_pda,
                "authority": authority_kp.public_key,
                "system_program": PublicKey("11111111111111111111111111111111"),
            },
            signers=[authority_kp]
        ),
    )
    print("register_agent tx sig:", tx_signature)
    
    # 7) Step C - Kill the agent (just as a test)
    print("Killing the agent...")
    tx_signature = await program.rpc["kill_agent"](
        ctx=Context(
            accounts={
                "agent": agent_pda,
                "authority": authority_kp.public_key,
            },
            signers=[authority_kp]
        ),
    )
    print("kill_agent tx sig:", tx_signature)
    
    # 8) (Optional) Fetch the agent account data 
    agent_account = await program.account["Agent"].fetch(agent_pda)
    print("Agent account after kill ->", agent_account)

    # Close connection to local validator
    await connection.close()

# If using an async entrypoint:
if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
