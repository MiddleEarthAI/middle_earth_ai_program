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
  createAccount,
  createInitializeAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("Token Staking Tests", () => {
  // Set up the provider and program
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Global variables for our test environment:
  let gamePda: PublicKey;
  let gameBump: number;
  const gameId = new BN(777); // Example game ID

  let agentPda: PublicKey;
  let agentBump: number;
  const agentId = 99; // Example agent ID

  let tokenMint: PublicKey;
  let stakerTokenAccount: PublicKey;
  let rewardsVault: PublicKey;

  // The agent vault token account (its inner owner is set to the agent PDA)
  let agentVault: PublicKey;

  // The stakeInfo PDA
  let stakeInfoPda: PublicKey;

  // Constants
  const INITIAL_MINT_AMOUNT = 1_000_000;    // Initial supply minted to the staker
  const STAKE_DEPOSIT_AMOUNT = 500;        // Default deposit for tests
  const STAKE_DEPOSIT_AMOUNT_2 = 300;      // Secondary deposit for multi-stake
  const LARGE_STAKE_AMOUNT = 2_000_000;    // More than the staker actually has

  // Helper: get the token account's balance
  async function getTokenBalance(pubkey: PublicKey): Promise<number> {
    const acct = await getAccount(provider.connection, pubkey);
    return Number(acct.amount);
  }

  // ----------------------------------------------------------------
  // STEP 1: Initialize game, create token mint, staker account, and rewards vault.
  // ----------------------------------------------------------------
  before(async () => {
    // 1) Derive the Game PDA and initialize the game.
    [gamePda, gameBump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    try {
      await program.methods
        .initializeGame(gameId, new BN(gameBump))
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game successfully initialized or already active.");
    } catch (err: any) {
      console.log("Game init might already exist:", err.message);
    }

    // 2) Create a token mint (decimals = 6)
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );
    console.log("Token mint created:", tokenMint.toBase58());

    // 3) Create the staker's token account.
    {
      const stakerAcctKeypair = Keypair.generate();
      const size = AccountLayout.span; // typically 165 bytes
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

      const createIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: stakerAcctKeypair.publicKey,
        space: size,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(
        stakerAcctKeypair.publicKey,
        tokenMint,
        provider.wallet.publicKey, // staker's owner
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [stakerAcctKeypair]);
      stakerTokenAccount = stakerAcctKeypair.publicKey;
      console.log("Staker token account created:", stakerTokenAccount.toBase58());
    }

    // 4) Mint tokens to staker's account.
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    console.log(`Staker token account funded with ${INITIAL_MINT_AMOUNT} tokens.`);

    // 5) Create a rewards vault (a token account owned by provider for rewards distribution).
    {
      const vaultKeypair = Keypair.generate();
      const size = AccountLayout.span;
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

      const createIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: vaultKeypair.publicKey,
        space: size,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(
        vaultKeypair.publicKey,
        tokenMint,
        provider.wallet.publicKey, // inner owner is provider
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [vaultKeypair]);
      rewardsVault = vaultKeypair.publicKey;
      console.log("Rewards vault created:", rewardsVault.toBase58());
    }

    // Fund the rewards vault.
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      rewardsVault,
      provider.wallet.publicKey,
      500_000_000 // 0.5M tokens
    );
    console.log("Rewards vault funded.");

    // ----------------------------------------------------------------
    // STEP 2: Register agent and create agent vault.
    // ----------------------------------------------------------------
    // 1) Derive the Agent PDA.
    [agentPda, agentBump] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );

    // 2) Register the agent.
    try {
      await program.methods
        .registerAgent(agentId, 10, -4, "Frodo")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Agent registered at:", agentPda.toBase58());
    } catch (err: any) {
      console.log("Agent registration might already exist:", err.message);
    }

    // 3) Create the agent's vault as a PDA-owned token account.
    {
      const agentVaultKeypair = Keypair.generate();
      const size = AccountLayout.span;
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);
      const createVaultIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: agentVaultKeypair.publicKey,
        space: size,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      });
      // Initialize it as a token account with 'agentPda' as the owner.
      const initVaultIx = createInitializeAccountInstruction(
        agentVaultKeypair.publicKey,
        tokenMint,
        agentPda, // the "owner" in the token's metadata
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
      await provider.sendAndConfirm(tx, [agentVaultKeypair]);
      agentVault = agentVaultKeypair.publicKey;
      console.log("Agent vault created with PDA owner:", agentVault.toBase58());
    }
  });

  // ----------------------------------------------------------------
  // STEP 3: Stake Info PDA (derive once)
  // ----------------------------------------------------------------
  before("Derive stake_info PDA", async () => {
    // [ "stake", agentPda, staker_pubkey ]
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPda = pda;
  });

  
  describe("Stake Tokens", () => {
    it("Stakes tokens from the staker to the agent vault (first deposit)", async () => {
      // Check balances before
      const stakerBalanceBefore = await getTokenBalance(stakerTokenAccount);
      const vaultBalanceBefore = await getTokenBalance(agentVault);

      // Call the stake_tokens instruction.
      const txSig = await program.methods
        .stakeTokens(new BN(STAKE_DEPOSIT_AMOUNT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          stakerSource: stakerTokenAccount,
          agentVault: agentVault,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Staking transaction signature (1st deposit):", txSig);

      // Check balances after
      const stakerBalanceAfter = await getTokenBalance(stakerTokenAccount);
      const vaultBalanceAfter = await getTokenBalance(agentVault);
      expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - STAKE_DEPOSIT_AMOUNT);
      expect(vaultBalanceAfter).to.equal(vaultBalanceBefore + STAKE_DEPOSIT_AMOUNT);

      // Verify stake_info data
      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
      expect(Number(stakeInfo.amount)).to.equal(STAKE_DEPOSIT_AMOUNT);
      expect(Number(stakeInfo.shares)).to.equal(STAKE_DEPOSIT_AMOUNT);

      // Ensure 1-hour cooldown is set
      const nowSecs = Math.floor(Date.now() / 1000);
      expect(Number(stakeInfo.cooldownEndsAt) - nowSecs).to.be.within(0, 3605);
      console.log("Staking successful. Stake info validated (first deposit).");
    });

    it("Allows a second deposit, correctly mints more shares", async () => {
      // The second deposit is STAKE_DEPOSIT_AMOUNT_2 = 300
      // If there's a non-zero existing balance and shares, it should mint proportionally more shares.
      // Check balances before
      const stakerBalanceBefore = await getTokenBalance(stakerTokenAccount);
      const vaultBalanceBefore = await getTokenBalance(agentVault);

      // Current stake_info
      const stakeInfoBefore = await program.account.stakeInfo.fetch(stakeInfoPda);
      const sharesBefore = Number(stakeInfoBefore.shares);
      const amountBefore = Number(stakeInfoBefore.amount);

      // Additional deposit
      const txSig = await program.methods
        .stakeTokens(new BN(STAKE_DEPOSIT_AMOUNT_2))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          stakerSource: stakerTokenAccount,
          agentVault: agentVault,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Staking transaction signature (2nd deposit):", txSig);

      // Check balances after
      const stakerBalanceAfter = await getTokenBalance(stakerTokenAccount);
      const vaultBalanceAfter = await getTokenBalance(agentVault);
      expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - STAKE_DEPOSIT_AMOUNT_2);
      expect(vaultBalanceAfter).to.equal(vaultBalanceBefore + STAKE_DEPOSIT_AMOUNT_2);

      // Check stake_info
      const stakeInfoAfter = await program.account.stakeInfo.fetch(stakeInfoPda);
      const amountAfter = Number(stakeInfoAfter.amount);
      expect(amountAfter).to.equal(amountBefore + STAKE_DEPOSIT_AMOUNT_2);

      // Because the vault had some balance prior to deposit, the new minted shares should be
      // proportionally calculated by your code. If we had 500 shares for 500 tokens,
      // now we deposit an extra 300 when vault = 500 => total = 800 -> minted shares is ~300 * 500 / 500 = 300
      // so total shares = 800. That’s if your code is standard share logic. Adjust your expectation accordingly.
      const newShares = Number(stakeInfoAfter.shares);
      // In your logic, if the share logic is (if vault_balance == deposit_amount OR total_shares == 0)
      // then it uses deposit_amount directly. Otherwise, it calculates proportion.
      // If we had 500 tokens, 500 shares, after depositing 300 => we’d expect 300 new shares => 800 total shares.
      expect(newShares).to.be.greaterThan(sharesBefore);

      console.log("Stake info validated after second deposit. New total shares:", newShares);
    });

    it("Fails if trying to stake more tokens than staker has", async () => {
      let failed = false;
      const stakerBalance = await getTokenBalance(stakerTokenAccount);
      console.log("Staker current balance:", stakerBalance);

      try {
        await program.methods
          .stakeTokens(new BN(LARGE_STAKE_AMOUNT)) // e.g. 2_000_000 > staker's total
          .accounts({
            agent: agentPda,
            game: gamePda,
            stakeInfo: stakeInfoPda,
            stakerSource: stakerTokenAccount,
            agentVault: agentVault,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      } catch (err: any) {
        console.log("Error while over-staking as expected:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });

    // If you want a stake cooldown check, you'd do something like:
    // it("Fails if attempting to stake again before cooldown ends", async () => {
    //   // But your code does not enforce a stake cooldown, only sets it. 
    //   // If you want to enforce, you'd add `require!(now >= stake_info.cooldown_ends_at, SomeError)`.
    //   // Then you'd test it here.
    // });
  });

  // ----------------------------------------------------------------
  // Add "Unstake Tokens" tests here if you like
  // ----------------------------------------------------------------
  // e.g., 
  // describe("Unstake Tokens", () => {
  //   it("Fails to unstake before 1-hour cooldown", async () => { ... });
  //   it("Unstakes successfully after 1-hour cooldown", async () => { ... });
  //   ...
  // });

  // ----------------------------------------------------------------
  // Add "Claim Rewards" tests here if you want
  // ----------------------------------------------------------------
  // e.g., 
  // describe("Claim Rewards", () => {
  //   it("Fails to claim before 1-hour stake cooldown or 24-hour reward cooldown", async () => { ... });
  //   it("Claims successfully after cooldown", async () => { ... });
  // });

  // ----------------------------------------------------------------
  // Additional Access Control tests
  // ----------------------------------------------------------------
  describe("Access Control", () => {
    it("Fails to stake tokens with unauthorized wallet", async () => {
      // We'll create a new Keypair and try to stake from stakerTokenAccount
      const unauthorizedWallet = Keypair.generate();

      let failed = false;
      try {
        await program.methods
          .stakeTokens(new BN(100))
          .accounts({
            agent: agentPda,
            game: gamePda,
            stakeInfo: stakeInfoPda,
            stakerSource: stakerTokenAccount,
            agentVault: agentVault,
            authority: unauthorizedWallet.publicKey, // not the staker's real owner
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedWallet]) // but unauthorized doesn't own stakerSource
          .rpc();
      } catch (err: any) {
        console.log("Unauthorized staking attempt blocked:", err.message);
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });
});
