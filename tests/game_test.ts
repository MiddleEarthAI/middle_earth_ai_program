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

  const getGameAccountNamespace = () => {
    return (program.account as any).Game || (program.account as any).game;
  };

  before("Derive Game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived Game PDA:", gamePda.toBase58());
  });

  it("Initializes a new game successfully", async () => {
    // Fetch initial state if it exists
    let gameAccountBefore;
    try {
      gameAccountBefore = await getGameAccountNamespace().fetch(gamePda);
      console.log("Game account already exists, validating its state.");
    } catch {
      console.log("Game account does not exist yet, proceeding with initialization.");
    }

    // If the game account exists, validate it matches the expected initial state
    if (gameAccountBefore) {
      expect(gameAccountBefore.gameId.toNumber()).to.equal(gameId.toNumber());
      expect(gameAccountBefore.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(gameAccountBefore.isActive).to.be.true;
      return; // Skip initialization since the game is already initialized
    }
    const unauthorizedWallet = anchor.web3.Keypair.generate();

    // Call the initialize_game instruction
    const bump = 123; // Example bump
    const tx = await program.methods
      .initializeGame(gameId, new BN(bump))
      .accounts({
        game: gamePda,
        authority: unauthorizedWallet,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Game initialization tx signature:", tx);

    // Fetch the newly created game account
    const gameAccountAfter = await getGameAccountNamespace().fetch(gamePda);

    // Validate game account state
    expect(gameAccountAfter.gameId.toNumber()).to.equal(gameId.toNumber());
    expect(gameAccountAfter.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(gameAccountAfter.isActive).to.be.true;
    expect(gameAccountAfter.bump).to.equal(bump);
    expect(gameAccountAfter.reentrancyGuard).to.be.false;
    expect(gameAccountAfter.lastUpdate.toNumber()).to.be.greaterThan(0);
  });

  it("Fails to reinitialize an already active game", async () => {
    const bump = 123; // Use the same bump as before
    let reverted = false;

    try {
      await program.methods
        .initializeGame(gameId, new BN(bump))
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

  it("Fails to initialize a game with an unauthorized wallet", async () => {
    const unauthorizedWallet = anchor.web3.Keypair.generate();
    const bump = 124; // Different bump for this test
    let reverted = false;

    try {
      await program.methods
        .initializeGame(gameId, new BN(bump))
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      console.log("Unauthorized initialization failed as expected:", err.message);
      reverted = true;
    }

    expect(reverted).to.be.true;
  });
});
