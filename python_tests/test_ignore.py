# tests/test_ignore.py

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
TARGET_IGNORE_ID = 2

@pytest.mark.asyncio
async def test_ignore_agent():
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive game + agent PDAs (assuming agent is reg'd).
    game_pda, _ = PublicKey.find_program_address(
        [b"game", GAME_ID.to_bytes(4, "little")],
        PROGRAM_ID
    )
    agent_pda, _ = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([AGENT_ID])],
        PROGRAM_ID
    )

    # ignore_agent instruction: (target_agent_id: u8)
    # Accounts: agent, game, authority
    try:
        tx_sig = await program.rpc["ignore_agent"](
            TARGET_IGNORE_ID,
            ctx=Context(
                accounts={
                    "agent": agent_pda,
                    "game": game_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("ignore_agent tx:", tx_sig)
    except Exception as e:
        pytest.fail(f"ignore_agent failed: {e}")

    # Check that the agent's ignore_cooldowns was updated
    agent_data = await program.account["agent"].fetch(agent_pda)
    print("Agent data after ignore_agent:", agent_data)

    # The last entry in ignore_cooldowns should have agent_id = TARGET_IGNORE_ID
    ignore_list = agent_data["ignoreCooldowns"]
    assert len(ignore_list) > 0, "ignore_cooldowns should not be empty"
    assert ignore_list[-1]["agentId"] == TARGET_IGNORE_ID, "Should match the target ignored ID"

    await connection.close()
    print("test_ignore_agent passed!")
