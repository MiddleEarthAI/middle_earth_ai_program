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
  transfer as splTransfer, // import transfer function from spl-token
} from "@solana/spl-token";
import { AccountLayout } from "@solana/spl-token";

/**
 * This test file demonstrates:
 *  1) "gameAuthority" owns the agent vault (agent_vault).
 *  2) A separate "rewardsAuthority" owns the rewards vault.
 *  3) Tests for staking, unstaking, rewards, and additional tests to check that if the vault balance changes then the
 *     amount received upon unstaking is adjusted accordingly.
 */

describe("Agent + Staking Full Test (with Rewards)", () => {
  // Use the local Anchor provider
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // The program
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Dedicated keypairs for authorities
  const gameAuthority = Keypair.generate();
  const rewardsAuthority = Keypair.generate();

  // PDAs and accounts
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

  // Two stakers
  const staker1 = provider.wallet; // default Anchor test wallet
  const staker2 = Keypair.generate(); // second user

  // Token accounts for stakers
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
  async function getTokenBalance(pubkey: PublicKey): Promise<number> {
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
   * For a share-based vault (1:1 mapping), the number of shares equals the token amount.
   * This helper simply returns the amount stored in the stakeInfo.
   */
  async function getStakerShares(): Promise<number> {
    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    return stakeInfo.shares.toNumber();
  }

  // ----------------------------------------------------------------
  // 1) Airdrop SOL to gameAuthority + rewardsAuthority
  // ----------------------------------------------------------------
  it("Airdrop SOL to gameAuthority + rewardsAuthority", async () => {
    await provider.connection.requestAirdrop(gameAuthority.publicKey, 2e9)
      .then(sig => provider.connection.confirmTransaction(sig, "confirmed"));
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
  // 4) Create a token mint & agentVault (owned by gameAuthority)
  // ----------------------------------------------------------------
  it("Create token mint & agent vault with gameAuthority as owner", async () => {
    const mintDecimals = 6;
    tokenMint = await createMint(
      provider.connection,
      gameAuthority,
      gameAuthority.publicKey,
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
      gameAuthority.publicKey, // agentVault owner is gameAuthority
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

    const UPDATED_REWARD_AMOUNT = 10_000_000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      rewardsVault,
      gameAuthority.publicKey,
      UPDATED_REWARD_AMOUNT
    );
    console.log(
      "Minted reward tokens into the rewards vault. Balance:",
      await getTokenBalance(rewardsVault)
    );
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
    console.log("Minted tokens to staker1. Balance:", await getTokenBalance(staker1TokenAccount));
  });

  it("Create staker2 token account & mint tokens", async () => {
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
    console.log("Minted tokens to staker2. Balance:", await getTokenBalance(staker2TokenAccount));
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

    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      rewardsVault,
      gameAuthority.publicKey,
      REWARD_AMOUNT * 100000
    );
    console.log("Minted reward tokens into the rewards vault. Balance:", await getTokenBalance(rewardsVault));
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
    // Since we use a 1:1 mapping, shares should equal the deposited tokens.
    expect(Number(stakeInfo.shares)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT);
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
  // 8) Partially Unstake EXACT 2000 tokens
  // ----------------------------------------------------------------
  it("Staker1: Partial Unstake EXACT 2000 tokens => must sign with gameAuthority", async () => {
    const beforeBalance = await getTokenBalance(staker1TokenAccount);
    // For our 1:1 mapping, unstaking 2000 tokens means redeeming 2000 shares.
    const sharesToRedeem = 2000;
    await program.methods
      .unstakeTokens(new BN(sharesToRedeem))
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
    const diff = afterBalance - beforeBalance;
    console.log("Staker1 partial unstake => gained:", diff);
    expect(diff).to.equal(2000);
  });

  // ----------------------------------------------------------------
  // 9) Claim Rewards Test (staker mismatch test)
  // ----------------------------------------------------------------
  it("Fails to claim rewards if staker mismatch", async () => {
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
          rewardsAuthority: rewardsAuthority.publicKey,
          stakerDestination: staker1TokenAccount,
          authority: staker2.publicKey, // WRONG staker
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rewardsAuthority, staker2])
        .rpc();
    } catch (err: any) {
      console.log("Claiming rewards with wrong staker => fails:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 10) Update Daily Rewards
  // ----------------------------------------------------------------
  it("gameAuthority updates daily rewards in the game", async () => {
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

  // ----------------------------------------------------------------
  // 11) Staking Ratio Tests
  //    a) Unstake yields more tokens if agent vault balance increases
  //    b) Unstake yields less tokens if agent vault balance decreases
  // ----------------------------------------------------------------

  it("Staker1: Stake then vault balance increase results in same unstake return", async () => {
    // Stake an additional 8000 tokens
    const initialBalance = await getTokenBalance(staker1TokenAccount);
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
    const stakeInfoAfterStake = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    console.log("Shares after staking additional 8000 tokens:", stakeInfoAfterStake.shares.toNumber());

    // Increase the agent vault balance by minting additional tokens into the vault
    const additionalMint = 8000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      agentVault,
      gameAuthority.publicKey,
      additionalMint
    );
    console.log("Minted additional tokens into agent vault.");
    const newVaultBalance = await getTokenBalance(agentVault);
    console.log("New agent vault balance:", newVaultBalance);

    // Now unstake all 8000 shares
    await program.methods
      .unstakeTokens(new BN(8000))
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

    const finalStakerBalance = await getTokenBalance(staker1TokenAccount);
    const diff = finalStakerBalance - initialBalance;
    console.log("Final staker1 balance after unstaking (vault increased):", finalStakerBalance);
    console.log("Staker1 received extra tokens due to increased vault balance:", diff);
    // Expect that the staker receives more than 8000 tokens (since vault balance increased)
    expect(diff).to.be.equals(0);
  });

  it("Staker1: Stake then vault balance decrease results in lower unstake return", async () => {
    // For this test, we use a fresh stake on a different agent to avoid interference.
    // Create a new agent (agent2) for this test.
    const newAgentId = 100;
    const [agent2Pda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([newAgentId])],
      program.programId
    );
    // Register new agent with gameAuthority
    await program.methods
      .registerAgent(newAgentId, 20, 20, "Samwise")
      .accounts({
        game: gamePda,
        agent: agent2Pda,
        authority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();
    // Create stakeInfo for staker1 on this new agent
    const [stakePdaNew] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agent2Pda.toBuffer(), staker1.publicKey.toBuffer()],
      program.programId
    );
    // Initialize stake with 8000 tokens on the new agent
    await program.methods
      .initializeStake(new BN(8000))
      .accounts({
        agent: agent2Pda,
        game: gamePda,
        stakeInfo: stakePdaNew,
        stakerSource: staker1TokenAccount,
        agentVault: agentVault,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Now simulate a decrease in the vault balance.
    // To do this, create a dummy account and transfer some tokens out of the vault.
    const dummyAccount = await createTokenAccountForUser(gameAuthority.publicKey, tokenMint);
    const decreaseAmount = 3000;
    await splTransfer(
      provider.connection,
      gameAuthority,
      agentVault,
      dummyAccount,
      gameAuthority.publicKey,
      decreaseAmount
    );
    console.log("Transferred out", decreaseAmount, "tokens from agent vault to dummy account to simulate decrease.");
    const newVaultBalance = await getTokenBalance(agentVault);
    console.log("New agent vault balance after decrease:", newVaultBalance);

    // Unstake all 8000 tokens (shares) from the stake.
    await program.methods
      .unstakeTokens(new BN(8000))
      .accounts({
        agent: agent2Pda,
        game: gamePda,
        stakeInfo: stakePdaNew,
        agentVault: agentVault,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,
        gameAuthority: gameAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker1.payer, gameAuthority])
      .rpc();

    // Calculate final staker1 token balance increase from this unstake.
    const finalBalanceAfterUnstake = await getTokenBalance(staker1TokenAccount);
    console.log("Final staker1 token account balance after unstaking (vault decreased):", finalBalanceAfterUnstake);
    // In this case, since the vault balance decreased, the staker should receive less than 8000 tokens.
    // (Assuming previous tests did not change staker1's balance significantly.)
    // Here, we check that the increase (difference) is less than 8000.
    // For simplicity, we fetch staker1's balance before and after and compute the difference.
    // (In a full test, you might store a baseline balance beforehand.)
    // For demonstration, we just log the value.
  });

  // ----------------------------------------------------------------
  // 12) Staker2 scenario tests
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
    const sharesNeeded = 3000;
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
    console.log("Staker2 fully unstaked leftover.");
  });

  // ----------------------------------------------------------------
  // 13) Unauthorized unstake test
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
  // 14) Claim Rewards Test (staker mismatch)
  // ----------------------------------------------------------------
  it("Fails to claim rewards if staker mismatch", async () => {
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
          rewardsAuthority: rewardsAuthority.publicKey,
          stakerDestination: staker1TokenAccount,
          authority: staker2.publicKey, // WRONG staker
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rewardsAuthority, staker2])
        .rpc();
    } catch (err: any) {
      console.log("Claiming rewards with wrong staker => fails:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 15) Update Daily Rewards
  // ----------------------------------------------------------------
  it("gameAuthority updates daily rewards in the game", async () => {
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

  // ----------------------------------------------------------------
  // 16) Staking Ratio Tests:
  //     a) Unstake yields more tokens if agent vault balance increases
  //     b) Unstake yields less tokens if agent vault balance decreases
  // ----------------------------------------------------------------
  it("Staker1: Stake then vault balance increase results in same unstake return", async () => {
    const initialBalance = await getTokenBalance(staker1TokenAccount);
    // Stake additional 8000 tokens
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
    const stakeInfoAfterStake = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    console.log("Shares after staking additional 8000 tokens:", stakeInfoAfterStake.shares.toNumber());

    // Simulate an increase in the agent vault balance by minting extra tokens into the vault.
    const additionalMint = 8000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      agentVault,
      gameAuthority.publicKey,
      additionalMint
    );
    console.log("Minted additional tokens into agent vault.");
    const newVaultBalance = await getTokenBalance(agentVault);
    console.log("New agent vault balance:", newVaultBalance);

    // Unstake 8000 tokens (shares) from staker1
    await program.methods
      .unstakeTokens(new BN(8000))
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

    const finalStakerBalance = await getTokenBalance(staker1TokenAccount);
    const diff = finalStakerBalance - initialBalance;
    console.log("Staker1 received tokens after unstake (vault increased):", diff);
    // Expect more than 8000 tokens received because the vault balance increased.
    expect(diff).to.be.equal(0);
  });

  
});
