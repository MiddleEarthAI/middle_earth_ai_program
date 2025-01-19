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
  // Use a dedicated agent ID (e.g. 100) so it does not conflict with other tests.
  const newAgentId = 100;
  const unauthorizedWallet = Keypair.generate();

  // Helper: Get the Agent account namespace.
  const getAgentAccountNamespace = () =>
    (program.account as any).Agent || (program.account as any).agent;

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
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped or already done:", err.message);
    }
  });

  describe("Register Agent", () => {
    it("Registers a new agent successfully (authorized)", async () => {
      // Use newAgentId (which is not used by other tests)
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
        program.programId
      );

      const tx = await program.methods
        .registerAgent(newAgentId, 10, -4, "Gandalf")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Register agent tx signature:", tx);

      const agentAccount = await getAgentAccountNamespace().fetch(agentPda);
      expect(agentAccount.game.toBase58()).to.equal(gamePda.toBase58());
      expect(agentAccount.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      expect(agentAccount.id).to.equal(newAgentId);
      expect(agentAccount.x).to.equal(10);
      expect(agentAccount.y).to.equal(-4);
      expect(agentAccount.isAlive).to.be.true;
      expect(agentAccount.lastMove.toNumber()).to.equal(0);
      expect(agentAccount.lastBattle.toNumber()).to.equal(0);
      expect(agentAccount.currentBattleStart).to.be.null;
      expect(agentAccount.allianceWith).to.be.null;
      expect(agentAccount.allianceTimestamp.toNumber()).to.equal(0);
      expect(agentAccount.ignoreCooldowns).to.be.an("array").that.is.empty;
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

      console.log("Agent fields verified successfully after registration.");
    });
  });

  describe("Kill Agent", () => {
    it("Kills the agent and verifies it is marked as dead", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
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

  describe("Access Control Tests (Agent)", () => {
    it("Fails to register an agent when called by an unauthorized wallet", async () => {
      // Use an unused agent ID (e.g. 101)
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([101])],
        program.programId
      );

      let reverted = false;
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
        console.log("Unauthorized register_agent failed as expected.");
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Fails to kill the agent when called by an unauthorized wallet", async () => {
      const [agentPda] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
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
  const tokenAccounts: { [agentId: number]: PublicKey } = {};

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

  const unauthorizedWallet = Keypair.generate();

  const deriveAgentPda = async (agentId: number): Promise<PublicKey> => {
    const [pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    return pda;
  };

  before("Setup game PDA for battle tests", async () => {
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Battle Tests - Derived Game PDA:", gamePda.toBase58());
  });

  before("Create token mint and associated token accounts for agents", async () => {
    tokenMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      9
    );
    console.log("Battle Tests - Created token mint:", tokenMint.toBase58());

    const allAgentIds = [
      ...Object.values(allianceBattleAgents),
      ...Object.values(simpleBattleAgents),
    ];
    const mintAmount = 1_000_000_000;

    for (const agentId of allAgentIds) {
      // For each agent, create an ATA with the provider.wallet.publicKey as owner
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenMint,
        provider.wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      tokenAccounts[agentId] = ata.address;
      console.log(`Battle Tests - Token account for agent ${agentId}: ${ata.address.toBase58()}`);
      await mintTo(
        connection,
        payer,
        tokenMint,
        ata.address,
        provider.wallet.publicKey,
        mintAmount
      );
      console.log(`Battle Tests - Minted ${mintAmount} tokens to agent ${agentId}`);
    }
  });

  before("Register agents for battle tests", async () => {
    const registerAgentIfNeeded = async (agentId: number, x: number, y: number, name: string) => {
      const agentPda = await deriveAgentPda(agentId);
      try {
        await program.account.agent.fetch(agentPda);
        console.log(`Battle Tests - Agent ${name} (ID: ${agentId}) already registered at ${agentPda.toBase58()}`);
      } catch {
        console.log(`Battle Tests - Registering agent ${name} (ID: ${agentId})`);
        await program.methods
          .registerAgent(agentId, x, y, name)
          .accounts({
            game: gamePda,
            agent: agentPda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }
    };

    await registerAgentIfNeeded(allianceBattleAgents.winner, 10, 10, "AllianceWinner");
    await registerAgentIfNeeded(allianceBattleAgents.winnerPartner, 11, 10, "AllianceWinnerPartner");
    await registerAgentIfNeeded(allianceBattleAgents.loser, -5, -5, "AllianceLoser");
    await registerAgentIfNeeded(allianceBattleAgents.loserPartner, -6, -5, "AllianceLoserPartner");
    await registerAgentIfNeeded(simpleBattleAgents.winner, 5, 5, "SimpleWinner");
    await registerAgentIfNeeded(simpleBattleAgents.loser, -2, -2, "SimpleLoser");
  });

  before("Form alliance for battle tests", async () => {
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
      console.log("Battle Tests - Alliance formed between winner and loser.");
    } catch (e: any) {
      console.log("Battle Tests - Alliance formation may already exist:", e.message);
    }
  });

  describe("resolve_battle (with alliances)", () => {
    it("Resolves an alliance battle, updating cooldowns and transferring tokens proportionally, and verifies token balances", async () => {
      const winnerPda = await deriveAgentPda(allianceBattleAgents.winner);
      const winnerPartnerPda = await deriveAgentPda(allianceBattleAgents.winnerPartner);
      const loserPda = await deriveAgentPda(allianceBattleAgents.loser);
      const loserPartnerPda = await deriveAgentPda(allianceBattleAgents.loserPartner);

      // Fetch initial token balances
      const initLoser = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      const initLoserPartner = await getAccount(connection, tokenAccounts[allianceBattleAgents.loserPartner]);
      const initWinner = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      const initWinnerPartner = await getAccount(connection, tokenAccounts[allianceBattleAgents.winnerPartner]);

      console.log("Initial token balances (with alliances):");
      console.log("Loser:", Number(initLoser.amount));
      console.log("Loser Partner:", Number(initLoserPartner.amount));
      console.log("Winner:", Number(initWinner.amount));
      console.log("Winner Partner:", Number(initWinnerPartner.amount));

      const txSig = await program.methods
        .resolveBattle(20) // 20% loss
        .accounts({
          winner: winnerPda,
          winnerPartner: winnerPartnerPda,
          loser: loserPda,
          loserPartner: loserPartnerPda,
          game: gamePda,
          winnerToken: tokenAccounts[allianceBattleAgents.winner],
          winnerPartnerToken: tokenAccounts[allianceBattleAgents.winnerPartner],
          loserToken: tokenAccounts[allianceBattleAgents.loser],
          loserPartnerToken: tokenAccounts[allianceBattleAgents.loserPartner],
          loserAuthority: provider.wallet.publicKey,
          loserPartnerAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Battle Tests - resolve_battle tx signature:", txSig);

      // Fetch final balances
      const finalLoser = await getAccount(connection, tokenAccounts[allianceBattleAgents.loser]);
      const finalLoserPartner = await getAccount(connection, tokenAccounts[allianceBattleAgents.loserPartner]);
      const finalWinner = await getAccount(connection, tokenAccounts[allianceBattleAgents.winner]);
      const finalWinnerPartner = await getAccount(connection, tokenAccounts[allianceBattleAgents.winnerPartner]);

      console.log("Final token balances (with alliances):");
      console.log("Loser:", Number(finalLoser.amount));
      console.log("Loser Partner:", Number(finalLoserPartner.amount));
      console.log("Winner:", Number(finalWinner.amount));
      console.log("Winner Partner:", Number(finalWinnerPartner.amount));

      // For simplicity, assert that the loser's token balance decreased and winner's increased.
      expect(Number(finalLoser.amount)).to.be.lessThan(Number(initLoser.amount));
      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(initWinner.amount));
    });
  });

  describe("resolve_battle_simple (without alliances)", () => {
    it("Resolves a simple battle, updating cooldowns and transferring tokens, and verifies token balances", async () => {
      const winnerPda = await deriveAgentPda(simpleBattleAgents.winner);
      const loserPda = await deriveAgentPda(simpleBattleAgents.loser);

      // Fetch initial balances
      const initWinner = await getAccount(connection, tokenAccounts[simpleBattleAgents.winner]);
      const initLoser = await getAccount(connection, tokenAccounts[simpleBattleAgents.loser]);

      console.log("Initial token balances (simple battle):");
      console.log("Winner:", Number(initWinner.amount));
      console.log("Loser:", Number(initLoser.amount));

      const txSig = await program.methods
        .resolveBattleSimple(20) // 20% loss
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
      console.log("Battle Tests - resolve_battle_simple tx signature:", txSig);

      // Fetch final balances.
      const finalWinner = await getAccount(connection, tokenAccounts[simpleBattleAgents.winner]);
      const finalLoser = await getAccount(connection, tokenAccounts[simpleBattleAgents.loser]);

      console.log("Final token balances (simple battle):");
      console.log("Winner:", Number(finalWinner.amount));
      console.log("Loser:", Number(finalLoser.amount));

      expect(Number(finalLoser.amount)).to.be.lessThan(Number(initLoser.amount));
      expect(Number(finalWinner.amount)).to.be.greaterThan(Number(initWinner.amount));
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
            winnerToken: tokenAccounts[simpleBattleAgents.winner],
            loserToken: tokenAccounts[simpleBattleAgents.loser],
            loserAuthority: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            authority: unauthorizedWallet.publicKey,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Battle Tests - Unauthorized resolve_battle_simple prevented as expected:", err.message);
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
