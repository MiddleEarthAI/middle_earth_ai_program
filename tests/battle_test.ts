import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Battle Tests", () => {
  // Set up provider and program.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Use a fixed game ID.
  const gameId = new BN(999);
  let gamePda: PublicKey;

  // Helpers to get account namespaces.
  const getGameAccount = async () => {
    return (program.account as any).Game || (program.account as any).game;
  };
  const getAgentAccount = async () => {
    return (program.account as any).Agent || (program.account as any).agent;
  };

  // Derive the game PDA.
  before("Setup game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived Game PDA:", gamePda.toBase58());
  });

  // Define agent IDs for testing.
  const allianceBattleAgents = {
    winner: 3,
    winnerPartner: 4,
    loser: 5,
    loserPartner: 6,
  };
  const simpleBattleAgents = {
    winner: 7,
    loser: 8,
  };

  // Unauthorized wallet for access control tests.
  const unauthorizedWallet = Keypair.generate();

  // Helper to derive an agent PDA.
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
      program.programId
    );
    return pda;
  };

  // Register agents needed for the tests.
  before("Register agents for battles", async () => {
    // Helper: register agent if not already registered.
    const registerAgentIfNotExists = async (
      agentId: number,
      x: number,
      y: number,
      name: string
    ) => {
      const agentPda = await deriveAgentPda(agentId);
      const agentAccountNs = await getAgentAccount();
      try {
        await agentAccountNs.fetch(agentPda);
        console.log(`Agent ${name} (ID: ${agentId}) already registered at PDA: ${agentPda.toBase58()}.`);
      } catch (e: any) {
        console.log(`Registering agent ${name} (ID: ${agentId}) at PDA: ${agentPda.toBase58()}`);
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
      }
    };

    // Register alliance-based battle agents.
    await registerAgentIfNotExists(allianceBattleAgents.winner, 10, 10, "WinnerAlliance");
    await registerAgentIfNotExists(allianceBattleAgents.winnerPartner, 11, 10, "WinnerPartner");
    await registerAgentIfNotExists(allianceBattleAgents.loser, -5, -5, "LoserAlliance");
    await registerAgentIfNotExists(allianceBattleAgents.loserPartner, -6, -5, "LoserPartner");

    // Register simple battle agents.
    await registerAgentIfNotExists(simpleBattleAgents.winner, 5, 5, "WinnerSimple");
    await registerAgentIfNotExists(simpleBattleAgents.loser, -2, -2, "LoserSimple");
  });

  // Form an alliance for alliance-based battle tests.
  before("Form alliance for battle", async () => {
    const winnerPda = await deriveAgentPda(allianceBattleAgents.winner);
    const loserPda = await deriveAgentPda(allianceBattleAgents.loser);

    try {
      await program.methods
        .formAlliance()
        .accounts({
          initiator: winnerPda,
          targetAgent: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Alliance formed between winner and loser.");
    } catch (e: any) {
      console.log("Alliance may already be formed:", e.message);
    }
  });

  describe("resolve_battle (with alliances)", () => {
    it("Resolves a battle and updates cooldown timers for all allied agents", async () => {
      const winnerPda = await deriveAgentPda(allianceBattleAgents.winner);
      const loserPda = await deriveAgentPda(allianceBattleAgents.loser);
      const winnerPartnerPda = await deriveAgentPda(allianceBattleAgents.winnerPartner);
      const loserPartnerPda = await deriveAgentPda(allianceBattleAgents.loserPartner);

      const agentNs = await getAgentAccount();
      // Check state BEFORE battle.
      const winnerBefore = await agentNs.fetch(winnerPda);
      const loserBefore = await agentNs.fetch(loserPda);
      const winnerPartnerBefore = await agentNs.fetch(winnerPartnerPda);
      const loserPartnerBefore = await agentNs.fetch(loserPartnerPda);

      expect(winnerBefore.lastAttack.toNumber()).to.equal(0);
      expect(loserBefore.lastAttack.toNumber()).to.equal(0);
      expect(winnerPartnerBefore.lastAttack.toNumber()).to.equal(0);
      expect(loserPartnerBefore.lastAttack.toNumber()).to.equal(0);

      const transferAmount = new BN(100);

      // Call resolve_battle instruction.
      const tx = await program.methods
        .resolveBattle(transferAmount)
        .accounts({
          winner: winnerPda,
          winnerPartner: winnerPartnerPda,
          loser: loserPda,
          loserPartner: loserPartnerPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("resolve_battle tx signature:", tx);

      // Check state AFTER battle.
      const winnerAfter = await agentNs.fetch(winnerPda);
      const loserAfter = await agentNs.fetch(loserPda);
      const winnerPartnerAfter = await agentNs.fetch(winnerPartnerPda);
      const loserPartnerAfter = await agentNs.fetch(loserPartnerPda);

      expect(winnerAfter.lastAttack.toNumber()).to.be.greaterThan(0);
      expect(loserAfter.lastAttack.toNumber()).to.be.greaterThan(0);
      expect(winnerPartnerAfter.lastAttack.toNumber()).to.equal(winnerAfter.lastAttack.toNumber());
      expect(loserPartnerAfter.lastAttack.toNumber()).to.equal(loserAfter.lastAttack.toNumber());
    });
  });

  describe("resolve_battle_simple (without alliances)", () => {
    it("Resolves a simple battle by updating the winner's and loser's cooldown timers", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      const agentNs = await getAgentAccount();
      // State BEFORE battle.
      const winnerBefore = await agentNs.fetch(winnerPda);
      const loserBefore = await agentNs.fetch(loserPda);
      expect(winnerBefore.lastAttack.toNumber()).to.equal(0);
      expect(loserBefore.lastAttack.toNumber()).to.equal(0);

      const transferAmount = new BN(200);

      // Call resolve_battle_simple instruction.
      // (Assuming this function is now properly exposed in your program)
      const tx = await program.methods
        .resolveBattleSimple(transferAmount)
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("resolve_battle_simple tx signature:", tx);

      // State AFTER battle.
      const winnerAfter = await agentNs.fetch(winnerPda);
      const loserAfter = await agentNs.fetch(loserPda);
      expect(winnerAfter.lastAttack.toNumber()).to.be.greaterThan(0);
      expect(loserAfter.lastAttack.toNumber()).to.be.greaterThan(0);
    });
  });

  describe("Access Control Tests (Battle Resolution)", () => {
    it("Fails to resolve a battle when called by an unauthorized wallet", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      let reverted = false;
      try {
        await program.methods
          .resolveBattleSimple(new BN(50))
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized resolve_battle_simple prevented as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
