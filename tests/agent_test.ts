import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Agent Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  let gamePda: PublicKey;
  const gameId = new BN(999);
  const authorizedAgentId = 7;

  const unauthorizedWallet = Keypair.generate();

  const getAgentAccountNamespace = () => {
    return (program.account as any).Agent || (program.account as any).agent;
  };

  before("Initialize game", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );

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
  });

  describe("Register Agent", () => {
    it("Registers a new agent successfully (authorized)", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(authorizedAgentId)],
        program.programId
      );

      const tx = await program.methods
        .registerAgent(authorizedAgentId, 10, -4, "Gandalf")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Register agent tx signature:", tx);

      const agentAccount = await getAgentAccountNamespace().fetch(agentPda);

      expect(agentAccount.game.toBase58()).to.equal(gamePda.toBase58());
      expect(agentAccount.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agentAccount.id).to.equal(authorizedAgentId);
      expect(agentAccount.x).to.equal(10);
      expect(agentAccount.y).to.equal(-4);
      expect(agentAccount.isAlive).to.be.true;
      expect(agentAccount.lastMove.toNumber()).to.equal(0);
      expect(agentAccount.lastBattle.toNumber()).to.equal(0);
      expect(agentAccount.currentBattleStart).to.be.null;
      expect(agentAccount.allianceWith).to.be.null;
      expect(agentAccount.allianceTimestamp.toNumber()).to.equal(0);
      expect(agentAccount.tokenBalance.toNumber()).to.equal(0);
      expect(agentAccount.stakedBalance.toNumber()).to.equal(0);
      expect(agentAccount.lastRewardClaim.toNumber()).to.equal(0);
      expect(agentAccount.totalShares.toNumber()).to.equal(0);
      expect(agentAccount.lastAttack.toNumber()).to.equal(0);
      expect(agentAccount.lastIgnore.toNumber()).to.equal(0);
      expect(agentAccount.lastAlliance.toNumber()).to.equal(0);
      expect(agentAccount.nextMoveTime.toNumber()).to.equal(0);
      expect(agentAccount.vaultBump).to.equal(0);
      expect(agentAccount.lastAllianceAgent).to.be.null;
      expect(agentAccount.lastAllianceBroken.toNumber()).to.equal(0);

      console.log("All agent fields verified successfully after registration.");
    });
  });

  describe("Kill Agent", () => {
    it("Kills the agent and verifies it is marked as dead", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(authorizedAgentId)],
        program.programId
      );

      const tx = await program.methods
        .killAgent()
        .accounts({
          agent: agentPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Kill agent tx signature:", tx);

      const agentAccount = await getAgentAccountNamespace().fetch(agentPda);
      expect(agentAccount.isAlive).to.be.false;
      console.log("Agent is marked as dead successfully.");
    });
  });

  describe("Access Control Tests", () => {
    it("Fails to register an agent when called by an unauthorized wallet", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(8)],
        program.programId
      );

      let reverted = false;
      try {
        await program.methods
          .registerAgent(8, 15, 20, "Saruman")
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: unauthorizedWallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized register_agent failed as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Fails to kill the agent when called by an unauthorized wallet", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(authorizedAgentId)],
        program.programId
      );

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
        console.log("Unauthorized kill_agent failed as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
