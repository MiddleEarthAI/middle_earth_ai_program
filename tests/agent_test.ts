import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Agent Tests", () => {
  // Set up the provider to use the local cluster.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // Access the program from the workspace.
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Global variable for the game PDA.
  let gamePda: PublicKey;
  // The game ID we use for initialization.
  const gameId = new BN(999);
  // The agent ID we'll use in tests.
  const agentId = 7;

  // An unauthorized wallet (different from the provider's wallet).
  const unauthorizedWallet = Keypair.generate();

  // Before any tests run, derive (and optionally initialize) the game account.
  before("Initialize game", async () => {
    // Derive the game PDA using the seeds: [ "game", gameId.toBuffer("le", 4) ]
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived game PDA:", gamePda.toBase58());

    // Optionally call the initialize_game instruction.
    try {
      await program.methods
        .initializeGame(gameId, new BN(123)) // Pass the bump as a BN if required.
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped or already done:", err.message);
    }
  });

  describe("Register Agent", () => {
    it("Registers a new agent successfully", async () => {
      // Derive the agent PDA using seeds: [ "agent", gamePda, Uint8Array.of(agentId) ]
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
        program.programId
      );
      console.log("Derived agent PDA:", agentPda.toBase58());

      // Call the register_agent instruction.
      const tx = await program.methods
        .registerAgent(agentId, 10, -4, "Gandalf")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Register agent tx signature:", tx);
    });
  });

  describe("Kill Agent and Access Control", () => {
    it("Kills the agent when called by its authority", async () => {
      // Derive the agent PDA using the same seeds.
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
        program.programId
      );
      console.log("Using agent PDA for kill (authorized):", agentPda.toBase58());
  
      // Call the kill_agent instruction as the proper authority.
      const tx = await program.methods
        .killAgent()
        .accounts({
          agent: agentPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Kill agent tx signature (authorized):", tx);
    });
  
    it("Fails to kill the agent when called by an unauthorized wallet", async () => {
      // Derive the agent PDA again using the same seeds.
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
        program.programId
      );
      console.log("Using agent PDA for kill (unauthorized):", agentPda.toBase58());
  
      // Attempt to call kill_agent using an unauthorized wallet.
      let reverted = false;
      try {
        await program.methods
          .killAgent()
          .accounts({
            agent: agentPda,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized kill_agent failed as expected");
        reverted = true; // Mark as reverted since an error occurred.
      }
  
      // Assert that the transaction reverted.
      expect(reverted).to.be.true;
    });
  });
  
});
