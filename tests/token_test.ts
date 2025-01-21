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

  // Constants
  const INITIAL_MINT_AMOUNT = 1_000_000;
  const STAKE_DEPOSIT_AMOUNT = 500;

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
      console.log("Game successfully initialized.");
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
        provider.wallet.publicKey, // staker's inner owner
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
    console.log("Staker token account funded.");

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
      500_000_000
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
      // Initialize it as a token account with 'agentPda' as the inner owner.
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
  // STEP 3: Test staking tokens.
  // ----------------------------------------------------------------
  describe("Stake Tokens", () => {
    it("Stakes tokens from the staker to the agent vault", async () => {
      // Derive the stake_info PDA using seeds:
      // [ "stake", agentPda, authority ]
      // (This matches the on-chain constraint in your token.rs code.)
      const [stakeInfoPda, stakeInfoBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("stake"),
          agentPda.toBuffer(),
          provider.wallet.publicKey.toBuffer(),
        ],
        program.programId
      );

      // Get balances before staking.
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
          agentVault: agentVault, // Use the agentVault PublicKey directly
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Staking transaction signature:", txSig);

      // Get balances after staking.
      const stakerBalanceAfter = await getTokenBalance(stakerTokenAccount);
      const vaultBalanceAfter = await getTokenBalance(agentVault);

      // Verify token transfers.
      expect(stakerBalanceAfter).to.equal(stakerBalanceBefore - STAKE_DEPOSIT_AMOUNT);
      expect(vaultBalanceAfter).to.equal(vaultBalanceBefore + STAKE_DEPOSIT_AMOUNT);

      // Verify stake_info data.
      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
      expect(Number(stakeInfo.amount)).to.equal(STAKE_DEPOSIT_AMOUNT);
      // Based on your logic, if there were no prior deposits then shares = deposit_amount.
      expect(Number(stakeInfo.shares)).to.equal(STAKE_DEPOSIT_AMOUNT);
      
      // Check the cooldown is set to approximately 1 hour from now.
      const nowSecs = Math.floor(Date.now() / 1000);
      expect(Number(stakeInfo.cooldownEndsAt) - nowSecs).to.be.at.most(3601);

      console.log("Staking successful. Stake info validated.");
    });
  });
});