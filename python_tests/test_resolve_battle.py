import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

// Import the generated IDL types
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

describe("resolve_battle_simple", () => {
  // Set the provider (uses the cluster specified in your Anchor.toml)
  anchor.setProvider(anchor.AnchorProvider.env());

  // IMPORTANT: Use the correct workspace key (camelCase)
  const program = anchor.workspace.middleEarthAiProgram as Program<MiddleEarthAiProgram>;
  const provider = anchor.getProvider();
  const wallet = provider.wallet as anchor.Wallet;

  // Constants for testing.
  const TEST_GAME_ID = 8888;
  const AGENT_ID_WINNER = 1;
  const AGENT_ID_LOSER = 2;
  let gamePda: PublicKey;
  let winnerPda: PublicKey;
  let loserPda: PublicKey;

  before(async () => {
    // Derive the game PDA. (Here we use the string representation of TEST_GAME_ID;
    // adjust the seed if your program uses a different format.)
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), Buffer.from(TEST_GAME_ID.toString())],
      program.programId
    );

    // Derive Agent PDAs.
    [winnerPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([AGENT_ID_WINNER])],
      program.programId
    );

    [loserPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([AGENT_ID_LOSER])],
      program.programId
    );

    // Initialize the game.
    await program.methods
      .initializeGame(new anchor.BN(TEST_GAME_ID), /* bump: */ new anchor.BN(0)) // Adjust bump if needed.
      .accounts({
        game: gamePda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Register the winner agent.
    await program.methods
      .registerAgent(
        AGENT_ID_WINNER,
        /* x: */ 0,
        /* y: */ 0,
        "Winner"
      )
      .accounts({
        game: gamePda,
        agent: winnerPda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Register the loser agent.
    await program.methods
      .registerAgent(
        AGENT_ID_LOSER,
        /* x: */ 1,
        /* y: */ 1,
        "Loser"
      )
      .accounts({
        game: gamePda,
        agent: loserPda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  it("should resolve a battle between two agents", async () => {
    // Call the resolve_battle_simple instruction.
    // The instruction (as defined in your IDL) takes a u64 parameter called transfer_amount.
    const transferAmount = new anchor.BN(50000);
    await program.methods
      .resolveBattleSimple(transferAmount)
      .accounts({
        winner: winnerPda,
        loser: loserPda,
        game: gamePda,
        authority: wallet.publicKey,
      })
      .rpc();

    // Fetch updated accounts to verify changes.
    const winnerAccount = await program.account.agent.fetch(winnerPda);
    const loserAccount = await program.account.agent.fetch(loserPda);

    // Verify that the lastAttack field is updated (assuming your IDL defines it as last_attack)
    assert.ok(
      winnerAccount.lastAttack.toNumber() > 0,
      "Winner lastAttack not updated"
    );
    assert.ok(
      loserAccount.lastAttack.toNumber() > 0,
      "Loser lastAttack not updated"
    );
  });
});
