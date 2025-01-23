import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";
import { AccountLayout } from "@solana/spl-token";

import {
  TOKEN_PROGRAM_ID,
  createMint,
  createInitializeAccountInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("Multi-Staker & Partial Unstake Tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Global references from previous steps (game, agent, agentVault, tokenMint, etc.)
  let gamePda: PublicKey;
  const gameId = new BN(777);
  let agentPda: PublicKey;
  let tokenMint: PublicKey;
  let agentVault: PublicKey;

  // We'll create separate stake PDAs for each staker
  let stakeInfoPda1: PublicKey;
  let stakeInfoPda2: PublicKey;
  let stakeInfoPda3: PublicKey;

  // Each staker will have their own token account
  let staker1: Keypair;
  let staker2: Keypair;
  let staker3: Keypair;
  let stakerTokenAccount1: PublicKey;
  let stakerTokenAccount2: PublicKey;
  let stakerTokenAccount3: PublicKey;

  // Constants
  const INITIAL_MINT_AMOUNT = 1_000_000;
  const FIRST_DEPOSIT = 500;
  const SECOND_DEPOSIT = 300;
  const PARTIAL_UNSTAKE_AMOUNT = 200; // Example partial unstake
  const STAKEER2_DEPOSIT = 600;
  const STAKEER3_DEPOSIT = 400;

  async function getTokenBalance(pubkey: PublicKey): Promise<number> {
    const acct = await getAccount(provider.connection, pubkey);
    return Number(acct.amount);
  }

  before("Set up environment", async () => {
    // Reuse or adapt from your existing suite:
    // 1) Initialize the game PDA
    // 2) Register agent
    // 3) Create agent vault, token mint, etc.

    // For brevity, we assume you already have:
    //   gamePda, agentPda, agentVault, tokenMint
    //   from your existing setup. If not, replicate the logic from your original test.

    // We'll just do placeholders here. Adjust to your real code.
    gamePda = PublicKey.default;  // <--- Placeholder. Use real logic
    agentPda = PublicKey.default; // <--- Placeholder

    // Similarly, if you haven't minted or set up the agent vault, do so here

    // Create the test token mint for stakers if not done
    // tokenMint = ...
    // agentVault = ...
  });

  before("Create staker Keypairs & token accounts", async () => {
    // We'll create 3 stakers each with their own token account

    // 1) Create staker #1
    staker1 = Keypair.generate();
    stakerTokenAccount1 = await createTokenAccountForUser(staker1, tokenMint, provider);
  
    staker2 = Keypair.generate();
    stakerTokenAccount2 = await createTokenAccountForUser(staker2, tokenMint, provider);
  
    staker3 = Keypair.generate();
    stakerTokenAccount3 = await createTokenAccountForUser(staker3, tokenMint, provider);
  

    // Now let's mint some tokens to each staker
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount1,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount2,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      tokenMint,
      stakerTokenAccount3,
      provider.wallet.publicKey,
      INITIAL_MINT_AMOUNT
    );
    console.log("All stakers funded with initial tokens.");
  });

  before("Derive stake PDAs for each staker", async () => {
    // staker1
    [stakeInfoPda1] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker1.publicKey.toBuffer()],
      program.programId
    );
    // staker2
    [stakeInfoPda2] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker2.publicKey.toBuffer()],
      program.programId
    );
    // staker3
    [stakeInfoPda3] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), staker3.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Staker #1 Tests (Partial Unstake)", () => {
    it("Initialize stake for staker #1 (first deposit)", async () => {
      // e.g., initializeStake
      await program.methods
        .initializeStake(new BN(FIRST_DEPOSIT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda1,
          stakerSource: stakerTokenAccount1,
          agentVault: agentVault,
          authority: staker1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker1])
        .rpc();

      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda1);
      expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT);
      expect(stakeInfo.isInitialized).to.be.true;
      console.log("Staker #1 initial deposit done.");
    });

    it("Staker #1 does a second deposit (subsequent stake)", async () => {
      await program.methods
        .stakeTokens(new BN(SECOND_DEPOSIT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda1,
          stakerSource: stakerTokenAccount1,
          agentVault: agentVault,
          authority: staker1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker1])
        .rpc();

      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda1);
      expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT);
      console.log("Staker #1 second deposit done.");
    });

    it("Staker #1 partially unstakes", async () => {
      const partialUnstake = PARTIAL_UNSTAKE_AMOUNT;
      await program.methods
        .unstakeTokens(new BN(partialUnstake))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda1,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount1,
          authority: staker1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker1])
        .rpc();

      const stakeInfo = await program.account.stakeInfo.fetch(stakeInfoPda1);
      // stakeInfo.amount should be (FIRST_DEPOSIT + SECOND_DEPOSIT - partialUnstake)
      expect(Number(stakeInfo.amount)).to.equal(FIRST_DEPOSIT + SECOND_DEPOSIT - partialUnstake);
      console.log("Staker #1 partial unstake done:", partialUnstake);
    });
  });

  describe("Other Stakers Tests", () => {
    it("Staker #2 stakes for the first time", async () => {
      // We can do a direct initializeStake or stakeTokens if you prefer one instruction
      // For example, let's do initializeStake
      await program.methods
        .initializeStake(new BN(STAKEER2_DEPOSIT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda2,
          stakerSource: stakerTokenAccount2,
          agentVault: agentVault,
          authority: staker2.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2])
        .rpc();

      const stakeInfo2 = await program.account.stakeInfo.fetch(stakeInfoPda2);
      expect(Number(stakeInfo2.amount)).to.equal(STAKEER2_DEPOSIT);
      console.log("Staker #2 initial deposit done.");
    });

    it("Staker #3 stakes for the first time", async () => {
      await program.methods
        .initializeStake(new BN(STAKEER3_DEPOSIT))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda3,
          stakerSource: stakerTokenAccount3,
          agentVault: agentVault,
          authority: staker3.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker3])
        .rpc();

      const stakeInfo3 = await program.account.stakeInfo.fetch(stakeInfoPda3);
      expect(Number(stakeInfo3.amount)).to.equal(STAKEER3_DEPOSIT);
      console.log("Staker #3 initial deposit done.");
    });

    it("Staker #1 unstakes the remainder after staker #2 and #3 are already in", async () => {
      // We confirm that staker #1 can still withdraw even though staker #2 & #3 have staked
      // This tests concurrency logic with the same Agent.
      // We'll do a full withdrawal of staker1's leftover shares for demonstration
      const staker1Info = await program.account.stakeInfo.fetch(stakeInfoPda1);
      const leftoverShares = Number(staker1Info.shares); // all shares
      console.log("Staker #1 leftover shares:", leftoverShares);

      await program.methods
        .unstakeTokens(new BN(leftoverShares))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda1,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount1,
          authority: staker1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker1])
        .rpc();

      // Now staker1's stake_info should be zero
      const stakeInfo1After = await program.account.stakeInfo.fetch(stakeInfoPda1);
      expect(Number(stakeInfo1After.amount)).to.equal(0);
      expect(Number(stakeInfo1After.shares)).to.equal(0);
      console.log("Staker #1 fully unstaked. Staker #2 & #3 are still staked.");
    });

    it("Staker #2 partially unstakes while staker #3 remains fully staked", async () => {
      const partialUnstake2 = 200; // example partial
      await program.methods
        .unstakeTokens(new BN(partialUnstake2))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda2,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount2,
          authority: staker2.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2])
        .rpc();

      const stakeInfo2 = await program.account.stakeInfo.fetch(stakeInfoPda2);
      console.log("Staker #2 partial unstake done. Remaining stake:", Number(stakeInfo2.amount));
      expect(Number(stakeInfo2.amount)).to.equal(STAKEER2_DEPOSIT - partialUnstake2);
    });

    it("Staker #2 unstakes fully, staker #3 still staked", async () => {
      // Now let's fully unstake staker2
      const stakeInfo2Before = await program.account.stakeInfo.fetch(stakeInfoPda2);
      const leftoverShares2 = Number(stakeInfo2Before.shares);
      await program.methods
        .unstakeTokens(new BN(leftoverShares2))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda2,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount2,
          authority: staker2.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker2])
        .rpc();

      const stakeInfo2After = await program.account.stakeInfo.fetch(stakeInfoPda2);
      expect(Number(stakeInfo2After.amount)).to.equal(0);
      expect(Number(stakeInfo2After.shares)).to.equal(0);
      console.log("Staker #2 fully unstaked. Staker #3 remains staked.");
    });

    it("Finally, staker #3 unstakes everything", async () => {
      // staker3 still has their deposit
      const stakeInfo3Before = await program.account.stakeInfo.fetch(stakeInfoPda3);
      const leftoverShares3 = Number(stakeInfo3Before.shares);
      await program.methods
        .unstakeTokens(new BN(leftoverShares3))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda3,
          agentVault: agentVault,
          agentAuthority: agentPda,
          stakerDestination: stakerTokenAccount3,
          authority: staker3.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker3])
        .rpc();

      const stakeInfo3After = await program.account.stakeInfo.fetch(stakeInfoPda3);
      expect(Number(stakeInfo3After.amount)).to.equal(0);
      expect(Number(stakeInfo3After.shares)).to.equal(0);
      console.log("Staker #3 fully unstaked. All stakers done.");
    });
  });

// A helper to create a token account for a "user" keypair without airdropping
// A helper to create a token account for a "user" keypair
// The provider pays the account creation fees
async function createTokenAccountForUser(
  user: Keypair,
  mint: PublicKey,
  provider: anchor.AnchorProvider
): Promise<PublicKey> {
  const size = AccountLayout.span;
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(size);

  const createIx = SystemProgram.createAccount({
    fromPubkey: provider.wallet.publicKey,  // Payer is the provider
    newAccountPubkey: user.publicKey,       // The new account
    space: size,
    lamports,
    programId: TOKEN_PROGRAM_ID,
  });
  const initIx = createInitializeAccountInstruction(
    user.publicKey,  // newly created token account
    mint,
    user.publicKey,  // user is the owner
    TOKEN_PROGRAM_ID
  );

  const tx = new web3.Transaction().add(createIx, initIx);

  // Sign with both provider's payer (the actual payer) AND user
  // so the user is the `newAccountPubkey` and the provider is the funder.
  await provider.sendAndConfirm(tx, [provider.wallet.payer, user]);

  return user.publicKey;
}



});
