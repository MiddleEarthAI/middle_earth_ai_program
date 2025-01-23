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
  let agentVault: PublicKey; // Agent vault token account
  let stakeInfoPda: PublicKey;

  // Constants
  const INITIAL_MINT_AMOUNT = 1_000_000;   
  const FIRST_DEPOSIT = 500;    
  const SECOND_DEPOSIT = 300;   
  const LARGE_STAKE_AMOUNT = 2_000_000;    

  async function getTokenBalance(pubkey: PublicKey): Promise<number> {
    const acct = await getAccount(provider.connection, pubkey);
    return Number(acct.amount);
  }

  before(async () => {
    // 1) Derive the Game PDA and initialize
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

    // 2) Create a token mint
    tokenMint = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );
    console.log("Token mint created:", tokenMint.toBase58());

    // 3) Create the staker's token account
    const stakerAcctKeypair = Keypair.generate();
    {
      const size = AccountLayout.span;
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
        provider.wallet.publicKey,
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [stakerAcctKeypair]);
      stakerTokenAccount = stakerAcctKeypair.publicKey;
      console.log("Staker token account created:", stakerTokenAccount.toBase58());
    }

    // 4) Mint tokens to staker's account
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    console.log(`Staker token account funded with ${INITIAL_MINT_AMOUNT} tokens.`);

    // 5) Create a rewards vault
    const vaultKeypair = Keypair.generate();
    {
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
        provider.wallet.publicKey,
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createIx, initIx);
      await provider.sendAndConfirm(tx, [vaultKeypair]);
      rewardsVault = vaultKeypair.publicKey;
      console.log("Rewards vault created:", rewardsVault.toBase58());
    }
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      rewardsVault,
      provider.wallet.publicKey,
      500_000_000
    );
    console.log("Rewards vault funded.");

    // Register agent
    [agentPda, agentBump] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
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

    // Create the agent's vault
    const agentVaultKeypair = Keypair.generate();
    {
      const size = AccountLayout.span;
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);
      const createVaultIx = SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: agentVaultKeypair.publicKey,
        space: size,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      });
      const initVaultIx = createInitializeAccountInstruction(
        agentVaultKeypair.publicKey,
        tokenMint,
        agentPda,
        TOKEN_PROGRAM_ID
      );
      const tx = new web3.Transaction().add(createVaultIx, initVaultIx);
      await provider.sendAndConfirm(tx, [agentVaultKeypair]);
      agentVault = agentVaultKeypair.publicKey;
      console.log("Agent vault created with PDA owner:", agentVault.toBase58());
    }
  });

  before("Derive stake_info PDA", async () => {
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    stakeInfoPda = pda;
    console.log("Derived stakeInfo PDA:", stakeInfoPda.toBase58());
  });

  describe("Staking Tests", () => {
    it("Initial deposit using initializeStake()", async () => {
      // Balances before
      const stakerBefore = await getTokenBalance(stakerTokenAccount);
      const vaultBefore = await getTokenBalance(agentVault);
      console.log("Before initStake: staker=", stakerBefore, " vault=", vaultBefore);

      // Initialize stake (first deposit)
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

      const stakerAfter = await getTokenBalance(stakerTokenAccount);
      const vaultAfter = await getTokenBalance(agentVault);
      console.log("After initStake: staker=", stakerAfter, " vault=", vaultAfter);
      expect(stakerAfter).to.equal(stakerBefore - FIRST_DEPOSIT);
      expect(vaultAfter).to.equal(vaultBefore + FIRST_DEPOSIT);

      // Check stake_info
      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
      expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
      expect(Number(stakeInfo.shares)).to.equal(FIRST_DEPOSIT);
      console.log("initializeStake success. stake_info validated.");
    });

    it("Subsequent deposit using stake_tokens()", async () => {
      // Balances before
      const stakerBefore = await getTokenBalance(stakerTokenAccount);
      const vaultBefore = await getTokenBalance(agentVault);
      console.log("Before stakeTokens: staker=", stakerBefore, " vault=", vaultBefore);

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

      const stakerAfter = await getTokenBalance(stakerTokenAccount);
      const vaultAfter = await getTokenBalance(agentVault);
      console.log("After stakeTokens: staker=", stakerAfter, " vault=", vaultAfter);
      expect(stakerAfter).to.equal(stakerBefore - SECOND_DEPOSIT);
      expect(vaultAfter).to.equal(vaultBefore + SECOND_DEPOSIT);

      // Check stakeInfo
      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda);
      console.log("stakeInfo after second deposit:", stakeInfo);
      expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT);
      // The minted shares depends on your share logic. Typically it’d be proportionally minted.
    });

    it("Fails if trying to stake more tokens than staker has", async () => {
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
  });

  // Additional tests for unstake_tokens and claim_staking_rewards can follow similarly.
  // e.g.:
  // describe("Unstake Tests", () => {...});
  // describe("Claim Rewards Tests", () => {...});
});
