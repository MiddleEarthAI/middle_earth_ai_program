import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// Replace this import with your generated IDL name/path
import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

// Load the IDL manually.
const idlPath = path.resolve(__dirname, "../target/idl/middle_earth_ai_program.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Replace with your actual program ID.
const programId = new PublicKey("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// Create an Anchor provider.
const provider = AnchorProvider.local();
anchor.setProvider(provider);

// Instantiate the program manually.
const program = new anchor.Program(idl, programId, provider);

describe("Game & Agent On-Chain Tests", () => {
  // Global variables that persist across tests.
  let gamePda: PublicKey;
  let gameBump: number;
  let agentPda: PublicKey;
  let agentBump: number;

  const gameId = new BN(1);       // A numeric ID for the game
  const agentId = 1;              // Single-byte ID for the agent
  const agentX = 10;
  const agentY = 20;
  const agentName = "TestAgent";

  // In this test, we initialize the game in a before hook so it's only done once.
  before(async () => {
    // Derive Game PDA using seeds [ "game", game_id (as le bytes) ]
    [gamePda, gameBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from("game"),
        gameId.toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );
    console.log("Derived Game PDA:", gamePda.toBase58());

    // Call initializeGame to create the game account.
    await program.methods
      .initializeGame(gameId, gameBump)
      .accounts({
        game: gamePda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify that the Game account is initialized.
    const gameAccount = await program.account.game.fetch(gamePda);
    console.log("Game Account:", gameAccount);
    assert.equal(gameAccount.gameId.toNumber(), 1, "Game ID should be 1");
    assert.isTrue(gameAccount.isActive, "Game should be active");
    assert.deepEqual(gameAccount.agents, [], "No agents should be registered yet");
  });

  it("Registers (initializes) an agent on-chain", async () => {
    // Derive Agent PDA using seeds: [ "agent", gamePda, [agentId] ]
    [agentPda, agentBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from("agent"),
        gamePda.toBuffer(),
        Uint8Array.of(agentId),
      ],
      program.programId
    );
    console.log("Derived Agent PDA:", agentPda.toBase58());

    // Call registerAgent (combined initialize_agent and add_agent).
    await program.methods
      .registerAgent(agentId, agentX, agentY, agentName)
      .accounts({
        game: gamePda,
        agent: agentPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch the Agent account to verify on-chain data.
    const agentAccount = await program.account.agent.fetch(agentPda);
    console.log("Fetched Agent Account:", agentAccount);
    assert.equal(agentAccount.id, agentId, "Agent ID should match");
    assert.equal(agentAccount.x.toNumber(), agentX, "Agent X should match");
    assert.equal(agentAccount.y.toNumber(), agentY, "Agent Y should match");
    assert.ok(agentAccount.isAlive, "Agent should be alive");

    // Fetch updated Game account to verify that the agent metadata was added.
    const updatedGameAccount = await program.account.game.fetch(gamePda);
    console.log("Updated Game Account:", updatedGameAccount);

    // Check that the agent appears in the global agent list.
    const found = updatedGameAccount.agents.some((agentInfo: any) => {
      return (
        agentInfo.key.toString() === agentPda.toString() &&
        agentInfo.name === agentName
      );
    });
    assert.ok(found, "The agent metadata was not found in the game's agent list");
  });

  it("Should fail when trying to register a duplicate agent ID", async () => {
    try {
      // Attempt to register the same agent a second time.
      await program.methods
        .registerAgent(agentId, 50, 50, "AnotherAgentName")
        .accounts({
          game: gamePda,
          agent: agentPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Expected an error when registering a duplicate agent");
    } catch (err: any) {
      console.log("Caught expected error:", err.toString());
      // The error should indicate that the account is already initialized (e.g. "already in use")
      assert.match(
        err.toString(),
        /already in use/,
        "Duplicate registration should fail with an 'already in use' error"
      );
    }
  });
});
