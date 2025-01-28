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

  // 2) Initialize game parameters.
  const gameId = new BN(1234);
  // The 'bump' is typically derived, not hard-coded. Assuming it's handled in `initializeGame`.
  // const bump = 99; // example bump; must match your on-chain seeds logic

  // 3) PDAs and agent ID.
  let gamePda: PublicKey;
  const agentId = 42; // Single agent ID for all movement tests
  let agentPda: PublicKey;

  // 4) Unauthorized wallet for testing access control.
  const unauthorizedWallet = Keypair.generate();

  // 5) Helper function to derive agent PDA.
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(), // must match `game.key().as_ref()`
        Buffer.from([agentId]),
      ],
      program.programId
    );
    return pda;
  };

  // 6) Initialize game and register agent.
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
        .initializeGame(gameId, new BN(0)) // Assuming 'bump' is handled internally
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey, // Game authority
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped or already exists:", err.message);
    }

    // C) Derive the Agent PDA matching on-chain seeds:
    agentPda = await deriveAgentPda(agentId);
    console.log("Derived agentPda:", agentPda.toBase58());

    // D) Register the agent using the game authority.
    try {
      await program.methods
        .registerAgent(agentId, 0, 0, "MovementTestAgent")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey, // Game authority acting as agent authority
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Agent registered successfully.");
    } catch (err: any) {
      console.log("Agent registration skipped or already done:", err.message);
    }
  });

  // 7) Add a helper to kill an agent (mark as dead).
  const killAgent = async (agentPda: PublicKey) => {
    await program.methods
      .killAgent()
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey, // Game authority
      })
      .rpc();
    console.log(`Agent at PDA ${agentPda.toBase58()} has been killed.`);
  };

  describe("Agent Movement", () => {
    it("Moves the agent on plain terrain successfully by game authority", async () => {
      const newX = 10;
      const newY = 5;

      // Fetch agent state before moving.
      const initialAgent = await program.account.agent.fetch(agentPda);
      expect(initialAgent.isAlive).to.be.true;

      // Call moveAgent with the game authority.
      const tx = await program.methods
        .moveAgent(newX, newY, { plain: {} })
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: provider.wallet.publicKey, // Game authority
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
          authority: provider.wallet.publicKey, // Game authority
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
          authority: provider.wallet.publicKey, // Game authority
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

    it("Reverts if attempting to move a dead agent", async () => {
      const newX = 25;
      const newY = 25;

      // **Step 1: Kill the agent**
      await killAgent(agentPda);

      // Fetch agent state to confirm death
      const killedAgent = await program.account.agent.fetch(agentPda);
      expect(killedAgent.isAlive).to.be.false;

      // **Step 2: Attempt to move the dead agent**
      let failed = false;
      try {
        await program.methods
          .moveAgent(newX, newY, { plain: {} })
          .accounts({
            agent: agentPda,
            game: gamePda,
            authority: provider.wallet.publicKey, // Game authority
          })
          .rpc();
      } catch (err: any) {
        console.log("MoveAgent for dead agent reverted as expected:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

   
  });
});
