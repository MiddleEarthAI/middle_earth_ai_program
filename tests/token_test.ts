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
 *  1) Single "Agent" that multiple stakers can stake into (so we remove `has_one=authority` on agent).
 *  2) Staker1 stakes/unstakes partially (by EXACT token amounts).
 *  3) Staker2 also stakes, partially unstakes.
 *  4) Unauthorized tries to unstake staker1 => fails.
 * 
 * Key Points:
 *  - Because your program is share-based, we must compute how many shares equals an exact token amount.
 *    That way, we can test partial unstakes for EXACT 2000 tokens, etc.
 */
describe("Agent + Staking Full Test", () => {
  // Use the local Anchor provider
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // The program
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // We'll populate these as we create them
  let gamePda: PublicKey;
  let agentPda: PublicKey;
  let tokenMint: PublicKey;
  let agentVault: PublicKey;

  // Seeds / IDs
  const gameId = new BN(777);
  const agentId = 99;

  // We'll store stakeInfo PDAs for each staker
  let stakeInfoPdaStaker1: PublicKey;
  let stakeInfoPdaStaker2: PublicKey; // For second staker scenario

  // Constants for staking
  const FIRST_DEPOSIT = 5000;
  const SECOND_DEPOSIT = 3000;
  const PARTIAL_UNSTAKE_TOKENS = 2000;
  const LARGE_STAKE_AMOUNT = 2_000_000; // Over stake to test failure

  // We'll create two stakers:
  const staker1 = provider.wallet; // The default anchor test wallet
  const staker2 = Keypair.generate(); // A second user

  // We'll hold their token accounts here
  let staker1TokenAccount: PublicKey;
  let staker2TokenAccount: PublicKey;

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
      userPubkey, // userPubkey is the owner
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createIx, initIx);
    await provider.sendAndConfirm(tx, [tokenAcctKeypair]);
    return tokenAcctKeypair.publicKey;
  }

  /**
   * Since your unstakeTokens instruction expects "shares" but we want to unstake EXACT `tokenAmount`,
   * we convert: sharesNeeded = (tokenAmount * totalShares) / vaultBalance.
   * We'll do integer math with `floor`.
   */
  async function computeSharesForExactUnstake(
    tokenAmount: number,
    stakerPda: PublicKey
  ): Promise<number> {
    // fetch agent and read agent.totalShares
    const agentAcct = await program.account.agent.fetch(agentPda);
    const totalSharesBN = agentAcct.totalShares as anchor.BN;
    const totalShares = Number(totalSharesBN);

    // read vault's balance
    const vaultBalance = await getTokenBalance(agentVault);
    if (vaultBalance === 0 || totalShares === 0) {
      // If there's no balance or no totalShares, can't compute ratio
      return 0;
    }

    // sharesNeeded = tokenAmount * totalShares / vaultBalance
    const sharesFloat = (tokenAmount * totalShares) / vaultBalance;
    const sharesNeeded = Math.floor(sharesFloat);
    return sharesNeeded;
  }

  // ----------------------------------------------------------------
  // 1) Initialize Game
  // ----------------------------------------------------------------
  it("Initialize a brand-new Game", async () => {
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    gamePda = pda;

    await program.methods
      .initializeGame(gameId, new BN(bump))
      .accounts({
        game: gamePda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Game created at:", gamePda.toBase58());

    // Confirm
    const gameAcct = await program.account.game.fetch(gamePda);
    expect(gameAcct.isActive).to.be.true;
    expect(Number(gameAcct.gameId)).to.equal(gameId.toNumber());
    expect(gameAcct.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
  });

  // ----------------------------------------------------------------
  // 2) Register Agent (Remove or update `has_one = authority` in your Rust code!)
  // ----------------------------------------------------------------
  it("Register an Agent referencing that Game", async () => {
    const [apda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    agentPda = apda;

    // We'll do a name
    const agentName = "Frodo";

    await program.methods
      .registerAgent(agentId, 10, -4, agentName)
      .accounts({
        game: gamePda,
        agent: agentPda,
        authority: provider.wallet.publicKey, // the agent's authority for admin, but not for stakers
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Agent registered at:", agentPda.toBase58());

    // Confirm
    const agentAcct = await program.account.agent.fetch(agentPda);
    expect(agentAcct.isAlive).to.be.true;
    expect(agentAcct.game.toBase58()).to.equal(gamePda.toBase58());
    // `agentAcct.authority` is the one who can do agent-level updates, but not necessarily staker
    expect(agentAcct.id).to.equal(agentId);
  });

  // ----------------------------------------------------------------
  // 3) Create a token mint & Agent Vault
  // ----------------------------------------------------------------
  it("Create token mint & agent vault", async () => {
    // Create a token mint
    const mintDecimals = 6;
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      mintDecimals
    );
    console.log("Created token mint:", tokenMint.toBase58());

    // Create agent vault
    const vaultKeypair = Keypair.generate();
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

    const createVaultIx = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: vaultKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    const initVaultIx = createInitializeAccountInstruction(
      vaultKeypair.publicKey,
      tokenMint,
      provider.wallet.publicKey, // authority is the owner of this vault
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
    await provider.sendAndConfirm(tx, [vaultKeypair]);
    agentVault = vaultKeypair.publicKey;
    console.log("Agent vault created:", agentVault.toBase58());
  });

  // ----------------------------------------------------------------
  // 4) Create staker token accounts & mint tokens
  // ----------------------------------------------------------------
  it("Create staker1 token account & mint tokens", async () => {
    // We'll let staker1 = provider.wallet
    staker1TokenAccount = await createTokenAccountForUser(staker1.publicKey, tokenMint);
    console.log("Created staker1 token account:", staker1TokenAccount.toBase58());

    const MINT_AMOUNT = 1_000_000;
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      staker1TokenAccount,
      provider.wallet.publicKey, // mint authority
      MINT_AMOUNT
    );
    console.log(
      "Minted tokens to staker1's account. Balance:",
      await getTokenBalance(staker1TokenAccount)
    );
  });

  it("Create staker2 token account & mint tokens", async () => {
    // Also airdrop some SOL to staker2 so they can pay for transactions
    await provider.connection.requestAirdrop(staker2.publicKey, 2e9); // 2 SOL

    staker2TokenAccount = await createTokenAccountForUser(staker2.publicKey, tokenMint);
    console.log("Created staker2 token account:", staker2TokenAccount.toBase58());

    const MINT_AMOUNT_2 = 500_000;
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      staker2TokenAccount,
      provider.wallet.publicKey, // mint authority
      MINT_AMOUNT_2
    );
    console.log(
      "Minted tokens to staker2's account. Balance:",
      await getTokenBalance(staker2TokenAccount)
    );
  });

  // ----------------------------------------------------------------
  // 5) Staker1: InitializeStake => create stakeInfo, deposit
  // ----------------------------------------------------------------
  it("Staker1: InitializeStake on the agent", async () => {
    // Derive stake info pda
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
        authority: staker1.publicKey, // staker1 must sign
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([]) // staker1 is the default wallet, so no explicit signer needed if using anchor default
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
    expect(stakeInfo.isInitialized).to.be.true;
    expect(stakeInfo.staker.toBase58()).to.equal(staker1.publicKey.toBase58());
    console.log("Staker1: stakeInfo validated, first deposit success.");
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

  it("Staker1: Fails if trying to over-stake beyond staker's balance", async () => {
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
      console.log("Over-staking attempt failed as expected:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 6) Staker1: Initiate a 2-hour Cooldown
  // ----------------------------------------------------------------
  it("Staker1: Initiates a 2-hour cooldown", async () => {
    await program.methods
      .initiateCooldown()
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    console.log("Cooldown initiated. cooldown_ends_at=", stakeInfo.cooldownEndsAt.toNumber());
    expect(stakeInfo.cooldownEndsAt.toNumber()).to.be.greaterThan(Math.floor(Date.now() / 1000));
  });

  // ----------------------------------------------------------------
  // 7) Staker1: Partial Unstake EXACT 2000 tokens (by converting to shares)
  // ----------------------------------------------------------------
  it("Staker1: Partially unstakes exactly 2000 tokens", async () => {
    // Read staker's token balance before
    const beforeBalance = await getTokenBalance(staker1TokenAccount);

    // Convert "2000 tokens" -> shares
    const sharesNeeded = await computeSharesForExactUnstake(PARTIAL_UNSTAKE_TOKENS, agentPda);
    console.log("Shares needed to unstake EXACT 2000 tokens:", sharesNeeded);
    expect(sharesNeeded).to.be.gt(0);

    // Attempt partial unstake by passing 'sharesNeeded'
    await program.methods
      .unstakeTokens(new BN(sharesNeeded))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        agentVault: agentVault,
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Read staker's token balance after
    const afterBalance = await getTokenBalance(staker1TokenAccount);
    const diff = afterBalance - beforeBalance;
    // Because we calculated the correct shares, we should get ~2000 tokens exactly
    console.log(`Staker1 partial unstake => gained ${diff} tokens`);
    expect(diff).to.equal(PARTIAL_UNSTAKE_TOKENS);

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    console.log("Staker1: stakeInfo after partial unstake:", stakeInfo);
  });

  // ----------------------------------------------------------------
  // 8) Staker1: Fully Unstake leftover
  // ----------------------------------------------------------------
  it("Staker1: Fully unstakes leftover", async () => {
    // Check the stakeInfo to see what's left
    const stakeInfoBefore = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    const leftoverShares = Number(stakeInfoBefore.shares);
    console.log("Leftover shares for staker1:", leftoverShares);

    // Check staker's balance before
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
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Check staker's balance after
    const afterBalance = await getTokenBalance(staker1TokenAccount);
    console.log("Balance before:", beforeBalance, "after:", afterBalance);

    const stakeInfoAfter = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfoAfter.shares)).to.equal(0);
    expect(Number(stakeInfoAfter.amount)).to.equal(0);
    console.log("Staker1: fully unstaked leftover => stakeInfo zeroed out.");
  });

  // ----------------------------------------------------------------
  // 9) Unauthorized user tries to unstake staker1 => fails
  // ----------------------------------------------------------------
  it("Unauthorized user tries to partially unstake staker1 => fails", async () => {
    let failed = false;

    // We'll just reuse stakeInfoPdaStaker1 but sign with staker2
    try {
      await program.methods
        .unstakeTokens(new BN(1000))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPdaStaker1,
          agentVault: agentVault,
          stakerDestination: staker2TokenAccount,
          authority: staker2.publicKey, // WRONG authority => should fail
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2]) // staker2 tries to do it
        .rpc();
    } catch (err: any) {
      console.log("Unauthorized unstake attempt failed as expected:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 10) Staker2 scenario: Initialize & partial unstake
  // ----------------------------------------------------------------
  it("Staker2: InitializeStake on the same agent", async () => {
    // Derive stake info pda for staker2
    const [stakePda2] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker2.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPdaStaker2 = stakePda2;

    const STAKER2_DEPOSIT = 7000;
    await program.methods
      .initializeStake(new BN(STAKER2_DEPOSIT))
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
    expect(Number(stakeInfo2.amount)).to.equal(STAKER2_DEPOSIT);
    expect(stakeInfo2.isInitialized).to.be.true;
    expect(stakeInfo2.staker.toBase58()).to.equal(staker2.publicKey.toBase58());
    console.log("Staker2: stakeInfo created & deposit done.");
  });

  it("Staker2: Partially unstakes EXACT 3000 tokens", async () => {
    // Check staker2's balance before
    const beforeBalance = await getTokenBalance(staker2TokenAccount);

    // Convert 3000 tokens -> shares
    const tokenAmount = 3000;
    const sharesNeeded = await computeSharesForExactUnstake(tokenAmount, agentPda);
    console.log("Shares needed for staker2 to unstake 3000 tokens:", sharesNeeded);

    await program.methods
      .unstakeTokens(new BN(sharesNeeded))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker2,
        agentVault: agentVault,
        stakerDestination: staker2TokenAccount,
        authority: staker2.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2])
      .rpc();

    const afterBalance = await getTokenBalance(staker2TokenAccount);
    const diff = afterBalance - beforeBalance;
    console.log("Staker2 partial unstake diff:", diff);
    expect(diff).to.equal(tokenAmount);
  });

  it("Staker2: Fully unstakes leftover", async () => {
    // Check leftover shares
    const stakeInfo2Before = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    const leftover = Number(stakeInfo2Before.shares);

    // Unstake them
    await program.methods
      .unstakeTokens(new BN(leftover))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker2,
        agentVault: agentVault,
        stakerDestination: staker2TokenAccount,
        authority: staker2.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2])
      .rpc();

    // Confirm zeroed out
    const stakeInfo2After = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    expect(Number(stakeInfo2After.shares)).to.equal(0);
    expect(Number(stakeInfo2After.amount)).to.equal(0);
    console.log("Staker2: fully unstaked leftover => stakeInfo zeroed out.");
  });
});
