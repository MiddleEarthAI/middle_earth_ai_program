import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey } from "@solana/web3.js";

describe("Agent Tests", () => {
  // Set up the provider to use the local cluster.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // Access the program from the workspace (ensure the program name matches your Anchor.toml).
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Global variable for the game PDA.
  let gamePda: PublicKey;

  // The game ID that we use for initialization.
  const gameId = new BN(999);

  // Before any tests run, derive (and optionally initialize) the game account.
  before("initialize game", async () => {
    // Derive the game PDA using your seeds: [ "game", gameId.toBuffer("le", 4) ]
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );

    console.log("Derived game PDA:", gamePda.toBase58());

    // Optionally call the initialize_game instruction (if the game isn’t already initialized).
    // If your test environment clears accounts on each run, you can initialize it here.
    try {
      await program.methods
        .initializeGame(gameId, new BN(123)) // Pass the bump as a BN if required
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      // If the game is already initialized, you may get an error.
      console.log("Game initialization skipped or already done:", err.message);
    }
  });

  it("Registers a new agent", async () => {
    const agentId = 7;
    // Derive the agent PDA using the seeds:
    // [ "agent", gamePda, [agentId] ]
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

  it("Kills the agent", async () => {
    const agentId = 7;
    // Derive the agent PDA again (ensure you use the same seeds and agentId).
    const [agentPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
      program.programId
    );
    console.log("Using agent PDA to kill agent:", agentPda.toBase58());

    // Call the kill_agent instruction.
    const tx = await program.methods
      .killAgent()
      .accounts({
        agent: agentPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    console.log("Kill agent tx signature:", tx);
  });
});
