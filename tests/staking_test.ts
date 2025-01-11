import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

describe("Staking tests", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  let gamePda: PublicKey;
  let gameBump: number;
  let agentPda: PublicKey;
  let agentBump: number;
  let stakeInfoPda: PublicKey;
  let stakeInfoBump: number;

  const gameId = new anchor.BN(123); 
  const agentId = 1; 
  const initialDeposit = 1_000_000; 

  const authority = provider.wallet.publicKey;

  it("Initialize Game", async () => {
    [gamePda, gameBump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), gameId.toArray("le", 4)],
      program.programId
    );

    await program.methods
      .initializeGame(gameId.toNumber(), gameBump)
      .accounts({
        game: gamePda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const gameAccount = await program.account.game.fetch(gamePda);
    assert.ok(gameAccount.isActive);
  });

  it("Initialize Agent", async () => {
    [agentPda, agentBump] = await PublicKey.findProgramAddress(
      [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([agentId])],
      program.programId
    );

    await program.methods
      .initializeAgent(agentId, 0, 0)
      .accounts({
        game: gamePda,
        agent: agentPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agentAccount = await program.account.agent.fetch(agentPda);
    assert.ok(agentAccount.isAlive);
  });

  it("Stake Tokens", async () => {
    [stakeInfoPda, stakeInfoBump] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), agentPda.toBuffer(), authority.toBuffer()],
      program.programId
    );

    await program.methods
      .stakeTokens(new anchor.BN(initialDeposit))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agentAccount = await program.account.agent.fetch(agentPda);
    const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);

    assert.equal(agentAccount.tokenBalance.toNumber(), initialDeposit);
    assert.equal(stakeInfoAccount.amount.toNumber(), initialDeposit);
  });

  it("Unstake Tokens", async () => {
    const sharesToUnstake = initialDeposit / 2; // Unstake half

    await program.methods
      .unstakeTokens(new anchor.BN(sharesToUnstake))
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const agentAccount = await program.account.agent.fetch(agentPda);
    const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);

    assert.equal(agentAccount.tokenBalance.toNumber(), initialDeposit / 2);
    assert.equal(stakeInfoAccount.amount.toNumber(), initialDeposit / 2);
  });

  it("Claim Rewards", async () => {
    // Simulate time passage for reward calculation
    const CLOCK_START = await provider.connection.getSlot();

    await program.methods
      .claimStakingRewards()
      .accounts({
        agent: agentPda,
        game: gamePda,
        stakeInfo: stakeInfoPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stakeInfoAccount = await program.account.stakeInfo.fetch(stakeInfoPda);

    assert.ok(stakeInfoAccount.lastRewardTimestamp > CLOCK_START);
    assert.ok(stakeInfoAccount.amount.toNumber() > initialDeposit / 2);
  });
});
