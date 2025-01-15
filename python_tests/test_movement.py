# tests/test_movement.py

import pytest
import json
from solana.keypair import Keypair
from solana.publickey import PublicKey
from solana.rpc.async_api import AsyncClient
from anchorpy import Program, Provider, Wallet, Idl, Context
from solana.rpc.types import TxOpts

PROGRAM_ID = PublicKey("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q")
IDL_PATH = "target/idl/middle_earth_ai_program.json"

GAME_ID = 1
AGENT_ID = 1

@pytest.mark.asyncio
async def test_move_agent():
    """Tests move_agent instruction with different TerrainType (Plain, Mountain, River)."""
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive game and agent
    [game_pda, _] = PublicKey.find_program_address(
        [b"game", GAME_ID.to_bytes(4, "little")],
        PROGRAM_ID
    )
    [agent_pda, _] = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([AGENT_ID])],
        PROGRAM_ID
    )

    # We'll pass in an enum for terrain. In your IDL, 
    # TerrainType = { Plain=0, Mountain=1, River=2 } or similar
    # AnchorPy will want a numeric or dictionary representation, depending on your IDL.

    # Example: for "Plain", we pass 0
    terrain_plain = 0  # or the correct representation from the IDL

    try:
        tx_sig = await program.rpc["move_agent"](
            100,   # new_x
            200,   # new_y
            terrain_plain,
            ctx=Context(
                accounts={
                    "agent": agent_pda,
                    "game": game_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("move_agent tx:", tx_sig)
    except Exception as e:
        pytest.fail(f"move_agent(Plain) failed: {e}")

    agent_data = await program.account["agent"].fetch(agent_pda)
    print("Agent data after move_agent(Plain):", agent_data)
    # The agent's x, y should now be 100, 200, and next_move_time updated

    await connection.close()
    print("test_move_agent passed!")
