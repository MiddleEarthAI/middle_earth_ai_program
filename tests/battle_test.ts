// test/battle.test.ts

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { expect } from "chai";

// SPL Token functions from @solana/spl-token.
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("Battle Contract Tests with Cooldowns", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = provider.wallet.payer;
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // We'll use an existing game with id = 999.
  const gameId = new BN(999);
  let gamePda: PublicKey;
  let tokenMint: PublicKey;

  // Create mappings:
  // - tokenAccounts: agent id -> associated token account (ATA)
  // - agentAuthorities: agent id -> dedicated Keypair used as the owner of that ATA
  const tokenAccounts: { [agentId: number]: PublicKey } = {};
  const agentAuthorities: { [agentId: number]: Keypair } = {};

  // Predefined agent IDs for different battle scenarios.
  const allianceBattleAgents = {
    singleAgent: 3,       // The "solo" agent in agent-vs-alliance battles.
    allianceLeader: 5,
    alliancePartner: 6,
  };

  const allianceA = { leader: 10, partner: 11 };
  const allianceB = { leader: 12, partner: 13 };
  const simpleBattle = { winner: 20, loser: 21 };

  // Helper: Derive an agent's PDA using seeds ["agent", gamePda, [agentId]].
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    return pda;
  };

  // --------------------
  // Initialize the game.
  // --------------------
  before("Derive Game PDA and ensure game is initialized", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived game PDA:", gamePda.toBase58());

    try {
      await program.methods
        .initializeGame(gameId, 123) // Assuming initializeGame takes gameId and some other parameter
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped (probably already active):", err.message);
    }
  });

  // ------------------------------------
  // Create Mint & Token Accounts per Agent
  // ------------------------------------
  before("Create token mint and dedicated ATAs for each agent", async () => {
    // Create a new SPL token mint (decimals = 9).
    tokenMint = await createMint(connection, payer, provider.wallet.publicKey, null, 9);
    console.log("Created token mint:", tokenMint.toBase58());

    // List all agent IDs that will participate in battles.
    const allAgentIds = [
      allianceBattleAgents.singleAgent,
      allianceBattleAgents.allianceLeader,
      allianceBattleAgents.alliancePartner,
      allianceA.leader,
      allianceA.partner,
      allianceB.leader,
      allianceB.partner,
      simpleBattle.winner,
      simpleBattle.loser,
    ];

    // Set an initial mint amount per agent.
    const initialMintAmount = 1_000_000_000_000; // e.g. 1,000,000 tokens (smallest unit)

    for (const id of allAgentIds) {
      // Generate a dedicated authority for this agent.
      const agentAuth = Keypair.generate();
      agentAuthorities[id] = agentAuth;

      // Create (or get) the associated token account for this agent,
      // using the dedicated authority as the owner.
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        agentAuth.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tokenAccounts[id] = ata.address;
      console.log(`Created ATA for agent ${id} (owner: ${agentAuth.publicKey.toBase58()}): ${ata.address.toBase58()}`);

      // Mint tokens to this ATA.
      await mintTo(connection, payer, tokenMint, ata.address, provider.wallet.publicKey, initialMintAmount);
      console.log(`Minted ${initialMintAmount} tokens to agent ${id}`);
    }
  });

  // ------------------------------------
  // (Optional) Register Agents on Chain.
  // ------------------------------------
  before("Register needed agents", async () => {
    // Helper function to register an agent if not already registered.
    const registerAgent = async (agentId: number, x: number, y: number, name: string) => {
      const pda = await deriveAgentPda(agentId);
      try {
        await program.account.agent.fetch(pda);
        console.log(`Agent ${name} (ID ${agentId}) already registered.`);
      } catch {
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: pda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`Registered agent ${name} (ID ${agentId}).`);
      }
    };

    await registerAgent(allianceBattleAgents.singleAgent, 0, 0, "SoloAgent");
    await registerAgent(allianceBattleAgents.allianceLeader, 1, 1, "AllianceLeader");
    await registerAgent(allianceBattleAgents.alliancePartner, 2, 2, "AlliancePartner");

    await registerAgent(allianceA.leader, 10, 10, "AllianceA_Leader");
    await registerAgent(allianceA.partner, 11, 11, "AllianceA_Partner");
    await registerAgent(allianceB.leader, -10, -10, "AllianceB_Leader");
    await registerAgent(allianceB.partner, -11, -11, "AllianceB_Partner");

    await registerAgent(simpleBattle.winner, 5, 5, "SimpleBattleWinner");
    await registerAgent(simpleBattle.loser, -5, -5, "SimpleBattleLoser");
  });

  // --------------------
  // Helper Functions
  // --------------------

  // Helper to set agent cooldown for testing
  const setAgentCooldown = async (agentId: number, newNextMoveTime: number) => {
    const agentPda = await deriveAgentPda(agentId);
    await program.methods
      .setAgentCooldown(new BN(newNextMoveTime))
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    console.log(`Set cooldown for agent ${agentId} to ${newNextMoveTime}`);
  };

  // Helper to fetch agent data
  const fetchAgent = async (agentId: number) => {
    const agentPda = await deriveAgentPda(agentId);
    return await program.account.agent.fetch(agentPda);
  };

  // --------------------
  // TESTS BEGIN HERE.
  // --------------------

  // 1) resolve_battle_agent_vs_alliance
  describe("resolve_battle_agent_vs_alliance", () => {
    it("Agent wins vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      // Derive PDAs.
      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      // Start the battle
      await program.methods
        .startBattleAgentVsAlliance()
        .accounts({
          attacker: singlePda,
          allianceLeader: leaderPda,
          alliancePartner: partnerPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Get initial token balances.
      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const initPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);
      console.log("Before (agent wins): solo balance =", Number(initSolo.amount), ", leader balance =", Number(initLeader.amount), ", partner balance =", Number(initPartner.amount));

      // Call battle instruction with agent_is_winner = true and percent_lost = 30.
      await program.methods
        .resolveBattleAgentVsAlliance(30, true)
        .accounts({
          singleAgent: singlePda,
          allianceLeader: leaderPda,
          alliancePartner: partnerPda,
          game: gamePda,
          singleAgentToken: tokenAccounts[singleAgentId],
          allianceLeaderToken: tokenAccounts[allianceLeaderId],
          alliancePartnerToken: tokenAccounts[alliancePartnerId],
          // Pass dedicated agent authority public keys.
          single_agent_authority: agentAuthorities[singleAgentId].publicKey,
          alliance_leader_authority: agentAuthorities[allianceLeaderId].publicKey,
          alliance_partner_authority: agentAuthorities[alliancePartnerId].publicKey,
          token_program: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[singleAgentId],
          agentAuthorities[allianceLeaderId],
          agentAuthorities[alliancePartnerId],
        ])
        .rpc();

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const finalPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);
      console.log("After (agent wins): solo balance =", Number(finalSolo.amount), ", leader balance =", Number(finalLeader.amount), ", partner balance =", Number(finalPartner.amount));
      expect(Number(finalSolo.amount)).to.be.greaterThan(Number(initSolo.amount));
      expect(Number(finalLeader.amount)).to.be.lessThan(Number(initLeader.amount));
      expect(Number(finalPartner.amount)).to.be.lessThan(Number(initPartner.amount));
    });

    it("Agent loses vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      // Start the battle
      await program.methods
        .startBattleAgentVsAlliance()
        .accounts({
          attacker: singlePda,
          allianceLeader: leaderPda,
          alliancePartner: partnerPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const initPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);
      console.log("Before (agent loses): solo balance =", Number(initSolo.amount), ", leader balance =", Number(initLeader.amount), ", partner balance =", Number(initPartner.amount));

      // Call battle instruction with agent_is_winner = false and percent_lost = 25.
      await program.methods
        .resolveBattleAgentVsAlliance(25, false)
        .accounts({
          singleAgent: singlePda,
          allianceLeader: leaderPda,
          alliancePartner: partnerPda,
          game: gamePda,
          singleAgentToken: tokenAccounts[singleAgentId],
          allianceLeaderToken: tokenAccounts[allianceLeaderId],
          alliancePartnerToken: tokenAccounts[alliancePartnerId],
          single_agent_authority: agentAuthorities[singleAgentId].publicKey,
          alliance_leader_authority: agentAuthorities[allianceLeaderId].publicKey,
          alliance_partner_authority: agentAuthorities[alliancePartnerId].publicKey,
          token_program: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[singleAgentId],
          agentAuthorities[allianceLeaderId],
          agentAuthorities[alliancePartnerId],
        ])
        .rpc();

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const finalPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);
      console.log("After (agent loses): solo balance =", Number(finalSolo.amount), ", leader balance =", Number(finalLeader.amount), ", partner balance =", Number(finalPartner.amount));
      expect(Number(finalSolo.amount)).to.be.lessThan(Number(initSolo.amount));
      expect(Number(finalLeader.amount)).to.be.greaterThan(Number(initLeader.amount));
      expect(Number(finalPartner.amount)).to.be.greaterThan(Number(initPartner.amount));
    });
  });

  // 2) resolve_battle_alliance_vs_alliance
  describe("resolve_battle_alliance_vs_alliance", () => {
    it("Alliance A wins vs Alliance B", async () => {
      // For Alliance A.
      const leaderAId = allianceA.leader;
      const partnerAId = allianceA.partner;
      // For Alliance B.
      const leaderBId = allianceB.leader;
      const partnerBId = allianceB.partner;

      const leaderAPda = await deriveAgentPda(leaderAId);
      const partnerAPda = await deriveAgentPda(partnerAId);
      const leaderBPda = await deriveAgentPda(leaderBId);
      const partnerBPda = await deriveAgentPda(partnerBId);

      // Start the battle
      await program.methods
        .startBattleAlliances()
        .accounts({
          leader_a: leaderAPda,
          partner_a: partnerAPda,
          leader_b: leaderBPda,
          partner_b: partnerBPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Get initial token balances.
      const initLeaderB = await getAccount(connection, tokenAccounts[leaderBId]);
      const initPartnerB = await getAccount(connection, tokenAccounts[partnerBId]);
      const initLeaderA = await getAccount(connection, tokenAccounts[leaderAId]);
      const initPartnerA = await getAccount(connection, tokenAccounts[partnerAId]);
      console.log("Before (Alliance A wins): B.Leader balance =", Number(initLeaderB.amount), ", B.Partner balance =", Number(initPartnerB.amount));

      // Call battle instruction: alliance_a_wins = true, percent_lost = 20.
      await program.methods
        .resolveBattleAlliances(20, true)
        .accounts({
          leader_a: leaderAPda,
          partner_a: partnerAPda,
          leader_b: leaderBPda,
          partner_b: partnerBPda,
          game: gamePda,
          leader_a_token: tokenAccounts[leaderAId],
          partner_a_token: tokenAccounts[partnerAId],
          leader_b_token: tokenAccounts[leaderBId],
          partner_b_token: tokenAccounts[partnerBId],
          leader_a_authority: agentAuthorities[leaderAId].publicKey,
          partner_a_authority: agentAuthorities[partnerAId].publicKey,
          leader_b_authority: agentAuthorities[leaderBId].publicKey,
          partner_b_authority: agentAuthorities[partnerBId].publicKey,
          token_program: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[leaderAId],
          agentAuthorities[partnerAId],
          agentAuthorities[leaderBId],
          agentAuthorities[partnerBId],
        ])
        .rpc();

      const finalLeaderB = await getAccount(connection, tokenAccounts[leaderBId]);
      const finalPartnerB = await getAccount(connection, tokenAccounts[partnerBId]);
      const finalLeaderA = await getAccount(connection, tokenAccounts[leaderAId]);
      const finalPartnerA = await getAccount(connection, tokenAccounts[partnerAId]);

      console.log("After (Alliance A wins): B.Leader balance =", Number(finalLeaderB.amount), ", B.Partner balance =", Number(finalPartnerB.amount));
      console.log("After (Alliance A wins): A.Leader balance =", Number(finalLeaderA.amount), ", A.Partner balance =", Number(finalPartnerA.amount));

      expect(Number(finalLeaderB.amount)).to.be.lessThan(Number(initLeaderB.amount));
      expect(Number(finalPartnerB.amount)).to.be.lessThan(Number(initPartnerB.amount));
      expect(Number(finalLeaderA.amount)).to.be.greaterThan(Number(initLeaderA.amount));
      expect(Number(finalPartnerA.amount)).to.be.greaterThan(Number(initPartnerA.amount));
    });

    it("Alliance B wins vs Alliance A", async () => {
      // For Alliance A.
      const leaderAId = allianceA.leader;
      const partnerAId = allianceA.partner;
      // For Alliance B.
      const leaderBId = allianceB.leader;
      const partnerBId = allianceB.partner;

      const leaderAPda = await deriveAgentPda(leaderAId);
      const partnerAPda = await deriveAgentPda(partnerAId);
      const leaderBPda = await deriveAgentPda(leaderBId);
      const partnerBPda = await deriveAgentPda(partnerBId);

      // Start the battle
      await program.methods
        .startBattleAlliances()
        .accounts({
          leader_a: leaderAPda,
          partner_a: partnerAPda,
          leader_b: leaderBPda,
          partner_b: partnerBPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Get initial token balances.
      const initLeaderA = await getAccount(connection, tokenAccounts[leaderAId]);
      const initPartnerA = await getAccount(connection, tokenAccounts[partnerAId]);
      const initLeaderB = await getAccount(connection, tokenAccounts[leaderBId]);
      const initPartnerB = await getAccount(connection, tokenAccounts[partnerBId]);
      console.log("Before (Alliance B wins): A.Leader balance =", Number(initLeaderA.amount), ", A.Partner balance =", Number(initPartnerA.amount));

      // Call battle instruction: alliance_a_wins = false, percent_lost = 15.
      await program.methods
        .resolveBattleAlliances(15, false)
        .accounts({
          leader_a: leaderAPda,
          partner_a: partnerAPda,
          leader_b: leaderBPda,
          partner_b: partnerBPda,
          game: gamePda,
          leader_a_token: tokenAccounts[leaderAId],
          partner_a_token: tokenAccounts[partnerAId],
          leader_b_token: tokenAccounts[leaderBId],
          partner_b_token: tokenAccounts[partnerBId],
          leader_a_authority: agentAuthorities[leaderAId].publicKey,
          partner_a_authority: agentAuthorities[partnerAId].publicKey,
          leader_b_authority: agentAuthorities[leaderBId].publicKey,
          partner_b_authority: agentAuthorities[partnerBId].publicKey,
          token_program: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[leaderAId],
          agentAuthorities[partnerAId],
          agentAuthorities[leaderBId],
          agentAuthorities[partnerBId],
        ])
        .rpc();

      const finalLeaderA = await getAccount(connection, tokenAccounts[leaderAId]);
      const finalPartnerA = await getAccount(connection, tokenAccounts[partnerAId]);
      const finalLeaderB = await getAccount(connection, tokenAccounts[leaderBId]);
      const finalPartnerB = await getAccount(connection, tokenAccounts[partnerBId]);

      console.log("After (Alliance B wins): A.Leader balance =", Number(finalLeaderA.amount), ", A.Partner balance =", Number(finalPartnerA.amount));
      console.log("After (Alliance B wins): B.Leader balance =", Number(finalLeaderB.amount), ", B.Partner balance =", Number(finalPartnerB.amount));

      expect(Number(finalLeaderA.amount)).to.be.lessThan(Number(initLeaderA.amount));
      expect(Number(finalPartnerA.amount)).to.be.lessThan(Number(initPartnerA.amount));
      expect(Number(finalLeaderB.amount)).to.be.greaterThan(Number(initLeaderB.amount));
      expect(Number(finalPartnerB.amount)).to.be.greaterThan(Number(initPartnerB.amount));
    });
  });

  // 3) resolve_battle_simple
  describe("resolve_battle_simple", () => {
    it("Loser pays 20% to winner", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      // Start the battle
      await program.methods
        .startBattleSimple()
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const initWinner = await getAccount(connection, tokenAccounts[winnerId]);
      const initLoser = await getAccount(connection, tokenAccounts[loserId]);
      console.log("Before (simple battle): winner =", Number(initWinner.amount), ", loser =", Number(initLoser.amount));

      // Call simple battle instruction: percent_lost = 20.
      await program.methods
        .resolveBattleSimple(20)
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winner_token: tokenAccounts[winnerId],
          loser_token: tokenAccounts[loserId],
          // For a simple battle, the loser authority must sign.
          loser_authority: agentAuthorities[loserId].publicKey,
          token_program: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[loserId]
        ])
        .rpc();

      const finalWinner = await getAccount(connection, tokenAccounts[winnerId]);
      const finalLoser = await getAccount(connection, tokenAccounts[loserId]);
      console.log("After (simple battle): winner =", Number(finalWinner.amount), ", loser =", Number(finalLoser.amount));

      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(initWinner.amount));
      expect(Number(finalLoser.amount)).to.be.lessThan(Number(initLoser.amount));
    });
  });

  // 4) Battle Access Control and Cooldown Enforcement.
  describe("Battle access control and cooldowns", () => {
    const unauthorizedWallet = Keypair.generate();

    it("Fails to resolve a simple battle with unauthorized wallet", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      // Start the battle
      await program.methods
        .startBattleSimple()
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winner_token: tokenAccounts[winnerId],
            loser_token: tokenAccounts[loserId],
            loser_authority: agentAuthorities[loserId].publicKey,
            token_program: TOKEN_PROGRAM_ID,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([
            unauthorizedWallet
          ])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized attempt blocked:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

    it("Fails to resolve a battle during cooldown", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      // Start the battle
      await program.methods
        .startBattleSimple()
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Attempt to resolve battle immediately after starting (cooldown active)
      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winner_token: tokenAccounts[winnerId],
            loser_token: tokenAccounts[loserId],
            loser_authority: agentAuthorities[loserId].publicKey,
            token_program: TOKEN_PROGRAM_ID,
            authority: provider.wallet.publicKey,
          })
          .signers([
            agentAuthorities[loserId]
          ])
          .rpc();
      } catch (err: any) {
        console.log("Battle blocked due to cooldown:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

    it("Allows battle after cooldown by setting next_move_time", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      // Start the battle
      await program.methods
        .startBattleSimple()
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const now = Math.floor(Date.now() / 1000);
      // Set the loser's next_move_time to allow battle (simulate cooldown passed)
      await setAgentCooldown(loserId, now - 3600); // Set cooldown to the past

      // Attempt to resolve battle again
      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winner_token: tokenAccounts[winnerId],
            loser_token: tokenAccounts[loserId],
            loser_authority: agentAuthorities[loserId].publicKey,
            token_program: TOKEN_PROGRAM_ID,
            authority: provider.wallet.publicKey,
          })
          .signers([
            agentAuthorities[loserId]
          ])
          .rpc();
      } catch (err: any) {
        console.log("Battle failed unexpectedly:", err.message);
        failed = true;
      }
      expect(failed).to.be.false;

      // Verify token balances as before
      const finalWinner = await getAccount(connection, tokenAccounts[winnerId]);
      const finalLoser = await getAccount(connection, tokenAccounts[loserId]);
      console.log("After (simple battle post-cooldown): winner =", Number(finalWinner.amount), ", loser =", Number(finalLoser.amount));

      // Fetch initial balances again to compare
      const updatedInitWinner = await getAccount(connection, tokenAccounts[winnerId]);
      const updatedInitLoser = await getAccount(connection, tokenAccounts[loserId]);

      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(updatedInitWinner.amount));
      expect(Number(finalLoser.amount)).to.be.lessThan(Number(updatedInitLoser.amount));
    });
  });
});
