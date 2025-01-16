# tests/test_alliance.py

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
AGENT_ID_INITIATOR = 1
AGENT_ID_TARGET = 2

@pytest.mark.asyncio
async def test_form_and_break_alliance():
    """
    Tests form_alliance and break_alliance instructions.
    Assumes the Game and two Agents are already created and alive.
    """
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive the Game PDA
    game_id_bytes = GAME_ID.to_bytes(4, "little")
    [game_pda, game_bump] = PublicKey.find_program_address(
        [b"game", game_id_bytes],
        PROGRAM_ID
    )

    # Derive PDAs for initiator and target
    [initiator_pda, _] = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([AGENT_ID_INITIATOR])],
        PROGRAM_ID
    )
    [target_pda, _] = PublicKey.find_program_address(
        [b"agent", game_pda.to_bytes(), bytes([AGENT_ID_TARGET])],
        PROGRAM_ID
    )

    # Form alliance: initiator -> target
    try:
        tx_sig_form = await program.rpc["form_alliance"](
            ctx=Context(
                accounts={
                    "initiator": initiator_pda,
                    "targetAgent": target_pda,
                    "game": game_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("form_alliance tx:", tx_sig_form)
    except Exception as e:
        pytest.fail(f"form_alliance failed: {e}")

    # Verify alliance
    initiator_data = await program.account["agent"].fetch(initiator_pda)
    target_data = await program.account["agent"].fetch(target_pda)
    print("Initiator after alliance:", initiator_data)
    print("Target after alliance:", target_data)

    assert initiator_data["allianceWith"] == target_pda, "Initiator should be allied with target"
    assert target_data["allianceWith"] == initiator_pda, "Target should be allied with initiator"

    # Break alliance
    try:
        tx_sig_break = await program.rpc["break_alliance"](
            ctx=Context(
                accounts={
                    "initiator": initiator_pda,
                    "targetAgent": target_pda,
                    "game": game_pda,
                    "authority": payer.public_key,
                },
                signers=[payer]
            )
        )
        print("break_alliance tx:", tx_sig_break)
    except Exception as e:
        pytest.fail(f"break_alliance failed: {e}")

    # Verify they've parted ways
    initiator_data2 = await program.account["agent"].fetch(initiator_pda)
    target_data2 = await program.account["agent"].fetch(target_pda)
    print("Initiator after break_alliance:", initiator_data2)
    print("Target after break_alliance:", target_data2)

    assert initiator_data2["allianceWith"] is None, "Initiator alliance cleared"
    assert target_data2["allianceWith"] is None, "Target alliance cleared"

    await connection.close()
    print("test_form_and_break_alliance passed!")
