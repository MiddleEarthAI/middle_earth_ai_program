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
 * This test file runs:
 *  1) Creates a new Game account
 *  2) Registers a new Agent referencing that Game
 *  3) Creates a token mint for staking
 *  4) Creates an Agent vault token account owned by the Authority's wallet
 *  5) Calls initialize_stake, stake, partial unstake, full unstake, etc.
 *  6) Demonstrates initiating cooldown.
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

  // We'll store stakeInfo PDA
  let stakeInfoPda: PublicKey;

  // Constants for staking
  const FIRST_DEPOSIT = 5000;
  const SECOND_DEPOSIT = 3000;
  const PARTIAL_UNSTAKE = 2000;
  const LARGE_STAKE_AMOUNT = 2_000_000; // Over stake to test failure

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

  let stakerTokenAccount: PublicKey;

  // ----------------------------------------------------------------
  // 1) Initialize Game
  // ----------------------------------------------------------------
  it("Initialize a brand-new Game", async () => {
    // Derive the game PDA
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 4)],
      program.programId
    );
    gamePda = pda;

    // Initialize
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
  // 2) Register Agent
  // ----------------------------------------------------------------
  it("Register an Agent referencing that Game & same authority", async () => {
    // Derive the agent PDA
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
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Agent registered at:", agentPda.toBase58());

    // Confirm
    const agentAcct = await program.account.agent.fetch(agentPda);
    expect(agentAcct.isAlive).to.be.true;
    expect(agentAcct.game.toBase58()).to.equal(gamePda.toBase58());
    expect(agentAcct.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
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

    // Create agent vault owned by the authority (provider.wallet.publicKey)
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
      provider.wallet.publicKey, // authority is the owner
      TOKEN_PROGRAM_ID
    );
    const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
    await provider.sendAndConfirm(tx, [vaultKeypair]);
    agentVault = vaultKeypair.publicKey;
    console.log("Agent vault created:", agentVault.toBase58());
  });

  // ----------------------------------------------------------------
  // 4) Create staker token account & mint tokens
  // ----------------------------------------------------------------
  it("Create staker token account & mint tokens", async () => {
    // We'll let the staker be the same as the provider's wallet
    stakerTokenAccount = await createTokenAccountForUser(provider.wallet.publicKey, tokenMint);
    console.log("Created staker token account:", stakerTokenAccount.toBase58());

    const MINT_AMOUNT = 1_000_000;
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount,
      provider.wallet.publicKey, // mint authority
      MINT_AMOUNT
    );
    console.log(
      "Minted tokens to staker's account. Balance:",
      await getTokenBalance(stakerTokenAccount)
    );
  });

  // ----------------------------------------------------------------
  // 5) InitializeStake => create stakeInfo, deposit
  // ----------------------------------------------------------------
  it("InitializeStake on the agent", async () => {
    // Derive stake info pda
    const [stakePda] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPda = stakePda;

    await program.methods
      .initializeStake(new BN(FIRST_DEPOSIT))
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

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
    expect(stakeInfo.isInitialized).to.be.true;
    console.log("StakeInfo validated, first deposit success.");
  });

  it("StakeTokens again (second deposit)", async () => {
    await program.methods
      .stakeTokens(new BN(SECOND_DEPOSIT))
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

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
    expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT);
    console.log("Second deposit success. stakeInfo updated.");
  });

  it("Fails if trying to over-stake beyond staker's balance", async () => {
    let failed = false;
    try {
      await program.methods
        .stakeTokens(new BN(LARGE_STAKE_AMOUNT))
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
      console.log("Over-staking attempt failed as expected:", err.message);
      failed = true;
    }
    expect(failed).to.be.true;
  });

  // ----------------------------------------------------------------
  // 6) Initiate a 2-hour Cooldown
  // ----------------------------------------------------------------
  it("Initiates a 2-hour cooldown", async () => {
    await program.methods
      .initiateCooldown()
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
    console.log("Cooldown initiated. cooldown_ends_at=", stakeInfo.cooldownEndsAt.toNumber());
    expect(stakeInfo.cooldownEndsAt.toNumber()).to.be.greaterThan(
      Math.floor(Date.now() / 1000)
    );
  });

  // ----------------------------------------------------------------
  // 7) Partial Unstake
  // ----------------------------------------------------------------
  it("Partially unstakes some tokens", async () => {
    // Attempt partial unstake
    // NOTE: This may fail if the real-time hasn't passed 2 hours
    // For demonstration, we proceed. Adjust as needed for real time or test-time manipulation.
    let failed = false;
 
      await program.methods
        .unstakeTokens(new BN(PARTIAL_UNSTAKE))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          agentVault: agentVault,
          stakerDestination: stakerTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();



  });

  // ----------------------------------------------------------------
  // 8) Fully Unstake the Rest
  // ----------------------------------------------------------------
  it("Fully unstakes leftover", async () => {
    // Attempt to fully unstake leftover shares
    const stakeInfoBefore = await program.account.stakeInfo.fetch(stakeInfoPda);
    const leftoverShares = Number(stakeInfoBefore.shares);


      await program.methods
        .unstakeTokens(new BN(leftoverShares))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          agentVault: agentVault,
          stakerDestination: stakerTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

  });
});
