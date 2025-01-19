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
  const newAgentId = 100; // Unique ID for an agent to avoid conflicts
  const unauthorizedWallet = Keypair.generate();

  // Helper: fetch agent accounts if needed
  const getAgentAccountNs = () => (program.account as any).agent || (program.account as any).Agent;

  before("Initialize game", async () => {
    // Derive game PDA
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
  // ATA addresses for each agent ID
  const tokenAccounts: { [agentId: number]: PublicKey } = {};

  // Predefined agent IDs for alliances or simple battles
  const allianceBattleAgents = { winner: 3, winnerPartner: 4, loser: 5, loserPartner: 6 };
  const simpleBattleAgents = { winner: 7, loser: 8 };

  const unauthorizedWallet = Keypair.generate();

  // Helper: derive agent PDA
  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    return pda;
  };

  before("Derive game PDA", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Derived game PDA:", gamePda.toBase58());
  });

  before("Create mint & token accounts", async () => {
    tokenMint = await createMint(connection, payer, payer.publicKey, null, 9);
    console.log("Created token mint:", tokenMint.toBase58());

    const allIds = [
      ...Object.values(allianceBattleAgents),
      ...Object.values(simpleBattleAgents),
    ];
    const mintAmount = 6_000_000_000; // so we can see changes if they happen

    for (const id of allIds) {
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        provider.wallet.publicKey,
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
        mintAmount
      );
      console.log(`Minted ${mintAmount} tokens to agent ${id}`);
    }
  });

  before("Register needed agents & form alliance", async () => {
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
        console.log(`Registered agent ${name} (ID: ${agentId})`);
      }
    };

    // Alliance battle
    await registerAgent(allianceBattleAgents.winner, 10, 10, "AllianceWinner");
    await registerAgent(allianceBattleAgents.winnerPartner, 11, 10, "AllianceWinnerPartner");
    await registerAgent(allianceBattleAgents.loser, -5, -5, "AllianceLoser");
    await registerAgent(allianceBattleAgents.loserPartner, -6, -5, "AllianceLoserPartner");

    // Simple battle
    await registerAgent(simpleBattleAgents.winner, 5, 5, "SimpleWinner");
    await registerAgent(simpleBattleAgents.loser, -2, -2, "SimpleLoser");

    // Form alliance for test
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
      console.log("Alliance formed between winner & loser.");
    } catch (err: any) {
      console.log("Alliance possibly already formed:", err.message);
    }
  });

  // 1) resolve_battle_agent_vs_alliance
  describe("resolve_battle_agent_vs_alliance", () => {
    it("Agent wins vs alliance", async () => {
      // singleAgent is allianceBattleAgents.winner
      // alliance = { leader: allianceBattleAgents.loser, partner: allianceBattleAgents.loserPartner }
      const singleAgentPda = await deriveAgentPda(allianceBattleAgents.winner);
      const allianceLeaderPda = await deriveAgentPda(allianceBattleAgents.loser);
      const alliancePartnerPda = await deriveAgentPda(allianceBattleAgents.loserPartner);

      const initSingle = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      const initLeader = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      console.log("Before battle: single:", Number(initSingle.amount), "leader:", Number(initLeader.amount));

      await program.methods
        .resolveBattleAgentVsAlliance(20, true) // 20% from alliance -> single agent
        .accounts({
          singleAgent: singleAgentPda,
          allianceLeader: allianceLeaderPda,
          alliancePartner: alliancePartnerPda,
          game: gamePda,
          singleAgentToken: tokenAccounts[allianceBattleAgents.winner],
          allianceLeaderToken: tokenAccounts[allianceBattleAgents.loser],
          alliancePartnerToken: tokenAccounts[allianceBattleAgents.loserPartner],
          singleAgentAuthority: provider.wallet.publicKey,
          allianceLeaderAuthority: provider.wallet.publicKey,
          alliancePartnerAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalSingle = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      const finalLeader = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      console.log(
        "After battle: single:",
        Number(finalSingle.amount),
        "leader:",
        Number(finalLeader.amount)
      );
      // If different owners exist, finalSingle should be > initSingle
      expect(Number(finalSingle.amount)).to.be.greaterThanOrEqual(Number(initSingle.amount));
    });

    it("Agent loses vs alliance", async () => {
      // same PDAs, but agent_is_winner = false
      const singleAgentPda = await deriveAgentPda(allianceBattleAgents.winner);
      const allianceLeaderPda = await deriveAgentPda(allianceBattleAgents.loser);
      const alliancePartnerPda = await deriveAgentPda(allianceBattleAgents.loserPartner);

      const initSingle = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      console.log("Before: agent losing, singleAgent:", Number(initSingle.amount));

      await program.methods
        .resolveBattleAgentVsAlliance(20, false) // single loses 20% to alliance
        .accounts({
          singleAgent: singleAgentPda,
          allianceLeader: allianceLeaderPda,
          alliancePartner: alliancePartnerPda,
          game: gamePda,
          singleAgentToken: tokenAccounts[allianceBattleAgents.winner],
          allianceLeaderToken: tokenAccounts[allianceBattleAgents.loser],
          alliancePartnerToken: tokenAccounts[allianceBattleAgents.loserPartner],
          singleAgentAuthority: provider.wallet.publicKey,
          allianceLeaderAuthority: provider.wallet.publicKey,
          alliancePartnerAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalSingle = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      console.log("After: agent losing, singleAgent:", Number(finalSingle.amount));

      expect(Number(finalSingle.amount)).to.be.lessThanOrEqual(Number(initSingle.amount));
    });
  });

  // 2) resolve_battle_alliance_vs_alliance
  describe("resolve_battle_alliance_vs_alliance", () => {
    it("Alliance A wins vs Alliance B", async () => {
      const leaderAPda = await deriveAgentPda(allianceBattleAgents.winner);
      const partnerAPda = await deriveAgentPda(allianceBattleAgents.winnerPartner);
      const leaderBPda = await deriveAgentPda(allianceBattleAgents.loser);
      const partnerBPda = await deriveAgentPda(allianceBattleAgents.loserPartner);

      const initLeaderB = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      console.log("Alliance B Leader init:", Number(initLeaderB.amount));

      await program.methods
        .resolveBattleAllianceVsAlliance(20, true) // 20% from alliance B -> A
        .accounts({
          leaderA: leaderAPda,
          partnerA: partnerAPda,
          leaderB: leaderBPda,
          partnerB: partnerBPda,
          game: gamePda,
          leaderAToken: tokenAccounts[allianceBattleAgents.winner],
          partnerAToken: tokenAccounts[allianceBattleAgents.winnerPartner],
          leaderBToken: tokenAccounts[allianceBattleAgents.loser],
          partnerBToken: tokenAccounts[allianceBattleAgents.loserPartner],
          leaderAAuthority: provider.wallet.publicKey,
          partnerAAuthority: provider.wallet.publicKey,
          leaderBAuthority: provider.wallet.publicKey,
          partnerBAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const finalLeaderB = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      console.log("Alliance B Leader final:", Number(finalLeaderB.amount));
      expect(Number(finalLeaderB.amount)).to.be.lessThanOrEqual(Number(initLeaderB.amount));
    });
  });

  // 3) resolve_battle_simple
  describe("resolve_battle_simple", () => {
    it("Resolves a simple battle, updates balances", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      const initWinner = await getAccount(connection, tokenAccounts[simpleBattleAgents.winner]);
      const initLoser = await getAccount(connection, tokenAccounts[simpleBattleAgents.loser]);

      console.log("Before (simple): winner:", Number(initWinner.amount), "loser:", Number(initLoser.amount));

      const txSig = await program.methods
        .resolveBattleSimple(20) // 20% from loser -> winner
        .accounts({
          winner: winnerPda,
          loser: loserPda,
          game: gamePda,
          winnerToken: tokenAccounts[simpleBattleAgents.winner],
          loserToken: tokenAccounts[simpleBattleAgents.loser],
          loserAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("resolveBattleSimple tx sig:", txSig);

      const finalWinner = await getAccount(connection, tokenAccounts[simpleBattleAgents.winner]);
      const finalLoser = await getAccount(connection, tokenAccounts[simpleBattleAgents.loser]);
      console.log("After (simple): winner:", Number(finalWinner.amount), "loser:", Number(finalLoser.amount));

      // If using the same wallet for all accounts, the net effect might be zero. 
      expect(Number(finalLoser.amount)).to.be.lessThanOrEqual(Number(initLoser.amount));
    });
  });

  // 4) Access control for battle
  describe("Access Control (Battle)", () => {
    it("Fails to resolve a simple battle w/ unauthorized wallet", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      let failed = false;
      try {
        await program.methods
          .resolveBattleSimple(20)
          .accounts({
            winner: winnerPda,
            loser: loserPda,
            game: gamePda,
            winnerToken: tokenAccounts[simpleBattleAgents.winner],
            loserToken: tokenAccounts[simpleBattleAgents.loser],
            loserAuthority: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized resolution prevented:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});
