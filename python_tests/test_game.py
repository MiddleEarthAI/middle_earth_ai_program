# tests/test_game.py

import pytest
import json
from solana.keypair import Keypair
from solana.publickey import PublicKey
from solana.rpc.async_api import AsyncClient
from anchorpy import Program, Provider, Wallet, Idl, Context
from anchorpy import ProgramError
from solana.rpc.types import TxOpts

PROGRAM_ID = PublicKey("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q")
IDL_PATH = "target/idl/middle_earth_ai_program.json"

GAME_ID = 1  # Example game ID for seeds

@pytest.mark.asyncio
async def test_initialize_game():
    """Tests the initialize_game instruction."""
    # Load the IDL
    with open(IDL_PATH, "r") as f:
        raw_idl = json.load(f)
    idl = Idl.from_json(raw_idl)

    # Connect to local validator, create local payer
    connection = AsyncClient("http://127.0.0.1:8899")
    payer = Keypair.generate()
    wallet = Wallet(payer)
    provider = Provider(connection, wallet, opts=TxOpts(skip_preflight=True))
    program = Program(idl, PROGRAM_ID, provider)

    # Derive the Game PDA: seeds = [ b"game", game_id (4 bytes le) ]
    game_id_bytes = GAME_ID.to_bytes(4, "little")
    [game_pda, game_bump] = PublicKey.find_program_address(
        [b"game", game_id_bytes],
        PROGRAM_ID
    )
    print("Derived game PDA:", game_pda)

    # Call initialize_game(game_id, bump)
    try:
        tx_sig = await program.rpc["initialize_game"](
            GAME_ID,
            game_bump,
            ctx=Context(
                accounts={
                    "game": game_pda,
                    "authority": payer.public_key,
                    "system_program": PublicKey("11111111111111111111111111111111"),
                },
                signers=[payer],
            ),
        )
        print("initialize_game transaction signature:", tx_sig)
    except Exception as e:
        pytest.fail(f"initialize_game failed: {e}")

    # Fetch and verify game data
    game_data = await program.account["game"].fetch(game_pda)
    print("Game Data:", game_data)
    assert game_data["isActive"] == True, "Game should be active"

    # Cleanup
    await connection.close()
    print("test_initialize_game passed!")
