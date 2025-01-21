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

// ----------------------------
// BATTLE CONTRACT TESTS (using SPL Tokens)
// ----------------------------
describe("Battle Contract Tests", () => {
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
        .initializeGame(gameId, 123)
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

      // Get initial token balances.
      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      console.log("Before (agent wins): solo balance =", Number(initSolo.amount), ", leader balance =", Number(initLeader.amount));

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
          singleAgentAuthority: agentAuthorities[singleAgentId].publicKey,
          allianceLeaderAuthority: agentAuthorities[allianceLeaderId].publicKey,
          alliancePartnerAuthority: agentAuthorities[alliancePartnerId].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
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
      console.log("After (agent wins): solo balance =", Number(finalSolo.amount), ", leader balance =", Number(finalLeader.amount));
      expect(Number(finalSolo.amount)).to.be.greaterThan(Number(initSolo.amount));
    });

    it("Agent loses vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      console.log("Before (agent loses): solo balance =", Number(initSolo.amount));

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
          singleAgentAuthority: agentAuthorities[singleAgentId].publicKey,
          allianceLeaderAuthority: agentAuthorities[allianceLeaderId].publicKey,
          alliancePartnerAuthority: agentAuthorities[alliancePartnerId].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .signers([
          agentAuthorities[singleAgentId],
          agentAuthorities[allianceLeaderId],
          agentAuthorities[alliancePartnerId],
        ])
        .rpc();

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      console.log("After (agent loses): solo balance =", Number(finalSolo.amount));
      expect(Number(finalSolo.amount)).to.be.below(Number(initSolo.amount));
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

      const leaderA = await deriveAgentPda(leaderAId);
      const partnerA = await deriveAgentPda(partnerAId);
      const leaderB = await deriveAgentPda(leaderBId);
      const partnerB = await deriveAgentPda(partnerBId);

      const initLeaderB = await getAccount(connection, tokenAccounts[leaderBId]);
      console.log("Before (Alliance A wins): B.Leader balance =", Number(initLeaderB.amount));

      // Call battle instruction: alliance_a_wins = true, percent_lost = 20.
      await program.methods
        .resolveBattleAllianceVsAlliance(20, true)
        .accounts({
          leaderA,
          partnerA,
          leaderB,
          partnerB,
          game: gamePda,
          leaderAToken: tokenAccounts[leaderAId],
          partnerAToken: tokenAccounts[partnerAId],
          leaderBToken: tokenAccounts[leaderBId],
          partnerBToken: tokenAccounts[partnerBId],
          leaderAAuthority: agentAuthorities[leaderAId].publicKey,
          partnerAAuthority: agentAuthorities[partnerAId].publicKey,
          leaderBAuthority: agentAuthorities[leaderBId].publicKey,
          partnerBAuthority: agentAuthorities[partnerBId].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
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
      console.log("After (Alliance A wins): B.Leader balance =", Number(finalLeaderB.amount));
      expect(Number(finalLeaderB.amount)).to.be.below(Number(initLeaderB.amount));
    });
  });

  // 3) resolve_battle_simple
  describe("resolve_battle_simple", () => {
    it("Loser pays 20% to winner", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

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
          winnerToken: tokenAccounts[winnerId],
          loserToken: tokenAccounts[loserId],
          // For a simple battle, the loser authority must sign.
          loserAuthority: agentAuthorities[loserId].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
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
      expect(Number(finalLoser.amount)).to.be.below(Number(initLoser.amount));
    });
  });

  // 4) Battle Access Control.
  describe("Battle access control", () => {
    const unauthorizedWallet = Keypair.generate();

    it("Fails to resolve a simple battle with unauthorized wallet", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winnerToken: tokenAccounts[winnerId],
            loserToken: tokenAccounts[loserId],
            loserAuthority: agentAuthorities[loserId].publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized attempt blocked:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});
