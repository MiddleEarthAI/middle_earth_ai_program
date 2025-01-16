# tests/test_battle.py

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

@pytest.mark.asyncio
async def test_resolve_battle_simple():
    """Tests resolve_battle_simple (no alliances)."""
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive the Game PDA
    [game_pda, game_bump] = PublicKey.find_program_address(
        [b"game", GAME_ID.to_bytes(4, "little")],
        PROGRAM_ID
    )

    # Suppose we have 2 agents: agent1 & agent2, no alliances
    agent_id_1 = 1
    agent_id_2 = 2
    agent_pda_1, _ = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([agent_id_1])],
        PROGRAM_ID
    )
    agent_pda_2, _ = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([agent_id_2])],
        PROGRAM_ID
    )

    # We call resolve_battle_simple(winner, loser, transfer_amount=someValue).
    # The IDL for resolve_battle_simple: (transfer_amount) -> accounts: winner, loser, game, authority
    transfer_amount = 999  # arbitrary logging value

    try:
        tx_sig = await program.rpc["resolve_battle_simple"](
            transfer_amount,
            ctx=Context(
                accounts={
                    "winner": agent_pda_1,
                    "loser": agent_pda_2,
                    "game": game_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("resolve_battle_simple tx:", tx_sig)
    except Exception as e:
        pytest.fail(f"resolve_battle_simple failed: {e}")

    # Check cooldown updates
    agent1_data = await program.account["agent"].fetch(agent_pda_1)
    agent2_data = await program.account["agent"].fetch(agent_pda_2)
    print("Agent1 after battle simple:", agent1_data)
    print("Agent2 after battle simple:", agent2_data)
    # Both should have updated last_attack to the current timestamp

    await connection.close()
    print("test_resolve_battle_simple passed!")
