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
 *  1) "gameAuthority" truly owns the agent vault (agent_vault).
 *  2) Stakers (staker1, staker2) deposit/unstake by calling the program, 
 *     but must sign along with "gameAuthority" when unstaking (since the vault is owned by gameAuthority).
 *  3) Unauthorized attempts fail.
 *  4) Partial unstake calculations (share-based).
 */

describe("Agent + Staking Full Test", () => {
  // Use the local Anchor provider
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // The program
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // PDAs and addresses
  let gamePda: PublicKey;
  let agentPda: PublicKey;
  let tokenMint: PublicKey;
  let agentVault: PublicKey; // owned by gameAuthority

  // We'll create a dedicated Game Authority
  const gameAuthority = Keypair.generate();

  // Seeds / IDs
  const gameId = new BN(777);
  const agentId = 99;

  // We'll store stakeInfo PDAs for each staker
  let stakeInfoPdaStaker1: PublicKey;
  let stakeInfoPdaStaker2: PublicKey; 

  // Constants for staking
  const FIRST_DEPOSIT = 5000;
  const SECOND_DEPOSIT = 3000;
  const PARTIAL_UNSTAKE_TOKENS = 2000;
  const LARGE_STAKE_AMOUNT = 2_000_000; 

  // We'll create two stakers:
  const staker1 = provider.wallet; // default Anchor test wallet
  const staker2 = Keypair.generate(); 

  // We'll hold their token accounts
  let staker1TokenAccount: PublicKey;
  let staker2TokenAccount: PublicKey;

  // Helper to get SPL token balance
  async function getTokenBalance(pubkey: PublicKey) {
    const acct = await getAccount(provider.connection, pubkey);
    return Number(acct.amount);
  }

  /**
   * Create a token account for a user.
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
   * We want to unstake EXACT 'tokenAmount' from a share-based vault.
   * So sharesNeeded = (tokenAmount * totalShares) / vaultBalance, floored.
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
  // 1) Airdrop SOL to the game authority
  // ----------------------------------------------------------------
  it("Airdrop SOL to the game authority", async () => {
    const sig = await provider.connection.requestAirdrop(gameAuthority.publicKey, 2e9); // 2 SOL
    await provider.connection.confirmTransaction(sig, "confirmed");
    console.log("Airdropped 2 SOL to gameAuthority:", gameAuthority.publicKey.toBase58());
  });

  // ----------------------------------------------------------------
  // 2) Initialize a brand-new Game (owned by gameAuthority)
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
        authority: gameAuthority.publicKey, // game authority
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAuthority])
      .rpc();
    console.log("Game created at:", gamePda.toBase58());

    // Confirm
    const gameAcct = await program.account.game.fetch(gamePda);
    expect(gameAcct.isActive).to.be.true;
    expect(Number(gameAcct.gameId)).to.equal(gameId.toNumber());
    expect(gameAcct.authority.toBase58()).to.equal(gameAuthority.publicKey.toBase58());
  });

  // ----------------------------------------------------------------
  // 3) Register Agent referencing that Game
  // ----------------------------------------------------------------
  it("Register an Agent referencing that Game", async () => {
    const [apda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    agentPda = apda;

    const agentName = "Frodo";

    // We'll sign with gameAuthority since agent belongs to gameAuthority
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
    console.log("Agent registered at:", agentPda.toBase58());

    // Confirm
    const agentAcct = await program.account.agent.fetch(agentPda);
    expect(agentAcct.isAlive).to.be.true;
    expect(agentAcct.game.toBase58()).to.equal(gamePda.toBase58());
    expect(agentAcct.authority.toBase58()).to.equal(gameAuthority.publicKey.toBase58());
    expect(agentAcct.id).to.equal(agentId);
  });

  // ----------------------------------------------------------------
  // 4) Create a token mint & agent vault (owned by gameAuthority)
  // ----------------------------------------------------------------
  it("Create token mint & agent vault with gameAuthority as owner", async () => {
    // 4a) Create a token mint
    const mintDecimals = 6;
    tokenMint = await createMint(
      provider.connection,
      gameAuthority,            // Payer
      gameAuthority.publicKey,  // Mint authority
      null,
      mintDecimals
    );
    console.log("Created token mint:", tokenMint.toBase58());

    // 4b) Create agent vault owned by the game authority
    const vaultKeypair = Keypair.generate();
    const size = AccountLayout.span;
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

    const createVaultIx = SystemProgram.createAccount({
      fromPubkey: gameAuthority.publicKey, // game authority pays
      newAccountPubkey: vaultKeypair.publicKey,
      space: size,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    });
    // Initialize vault with game authority as the owner
    const initVaultIx = createInitializeAccountInstruction(
      vaultKeypair.publicKey,
      tokenMint,
      gameAuthority.publicKey, // <--- gameAuthority is the vault owner
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
    await provider.sendAndConfirm(tx, [gameAuthority, vaultKeypair]);
    agentVault = vaultKeypair.publicKey;
    console.log("Agent vault created (owned by gameAuthority):", agentVault.toBase58());
  });

  // ----------------------------------------------------------------
  // 5) Create staker token accounts & mint tokens
  // ----------------------------------------------------------------
  it("Create staker1 token account & mint tokens", async () => {
    staker1TokenAccount = await createTokenAccountForUser(staker1.publicKey, tokenMint);
    console.log("Created staker1 token account:", staker1TokenAccount.toBase58());

    const MINT_AMOUNT = 1_000_000;
    // Because gameAuthority is mint authority, it must sign
    await mintTo(
      provider.connection,
      gameAuthority,         // fee payer
      tokenMint,
      staker1TokenAccount,
      gameAuthority.publicKey, // mint authority
      MINT_AMOUNT
    );
    console.log(
      "Minted tokens to staker1's account. Balance:",
      await getTokenBalance(staker1TokenAccount)
    );
  });

  it("Create staker2 token account & mint tokens", async () => {
    // Airdrop some SOL to staker2 for fees
    const sig = await provider.connection.requestAirdrop(staker2.publicKey, 2e9);
    await provider.connection.confirmTransaction(sig, "confirmed");

    staker2TokenAccount = await createTokenAccountForUser(staker2.publicKey, tokenMint);
    console.log("Created staker2 token account:", staker2TokenAccount.toBase58());

    const MINT_AMOUNT_2 = 500_000;
    await mintTo(
      provider.connection,
      gameAuthority,
      tokenMint,
      staker2TokenAccount,
      gameAuthority.publicKey, // mint authority
      MINT_AMOUNT_2
    );
    console.log(
      "Minted tokens to staker2's account. Balance:",
      await getTokenBalance(staker2TokenAccount)
    );
  });

  // ----------------------------------------------------------------
  // 6) Staker1: InitializeStake => create stakeInfo, deposit
  // ----------------------------------------------------------------
  it("Staker1: InitializeStake on the agent", async () => {
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
        agentVault: agentVault, // Owned by gameAuthority
        authority: staker1.publicKey, // staker1 signs
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
    expect(stakeInfo.isInitialized).to.be.true;
    expect(stakeInfo.staker.toBase58()).to.equal(staker1.publicKey.toBase58());
    console.log("Staker1 stakeInfo validated, first deposit success.");
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
  // 7) Staker1: Initiate a 2-hour Cooldown
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
  // 8) Staker1: Partially Unstake EXACT 2000 tokens
  // ----------------------------------------------------------------
  it("Staker1: Partially unstakes exactly 2000 tokens", async () => {
    const beforeBalance = await getTokenBalance(staker1TokenAccount);

    const sharesNeeded = await computeSharesForExactUnstake(PARTIAL_UNSTAKE_TOKENS);
    console.log("Shares needed to unstake EXACT 2000 tokens:", sharesNeeded);
    expect(sharesNeeded).to.be.gt(0);

    // We must sign with BOTH staker1 (for stake_info) and gameAuthority (vault owner)
    await program.methods
      .unstakeTokens(new BN(sharesNeeded))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPdaStaker1,
        agentVault: agentVault, 
        stakerDestination: staker1TokenAccount,
        authority: staker1.publicKey,      // staker
        gameAuthority: gameAuthority.publicKey, // vault owner
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker1.payer, gameAuthority]) 
      .rpc();

    const afterBalance = await getTokenBalance(staker1TokenAccount);
    const diff = afterBalance - beforeBalance;
    console.log(`Staker1 partial unstake => gained ${diff} tokens`);
    expect(diff).to.equal(PARTIAL_UNSTAKE_TOKENS);
  });

  // ----------------------------------------------------------------
  // 9) Staker1: Fully Unstake leftover
  // ----------------------------------------------------------------
  it("Staker1: Fully unstakes leftover", async () => {
    const stakeInfoBefore = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    const leftoverShares = Number(stakeInfoBefore.shares);
    console.log("Leftover shares for staker1:", leftoverShares);

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
      // signers with staker + gameAuthority
      .signers([staker1.payer, gameAuthority])
      .rpc();

    const afterBalance = await getTokenBalance(staker1TokenAccount);
    console.log("Balance before:", beforeBalance, "after:", afterBalance);

    const stakeInfoAfter = await program.account.stakeInfo.fetch(stakeInfoPdaStaker1);
    expect(Number(stakeInfoAfter.shares)).to.equal(0);
    expect(Number(stakeInfoAfter.amount)).to.equal(0);
    console.log("Staker1: fully unstaked leftover => stakeInfo zeroed out.");
  });

  // ----------------------------------------------------------------
  // 10) Unauthorized user tries to unstake staker1 => fails
  // ----------------------------------------------------------------
  it("Unauthorized user tries to partially unstake staker1 => fails", async () => {
    let failed = false;

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
          gameAuthority: gameAuthority.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2, gameAuthority])
        .rpc();
    } catch (err: any) {
      console.log("Unauthorized unstake attempt failed as expected:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 11) Staker2 scenario: Initialize & partial unstake
  // ----------------------------------------------------------------
  it("Staker2: InitializeStake on the same agent", async () => {
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
    const tokenAmount = 3000;
    const sharesNeeded = await computeSharesForExactUnstake(tokenAmount);

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
    const diff = afterBalance - beforeBalance;
    console.log("Staker2 partial unstake diff:", diff);
    expect(diff).to.equal(tokenAmount);
  });

  it("Staker2: Fully unstakes leftover", async () => {
    const stakeInfo2Before = await program.account.stakeInfo.fetch(stakeInfoPdaStaker2);
    const leftoverShares = Number(stakeInfo2Before.shares);

    await program.methods
      .unstakeTokens(new BN(leftoverShares))
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
    expect(Number(stakeInfo2After.amount)).to.equal(0);
    console.log("Staker2: fully unstaked leftover => stakeInfo zeroed out.");
  });
});
