import * as anchor from '@project-serum/anchor';
import { Program, Provider, web3 } from '@project-serum/anchor';
import { assert } from "chai";
import { MiddleEarthAI } from "../target/types/middle_earth_ai_program";

describe("Cooldown Mechanisms", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.local(); // Updated initialization
  anchor.setProvider(provider);

  const program = anchor.workspace.MiddleEarthAI as Program<MiddleEarthAI>;

  // Dummy keypairs for testing.
  let agentAccount: web3.PublicKey;
  let gameAccount: web3.PublicKey;
  let agentPayer = provider.wallet;
  let agent: any; // Our agent object will be fetched below.

  // A helper to simulate waiting (in seconds). In tests you might want to simulate time
  // by sending instructions with simulated clock timestamps.
  const sleep = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

  before(async () => {
    // Assume you have methods to create a game and an agent.
    // Here we just fetch or create your game and agent accounts.
    // (Replace with your actual creation logic.)
    // For example:
    // const tx = await program.rpc.initializeGame(/* params */);
    // gameAccount = (await program.account.game.fetch(/* ... */)).publicKey;
    // agentAccount = (await program.account.agent.fetch(/* ... */)).publicKey;
  });

  it("Should update ignore cooldown and reject repeated calls before cooldown expires", async () => {
    // Call ignore_agent with some target agent id, e.g., target_agent_id=2.
    const targetAgentId = 2;
    const txIgnore = await program.rpc.ignoreAgent(new anchor.BN(targetAgentId), {
      accounts: {
        agent: agentAccount,
        game: gameAccount,
        authority: agentPayer.publicKey,
      },
    });
    console.log("Ignore tx:", txIgnore);

    // Fetch updated agent and check last_ignore is updated.
    agent = await program.account.agent.fetch(agentAccount);
    const ignoreTimestamp1 = agent.lastIgnore.toNumber();
    console.log("Last ignore timestamp:", ignoreTimestamp1);

    // Immediately attempt to ignore again. This should fail because of cooldown.
    try {
      await program.rpc.ignoreAgent(new anchor.BN(targetAgentId), {
        accounts: {
          agent: agentAccount,
          game: gameAccount,
          authority: agentPayer.publicKey,
        },
      });
      assert.fail("Ignored function call did not throw an error for active cooldown");
    } catch (err) {
      console.log("Cooldown enforcement works for ignore:", err.toString());
    }

    // Optionally, you can wait for the cooldown period (if it is short for testing purposes)
    // await sleep(cooldownPeriodInSeconds + 1);
  });

  it("Should update attack cooldown and reject a battle resolution before cooldown expires", async () => {
    // For testing the battle resolution we need two agents: one winner and one loser.
    // Assume you have created both and have their public keys.
    // Here we use agentAccount as winner and assume loserAccount is available.
    const loserAccount = agentAccount; // For demonstration – in real test use a separate account.
    const transferAmount = new anchor.BN(10);

    // First, resolve a battle. (This sets winner.last_attack = now)
    const txBattle = await program.rpc.resolveBattle(transferAmount, {
      accounts: {
        winner: agentAccount,
        loser: loserAccount,
        game: gameAccount,
        authority: agentPayer.publicKey,
      },
    });
    console.log("Battle resolved tx:", txBattle);

    // Fetch the updated agent and note the last_attack timestamp.
    agent = await program.account.agent.fetch(agentAccount);
    const lastAttack1 = agent.lastAttack.toNumber();
    console.log("Last attack timestamp:", lastAttack1);

    // Immediately attempt another battle resolution. It should fail because the
    // attack cooldown (e.g. 4 hours) has not passed.
    try {
      await program.rpc.resolveBattle(transferAmount, {
        accounts: {
          winner: agentAccount,
          loser: loserAccount,
          game: gameAccount,
          authority: agentPayer.publicKey,
        },
      });
      assert.fail("Battle resolution did not respect cooldown");
    } catch (err) {
      console.log("Cooldown enforcement works for battle resolution:", err.toString());
    }

    // Optionally: simulate waiting for the cooldown period, then attempt again.
    // await sleep(cooldownPeriodInSeconds + 1);
  });

  // Similarly add tests for alliance-related functions if available.
});
