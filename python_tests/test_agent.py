# tests/test_agent.py

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
async def test_register_agent_and_kill():
    """Tests register_agent and kill_agent instructions."""
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive the Game PDA (assume game is already initialized)
    game_id_bytes = GAME_ID.to_bytes(4, "little")
    [game_pda, game_bump] = PublicKey.find_program_address(
        [b"game", game_id_bytes],
        PROGRAM_ID
    )

    # Derive the Agent PDA
    [agent_pda, agent_bump] = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([AGENT_ID])],
        PROGRAM_ID
    )
    print("Derived agent PDA:", agent_pda)

    # Register the agent
    try:
        tx_sig = await program.rpc["register_agent"](
            AGENT_ID, 10, 20, "TestAgent",
            ctx=Context(
                accounts={
                    "game": game_pda,
                    "agent": agent_pda,
                    "authority": payer.public_key,
                    "system_program": PublicKey("11111111111111111111111111111111"),
                },
                signers=[payer]
            )
        )
        print("register_agent tx:", tx_sig)
    except Exception as e:
        pytest.fail(f"register_agent failed: {e}")

    # Fetch agent data
    agent_data = await program.account["agent"].fetch(agent_pda)
    print("Agent data after register:", agent_data)
    assert agent_data["isAlive"] == True, "Agent should be alive"

    # Kill the agent
    try:
        tx_sig_kill = await program.rpc["kill_agent"](
            ctx=Context(
                accounts={
                    "agent": agent_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("kill_agent tx:", tx_sig_kill)
    except Exception as e:
        pytest.fail(f"kill_agent failed: {e}")

    # Verify agent is dead
    agent_data_killed = await program.account["agent"].fetch(agent_pda)
    print("Agent data after kill:", agent_data_killed)
    assert agent_data_killed["isAlive"] == False, "Agent should be dead"

    await connection.close()
    print("test_register_agent_and_kill passed!")
