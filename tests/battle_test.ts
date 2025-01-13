// import * as anchor from "@project-serum/anchor";
// import { Program, AnchorProvider, BN } from "@project-serum/anchor";
// import { assert } from "chai";
// import { PublicKey, Keypair } from "@solana/web3.js";
// import fs from "fs";
// import path from "path";

// // -----------------------------
// // Numeric TerrainType enum for TS usage
// // -----------------------------
// enum TerrainType {
//   Plain = 0,     // 0 in Rust
//   Mountain = 1,  // 1 in Rust
//   River = 2,     // 2 in Rust
// }

// // -----------------------------
// // Load the IDL manually
// // -----------------------------
// const idlPath = path.resolve(__dirname, "../target/idl/middle_earth_ai_program.json");
// const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// // Replace with your actual program ID in base58 format.
// const programId = new PublicKey("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// // Create an Anchor provider.
// const provider = AnchorProvider.local();
// anchor.setProvider(provider);

// // Instantiate your program manually using the loaded IDL.
// const program = new anchor.Program(idl, programId, provider);

// describe("Movement and Battle Tests", () => {
//   let gameAccount: PublicKey;          // The Game account.
//   let winnerAgent: Keypair;            // Winner Agent.
//   let loserAgent: Keypair;             // Loser Agent.
//   let winnerPartnerAgent: Keypair;     // Winner’s alliance partner (for alliance tests).
//   let loserPartnerAgent: Keypair;      // Loser’s alliance partner (for alliance tests).
//   let gameAuthority: Keypair;          // The authority stored in the Game account.

//   before(async () => {
//     // Generate dummy keypairs for testing.
//     gameAuthority = provider.wallet.payer; 
//     winnerAgent = Keypair.generate();
//     loserAgent = Keypair.generate();
//     winnerPartnerAgent = Keypair.generate();
//     loserPartnerAgent = Keypair.generate();

//     // Pretend we have an on-chain Game account.
//     gameAccount = Keypair.generate().publicKey;

//     // In a real test, you'd create & init these accounts on-chain via instructions.
//   });

//   // ----------------------------------------------------------------------
//   // EXAMPLE: Testing move_agent Instruction with Terrain Code
//   // ----------------------------------------------------------------------
//   it("move_agent updates agent's position and cooldown based on terrain code", async () => {
//     // Suppose agent moves from (0,0) to (10,20) over Mountain terrain
//     const newX = 10;
//     const newY = 20;
//     const terrainCode = TerrainType.Mountain; // 1 in Rust logic

//     // Call the instruction (assuming your IDL has "moveAgent").
//     // We pass terrainCode as a number (u8).
//     const tx = await program.methods
//       .moveAgent(new BN(newX), new BN(newY), new BN(terrainCode))
//       .accounts({
//         agent: winnerAgent.publicKey,   // The agent we move
//         game: gameAccount,
//         authority: gameAuthority.publicKey,
//       })
//       .signers([gameAuthority])
//       .rpc();
//     console.log("move_agent tx:", tx);

//     // If your Rust code sets "agent.x", "agent.y", and next_move_time internally,
//     // fetch the updated agent to confirm.
//     const agentData = await program.account.agent.fetch(winnerAgent.publicKey);
//     console.log("Agent X:", agentData.x.toNumber());
//     console.log("Agent Y:", agentData.y.toNumber());
//     console.log("Agent next_move_time:", agentData.nextMoveTime.toNumber());

//     assert.equal(agentData.x.toNumber(), 10, "X updated to 10");
//     assert.equal(agentData.y.toNumber(), 20, "Y updated to 20");
//     assert.isAbove(agentData.nextMoveTime.toNumber(), 0, "Cooldown updated");
//   });

//   // ----------------------------------------------------------------------
//   // The "No Transfer Battle" tests you already have
//   // ----------------------------------------------------------------------
//   it("resolve_battle_simple_no_transfer updates cooldown for winner and loser", async () => {
//     const transferAmount = new BN(100);
//     const tx = await program.methods
//       .resolveBattleSimpleNoTransfer(transferAmount)
//       .accounts({
//         winner: winnerAgent.publicKey,
//         loser: loserAgent.publicKey,
//         game: gameAccount,
//         authority: gameAuthority.publicKey,
//       })
//       .signers([gameAuthority])
//       .rpc();
//     console.log("Simple battle tx:", tx);

//     const winnerData = await program.account.agent.fetch(winnerAgent.publicKey);
//     const loserData = await program.account.agent.fetch(loserAgent.publicKey);

//     assert.isAbove(winnerData.lastAttack.toNumber(), 0, "Winner cooldown updated");
//     assert.isAbove(loserData.lastAttack.toNumber(), 0, "Loser cooldown updated");
//   });

//   it("resolve_battle updates cooldown for allied agents", async () => {
//     const transferAmount = new BN(50);
//     const tx = await program.methods
//       .resolveBattle(transferAmount)
//       .accounts({
//         winner: winnerAgent.publicKey,
//         winner_partner: winnerPartnerAgent.publicKey,
//         loser: loserAgent.publicKey,
//         loser_partner: loserPartnerAgent.publicKey,
//         game: gameAccount,
//         authority: gameAuthority.publicKey,
//       })
//       .signers([gameAuthority])
//       .rpc();
//     console.log("Alliance battle tx:", tx);

//     const winnerData = await program.account.agent.fetch(winnerAgent.publicKey);
//     const winnerPartnerData = await program.account.agent.fetch(winnerPartnerAgent.publicKey);
//     const loserData = await program.account.agent.fetch(loserAgent.publicKey);
//     const loserPartnerData = await program.account.agent.fetch(loserPartnerAgent.publicKey);

//     assert.isAbove(winnerData.lastAttack.toNumber(), 0, "Winner cooldown updated");
//     assert.isAbove(winnerPartnerData.lastAttack.toNumber(), 0, "Winner partner cooldown updated");
//     assert.isAbove(loserData.lastAttack.toNumber(), 0, "Loser cooldown updated");
//     assert.isAbove(loserPartnerData.lastAttack.toNumber(), 0, "Loser partner cooldown updated");
//   });

//   it("should fail if caller is not the game authority", async () => {
//     const transferAmount = new BN(50);
//     const fakeAuthority = Keypair.generate();
//     // Airdrop SOL so it can pay fees.
//     const airdropSignature = await provider.connection.requestAirdrop(
//       fakeAuthority.publicKey,
//       2 * anchor.web3.LAMPORTS_PER_SOL
//     );
//     await provider.connection.confirmTransaction(airdropSignature, "confirmed");

//     try {
//       await program.methods
//         .resolveBattleSimpleNoTransfer(transferAmount)
//         .accounts({
//           winner: winnerAgent.publicKey,
//           loser: loserAgent.publicKey,
//           game: gameAccount,
//           authority: fakeAuthority.publicKey,
//         })
//         .signers([fakeAuthority])
//         .rpc();
//       assert.fail("Unauthorized call should have failed");
//     } catch (err) {
//       console.log("Unauthorized error caught:", err.toString());
//       assert.include(err.toString(), "Unauthorized", "Error should indicate unauthorized access");
//     }
//   });
// });
