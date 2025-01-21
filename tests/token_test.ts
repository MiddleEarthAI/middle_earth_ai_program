import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { AccountLayout } from "@solana/spl-token";

// SPL Token imports
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createInitializeAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";

// ----------------------------
// Constants / Helper
// ----------------------------
const INITIAL_MINT_AMOUNT = 1_000_000;     // how many tokens the user starts with
const REWARDS_MINT_AMOUNT = 500_000_000;   // how many tokens to put in the rewards vault
const STAKE_DEPOSIT_AMOUNT = 500;          // how many tokens to stake each test
const PARTIAL_UNSTAKE_SHARES = 200;        // how many shares to unstake

// Helper to read the balance of an SPL token account
async function getTokenBalance(pubkey: PublicKey, provider: anchor.AnchorProvider) {
  const acct = await getAccount(provider.connection, pubkey);
  return Number(acct.amount);
}

describe("Token Staking Tests (Comprehensive)", () => {
  // 1) Anchor + Program set up
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // 2) Global PDAs
  let gamePda: PublicKey;
  let agentPda: PublicKey;
  // For demonstration, we say we have a `gameId` + `agentId`
  const gameId = new BN(777);
  const agentId = 99;

  // 3) Vault + user SPL token accounts
  let tokenMint: PublicKey;
  let stakerTokenAccount: PublicKey;
  let rewardsVault: PublicKey;
  let agentVault: PublicKey; // the agent's vault token account

  before("Initialize game, create mint, user token account, register agent, create vault", async () => {
    // ----------------------------------------------------------
    // Step A: Derive + init the game
    // ----------------------------------------------------------
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    try {
      await program.methods
        .initializeGame(gameId, new BN(123)) // example bump is 123
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game successfully initialized or already done.");
    } catch (err: any) {
      console.log("Game init might exist:", err.message);
    }

    // ----------------------------------------------------------
    // Step B: Create a token mint for testing
    // ----------------------------------------------------------
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6 // decimals
    );
    console.log("Mint created =>", tokenMint.toBase58());

    // ----------------------------------------------------------
    // Step C: Create user token account + mint tokens to user
    // ----------------------------------------------------------
    {
      const userAcct = Keypair.generate();
      const lamportsNeeded = await provider.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span
      );

      const createIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: userAcct.publicKey,
        space: AccountLayout.span,
        lamports: lamportsNeeded,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(
        userAcct.publicKey,
        tokenMint,
        provider.wallet.publicKey, // user is the owner
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [userAcct]);
      stakerTokenAccount = userAcct.publicKey;
    }

    // Mint tokens to user
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    console.log("User token account created + minted =>", stakerTokenAccount.toBase58());

    // ----------------------------------------------------------
    // Step D: Create a rewards vault (owned by provider for distribution)
    // ----------------------------------------------------------
    {
      const vaultKey = Keypair.generate();
      const lamportsNeeded = await provider.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span
      );
      const createIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: vaultKey.publicKey,
        space: AccountLayout.span,
        lamports: lamportsNeeded,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(
        vaultKey.publicKey,
        tokenMint,
        provider.wallet.publicKey,
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [vaultKey]);
      rewardsVault = vaultKey.publicKey;
    }
    // Mint tokens to rewardsVault
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      rewardsVault,
      provider.wallet.publicKey,
      REWARDS_MINT_AMOUNT
    );
    console.log("Rewards vault created + minted =>", rewardsVault.toBase58());

    // ----------------------------------------------------------
    // Step E: Register the agent if needed
    // ----------------------------------------------------------
    [agentPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    try {
      await program.methods
        .registerAgent(agentId, 0, 0, "Frodo")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Agent registered =>", agentPda.toBase58());
    } catch (err: any) {
      console.log("Agent registration might exist:", err.message);
    }

    // ----------------------------------------------------------
    // Step F: Create the agent's vault as a PDA-owned token account
    // ----------------------------------------------------------
    // If your code auto-creates the vault, skip. Otherwise, do it manually:
    {
      const vaultKey = Keypair.generate();
      const lamportsNeeded = await provider.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span
      );
      const createVaultIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: vaultKey.publicKey,
        space: AccountLayout.span,
        lamports: lamportsNeeded,
        programId: TOKEN_PROGRAM_ID,
      });
      const initVaultIx = createInitializeAccountInstruction(
        vaultKey.publicKey,
        tokenMint,
        agentPda, // agent PDE is the owner
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
      await provider.sendAndConfirm(tx, [vaultKey]);
      agentVault = vaultKey.publicKey;
      console.log("Agent vault =>", agentVault.toBase58());
    }
  });

  // ----------------------------------------------------------------
  // Now the test cases
  // ----------------------------------------------------------------
  describe("Staking + Unstaking Flow", () => {
    let stakePda: PublicKey;
    let stakeBump: number;

    // We'll create stake_info in a `beforeEach` so each test starts fresh if desired.
    // Or we can create once. Here, we do `beforeEach` to test multiple scenarios.

    beforeEach(async () => {
      // Derive stake_info
      [stakePda, stakeBump] = await PublicKey.findProgramAddress(
        [Buffer.from("stake"), agentPda.toBuffer(), provider.wallet.publicKey.toBuffer()],
        program.programId
      );

      // stakeTokens
      await program.methods
        .stakeTokens(new BN(STAKE_DEPOSIT_AMOUNT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakePda,
          stakerSource: stakerTokenAccount,
          agentVault: agentVault,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Staked tokens => stakePda:", stakePda.toBase58());
    });

    it("Fails to unstake if cooldown not over", async () => {
      // We attempt an immediate unstake
      let failed = false;
      try {
        await program.methods
          .unstakeTokens(new BN(50))
          .accounts({
            agent: agentPda,
            game: gamePda,
            stakeInfo: stakePda,
            agentVault: agentVault,
            agentAuthority: agentPda, // PDE
            stakerDestination: stakerTokenAccount,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (err: any) {
        console.log("Unstake fails due to cooldown =>", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

    it("Clears cooldown and partially unstakes", async () => {
      // Clear cooldown with test instruction
      await program.methods
        .testClearCooldown()
        .accounts({
          stakeInfo: stakePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Cooldown cleared via test instruction.");

      // now partial unstake
      const partialUnstake = 200;
      const stakerBalanceBefore = await getTokenBalance(stakerTokenAccount, provider);
      const vaultBalanceBefore = await getTokenBalance(agentVault, provider);

      await program.methods
        .unstakeTokens(new BN(partialUnstake))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakePda,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Partially unstaked =>", partialUnstake);

      const stakerBalanceAfter = await getTokenBalance(stakerTokenAccount, provider);
      const vaultBalanceAfter = await getTokenBalance(agentVault, provider);

      expect(stakerBalanceAfter).to.equal(stakerBalanceBefore + partialUnstake);
      expect(vaultBalanceAfter).to.equal(vaultBalanceBefore - partialUnstake);

      // confirm stake_info updated
      const stakeInfoAcc = await program.account.stakeInfo.fetch(stakePda);
      expect(Number(stakeInfoAcc.amount)).to.equal(STAKE_DEPOSIT_AMOUNT - partialUnstake);
      expect(Number(stakeInfoAcc.shares)).to.equal(STAKE_DEPOSIT_AMOUNT - partialUnstake);

      console.log("Partial unstake success, stake info updated.");
    });

    it("Fails to unstake if user doesn't have enough shares", async () => {
      // We'll attempt to unstake more than total shares (which is 500).
      await program.methods
        .testClearCooldown()
        .accounts({
          stakeInfo: stakePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Cooldown cleared for test.");

      let failed = false;
      try {
        await program.methods
          .unstakeTokens(new BN(9999)) // way more than staked
          .accounts({
            agent: agentPda,
            game: gamePda,
            stakeInfo: stakePda,
            agentVault: agentVault,
            agentAuthority: agentPda,
            stakerDestination: stakerTokenAccount,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (err: any) {
        console.log("Unstake fails => not enough shares =>", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});
