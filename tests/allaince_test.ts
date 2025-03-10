import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Alliance Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  let gamePda: PublicKey;
  const gameId = new BN(999);

  const initiatorAgentId = 1;
  const targetAgentId = 2;
  const agent3Id = 3; // Added for Agent3

  const unauthorizedWallet = Keypair.generate();

  const getAgentAccountNamespace = () => {
    return (program.account as any).Agent || (program.account as any).agent;
  };

  const getGameAccountNamespace = () => {
    return (program.account as any).Game || (program.account as any).game;
  };

  before("Initialize game and register agents", async () => {
    // Derive game PDA
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );

    // Initialize game
    try {
      await program.methods
        .initializeGame(gameId, new BN(123))
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      console.log("Game initialization skipped or already done:", err.message);
    }

    // Register initiator agent (Agent1)
    const [initiatorPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
      program.programId
    );
    await program.methods
      .registerAgent(initiatorAgentId, 10, 10, "Initiator")
      .accounts({
        game: gamePda,
        agent: initiatorPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Register target agent (Agent2)
    const [targetPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
      program.programId
    );
    await program.methods
      .registerAgent(targetAgentId, -5, -5, "Target")
      .accounts({
        game: gamePda,
        agent: targetPda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Register Agent3
    const [agent3Pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agent3Id)],
      program.programId
    );
    await program.methods
      .registerAgent(agent3Id, 15, 15, "Agent3")
      .accounts({
        game: gamePda,
        agent: agent3Pda,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Agent3 registered at:", agent3Pda.toBase58());
  });

  describe("Form Alliance", () => {
    it("Forms an alliance successfully", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );
      const [targetPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
        program.programId
      );

      // Fetch and verify initial state
      const initiatorBefore = await getAgentAccountNamespace().fetch(initiatorPda);
      const targetBefore = await getAgentAccountNamespace().fetch(targetPda);

      expect(initiatorBefore.allianceWith).to.be.null;
      expect(targetBefore.allianceWith).to.be.null;

      // Execute the formAlliance instruction
      const tx = await program.methods
        .formAlliance()
        .accounts({
          initiator: initiatorPda,
          targetAgent: targetPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Form alliance tx signature:", tx);

      // Fetch and verify updated state
      const initiatorAfter = await getAgentAccountNamespace().fetch(initiatorPda);
      const targetAfter = await getAgentAccountNamespace().fetch(targetPda);

      expect(initiatorAfter.allianceWith.toBase58()).to.equal(targetPda.toBase58());
      expect(targetAfter.allianceWith.toBase58()).to.equal(initiatorPda.toBase58());
    });

    it("Fails to form an alliance with oneself", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );

      let reverted = false;
      try {
        await program.methods
          .formAlliance()
          .accounts({
            initiator: initiatorPda,
            targetAgent: initiatorPda, // Self-alliance
            game: gamePda,
            authority: provider.wallet.publicKey,
          })
          .rpc();
      } catch (err: any) {
        console.log("Self-alliance prevented as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Fails to form an alliance when called by an unauthorized wallet", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );
      const [targetPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
        program.programId
      );

      let reverted = false;
      try {
        await program.methods
          .formAlliance()
          .accounts({
            initiator: initiatorPda,
            targetAgent: targetPda,
            game: gamePda,
            authority: unauthorizedWallet.publicKey, // Unauthorized signer
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized form_alliance prevented as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    // New Test: Prevent forming a second alliance when already allied
    it("Prevents an agent from forming a second alliance while already in one", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );
      const [targetPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
        program.programId
      );
      const [agent3Pda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agent3Id)],
        program.programId
      );

      // Step 1: Form an initial alliance between Agent1 and Agent2


      // Fetch and verify the alliance
      const initiatorAfterFirstAlliance = await getAgentAccountNamespace().fetch(initiatorPda);
      const targetAfterFirstAlliance = await getAgentAccountNamespace().fetch(targetPda);

      expect(initiatorAfterFirstAlliance.allianceWith.toBase58()).to.equal(targetPda.toBase58());
      expect(targetAfterFirstAlliance.allianceWith.toBase58()).to.equal(initiatorPda.toBase58());

      // Step 2: Attempt to form a second alliance between Agent1 and Agent3
      let reverted = false;
      try {
        await program.methods
          .formAlliance()
          .accounts({
            initiator: initiatorPda,
            targetAgent: agent3Pda,
            game: gamePda,
            authority: provider.wallet.publicKey,
          })
          .rpc();
      } catch (err: any) {
        console.log("Attempting to form a second alliance failed as expected:", err.message);
        reverted = true;
      }

      // Step 3: Verify that the transaction was reverted
      expect(reverted).to.be.true;

      // Step 4: Confirm that Agent1's alliance remains unchanged and Agent3 remains unaffiliated
      const initiatorAfterSecondAttempt = await getAgentAccountNamespace().fetch(initiatorPda);
      const agent3AfterAttempt = await getAgentAccountNamespace().fetch(agent3Pda);

      expect(initiatorAfterSecondAttempt.allianceWith.toBase58()).to.equal(targetPda.toBase58());
      expect(agent3AfterAttempt.allianceWith).to.be.null;
    });
  });

  describe("Break Alliance", () => {
    it("Breaks an alliance successfully", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );
      const [targetPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
        program.programId
      );

      // Fetch and verify initial state
      const initiatorBefore = await getAgentAccountNamespace().fetch(initiatorPda);
      const targetBefore = await getAgentAccountNamespace().fetch(targetPda);

      expect(initiatorBefore.allianceWith.toBase58()).to.equal(targetPda.toBase58());
      expect(targetBefore.allianceWith.toBase58()).to.equal(initiatorPda.toBase58());

      // Execute the breakAlliance instruction
      const tx = await program.methods
        .breakAlliance()
        .accounts({
          initiator: initiatorPda,
          targetAgent: targetPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Break alliance tx signature:", tx);

      // Fetch and verify updated state
      const initiatorAfter = await getAgentAccountNamespace().fetch(initiatorPda);
      const targetAfter = await getAgentAccountNamespace().fetch(targetPda);

      expect(initiatorAfter.allianceWith).to.be.null;
      expect(targetAfter.allianceWith).to.be.null;
    });

    it("Fails to break an alliance when called by an unauthorized wallet", async () => {
      const [initiatorPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(initiatorAgentId)],
        program.programId
      );
      const [targetPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(targetAgentId)],
        program.programId
      );

      let reverted = false;
      try {
        await program.methods
          .breakAlliance()
          .accounts({
            initiator: initiatorPda,
            targetAgent: targetPda,
            game: gamePda,
            authority: unauthorizedWallet.publicKey, // Unauthorized signer
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized break_alliance prevented as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
