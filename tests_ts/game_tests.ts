// import * as anchor from "@project-serum/anchor";
// import { Program } from "@project-serum/anchor";
// import { PublicKey, SystemProgram } from "@solana/web3.js";
// import { assert } from "chai";

// // Load the generated IDL
// const idl = require("../target/idl/middle_earth_ai_program.json");

// // Optional: Remove "TerrainType" from the IDL types if it exists.
// if (idl.types) {
//   idl.types = idl.types.filter((t: any) => t.name !== "TerrainType");
// }

// // Create a Program instance manually using the patched IDL.
// anchor.setProvider(anchor.AnchorProvider.env());
// const provider = anchor.getProvider();
// const wallet = provider.wallet as anchor.Wallet;
// const program = new Program(idl as anchor.Idl, new PublicKey(idl.address), provider);

// describe("Game Contract Tests", () => {
//   const TEST_GAME_ID = 1234;
//   let gamePda: PublicKey;

//   it("should initialize the game", async () => {
//     // Derive the Game PDA using seeds "game" and TEST_GAME_ID (as string).
//     [gamePda] = await PublicKey.findProgramAddress(
//       [Buffer.from("game"), Buffer.from(TEST_GAME_ID.toString())],
//       program.programId
//     );

//     // Call initializeGame instruction.
//     const bump = 0; // Dummy bump for testing; adjust if needed.
//     await program.methods
//       .initializeGame(new anchor.BN(TEST_GAME_ID), bump)
//       .accounts({
//         game: gamePda,
//         authority: wallet.publicKey,
//         systemProgram: SystemProgram.programId,
//       })
//       .rpc();

//     // Fetch the game account state.
//     const gameAccount = await program.account.game.fetch(gamePda);
//     assert.equal(
//       gameAccount.gameId.toNumber(),
//       TEST_GAME_ID,
//       "Game ID not initialized correctly"
//     );
//   });

//   it("should move the agent", async () => {
//     const AGENT_ID = 1;
//     let agentPda: PublicKey;
//     [agentPda] = await PublicKey.findProgramAddress(
//       [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([AGENT_ID])],
//       program.programId
//     );

//     // For moveAgent, pass new coordinates and a raw u8 for terrain.
//     const newX = 50;
//     const newY = 100;
//     // 0 = Plain, 1 = River, 2 = Mountain.
//     const terrain: number = 0; // using Plain as example.

//     await program.methods
//       .moveAgent(new anchor.BN(newX), new anchor.BN(newY), terrain)
//       .accounts({
//         agent: agentPda,
//         game: gamePda,
//         authority: wallet.publicKey,
//       })
//       .rpc();

//     // Fetch the agent account state.
//     const agentAccount = await program.account.agent.fetch(agentPda);
//     assert.equal(agentAccount.x, newX, "Agent X coordinate not updated correctly");
//     assert.equal(agentAccount.y, newY, "Agent Y coordinate not updated correctly");
//   });
// });
