import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

describe("Game Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  const gameId = new BN(999); // Example game ID
  let gamePda: PublicKey; // Game PDA

  before("Derive Game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived Game PDA:", gamePda.toBase58());
  });

  it("Initializes a new game successfully", async () => {
    try {
      await program.methods
        .initializeGame(gameId, 123) // Example bump value
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped (likely already exists):", err.message);
    }

    // Fetch and validate the game account
    const gameAccount = await program.account.game.fetch(gamePda);
    expect(gameAccount.gameId.toNumber()).to.equal(gameId.toNumber());
    expect(gameAccount.isActive).to.be.true;
    expect(gameAccount.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
  });

  it("Ends the game successfully", async () => {
    await program.methods
      .endGame()
      .accounts({
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // Fetch and validate the game account
    const gameAccount = await program.account.game.fetch(gamePda);
    expect(gameAccount.isActive).to.be.false;
    console.log("Game ended successfully.");
  });

  it("Fails to reinitialize an already active game", async () => {
    let reverted = false;

    try {
      await program.methods
        .initializeGame(gameId, 123)
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      console.log("Reinitialization failed as expected:", err.message);
      reverted = true;
    }

    expect(reverted).to.be.true;
  });

  it("Fails to end the game with an unauthorized wallet", async () => {
    const unauthorizedWallet = anchor.web3.Keypair.generate();
    let reverted = false;

    try {
      await program.methods
        .endGame()
        .accounts({
          game: gamePda,
          authority: unauthorizedWallet.publicKey,
        })
        .signers([unauthorizedWallet])
        .rpc();
    } catch (err: any) {
      console.log("Unauthorized end game failed as expected:", err.message);
      reverted = true;
    }

    expect(reverted).to.be.true;
  });

  it("Fails to end an already inactive game", async () => {
    let reverted = false;

    try {
      await program.methods
        .endGame()
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err: any) {
      console.log("End game failed for inactive game as expected:", err.message);
      reverted = true;
    }

    expect(reverted).to.be.true;
  });
});
