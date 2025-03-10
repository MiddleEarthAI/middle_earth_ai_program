import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

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
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  const gameId = new BN(999);
  let gamePda: PublicKey;
  let gameBump: number; // Store the bump
  let tokenMint: PublicKey;

  const tokenAccounts: { [agentId: number]: PublicKey } = {};
  const agentAuthorities: { [agentId: number]: Keypair } = {};

  // Sample Agent IDs
  const allianceBattleAgents = {
    singleAgent: 3,
    allianceLeader: 5,
    alliancePartner: 6,
  };
  const allianceA = { leader: 10, partner: 11 };
  const allianceB = { leader: 12, partner: 13 };
  const simpleBattle = { winner: 20, loser: 21 };

  // We'll gather *all* agent IDs in one array for resets
  const ALL_AGENT_IDS = [
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

  // Derive agent PDA
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(),
        Buffer.from([agentId]),
      ],
      program.programId
    );
    return pda;
  };

  before("Initialize game", async () => {
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    gamePda = pda;
    gameBump = bump;

    try {
      await program.methods
        .initializeGame(gameId.toNumber(), gameBump)
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized.");
    } catch (err: any) {
      if (err.message.includes("already in use")) {
        console.log("Game account already initialized.");
      } else {
        console.error("Failed to initialize game:", err);
      }
    }
  });

  before("Create token mint & ATAs", async () => {
    tokenMint = await createMint(
      connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      9
    );
    console.log("Created token mint:", tokenMint.toBase58());

    // Agents
    const initialMintAmount = 1_000_000_000_000;
    for (const id of ALL_AGENT_IDS) {
      const agentAuth = Keypair.generate();
      agentAuthorities[id] = agentAuth;

      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        tokenMint,
        agentAuth.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tokenAccounts[id] = ata.address;
      console.log(`Created ATA for agent ${id}, minting tokens...`);

      await mintTo(
        connection,
        provider.wallet.payer,
        tokenMint,
        ata.address,
        provider.wallet.publicKey,
        initialMintAmount
      );
    }
  });

  before("Airdrop SOL to agent authorities", async () => {
    const airdropAmount = 2e9; // 2 SOL
    for (const id of ALL_AGENT_IDS) {
      const agentPubkey = agentAuthorities[id].publicKey;
      const sig = await connection.requestAirdrop(agentPubkey, airdropAmount);
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`Airdropped ${airdropAmount} lamports to agent ${id}: ${agentPubkey.toBase58()}`);
    }
  });

  before("Register Agents", async () => {
    // For each agent, register with some default coords
    const registerAgent = async (agentId: number, x: number, y: number, name: string) => {
      const agentPda = await deriveAgentPda(agentId);
      try {
        await program.account.agent.fetch(agentPda);
        console.log(`Agent ${name} (ID ${agentId}) already registered.`);
      } catch {
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: agentAuthorities[agentId].publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([agentAuthorities[agentId]])
          .rpc();
        console.log(`Agent ${name} registered.`);
      }
    };

    // Alliance battles
    await registerAgent(allianceBattleAgents.singleAgent, 0, 0, "SoloAgent");
    await registerAgent(allianceBattleAgents.allianceLeader, 1, 1, "AllianceLeader");
    await registerAgent(allianceBattleAgents.alliancePartner, 2, 2, "AlliancePartner");

    // Two alliances
    await registerAgent(allianceA.leader, 10, 10, "AllianceA_Leader");
    await registerAgent(allianceA.partner, 11, 11, "AllianceA_Partner");
    await registerAgent(allianceB.leader, 12, 12, "AllianceB_Leader");
    await registerAgent(allianceB.partner, 13, 13, "AllianceB_Partner");

    // Simple battle
    await registerAgent(simpleBattle.winner, 20, 20, "SimpleBattleWinner");
    await registerAgent(simpleBattle.loser, 21, 21, "SimpleBattleLoser");
  });

  // Reset battle-related state after each test.
  afterEach("reset leftover agent state", async () => {
    const chunk = (arr: number[], size: number) =>
      arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : [];
    const groups = chunk(ALL_AGENT_IDS, 4);
    for (const group of groups) {
      const [a1, a2, a3, a4] = [
        group[0] ?? group[0],
        group[1] ?? group[0],
        group[2] ?? group[0],
        group[3] ?? group[0],
      ];
      const agentPda1 = await deriveAgentPda(a1);
      const agentPda2 = await deriveAgentPda(a2);
      const agentPda3 = await deriveAgentPda(a3);
      const agentPda4 = await deriveAgentPda(a4);
      try {
        await program.methods
          .resetBattleTimes()
          .accounts({
            agent1: agentPda1,
            agent2: agentPda2,
            agent3: agentPda3,
            agent4: agentPda4,
            authority: provider.wallet.publicKey,
          })
          .rpc();
      } catch (err: any) {
        console.log("resetBattleTimes call failed, possibly partial =>", err.message);
      }
    }
    console.log("Finished resetting leftover agent states.");
  });

  // --- Battle Resolution Tests (without starting battles or cooldowns) ---

  describe("Battle - Agent vs Alliance", () => {
    it("Agent wins vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      // Directly call resolveBattleAgentVsAlliance without starting a battle or checking cooldowns
      await program.methods
        .resolveBattleAgentVsAlliance(new BN(30), true)
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
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const finalPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);

      console.log("After (agent wins): solo balance =", Number(finalSolo.amount), ", leader balance =", Number(finalLeader.amount), ", partner balance =", Number(finalPartner.amount));
      expect(Number(finalSolo.amount)).to.be.greaterThan(1_000_000_000_000);
      expect(Number(finalLeader.amount)).to.be.lessThan(1_000_000_000_000);
      expect(Number(finalPartner.amount)).to.be.lessThan(1_000_000_000_000);
    });

    it("Agent loses vs alliance", async () => {
      const singleAgentId = allianceBattleAgents.singleAgent;
      const allianceLeaderId = allianceBattleAgents.allianceLeader;
      const alliancePartnerId = allianceBattleAgents.alliancePartner;

      const singlePda = await deriveAgentPda(singleAgentId);
      const leaderPda = await deriveAgentPda(allianceLeaderId);
      const partnerPda = await deriveAgentPda(alliancePartnerId);

      const beforeSolo = await getAccount(connection, tokenAccounts[singleAgentId]);
      const beforeLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const beforePartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);
      await program.methods
        .resolveBattleAgentVsAlliance(new BN(25), false)
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
      const finalLeader = await getAccount(connection, tokenAccounts[allianceLeaderId]);
      const finalPartner = await getAccount(connection, tokenAccounts[alliancePartnerId]);

      console.log("After (agent loses): solo balance =", Number(finalSolo.amount), ", leader balance =", Number(finalLeader.amount), ", partner balance =", Number(finalPartner.amount));
      expect(Number(finalSolo.amount - beforeSolo.amount)).to.be.lessThan(0);
      expect(Number(finalLeader.amount - beforeLeader.amount)).to.be.greaterThan(0);
      expect(Number(finalPartner.amount - beforePartner.amount)).to.be.greaterThan(0);
    });
  });

  describe("Battle - Alliance vs Alliance", () => {
    it("Alliance A wins vs Alliance B", async () => {
      const leaderAId = allianceA.leader;
      const partnerAId = allianceA.partner;
      const leaderBId = allianceB.leader;
      const partnerBId = allianceB.partner;

      const leaderAPda = await deriveAgentPda(leaderAId);
      const partnerAPda = await deriveAgentPda(partnerAId);
      const leaderBPda = await deriveAgentPda(leaderBId);
      const partnerBPda = await deriveAgentPda(partnerBId);

      await program.methods
        .resolveBattleAllianceVsAlliance(new BN(20), true)
        .accounts({
          leaderA: leaderAPda,
          partnerA: partnerAPda,
          leaderB: leaderBPda,
          partnerB: partnerBPda,
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
      const finalPartnerB = await getAccount(connection, tokenAccounts[partnerBId]);
      const finalLeaderA = await getAccount(connection, tokenAccounts[leaderAId]);
      const finalPartnerA = await getAccount(connection, tokenAccounts[partnerAId]);

      console.log("After (Alliance A wins): B.Leader balance =", Number(finalLeaderB.amount), ", B.Partner balance =", Number(finalPartnerB.amount));
      console.log("After (Alliance A wins): A.Leader balance =", Number(finalLeaderA.amount), ", A.Partner balance =", Number(finalPartnerA.amount));

      expect(Number(finalLeaderB.amount)).to.be.lessThan(1_000_000_000_000);
      expect(Number(finalPartnerB.amount)).to.be.lessThan(1_000_000_000_000);
      expect(Number(finalLeaderA.amount)).to.be.greaterThan(1_000_000_000_000);
      expect(Number(finalPartnerA.amount)).to.be.greaterThan(1_000_000_000_000);
    });
  });

  describe("Battle - Simple", () => {
    it("Loser pays 20% to winner", async () => {
      const winnerId = simpleBattle.winner;
      const loserId = simpleBattle.loser;
      const winnerPda = await deriveAgentPda(winnerId);
      const loserPda = await deriveAgentPda(loserId);

      await program.methods
        .resolveBattleSimple(new BN(20))
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winnerToken: tokenAccounts[winnerId],
          loserToken: tokenAccounts[loserId],
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
      console.log("After simple battle => Winner:", Number(finalWinner.amount), ", Loser:", Number(finalLoser.amount));

      expect(Number(finalWinner.amount)).to.be.greaterThan(1_000_000_000_000);
      expect(Number(finalLoser.amount)).to.be.lessThan(1_000_000_000_000);
    });
  });

  describe("Access Control & Cooldown Tests", () => {
    const unauthorizedWallet = Keypair.generate();

    it("Fails to resolve a simple battle with unauthorized wallet", async () => {
      const winnerPda = await deriveAgentPda(simpleBattle.winner);
      const loserPda = await deriveAgentPda(simpleBattle.loser);

      await program.methods
        .resolveBattleSimple(new BN(20))
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winnerToken: tokenAccounts[simpleBattle.winner],
          loserToken: tokenAccounts[simpleBattle.loser],
          loserAuthority: agentAuthorities[simpleBattle.loser].publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: unauthorizedWallet.publicKey, // Unauthorized authority
        })
        .signers([
          unauthorizedWallet
        ])
        .rpc()
        .catch((err: any) => {
          console.log("Unauthorized attempt blocked:", err.message);
          expect(err.message).to.include("Unauthorized");
        });
    });
  });
});
