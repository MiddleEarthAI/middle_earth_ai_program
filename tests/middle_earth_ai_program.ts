// import * as anchor from "@coral-xyz/anchor";
// import { Program } from "@coral-xyz/anchor";
// import { PublicKey, SystemProgram } from "@solana/web3.js";
// import { expect } from "chai";
// import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

// describe("middle_earth_ai_program tests", () => {
//   // Configure the client to use the local cluster.
//   const provider = anchor.AnchorProvider.local();
//   anchor.setProvider(provider);

//   // Get the program.
//   const program = anchor.workspace
//     .MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;

//   let gamePda: PublicKey;
//   let gameBump: number;

//   // 1) Test for initialize_game
//   it("Initialize game", async () => {
//     // Choose a random game_id – using a u32 (4 bytes).
//     const gameId = new anchor.BN(123); // u32 value
//     // Derive the PDA using seeds [ "game", gameId.toArray("le", 4) ]
//     const seedBytes = gameId.toArray("le", 4); // 4 bytes
//     // Note: adjust this if your seed uses a different length.
//     const [pda, bump] = await PublicKey.findProgramAddress(
//       [Buffer.from("game"), Buffer.from(seedBytes)],
//       program.programId
//     );
//     gamePda = pda;
//     gameBump = bump;
    
//     console.log("Game PDA:", gamePda.toBase58(), "Bump:", bump);

//     // Call initialize_game with both parameters.
//     await program.methods
//       .initializeGame(gameId, bump)
//       .accounts({
//         game: gamePda,
//         authority: provider.wallet.publicKey,
//         systemProgram: SystemProgram.programId,
//       })
//       .rpc();

//     // Fetch and validate the Game account
//     const gameAccount = await program.account.game.fetch(gamePda);
//     expect(gameAccount).to.not.be.null;
//     // Assuming the field names in your account are camelCased in the IDL:
//     expect(gameAccount.gameId.toNumber()).to.equal(123);
//     expect(gameAccount.isActive).to.be.true;
//     console.log("Game account initialized at:", gamePda.toBase58());
//   });

//   // 2) Test for initialize_agent
//   it("Initialize agent", async () => {
//     const agentId = 7; // example value for a u8 agent id

//     // Derive the PDA for the agent
//     // Seeds for agent: [ "agent", game.key (32 bytes), [agentId] (1 byte) ]
//     const [agentPda] = await PublicKey.findProgramAddress(
//       [
//         Buffer.from("agent"),
//         gamePda.toBuffer(),
//         Buffer.from([agentId]),
//       ],
//       program.programId
//     );

//     console.log("Agent PDA:", agentPda.toBase58());

//     // Call initialize_agent.
//     await program.methods
//       .initializeAgent(agentId, 10, 20) // parameters: agent_id, x, y
//       .accounts({
//         game: gamePda,
//         agent: agentPda,
//         authority: provider.wallet.publicKey,
//         systemProgram: SystemProgram.programId,
//       })
//       .rpc();

//     // Fetch and validate the Agent account
//     const agentAccount = await program.account.agent.fetch(agentPda);
//     expect(agentAccount).to.not.be.null;
//     expect(agentAccount.id).to.equal(agentId);
//     expect(agentAccount.x).to.equal(10);
//     expect(agentAccount.y).to.equal(20);
//     expect(agentAccount.isAlive).to.be.true;
//     console.log("Agent account initialized at:", agentPda.toBase58());
//   });
// });
