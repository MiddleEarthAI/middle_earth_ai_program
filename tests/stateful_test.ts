import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

describe("Comprehensive Middle Earth AI Tests", () => {
  // Configure the local provider and set it globally.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  // Get the program from the workspace.
  const program = anchor.workspace
    .MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

  // Global variables to store PDAs and other data.
  let gamePda: PublicKey;
  let gameBump: number;
  let agentPda: PublicKey; // primary agent PDA
  const gameId = new anchor.BN(123); // u32 value (4 bytes)
  const agentId = 7; // a sample agent ID

  // Before all tests, initialize a Game account (if it doesn't already exist)
  before(async () => {
    // Derive the Game PDA using seeds [ "game", gameId.toArray("le", 4) ]
    const seedBytes = gameId.toArray("le", 4); // 4 bytes for a u32
    const [pda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), Buffer.from(seedBytes)],
      program.programId
    );
    gamePda = pda;
    gameBump = bump;
    console.log("Game PDA:", gamePda.toBase58(), "Bump:", bump);

    // Try to fetch the game account—if it exists, skip initialization.
    let gameAccount;
    try {
      gameAccount = await program.account.game.fetch(gamePda);
      console.log("Game account already exists");
    } catch (e) {
      // Account does not exist; we can initialize it.
      console.log("Game account not found. Initializing...");
    }

    if (!gameAccount) {
      // Call initializeGame with both parameters.
      await program.methods
        .initializeGame(gameId, bump)
        .accounts({
          game: gamePda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      gameAccount = await program.account.game.fetch(gamePda);
      expect(gameAccount).to.not.be.null;
      expect(gameAccount.gameId.toNumber()).to.equal(123);
      expect(gameAccount.isActive).to.be.true;
      console.log("Game account initialized at:", gamePda.toBase58());
    }

    // Derive the primary Agent PDA using seeds: ["agent", gamePda, [agentId]]
    const [agentAddress] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(),
        Buffer.from([agentId]),
      ],
      program.programId
    );
    agentPda = agentAddress;
    console.log("Primary Agent PDA:", agentPda.toBase58());

    // Try to fetch the agent account—if it exists, skip initialization.
    let agentAccount;
    try {
      agentAccount = await program.account.agent.fetch(agentPda);
      console.log("Primary Agent already exists");
    } catch (e) {
      console.log("Primary Agent not found. Initializing...");
    }

    if (!agentAccount) {
      await program.methods
        .initializeAgent(agentId, 10, 20)
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      agentAccount = await program.account.agent.fetch(agentPda);
      expect(agentAccount).to.not.be.null;
      expect(agentAccount.id).to.equal(agentId);
      expect(agentAccount.x).to.equal(10);
      expect(agentAccount.y).to.equal(20);
      expect(agentAccount.isAlive).to.be.true;
      console.log("Primary Agent initialized at:", agentPda.toBase58());
    }
  });

  // Test: Move Agent
  it("Moves the Agent", async () => {
    // Move the agent to coordinates (30, 40)
    await program.methods
      .moveAgent(30, 40)
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const agentAccount = await program.account.agent.fetch(agentPda);
    expect(agentAccount.x).to.equal(30);
    expect(agentAccount.y).to.equal(40);
    console.log("Agent moved to (30, 40)");
  });

  // Test: Initiate Battle between two agents
  it("Initiates a battle between two agents", async () => {
    // For battle testing, initialize a defender agent with a unique ID (e.g., 8)
    const defenderId = 8;
    const [defenderPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(),
        Buffer.from([defenderId]),
      ],
      program.programId
    );

    // Initialize the defender agent at position (50, 60)
    try {
      await program.methods
        .initializeAgent(defenderId, 50, 60)
        .accounts({
          game: gamePda,
          agent: defenderPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      console.log("Defender agent may already be initialized:", e);
    }

    // Initiate battle between the primary agent and the defender.
    await program.methods
      .initiateBattle()
      .accounts({
        attacker: agentPda,
        defender: defenderPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const attackerAccount = await program.account.agent.fetch(agentPda);
    const defenderAccount = await program.account.agent.fetch(defenderPda);
    expect(attackerAccount.currentBattleStart).to.not.be.null;
    expect(defenderAccount.currentBattleStart).to.not.be.null;
    console.log("Battle initiated between agents", agentPda.toBase58(), "and", defenderPda.toBase58());
  });

  // Test: Form and then break an alliance
  it("Forms and then breaks an alliance", async () => {
    // For alliance tests, use a fresh agent with a unique ID (e.g., 9)
    const allianceAgentId = 9;
    const [allianceAgentPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(),
        Buffer.from([allianceAgentId]),
      ],
      program.programId
    );

    // Initialize the alliance agent (if not already initialized)
    try {
      await program.methods
        .initializeAgent(allianceAgentId, 15, 25)
        .accounts({
          game: gamePda,
          agent: allianceAgentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      console.log("Alliance agent may already be initialized:", e);
    }

    // Form an alliance with target id 8.
    await program.methods
      .formAlliance(8)
      .accounts({
        agent: allianceAgentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    let allianceAgentAccount = await program.account.agent.fetch(allianceAgentPda);
    expect(allianceAgentAccount.allianceWith).to.equal(8);
    console.log("Alliance formed for agent", allianceAgentPda.toBase58(), "with agent 8");

    // Break the alliance.
    await program.methods
      .breakAlliance()
      .accounts({
        agent: allianceAgentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    allianceAgentAccount = await program.account.agent.fetch(allianceAgentPda);
    expect(allianceAgentAccount.allianceWith).to.be.null;
    console.log("Alliance broken for agent", allianceAgentPda.toBase58());
  });

  // Test: Ignore an Agent
  it("Sets an ignore cooldown for an agent", async () => {
    // Primary agent ignores agent 10.
    await program.methods
      .ignoreAgent(10)
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    const agentAccount = await program.account.agent.fetch(agentPda);
    const found = (agentAccount.ignoreCooldowns as any[]).some(
      (entry) => entry.agentId === 10
    );
    expect(found).to.be.true;
    console.log("Agent", agentPda.toBase58(), "is now ignoring agent 10");
  });

  // Test: Token staking functions (staking, unstaking, reward claim)
  it("Performs staking, unstaking, and reward claim", async () => {
    // Stake tokens (using BN for stake amount)
    const stakeAmount = new anchor.BN(1000);
    await program.methods
      .stakeTokens(stakeAmount)
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    let agentAccount = await program.account.agent.fetch(agentPda);
    expect(agentAccount.stakedBalance.toNumber()).to.equal(1000);
    console.log("Staked tokens for agent", agentPda.toBase58());

    // Unstake tokens.
    const unstakeAmount = new anchor.BN(500);
    await program.methods
      .unstakeTokens(unstakeAmount)
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    agentAccount = await program.account.agent.fetch(agentPda);
    expect(agentAccount.stakedBalance.toNumber()).to.equal(500);
    console.log("Unstaked tokens for agent", agentPda.toBase58());

    // Claim rewards.
    await program.methods
      .claimStakingRewards()
      .accounts({
        agent: agentPda,
        game: gamePda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    agentAccount = await program.account.agent.fetch(agentPda);
    expect(agentAccount.lastRewardClaim.toNumber()).to.be.gt(0);
    console.log("Rewards claimed for agent", agentPda.toBase58());
  });
});
