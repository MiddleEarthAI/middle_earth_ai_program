import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Agent Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  let gamePda: PublicKey;
  let agentPda: PublicKey;
  const gameId = new BN(777);
  const agentId = 99;

  const gameAuthority = Keypair.generate();
  const unauthorizedWallet = Keypair.generate();
  // Create a dedicated winner wallet for the winner's token account
  const winnerWallet = Keypair.generate();

  // Define token-related variables
  let mint: PublicKey;
  let agentTokenAccount: PublicKey;
  let winnerTokenAccount: PublicKey;

  // Helper to fetch agent account
  const getAgentAccountNamespace = () => {
    return (program.account as any).Agent || (program.account as any).agent;
  };

  before("Airdrop SOL, initialize game, register agent, and setup token accounts", async () => {
    // Airdrop to gameAuthority and winnerWallet
    await provider.connection.requestAirdrop(gameAuthority.publicKey, 2e9);
    await provider.connection.requestAirdrop(winnerWallet.publicKey, 2e9);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Find Game PDA
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    gamePda = pda;

    // Initialize Game
    await program.methods
      .initializeGame(gameId, new BN(bump))
      .accounts({
        game: gamePda,
        authority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();

    console.log("Game initialized at:", gamePda.toBase58());

    // Find Agent PDA
    const [agentAddress] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    agentPda = agentAddress;

    // Register agent (Frodo)
    await program.methods
      .registerAgent(agentId, 10, -4, "Frodo")
      .accounts({
        game: gamePda,
        agent: agentPda,
        authority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();

    console.log("Agent (Frodo) registered at:", agentPda.toBase58());

    // Set up a token mint for testing
    mint = await createMint(
      provider.connection,
      gameAuthority,               // payer
      gameAuthority.publicKey,     // mint authority
      null,                        // freeze authority
      9                            // decimals
    );

    // Create agent's token account (agent vault)
    const agentTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      gameAuthority,
      mint,
      gameAuthority.publicKey // agentTokenAccount owner is gameAuthority
    );
    agentTokenAccount = agentTokenAccountInfo.address;

    // Create winner's token account using the dedicated winner wallet
    const winnerTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      gameAuthority,
      mint,
      winnerWallet.publicKey // winnerTokenAccount owner is winnerWallet
    );
    winnerTokenAccount = winnerTokenAccountInfo.address;

    // Mint tokens to the agent's token account
    await mintTo(
      provider.connection,
      gameAuthority,
      mint,
      agentTokenAccount,
      gameAuthority,
      1_000_000
    );
  });

  describe("Register Agent (verifications)", () => {
    it("Checks the agent fields match our snippet's creation", async () => {
      const agentAccount = await getAgentAccountNamespace().fetch(agentPda);
      expect(agentAccount.game.toBase58()).to.equal(gamePda.toBase58());
      expect(agentAccount.authority.toBase58()).to.equal(gameAuthority.publicKey.toBase58());
      expect(agentAccount.id).to.equal(agentId);
      expect(agentAccount.x).to.equal(10);
      expect(agentAccount.y).to.equal(-4);
      expect(agentAccount.isAlive).to.be.true;
      console.log("Agent fields verified after snippet-based registration.");
    });
  });

  describe("Kill Agent", () => {
    it("Kills the agent and verifies it is marked as dead", async () => {
      // Check token balances before killAgent call
      const beforeAgentBalance = (await provider.connection.getTokenAccountBalance(agentTokenAccount)).value.amount;
      const beforeWinnerBalance = (await provider.connection.getTokenAccountBalance(winnerTokenAccount)).value.amount;
      console.log("Before kill, agent token balance:", beforeAgentBalance);
      console.log("Before kill, winner token balance:", beforeWinnerBalance);

      // Call killAgent with all required accounts
      const tx = await program.methods
        .killAgent()
        .accounts({
          agent: agentPda,
          game: gamePda,
          authority: gameAuthority.publicKey,
          agentToken: agentTokenAccount,
          winnerToken: winnerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([gameAuthority])
        .rpc();

      console.log("Kill agent tx signature:", tx);

      // Confirm the agent is now dead
      const agentAccount: any = await getAgentAccountNamespace().fetch(agentPda);
      expect(agentAccount.isAlive).to.be.false;

      // Check token balances after killAgent call
      console.log("Agent Pubkey :", agentTokenAccount.toBase58());
      console.log("Winner Pubkey :", winnerTokenAccount.toBase58());
      const afterAgentBalance = (await provider.connection.getTokenAccountBalance(agentTokenAccount)).value.amount;
      const afterWinnerBalance = (await provider.connection.getTokenAccountBalance(winnerTokenAccount)).value.amount;
      console.log("After kill, agent token balance:", afterAgentBalance);
      console.log("After kill, winner token balance:", afterWinnerBalance);

      // Verify agent's token balance is zero and the winner's account has received the full amount
      expect(Number(afterAgentBalance)).to.equal(0);
      expect(Number(afterWinnerBalance)).to.equal(Number(beforeWinnerBalance) + Number(beforeAgentBalance));
      console.log("All agent tokens successfully transferred to the winner!");
    });
  });

  describe("Access Control Tests", () => {
    it("Fails to register an agent when called by unauthorized wallet", async () => {
      const [agentPda2] = await PublicKey.findProgramAddress(
        [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([111])],
        program.programId
      );
      let reverted = false;
      try {
        await program.methods
          .registerAgent(111, 15, 20, "Saruman")
          .accounts({
            game: gamePda,
            agent: agentPda2,
            authority: unauthorizedWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized register_agent failed as expected =>", err.message);
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Fails to kill the agent when called by an unauthorized wallet", async () => {
      let reverted = false;
      try {
        await program.methods
          .killAgent()
          .accounts({
            agent: agentPda,
            game: gamePda,
            authority: unauthorizedWallet.publicKey,
            agentToken: agentTokenAccount,
            winnerToken: winnerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedWallet])
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized kill_agent failed as expected =>", err.message);
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
