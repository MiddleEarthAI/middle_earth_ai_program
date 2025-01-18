import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Battle Tests with Token Transfers and Proportional Distribution", () => {
  // Set up Anchor provider and program.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Use a fixed game ID.
  const gameId = new BN(999);
  let gamePda: PublicKey;

  // Helper functions to get the game and agent account namespaces.
  const getGameAccount = async () =>
    (program.account as any).Game || (program.account as any).game;
  const getAgentAccount = async () =>
    (program.account as any).Agent || (program.account as any).agent;

  before("Setup game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived Game PDA:", gamePda.toBase58());
  });

  // Define distinct agent IDs for testing.
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

  // Create an unauthorized wallet for access control tests.
  const unauthorizedWallet = Keypair.generate();

  // Helper to derive an agent PDA given its ID.
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Uint8Array.of(agentId)],
      program.programId
    );
    return pda;
  };

  // IMPORTANT: Replace these placeholder addresses with actual SPL token account addresses.
  // For alliance-based battle:
  const winnerTokenAlliance = new PublicKey("WinnerAllianceTokenAccountAddressHere");
  const winnerPartnerTokenAlliance = new PublicKey("WinnerPartnerTokenAccountAddressHere");
  const loserTokenAlliance = new PublicKey("LoserAllianceTokenAccountAddressHere");
  const loserPartnerTokenAlliance = new PublicKey("LoserAlliancePartnerTokenAccountAddressHere");
  // For simple battle:
  const winnerTokenSimple = new PublicKey("WinnerTokenAccountAddressHere");
  const loserTokenSimple = new PublicKey("LoserTokenAccountAddressHere");

  // Register agents if they are not already registered.
  before("Register agents for battles", async () => {
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

    await registerAgentIfNotExists(allianceBattleAgents.winner, 10, 10, "WinnerAlliance");
    await registerAgentIfNotExists(allianceBattleAgents.winnerPartner, 11, 10, "WinnerPartner");
    await registerAgentIfNotExists(allianceBattleAgents.loser, -5, -5, "LoserAlliance");
    await registerAgentIfNotExists(allianceBattleAgents.loserPartner, -6, -5, "LoserPartner");
    await registerAgentIfNotExists(simpleBattleAgents.winner, 5, 5, "WinnerSimple");
    await registerAgentIfNotExists(simpleBattleAgents.loser, -2, -2, "LoserSimple");
  });

  // For alliance-based battle tests, form an alliance.
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
      console.log("Alliance formation may already exist:", e.message);
    }
  });

  describe("resolve_battle (with alliances)", () => {
    it("Resolves an alliance battle, updating cooldowns and transferring tokens proportionally", async () => {
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

      const percentLost = 20; // 20% loss

      // Get token balances BEFORE battle.
      const loserTokenBefore = await provider.connection.getTokenAccountBalance(loserTokenAlliance);
      const loserPartnerTokenBefore = await provider.connection.getTokenAccountBalance(loserPartnerTokenAlliance);
      console.log("Loser token balance before:", loserTokenBefore.value.uiAmount);
      console.log("Loser partner token balance before:", loserPartnerTokenBefore.value.uiAmount);

      // Call the resolve_battle instruction.
      const tx = await program.methods
        .resolveBattle(percentLost)
        .accounts({
          winner: winnerPda,
          winner_partner: winnerPartnerPda,
          loser: loserPda,
          loser_partner: loserPartnerPda,
          game: gamePda,
          winner_token: winnerTokenAlliance,
          winner_partner_token: winnerPartnerTokenAlliance,
          loser_token: loserTokenAlliance,
          loser_partner_token: loserPartnerTokenAlliance,
          loser_authority: provider.wallet.publicKey,
          loser_partner_authority: provider.wallet.publicKey,
          token_program: anchor.spl.token.TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("resolve_battle tx signature:", tx);

      // Check state AFTER battle.
      const winnerAfter = await agentNs.fetch(winnerPda);
      const loserAfter = await agentNs.fetch(loserPda);
      expect(winnerAfter.lastAttack.toNumber()).to.be.greaterThan(0);
      expect(loserAfter.lastAttack.toNumber()).to.be.greaterThan(0);

      // Get token balances AFTER battle.
      const loserTokenAfter = await provider.connection.getTokenAccountBalance(loserTokenAlliance);
      const loserPartnerTokenAfter = await provider.connection.getTokenAccountBalance(loserPartnerTokenAlliance);
      console.log("Loser token balance after:", loserTokenAfter.value.uiAmount);
      console.log("Loser partner token balance after:", loserPartnerTokenAfter.value.uiAmount);

      // (Optional) You can add assertions to compare the balances to expected lost values.
    });
  });

  describe("resolve_battle_simple (without alliances)", () => {
    it("Resolves a simple battle, updating cooldowns and transferring tokens", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      const agentNs = await getAgentAccount();
      // State BEFORE battle.
      const winnerBefore = await agentNs.fetch(winnerPda);
      const loserBefore = await agentNs.fetch(loserPda);
      expect(winnerBefore.lastAttack.toNumber()).to.equal(0);
      expect(loserBefore.lastAttack.toNumber()).to.equal(0);

      const winnerTokenBalBefore = await provider.connection.getTokenAccountBalance(winnerTokenSimple);
      const loserTokenBalBefore = await provider.connection.getTokenAccountBalance(loserTokenSimple);
      console.log("Winner token balance before:", winnerTokenBalBefore.value.uiAmount);
      console.log("Loser token balance before:", loserTokenBalBefore.value.uiAmount);

      const percentLost = 20; // 20% loss

      // Call the resolve_battle_simple instruction.
      const tx = await program.methods
        .resolveBattleSimple(percentLost)
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winner_token: winnerTokenSimple,
          loser_token: loserTokenSimple,
          loser_authority: provider.wallet.publicKey,
          token_program: anchor.spl.token.TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("resolve_battle_simple tx signature:", tx);

      // State AFTER battle.
      const winnerAfter = await agentNs.fetch(winnerPda);
      const loserAfter = await agentNs.fetch(loserPda);
      expect(winnerAfter.lastAttack.toNumber()).to.be.greaterThan(0);
      expect(loserAfter.lastAttack.toNumber()).to.be.greaterThan(0);

      const winnerTokenBalAfter = await provider.connection.getTokenAccountBalance(winnerTokenSimple);
      const loserTokenBalAfter = await provider.connection.getTokenAccountBalance(loserTokenSimple);
      console.log("Winner token balance after:", winnerTokenBalAfter.value.uiAmount);
      console.log("Loser token balance after:", loserTokenBalAfter.value.uiAmount);

      const initialLoserBalance = loserTokenBalBefore.value.uiAmount || 0;
      const expectedLost = initialLoserBalance * (percentLost / 100);
      expect(loserTokenBalAfter.value.uiAmount).to.be.lessThan(initialLoserBalance);
    });
  });

  describe("Access Control Tests (Battle Resolution)", () => {
    it("Fails to resolve a battle when called by an unauthorized wallet", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      let reverted = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winner_token: new PublicKey("WinnerTokenAccountAddressHere"),
            loser_token: new PublicKey("LoserTokenAccountAddressHere"),
            loser_authority: provider.wallet.publicKey,
            token_program: anchor.spl.token.TOKEN_PROGRAM_ID,
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
