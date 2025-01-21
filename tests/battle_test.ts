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

describe("Battle Contract Tests", () => {
  // ---------------------------------------
  // Anchor / Program Setup
  // ---------------------------------------
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = provider.wallet.payer;
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // We'll use an existing Game with id = 999
  const gameId = new BN(999);
  let gamePda: PublicKey;

  // We'll create a new SPL token mint to represent the currency used in battles
  let tokenMint: PublicKey;

  // For each agent ID, we'll store their token account address in a map
  const tokenAccounts: { [agentId: number]: PublicKey } = {};

  // Some agent IDs used in alliance battles
  const allianceBattleAgents = { 
    singleAgent: 3,       // "Solo" agent in agent-vs-alliance
    allianceLeader: 5, 
    alliancePartner: 6 
  };

  // For an alliance-vs-alliance scenario:
  const allianceA = { leader: 10, partner: 11 };
  const allianceB = { leader: 12, partner: 13 };

  // For a simple (one-on-one) battle:
  const simpleBattle = { winner: 20, loser: 21 };

  // A helper to derive an agent's PDA from your existing seeds: ["agent", gamePda, [agentId]]
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    return pda;
  };

  // ---------------------------------------
  // 1) Initialize Game or Use Existing
  // ---------------------------------------
  before("Derive Game PDA and ensure game is initialized", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );

    console.log("Game PDA:", gamePda.toBase58());

    try {
      await program.methods
        .initializeGame(gameId, 123) // if it's already active, it will fail (which is fine)
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game already initialized or error:", err.message);
    }
  });

  // ---------------------------------------
  // 2) Create Mint & Fund Agents
  // ---------------------------------------
  before("Create SPL token mint + agent token accounts", async () => {
    // Create a new token mint. Mint authority = provider.wallet
    tokenMint = await createMint(
      connection,
      payer,
      provider.wallet.publicKey,
      null,
      9 // decimal
    );
    console.log("Created token mint:", tokenMint.toBase58());

    // We'll gather all agent IDs who need token balances
    const allAgentIds = [
      allianceBattleAgents.singleAgent,
      allianceBattleAgents.allianceLeader,
      allianceBattleAgents.alliancePartner,
      allianceA.leader,
      allianceA.partner,
      allianceB.leader,
      allianceB.partner,
      simpleBattle.winner,
      simpleBattle.loser
    ];

    const initialMintAmount = 5_000_000_000; // 5_000 tokens if decimals=9

    // For each agent ID, create (or fetch) an associated token account & mint them some tokens
    for (const id of allAgentIds) {
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        provider.wallet.publicKey,  // Owner = same wallet for simplicity
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tokenAccounts[id] = ata.address;

      // Mint tokens so that % deductions won't cause zero balances
      await mintTo(
        connection,
        payer,
        tokenMint,
        ata.address,
        provider.wallet.publicKey,
        initialMintAmount
      );
      console.log(`Minted ${initialMintAmount} tokens to agent ${id} at ATA ${ata.address.toBase58()}`);
    }
  });

  // ---------------------------------------
  // 3) Register Agents 
  // (Simplified. In real usage, you'd do this for each agent with actual seeds/PDAs.)
  // ---------------------------------------
  before("Register all needed agents", async () => {
    // We'll define a helper function:
    const registerAgent = async (agentId: number, x: number, y: number, name: string) => {
      const agentPda = await deriveAgentPda(agentId);
      try {
        // If it already exists, skip
        await program.account.agent.fetch(agentPda);
        console.log(`Agent ${agentId} already registered as ${name}`);
      } catch {
        // Otherwise, register
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`Registered agent ${name} (ID=${agentId})`);
      }
    };

    // Register each agent we need:
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

  // ---------------------------------------
  // TESTS
  // ---------------------------------------

  // -----------
  // Single agent vs alliance
  // -----------
  describe("resolve_battle_agent_vs_alliance", () => {
    it("Agent wins vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      // PDAs
      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      // Initial token balances
      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      console.log(
        "Before: solo balance=", 
        Number(initSolo.amount),
        "leader balance=", 
        Number(initLeader.amount)
      );

      // Agent is winner => param = `true`, percent_lost = 30
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
          singleAgentAuthority: provider.wallet.publicKey,
          allianceLeaderAuthority: provider.wallet.publicKey,
          alliancePartnerAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Check final balances
      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      console.log(
        "After: solo balance=",
        Number(finalSolo.amount),
        "leader balance=",
        Number(finalLeader.amount)
      );
      // We expect finalSolo to be higher than initSolo
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
      console.log("Before lose: solo balance=", Number(initSolo.amount));

      // agent_is_winner=false => single agent loses 25%
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
          singleAgentAuthority: provider.wallet.publicKey,
          allianceLeaderAuthority: provider.wallet.publicKey,
          alliancePartnerAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      console.log("After lose: solo balance=", Number(finalSolo.amount));
      expect(Number(finalSolo.amount)).to.be.lessThan(Number(initSolo.amount));
    });
  });

  // -----------
  // Alliance vs Alliance
  // -----------
  describe("resolve_battle_alliance_vs_alliance", () => {
    it("Alliance A wins vs Alliance B", async () => {
      // A's PDAs
      const leaderA = await deriveAgentPda(allianceA.leader);
      const partnerA = await deriveAgentPda(allianceA.partner);
      // B's PDAs
      const leaderB = await deriveAgentPda(allianceB.leader);
      const partnerB = await deriveAgentPda(allianceB.partner);

      // Check initial leaderB balance
      const initLeaderB = await getAccount(connection, tokenAccounts[allianceB.leader]);
      console.log("B.Leader init balance =", Number(initLeaderB.amount));

      // alliance_a_wins = true => B loses 20%
      await program.methods
        .resolveBattleAllianceVsAlliance(20, true)
        .accounts({
          leaderA,
          partnerA,
          leaderB,
          partnerB,
          game: gamePda,
          leaderAToken: tokenAccounts[allianceA.leader],
          partnerAToken: tokenAccounts[allianceA.partner],
          leaderBToken: tokenAccounts[allianceB.leader],
          partnerBToken: tokenAccounts[allianceB.partner],
          leaderAAuthority: provider.wallet.publicKey,
          partnerAAuthority: provider.wallet.publicKey,
          leaderBAuthority: provider.wallet.publicKey,
          partnerBAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalLeaderB = await getAccount(connection, tokenAccounts[allianceB.leader]);
      console.log("B.Leader final balance =", Number(finalLeaderB.amount));
      expect(Number(finalLeaderB.amount)).to.be.lessThan(Number(initLeaderB.amount));
    });
  });

  // -----------
  // Simple battle: one vs one
  // -----------
  describe("resolve_battle_simple", () => {
    it("loser pays 20% to winner", async () => {
      const winnerPda = await deriveAgentPda(simpleBattle.winner);
      const loserPda = await deriveAgentPda(simpleBattle.loser);

      const initWinner = await getAccount(connection, tokenAccounts[simpleBattle.winner]);
      const initLoser = await getAccount(connection, tokenAccounts[simpleBattle.loser]);

      console.log(
        "Before simple battle: winner=", 
        Number(initWinner.amount), 
        "loser=", 
        Number(initLoser.amount)
      );

      await program.methods
        .resolveBattleSimple(20) // 20% from loser->winner
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winnerToken: tokenAccounts[simpleBattle.winner],
          loserToken: tokenAccounts[simpleBattle.loser],
          loserAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalWinner = await getAccount(connection, tokenAccounts[simpleBattle.winner]);
      const finalLoser = await getAccount(connection, tokenAccounts[simpleBattle.loser]);
      console.log(
        "After simple battle: winner=", 
        Number(finalWinner.amount), 
        "loser=", 
        Number(finalLoser.amount)
      );

      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(initWinner.amount));
      expect(Number(finalLoser.amount)).to.be.lessThan(Number(initLoser.amount));
    });
  });

  // -----------
  // Access Control test (optional)
  // -----------
  describe("Battle access control", () => {
    const unauthorizedWallet = Keypair.generate();

    it("Fails to call resolveBattleSimple with unauthorized wallet", async () => {
      const winnerPda = await deriveAgentPda(simpleBattle.winner);
      const loserPda = await deriveAgentPda(simpleBattle.loser);

      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winnerToken: tokenAccounts[simpleBattle.winner],
            loserToken: tokenAccounts[simpleBattle.loser],
            loserAuthority: provider.wallet.publicKey,
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