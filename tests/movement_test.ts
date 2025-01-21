import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { expect } from "chai";

describe("Movement Tests", () => {
  // 1) Set up the Anchor provider + program.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // 2) For the seeds used in the code, we pass gameId & bump in `initializeGame`.
  const gameId = new BN(1234);
  const bump = 99; // example bump; must match your on-chain seeds logic

  // 3) We’ll store the PDAs & agent ID.
  let gamePda: PublicKey;
  const agentId = 42; // Single agent ID for all movement tests
  let agentPda: PublicKey;

  before("Initialize game + register agent", async () => {
    //
    // A) Derive the Game PDA
    //
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived gamePda:", gamePda.toBase58());

    //
    // B) Call initializeGame with consistent seeds
    //
    // Make sure your on-chain code does:
    //   #[account( init, seeds=[b"game", &game_id.to_le_bytes()], bump, ... )]
    // in the InitializeGame struct.
    //
    // If the game is already init, you can remove the try/catch or do `anchor clean`.
    //
    try {
      await program.methods
        .initializeGame(gameId, new BN(bump)) // gameId + bump
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

    //
    // C) Derive the Agent PDA with seeds matching your on-chain logic:
    //   #[account( init, seeds = [b"agent", game.key().as_ref(), &[agent_id]], bump, ... )]
    //
    [agentPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(), // Must match `game.key().as_ref()`
        Buffer.from([agentId]),
      ],
      program.programId
    );
    console.log("Derived agentPda:", agentPda.toBase58());

    //
    // D) Register the agent with the same ID + seeds
    //
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

      // 1) Fetch the agent state before moving
      const initialAgent = await program.account.agent.fetch(agentPda);

      // 2) Move the agent
      const tx = await program.methods
        .moveAgent(newX, newY, { plain: {} })
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Move agent (plain) tx:", tx);

      // 3) Verify agent state updated
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
      // Example: if your code adds (7200 - 300) = 6900 secs
      // just verify nextMoveTime is above old nextMoveTime
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
      // Example: if your code adds (10800 - 600) = 10200 secs
      expect(updatedAgent.nextMoveTime.toNumber()).to.be.greaterThan(initialAgent.nextMoveTime.toNumber());
      console.log("Mountain terrain cooldown success.");
    });


  });
});
