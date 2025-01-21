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
// AGENT AND GAME TESTS
// ----------------------------
describe("Agent Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;
  let gamePda: PublicKey;
  const gameId = new BN(999);
  const newAgentId = 100; // Unique agent id for testing
  const unauthorizedWallet = Keypair.generate();

  // Helper: determine the agent account namespace (try both lower/upper)
  const getAgentAccountNs = () => (program.account as any).agent || (program.account as any).Agent;

  before("Initialize game", async () => {
    // Derive game PDA using seed "game" and little-endian gameId
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
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized or already active.");
    } catch (err: any) {
      console.log("Game initialization skipped (already initialized?):", err.message);
    }
  });

  describe("Register Agent", () => {
    it("Registers an agent successfully (authorized)", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
        program.programId
      );

      const txSig = await program.methods
        .registerAgent(newAgentId, 10, -4, "Gandalf")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Register agent tx sig:", txSig);

      const agentAcc = await getAgentAccountNs().fetch(agentPda);
      expect(agentAcc.id).to.equal(newAgentId);
      expect(agentAcc.isAlive).to.be.true;
      console.log("Agent registered & verified.");
    });
  });

  describe("Kill Agent", () => {
    it("Kills the agent and verifies", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
        program.programId
      );

      const txSig = await program.methods
        .killAgent()
        .accounts({
          agent: agentPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Kill agent tx sig:", txSig);

      const agentAcc = await getAgentAccountNs().fetch(agentPda);
      expect(agentAcc.isAlive).to.be.false;
      console.log("Agent is now dead.");
    });
  });

  describe("Agent Access Control", () => {
    it("Fails to register with unauthorized wallet", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([101])],
        program.programId
      );

      let failed = false;
      try {
        await program.methods
          .registerAgent(101, 15, 20, "Saruman")
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: unauthorizedWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized registerAgent as expected:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

    it("Fails to kill agent with unauthorized wallet", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
        program.programId
      );

      let failed = false;
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
        console.log("Unauthorized killAgent as expected:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});

// ----------------------------
// BATTLE CONTRACT TESTS (using SPL Tokens)
// ----------------------------
describe("Battle Contract Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payer = provider.wallet.payer;
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  const gameId = new BN(999);
  let gamePda: PublicKey;
  let tokenMint: PublicKey;
  // Map agent ID to its associated token account (ATA)
  const tokenAccounts: { [agentId: number]: PublicKey } = {};

  // Predefined agent IDs for various battle scenarios
  const allianceBattleAgents = { 
    singleAgent: 3,       // The agent battling against an alliance
    allianceLeader: 5, 
    alliancePartner: 6 
  };

  const allianceA = { leader: 10, partner: 11 };
  const allianceB = { leader: 12, partner: 13 };

  const simpleBattle = { winner: 20, loser: 21 };

  // Helper: derive an agent's PDA from seeds ["agent", gamePda, [agentId]]
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    return pda;
  };

  before("Derive Game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived game PDA:", gamePda.toBase58());
  });

  before("Create mint & token accounts", async () => {
    // Create a new SPL token mint (decimals = 9)
    tokenMint = await createMint(connection, payer, provider.wallet.publicKey, null, 9);
    console.log("Created token mint:", tokenMint.toBase58());

    // We'll use a higher mint amount so that percentage deductions are significant.
    const initialMintAmount = 100_000_000_000; // e.g., 100,000 tokens (if decimals = 9)

    // Gather all agent IDs that will participate in battles:
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

    for (const id of allAgentIds) {
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        provider.wallet.publicKey,  // All accounts are owned by the same wallet for this test
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tokenAccounts[id] = ata.address;
      console.log(`Token account for agent ${id}: ${ata.address.toBase58()}`);

      await mintTo(
        connection,
        payer,
        tokenMint,
        ata.address,
        provider.wallet.publicKey,
        initialMintAmount
      );
      console.log(`Minted ${initialMintAmount} tokens to agent ${id}`);
    }
  });

  before("Register needed agents & form alliance (if applicable)", async () => {
    const registerAgent = async (agentId: number, x: number, y: number, name: string) => {
      const pda = await deriveAgentPda(agentId);
      try {
        await program.account.agent.fetch(pda);
        console.log(`Agent ${name} (ID ${agentId}) already registered.`);
      } catch {
        // Register if missing
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: pda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`Registered agent ${name} (ID=${agentId})`);
      }
    };

    // For alliance battle (agent vs alliance)
    await registerAgent(allianceBattleAgents.singleAgent, 0, 0, "SoloAgent");
    await registerAgent(allianceBattleAgents.allianceLeader, 1, 1, "AllianceLeader");
    await registerAgent(allianceBattleAgents.alliancePartner, 2, 2, "AlliancePartner");

    // For alliance vs alliance
    await registerAgent(allianceA.leader, 10, 10, "AllianceA_Leader");
    await registerAgent(allianceA.partner, 11, 11, "AllianceA_Partner");
    await registerAgent(allianceB.leader, -10, -10, "AllianceB_Leader");
    await registerAgent(allianceB.partner, -11, -11, "AllianceB_Partner");

    // For simple battle
    await registerAgent(simpleBattle.winner, 5, 5, "SimpleBattleWinner");
    await registerAgent(simpleBattle.loser, -5, -5, "SimpleBattleLoser");

    // (Optional) Form an alliance, if your program logic requires it for any test.
    // For example:
    const initiatorPda = await deriveAgentPda(allianceBattleAgents.singleAgent);
    const targetPda = await deriveAgentPda(allianceBattleAgents.allianceLeader);
    try {
      await program.methods
        .formAlliance()
        .accounts({
          initiator: initiatorPda,
          targetAgent: targetPda,
          game: gamePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Formed alliance between SoloAgent and AllianceLeader (if applicable).");
    } catch (err: any) {
      console.log("Alliance possibly already formed:", err.message);
    }
  });

  // --------------------
  // 1) resolve_battle_agent_vs_alliance
  // --------------------
  describe("resolve_battle_agent_vs_alliance", () => {
    it("Agent wins vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      const initSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      console.log("Before (agent wins): solo balance =", Number(initSolo.amount), "leader balance =", Number(initLeader.amount));

      // Agent wins vs alliance: percent_lost = 30, agent_is_winner = true
      try {
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
      } catch (err: any) {
        console.error("Error in resolveBattleAgentVsAlliance (agent wins):", err.message);
        throw err;
      }

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      console.log("After (agent wins): solo balance =", Number(finalSolo.amount), "leader balance =", Number(finalLeader.amount));
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

      // Agent loses vs alliance: percent_lost = 25, agent_is_winner = false
      try {
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
      } catch (err: any) {
        console.error("Error in resolveBattleAgentVsAlliance (agent loses):", err.message);
        throw err;
      }

      const finalSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      console.log("After (agent loses): solo balance =", Number(finalSolo.amount));
      expect(Number(finalSolo.amount)).to.be.below(Number(initSolo.amount));
    });
  });

  // --------------------
  // 2) resolve_battle_alliance_vs_alliance
  // --------------------
  describe("resolve_battle_alliance_vs_alliance", () => {
    it("Alliance A wins vs Alliance B", async () => {
      // A's PDAs
      const leaderA = await deriveAgentPda(allianceA.leader);
      const partnerA = await deriveAgentPda(allianceA.partner);
      // B's PDAs
      const leaderB = await deriveAgentPda(allianceB.leader);
      const partnerB = await deriveAgentPda(allianceB.partner);

      const initLeaderB = await getAccount(connection, tokenAccounts[allianceB.leader]);
      console.log("Before (Alliance A wins): B.Leader balance =", Number(initLeaderB.amount));

      // Alliance A wins vs Alliance B: percent_lost = 20, alliance_a_wins = true
      try {
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
      } catch (err: any) {
        console.error("Error in resolveBattleAllianceVsAlliance:", err.message);
        throw err;
      }

      const finalLeaderB = await getAccount(connection, tokenAccounts[allianceB.leader]);
      console.log("After (Alliance A wins): B.Leader balance =", Number(finalLeaderB.amount));
      expect(Number(finalLeaderB.amount)).to.be.below(Number(initLeaderB.amount));
    });
  });

  // --------------------
  // 3) resolve_battle_simple
  // --------------------
  describe("resolve_battle_simple", () => {
    it("Loser pays 20% to winner", async () => {
      const winnerPda = await deriveAgentPda(simpleBattle.winner);
      const loserPda = await deriveAgentPda(simpleBattle.loser);

      const initWinner = await getAccount(connection, tokenAccounts[simpleBattle.winner]);
      const initLoser = await getAccount(connection, tokenAccounts[simpleBattle.loser]);

      console.log("Before (simple battle): winner =", Number(initWinner.amount), "loser =", Number(initLoser.amount));

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
            authority: provider.wallet.publicKey,
          })
          .rpc();
      } catch (err: any) {
        console.error("Error in resolveBattleSimple:", err.message);
        throw err;
      }

      const finalWinner = await getAccount(connection, tokenAccounts[simpleBattle.winner]);
      const finalLoser = await getAccount(connection, tokenAccounts[simpleBattle.loser]);
      console.log("After (simple battle): winner =", Number(finalWinner.amount), "loser =", Number(finalLoser.amount));

      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(initWinner.amount));
      expect(Number(finalLoser.amount)).to.be.lessThan(Number(initLoser.amount));
    });
  });

  // --------------------
  // 4) Battle Access Control
  // --------------------
  describe("Battle access control", () => {
    const unauthorizedWallet = Keypair.generate();

    it("Fails to resolve a simple battle with unauthorized wallet", async () => {
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
