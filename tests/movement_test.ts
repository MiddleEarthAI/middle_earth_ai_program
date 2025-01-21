import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { expect } from "chai";

describe("Movement Tests", () => {
  // 1) Set up the provider + program.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // 2) For the seeds used in the code, we pass gameId & bump in `initializeGame`.
  const gameId = new BN(1234);
  const bump = 99; // example bump; must match your on-chain seeds logic

  // 3) We'll store the PDAs & agent ID.
  let gamePda: PublicKey;
  const agentId = 42; // Single agent ID for all movement tests
  let agentPda: PublicKey;

  // We'll also create an unauthorized wallet for testing
  const unauthorizedWallet = Keypair.generate();

  before("Initialize game + register agent", async () => {
    // A) Derive the Game PDA
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived gamePda:", gamePda.toBase58());

    // B) Initialize the game.
    try {
      await program.methods
        .initializeGame(gameId, new BN(bump))
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped or already exists:", err.message);
    }

    // C) Derive the Agent PDA matching on-chain seeds:
    [agentPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(), // must match `game.key().as_ref()`
        Buffer.from([agentId]),
      ],
      program.programId
    );
    console.log("Derived agentPda:", agentPda.toBase58());

    // D) Register the agent using the proper authority (the provider's wallet).
    try {
      await program.methods
        .registerAgent(agentId, 0, 0, "MovementTestAgent")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Agent registered successfully.");
    } catch (err: any) {
      console.log("Agent registration skipped or already done:", err.message);
    }
  });

  describe("Agent Movement", () => {
    it("Moves the agent on plain terrain", async () => {
      const newX = 10;
      const newY = 5;

      // Fetch agent state before moving.
      const initialAgent = await program.account.agent.fetch(agentPda);

      // Call moveAgent with the correct authority.
      const tx = await program.methods
        .moveAgent(newX, newY, { plain: {} })
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Move agent (plain) tx:", tx);

      // Verify that the agent state is updated.
      const updatedAgent = await program.account.agent.fetch(agentPda);
      expect(updatedAgent.x).to.equal(newX);
      expect(updatedAgent.y).to.equal(newY);
      expect(updatedAgent.lastMove.toNumber()).to.be.greaterThan(initialAgent.lastMove.toNumber());
      console.log("Plain terrain movement success.");
    });

    it("Applies correct cooldown for river terrain", async () => {
      const newX = 15;
      const newY = 20;
      const initialAgent = await program.account.agent.fetch(agentPda);

      const tx = await program.methods
        .moveAgent(newX, newY, { river: {} })
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Move agent (river) tx:", tx);

      const updatedAgent = await program.account.agent.fetch(agentPda);
      expect(updatedAgent.nextMoveTime.toNumber()).to.be.greaterThan(initialAgent.nextMoveTime.toNumber());
      console.log("River terrain cooldown success.");
    });

    it("Applies correct cooldown for mountain terrain", async () => {
      const newX = -5;
      const newY = -10;
      const initialAgent = await program.account.agent.fetch(agentPda);

      const tx = await program.methods
        .moveAgent(newX, newY, { mountain: {} })
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Move agent (mountain) tx:", tx);

      const updatedAgent = await program.account.agent.fetch(agentPda);
      expect(updatedAgent.nextMoveTime.toNumber()).to.be.greaterThan(initialAgent.nextMoveTime.toNumber());
      console.log("Mountain terrain cooldown success.");
    });

    it("Reverts if an unauthorized account calls moveAgent", async () => {
      const newX = 20;
      const newY = 20;
      let failed = false;
      try {
        await program.methods
          .moveAgent(newX, newY, { plain: {} })
          .accounts({
            agent: agentPda,
            game: gamePda,
            authority: unauthorizedWallet.publicKey, // Using unauthorized wallet
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized moveAgent reverted as expected:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});
