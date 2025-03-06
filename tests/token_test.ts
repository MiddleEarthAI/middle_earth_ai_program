import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createInitializeAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { AccountLayout } from "@solana/spl-token";

/**
 * This test file demonstrates:
 *  1) "gameAuthority" owns the agent vault (agent_vault).
 *  2) A separate "rewardsAuthority" owns the rewards vault.
 *  3) Tests for partial stake/unstake, claim rewards, unauthorized attempts, etc.
 */

describe("Agent + Staking Full Test (with Rewards)", () => {
  // Use the local Anchor provider
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // The program
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // We'll use a dedicated Keypair for the gameAuthority
  const gameAuthority = Keypair.generate();
  // Another Keypair for the rewardsAuthority
  const rewardsAuthority = Keypair.generate();

  // PDAs, accounts, etc.
  let gamePda: PublicKey;
  let agentPda: PublicKey;
  let tokenMint: PublicKey;     // For both staking and rewards
  let agentVault: PublicKey;    // Owned by gameAuthority
  let rewardsVault: PublicKey;  // Owned by rewardsAuthority

  // Seeds / IDs
  const gameId = new BN(777);
  const agentId = 99;

  // We'll store stakeInfo PDAs for each staker
  let stakeInfoPdaStaker1: PublicKey;
  let stakeInfoPdaStaker2: PublicKey;

  // We'll define two stakers:
  const staker1 = provider.wallet; // default Anchor test wallet
  const staker2 = Keypair.generate(); // second user

  // We'll hold their token accounts
  let staker1TokenAccount: PublicKey;
  let staker2TokenAccount: PublicKey;

  // Constants for staking
  const FIRST_DEPOSIT = 5000;
  const SECOND_DEPOSIT = 3000;
  const PARTIAL_UNSTAKE_TOKENS = 2000;
  const LARGE_STAKE_AMOUNT = 2_000_000; 

  // Constants for rewards
  const DAILY_REWARD_TOKENS = 500_000;
  const REWARD_AMOUNT = 2_000_000; // minted to rewardsVault for testing

  // Helper to read SPL token balance
  async function getTokenBalance(pubkey: PublicKey) {
    const acct = await getAccount(provider.connection, pubkey);
    return Number(acct.amount);
  }

  /**
   * Creates a token account in the user's wallet.
   */
  async function createTokenAccountForUser(
    userPubkey: PublicKey,
    mint: PublicKey
  ): Promise<PublicKey> {
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);
    const tokenAcctKeypair = Keypair.generate();

    const createIx = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: tokenAcctKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIx = createInitializeAccountInstruction(
      tokenAcctKeypair.publicKey,
      mint,
      userPubkey,
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createIx, initIx);
    await provider.sendAndConfirm(tx, [tokenAcctKeypair]);
    return tokenAcctKeypair.publicKey;
  }

  /**
   * For a share-based vault, to unstake EXACT 'tokenAmount':
   * shares = (tokenAmount * totalShares) / vaultBalance.
   */
  async function computeSharesForExactUnstake(tokenAmount: number): Promise<number> {
    const agentAcct = await program.account.agent.fetch(agentPda);
    const totalShares = Number(agentAcct.totalShares);

    const vaultBalance = await getTokenBalance(agentVault);
    if (vaultBalance === 0 || totalShares === 0) {
      return 0;
    }
    const sharesFloat = (tokenAmount * totalShares) / vaultBalance;
    return Math.floor(sharesFloat);
  }

  // ----------------------------------------------------------------
  // 1) Airdrop SOL to gameAuthority + rewardsAuthority
  // ----------------------------------------------------------------
  it("Airdrop SOL to gameAuthority + rewardsAuthority", async () => {
    // gameAuthority
    await provider.connection.requestAirdrop(gameAuthority.publicKey, 2e9)
      .then(sig => provider.connection.confirmTransaction(sig, "confirmed"));
    // rewardsAuthority
    await provider.connection.requestAirdrop(rewardsAuthority.publicKey, 2e9)
      .then(sig => provider.connection.confirmTransaction(sig, "confirmed"));

    console.log("Airdropped 2 SOL to each authority.");
  });

  // ----------------------------------------------------------------
  // 2) Initialize a brand-new Game
  // ----------------------------------------------------------------
  it("Initialize Game (owned by gameAuthority)", async () => {
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    gamePda = pda;

    await program.methods
      .initializeGame(gameId, new BN(bump))
      .accounts({
        game: gamePda,
        authority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();

    const gameAcct = await program.account.game.fetch(gamePda);
    expect(gameAcct.isActive).to.be.true;
    expect(gameAcct.authority.toBase58()).to.equal(gameAuthority.publicKey.toBase58());
    console.log("Game created at:", gamePda.toBase58());
  });

  // ----------------------------------------------------------------
  // 3) Register Agent
  // ----------------------------------------------------------------
  it("Register Agent referencing that Game", async () => {
    const [apda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    agentPda = apda;

    const agentName = "Frodo";
    await program.methods
      .registerAgent(agentId, 10, -4, agentName)
      .accounts({
        game: gamePda,
        agent: agentPda,
        authority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();

    const agentAcct = await program.account.agent.fetch(agentPda);
    expect(agentAcct.authority.toBase58()).to.equal(gameAuthority.publicKey.toBase58());
    expect(agentAcct.id).to.equal(agentId);
    console.log("Agent registered at:", agentPda.toBase58());
  });

  // ----------------------------------------------------------------
  // 4) Create a token mint + agentVault (owned by gameAuthority)
  // ----------------------------------------------------------------
  it("Create token mint & agent vault with gameAuthority as owner", async () => {
    const mintDecimals = 6;
    tokenMint = await createMint(
      provider.connection,
      gameAuthority,            // paying
      gameAuthority.publicKey,  // mint authority
      null,
      mintDecimals
    );
    console.log("Created token mint:", tokenMint.toBase58());

    // Create agentVault
    const vaultKeypair = Keypair.generate();
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

    const createVaultIx = SystemProgram.createAccount({
      fromPubkey: gameAuthority.publicKey,
      newAccountPubkey: vaultKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const initVaultIx = createInitializeAccountInstruction(
      vaultKeypair.publicKey,
      tokenMint,
      gameAuthority.publicKey, // gameAuthority is the vault owner
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
    await provider.sendAndConfirm(tx, [gameAuthority, vaultKeypair]);
    agentVault = vaultKeypair.publicKey;
    console.log("Agent vault created:", agentVault.toBase58());
  });

  it("Create a rewards vault + mint rewards to it", async () => {
    const rewardsVaultKeypair = Keypair.generate();
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);
  
    const createRewardsVaultIx = SystemProgram.createAccount({
      fromPubkey: rewardsAuthority.publicKey,
      newAccountPubkey: rewardsVaultKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const initRewardsVaultIx = createInitializeAccountInstruction(
      rewardsVaultKeypair.publicKey,
      tokenMint,
      rewardsAuthority.publicKey,
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createRewardsVaultIx, initRewardsVaultIx);
    await provider.sendAndConfirm(tx, [rewardsAuthority, rewardsVaultKeypair]);
    rewardsVault = rewardsVaultKeypair.publicKey;
    console.log("Rewards vault created at:", rewardsVault.toBase58());
  
    // Mint a larger amount of reward tokens to that vault
    const UPDATED_REWARD_AMOUNT = 10_000_000; // 10 tokens with 6 decimals
    await mintTo(
      provider.connection,
      gameAuthority,            // Mint authority
      tokenMint,                // Mint address
      rewardsVault,             // Recipient rewards vault
      gameAuthority.publicKey,  // Mint authority's public key
      UPDATED_REWARD_AMOUNT     // Updated reward amount
    );
    console.log(
      "Minted reward tokens into the rewards vault. Balance:",
      await getTokenBalance(rewardsVault)
    );
  
    // Verify the rewardsVault balance
    const updatedRewardsVaultBal = await getTokenBalance(rewardsVault);
    expect(updatedRewardsVaultBal).to.equal(UPDATED_REWARD_AMOUNT);
    console.log(`Rewards Vault Balance after minting: ${updatedRewardsVaultBal} tokens`);
  });
  // ----------------------------------------------------------------
  // 5) Create staker token accounts + mint
  // ----------------------------------------------------------------
  it("Create staker1 token account & mint tokens", async () => {
    staker1TokenAccount = await createTokenAccountForUser(staker1.publicKey, tokenMint);
    console.log("Created staker1 token account:", staker1TokenAccount.toBase58());

    const MINT_AMOUNT = 1_000_000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      staker1TokenAccount,
      gameAuthority.publicKey,
      MINT_AMOUNT
    );
    console.log(
      "Minted tokens to staker1. Balance:",
      await getTokenBalance(staker1TokenAccount)
    );
  });

  it("Create staker2 token account & mint tokens", async () => {
    // Also airdrop staker2 some SOL
    const sig = await provider.connection.requestAirdrop(staker2.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig);

    staker2TokenAccount = await createTokenAccountForUser(staker2.publicKey, tokenMint);
    console.log("Created staker2 token account:", staker2TokenAccount.toBase58());

    const MINT_AMOUNT_2 = 500_000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      staker2TokenAccount,
      gameAuthority.publicKey,
      MINT_AMOUNT_2
    );
    console.log(
      "Minted tokens to staker2. Balance:",
      await getTokenBalance(staker2TokenAccount)
    );
  });

  // ----------------------------------------------------------------
  // 6) Create rewards vault owned by rewardsAuthority
  // ----------------------------------------------------------------
  it("Create a rewards vault + mint rewards to it", async () => {
    const rewardsVaultKeypair = Keypair.generate();
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

    const createRewardsVaultIx = SystemProgram.createAccount({
      fromPubkey: rewardsAuthority.publicKey,
      newAccountPubkey: rewardsVaultKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const initRewardsVaultIx = createInitializeAccountInstruction(
      rewardsVaultKeypair.publicKey,
      tokenMint,
      rewardsAuthority.publicKey,
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createRewardsVaultIx, initRewardsVaultIx);
    await provider.sendAndConfirm(tx, [rewardsAuthority, rewardsVaultKeypair]);
    rewardsVault = rewardsVaultKeypair.publicKey;
    console.log("Rewards vault created at:", rewardsVault.toBase58());

    // Mint reward tokens to that vault
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      rewardsVault,
      gameAuthority.publicKey,
      REWARD_AMOUNT * 100000
    );
    console.log(
      "Minted reward tokens into the rewards vault. Balance:",
      await getTokenBalance(rewardsVault)
    );
  });

  // ----------------------------------------------------------------
  // 7) Staker1: Initialize Stake, deposit
  // ----------------------------------------------------------------
  it("Staker1: InitializeStake on agent", async () => {
    const [stakePda] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker1.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPdaStaker1 = stakePda;

    await program.methods
      .initializeStake(new BN(FIRST_DEPOSIT))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        stakerSource: staker1TokenAccount,
        agentVault: agentVault,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
    expect(stakeInfo.isInitialized).to.be.true;
    console.log("Staker1: first deposit success.");
  });

  it("Staker1: StakeTokens again (second deposit)", async () => {
    await program.methods
      .stakeTokens(new BN(SECOND_DEPOSIT))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        stakerSource: staker1TokenAccount,
        agentVault: agentVault,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT);
    console.log("Staker1: second deposit success. stakeInfo updated.");
  });

  // Over-stake test
  it("Fails if staker1 tries to over-stake beyond their balance", async () => {
    let failed = false;
    try {
      await program.methods
        .stakeTokens(new BN(LARGE_STAKE_AMOUNT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPdaStaker1,
          stakerSource: staker1TokenAccount,
          agentVault: agentVault,
          authority: staker1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err: any) {
      console.log("Overstake attempt failed =>", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 8) Initiate a 2-hour Cooldown
  // ----------------------------------------------------------------


  // ----------------------------------------------------------------
  // 9) Partially Unstake EXACT 2000 tokens
  // ----------------------------------------------------------------
  it("Staker1: Partial Unstake EXACT 2000 tokens => must sign with gameAuthority", async () => {
    const beforeBalance = await getTokenBalance(staker1TokenAccount);
    const sharesNeeded = await computeSharesForExactUnstake(PARTIAL_UNSTAKE_TOKENS);

    await program.methods
      .unstakeTokens(new BN(sharesNeeded))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        agentVault: agentVault,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,
        gameAuthority: gameAuthority.publicKey, // vault owned by gameAuthority
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker1.payer, gameAuthority]) // staker1 + gameAuthority
      .rpc();

    const afterBalance = await getTokenBalance(staker1TokenAccount);
    const diff = afterBalance - beforeBalance;
    console.log("Staker1 partial unstake => gained:", diff);
    expect(diff).to.equal(PARTIAL_UNSTAKE_TOKENS);
  });


  it("Succeeds in claiming rewards", async () => {
    // To simulate cooldown, we need to manually adjust the stake_info's last_reward_timestamp
    // For simplicity, let's assume that the cooldown has passed by modifying the stake_info directly.
    // **Important**: Directly modifying account data is generally unsafe and not recommended.
    // This is only for testing purposes. In production, you should have proper instructions to handle this.

    // **Option 1: Implement a Test-Only Instruction to Set Timestamps**
    // If you have a test-only instruction, use it here to set `last_reward_timestamp` to a past value.
    // Example (Assuming you have such an instruction):
    /*
    await program.methods
      .setLastRewardTimestamp(new BN(0))
      .accounts({
        stake_info: stakeInfoPdaStaker1,
        authority: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc();
    */

    // **Option 2: Temporarily Bypass Cooldown Checks**
    // Modify the program to bypass cooldown checks in the test environment.
    // This requires conditional compilation in your Rust program.

    // **Proceeding with the Claim as if Cooldown is Met:**

    // Ensure that the cooldown period is satisfied. You might need to advance the clock or use a test-only instruction.

    const beforeBal = await getTokenBalance(staker1TokenAccount);
    const rewardsVaultBal = await getTokenBalance(rewardsVault);

    console.log("Rewards Vault Balance", rewardsVaultBal, " tokens");

    await program.methods
      .claimStakingRewards()
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        mint: tokenMint,
        rewardsVault: rewardsVault,
        rewardsAuthority: rewardsAuthority.publicKey,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey, // correct staker
        gameAuthority: gameAuthority.publicKey, // gameAuthority signs
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([rewardsAuthority]) // Include rewardsAuthority as a signer
      .rpc();

    const afterBal = await getTokenBalance(staker1TokenAccount);
    const diff = afterBal - beforeBal;
    console.log(`Staker1 claimed rewards => gained ${diff} tokens in staker1TokenAccount.`);
    expect(diff).to.be.gt(0); // Some positive reward
  });


  // ----------------------------------------------------------------
  // 10) Fully Unstake leftover
  // ----------------------------------------------------------------
  it("Staker1: Fully unstakes leftover", async () => {
    const stakeInfoBefore = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    const leftoverShares = Number(stakeInfoBefore.shares);

    const beforeBalance = await getTokenBalance(staker1TokenAccount);

    await program.methods
      .unstakeTokens(new BN(leftoverShares))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        agentVault: agentVault,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,
        gameAuthority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker1.payer, gameAuthority])
      .rpc();

    const afterBalance = await getTokenBalance(staker1TokenAccount);
    console.log(`Balance before: ${beforeBalance}, after: ${afterBalance}`);

    const stakeInfoAfter = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfoAfter.shares)).to.equal(0);
    console.log("Staker1 fully unstaked leftover => stakeInfo zeroed out.");
  });

  // ----------------------------------------------------------------
  // 11) Create staker2 scenario
  // ----------------------------------------------------------------
  it("Staker2: InitializeStake on the same agent", async () => {
    const [stakePda2] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker2.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPdaStaker2 = stakePda2;

    await program.methods
      .initializeStake(new BN(7000))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker2,
        stakerSource: staker2TokenAccount,
        agentVault: agentVault,
        authority: staker2.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2])
      .rpc();

    const stakeInfo2 = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    expect(Number(stakeInfo2.amount)).to.equal(7000);
    expect(stakeInfo2.isInitialized).to.be.true;
    expect(stakeInfo2.staker.toBase58()).to.equal(staker2.publicKey.toBase58());
    console.log("Staker2: stakeInfo created & deposit done.");
  });

  it("Staker2: Partially unstakes EXACT 3000 tokens", async () => {
    const sharesNeeded = await computeSharesForExactUnstake(3000);
    const beforeBalance = await getTokenBalance(staker2TokenAccount);

    await program.methods
      .unstakeTokens(new BN(sharesNeeded))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker2,
        agentVault: agentVault,
        stakerDestination: staker2TokenAccount,
        authority: staker2.publicKey,
        gameAuthority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2, gameAuthority])
      .rpc();

    const afterBalance = await getTokenBalance(staker2TokenAccount);
    console.log("Staker2 partial unstake =>", afterBalance - beforeBalance);
    expect(afterBalance - beforeBalance).to.equal(3000);
  });

  it("Staker2: Fully unstakes leftover", async () => {
    const stakeInfo2Before = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    const leftover = Number(stakeInfo2Before.shares);

    await program.methods
      .unstakeTokens(new BN(leftover))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker2,
        agentVault: agentVault,
        stakerDestination: staker2TokenAccount,
        authority: staker2.publicKey,
        gameAuthority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2, gameAuthority])
      .rpc();

    const stakeInfo2After = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    expect(Number(stakeInfo2After.shares)).to.equal(0);
  });

  // ----------------------------------------------------------------
  // 12) Unauthorized user tries to unstake staker1 => fails
  // ----------------------------------------------------------------
  it("Unauthorized user tries to unstake staker1 => fails", async () => {
    let failed = false;
    try {
      await program.methods
        .unstakeTokens(new BN(1000))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPdaStaker1, // staker1's stake
          agentVault: agentVault,
          stakerDestination: staker2TokenAccount,
          authority: staker2.publicKey, // WRONG authority
          gameAuthority: gameAuthority.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2, gameAuthority])
        .rpc();
    } catch (err: any) {
      console.log("Unauthorized attempt blocked =>", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 13) **Claim Rewards** tests
  // ----------------------------------------------------------------
  it("Fails to claim rewards if not cooldown or staker mismatch", async () => {
    // Attempt to claim rewards for staker1 by staker2 => should fail
    let failed = false;
    try {
      await program.methods
        .claimStakingRewards()
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPdaStaker1,
          mint: tokenMint,
          rewardsVault: rewardsVault,
          rewardsAuthority: rewardsAuthority.publicKey, // must sign if we're transferring from rewards vault
          stakerDestination: staker1TokenAccount,
          authority: staker2.publicKey, // WRONG => staker2 not staker1
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rewardsAuthority, staker2]) // Include rewardsAuthority as a signer
        .rpc();
    } catch (err: any) {
      console.log("Claiming rewards with wrong staker => fails:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });


  // ----------------------------------------------------------------
  // 14) Update daily rewards
  // ----------------------------------------------------------------
  it("gameAuthority updates daily rewards in the game", async () => {
    // e.g. set daily_reward_tokens = 600_000
    await program.methods
      .updateDailyRewards(new BN(600_000))
      .accounts({
        game: gamePda,
        authority: gameAuthority.publicKey,
      })
      .signers([gameAuthority])
      .rpc();

    const gameAcct = await program.account.game.fetch(gamePda);
    expect(Number(gameAcct.dailyRewardTokens)).to.equal(600_000);
    console.log("Daily rewards updated to 600000");
  });

  it("Staker1: Stake then balance increase for the agent and then unstake", async () => {
    // Stake an additional 8,000 tokens
    const initialiBalance =  await getTokenBalance(staker1TokenAccount);
    await program.methods
      .stakeTokens(new BN(8000))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        stakerSource: staker1TokenAccount,
        agentVault: agentVault,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
      console.log("These are the shares of the staker: " , stakeInfo.shares.toNumber());
    // Now simulate an increase in the agent vault balance by minting additional tokens
    const additionalAmount = 8000; // e.g. add 2,000 tokens
    await mintTo(
      provider.connection,
      gameAuthority, 
      tokenMint,
      agentVault,
      gameAuthority.publicKey,
      additionalAmount
    );
    console.log("Minted additional tokens into agent vault.");
    console.log("These are the shaers of the staker after the deposit: " , stakeInfo.shares.toNumber());

    // Optionally, read and log the new balance of the agent vault:
    const newVaultBalance = await getAccount(provider.connection, agentVault);
    console.log("New agent vault balance:", Number(newVaultBalance.amount));
  
    // Now perform unstaking (this part would be as you normally test unstaking)
    // Compute how many shares are needed for unstaking a target token amount.
    // const sharesNeeded = await computeSharesForExactUnstake(10000); // unstake 2000 tokens
  
    await program.methods
      .unstakeTokens(new BN(8000))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        agentVault: agentVault,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,
        gameAuthority: gameAuthority.publicKey, // gameAuthority must sign as vault owner
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker1.payer, gameAuthority])
      .rpc();
  
    // Verify that staker1's token account balance increased appropriately
    const finalBalance = await getTokenBalance(staker1TokenAccount);
    console.log("Final staker1 token account balance:", finalBalance);
    console.log("Balance Difference : ", finalBalance - initialiBalance);
  });
  

});

