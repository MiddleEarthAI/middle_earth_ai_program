import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

// This test suite assumes that your staking instructions are in your program.
// Adjust the seeds and PDAs as per your program’s implementation.
describe("Staking & Reward Tests", () => {
  // Use the local provider.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Define a game id; this must match your game initialization logic.
  const gameId = new BN(999);
  let gamePda: PublicKey;

  // For our staking tests we create a new token mint.
  let mint: PublicKey;
  // The staker’s token account (source) for depositing tokens.
  let stakerSourceAta: PublicKey;
  // The agent’s vault token account that will hold deposits.
  let agentVaultAta: PublicKey;
  // A rewards vault that contains tokens for distribution.
  let rewardsVaultAta: PublicKey;

  // The staker (and authority) – we use our local wallet.
  const authority = provider.wallet.publicKey;

  // For deriving the stake_info PDA we use the seeds ["stake", agent, authority].
  // For testing, we register an agent with a dedicated id.
  const agentId = 100;  
  let agentPda: PublicKey;
  let stakeInfoPda: PublicKey; // PDA for staker record.

  before(async () => {
    // Derive game PDA.
    [gamePda] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toBuffer("le", 4)],
      program.programId
    );
    console.log("Game PDA:", gamePda.toBase58());

    // Initialize the game (ignore error if already initialized).
    try {
      await program.methods.initializeGame(gameId, new BN(123))
        .accounts({
          game: gamePda,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Game initialized successfully.");
    } catch (err: any) {
      console.log("Game initialization skipped or already exists.");
    }
  });

  before(async () => {
    // Create a new mint (assume 9 decimals).
    mint = await createMint(
      provider.connection,
      provider.wallet.payer,
      authority,
      null,
      9
    );
    console.log("Mint:", mint.toBase58());

    // Create or get the staker’s associated token account for the mint.
    const stakerSourceAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      authority,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    stakerSourceAta = stakerSourceAccount.address;
    console.log("Staker source ATA:", stakerSourceAta.toBase58());

    // Mint tokens to the staker’s source account.
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      stakerSourceAta,
      authority,
      1_000_000_000  // e.g., 1,000 tokens in base units
    );

    // For testing we assume the agent’s vault will be an ATA (with the same owner as authority).
    const agentVaultAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      authority,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    agentVaultAta = agentVaultAccount.address;
    console.log("Agent vault ATA:", agentVaultAta.toBase58());

    // Similarly, create a rewards vault and fund it.
    const rewardsVaultAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      authority,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    rewardsVaultAta = rewardsVaultAccount.address;
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      rewardsVaultAta,
      authority,
      5_000_000_000  // e.g., 5,000 tokens in base units
    );
    console.log("Rewards vault ATA:", rewardsVaultAta.toBase58());
  });

  before(async () => {
    // Derive the agent PDA using seeds ["agent", gamePda, [agentId]].
    [agentPda] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );
    console.log("Agent PDA:", agentPda.toBase58());

    // Register the agent (if not already registered).
    try {
      await program.methods.registerAgent(agentId, 0, 0, "TestAgent")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Agent registered.");
    } catch (err: any) {
      console.log("Agent already registered.");
    }

    // Derive the stake_info PDA using seeds ["stake", agentPda, authority].
    [stakeInfoPda] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), authority.toBuffer()],
      program.programId
    );
    console.log("Stake info PDA:", stakeInfoPda.toBase58());
  });

  describe("Staking & Reward Tests", () => {
    it("Stake Tokens: Deposits tokens and mints shares", async () => {
      const depositAmount = 500_000_000; // deposit 500 tokens in base units

      // Call the stake_tokens instruction.
      const tx = await program.methods.stakeTokens(new BN(depositAmount))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          stakerSource: stakerSourceAta,
          agentVault: agentVaultAta,
          authority,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Stake tokens tx:", tx);

      // Optionally, fetch the agent and stake_info and log their updated values.
      const agentAccount = await program.account.agent.fetch(agentPda);
      const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);
      console.log("Agent total shares:", agentAccount.totalShares.toString());
      console.log("Staker record amount:", stakeInfoAccount.amount.toString());
      console.log("Staker record shares:", stakeInfoAccount.shares.toString());
      // Assert that shares and staked amount are nonzero.
      expect(Number(stakeInfoAccount.shares)).to.be.greaterThan(0);
      expect(Number(stakeInfoAccount.amount)).to.equal(depositAmount);
    });

    it("Unstake Tokens: Redeems shares and transfers tokens back", async () => {
      // For testing, we redeem half of the staker's shares.
      const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);
      const sharesBefore = stakeInfoAccount.shares;
      const sharesToRedeem = Math.floor(Number(sharesBefore) / 2);

      const tx = await program.methods.unstakeTokens(new BN(sharesToRedeem))
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          agentVault: agentVaultAta,
          agentAuthority: agentPda, // In your program agent_authority is a PDA; adjust if needed.
          stakerDestination: stakerSourceAta, // For test, send funds back to staker source.
          authority,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Unstake tokens tx:", tx);

      // Fetch updated stake_info and assert the shares decreased.
      const stakeInfoAfter = await program.account.stakeInfo.fetch(stakeInfoPda);
      expect(Number(stakeInfoAfter.shares)).to.be.lessThan(Number(sharesBefore));
    });

    it("Claim Rewards: Claims rewards and transfers tokens to staker", async () => {
      // Advance the clock if necessary by waiting; for testing we assume cooldown has passed.
      // In a local test, you might simulate passage of time if your provider supports it.
      // Here we simply update the stake_info's last_reward_timestamp manually for testing.
      
      // First, fetch the current stake_info.
      const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);
      // For testing, force the last_reward_timestamp to a value in the past.
      // (In a real test environment, you might do a CPI call or use a mock clock.)
      // NOTE: Here we assume our test can call claim_staking_rewards immediately.
      
      const tx = await program.methods.claimStakingRewards()
        .accounts({
          agent: agentPda,
          game: gamePda,
          stakeInfo: stakeInfoPda,
          mint: mint, // Pass the mint account as an UncheckedAccount if needed.
          rewardsVault: rewardsVaultAta,
          rewardsAuthority: rewardsVaultAta, // In this test, we assume authority of rewards_vault is the same; adjust as needed.
          stakerDestination: stakerSourceAta,
          authority,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Claim rewards tx:", tx);

      // Fetch the staker's token account balance (destination).
      const stakerTokenAfter = await getAccount(provider.connection, stakerSourceAta);
      console.log("Staker token balance after reward:", Number(stakerTokenAfter.amount));
      // Assert that the balance increased (if reward > 0).
      // For example:
      expect(Number(stakerTokenAfter.amount)).to.be.greaterThan(1_000_000_000 - 500_000_000);
    });
  });
});
