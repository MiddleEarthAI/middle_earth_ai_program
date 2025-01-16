// import * as anchor from "@project-serum/anchor";
// import { Program } from "@project-serum/anchor";
// import { Keypair, PublicKey } from "@solana/web3.js";
// import { assert } from "chai";

// // Import your IDL
// import { MiddleEarthAiProgram } from "../target/types/middle_earth_ai_program";

// describe("resolve_battle_simple", () => {
//   // Configure the client to use the local cluster.
//   anchor.setProvider(anchor.AnchorProvider.env());

//   const program = anchor.workspace.MiddleEarthAiProgram as Program<MiddleEarthAiProgram>;
//   const provider = anchor.getProvider();
//   const wallet = provider.wallet as anchor.Wallet;

//   // Declare PDAs and constants
//   const TEST_GAME_ID = 8888;
//   const AGENT_ID_WINNER = 1;
//   const AGENT_ID_LOSER = 2;
//   let gamePda: PublicKey;
//   let winnerPda: PublicKey;
//   let loserPda: PublicKey;

//   before(async () => {
//     // Derive the PDAs
//     [gamePda] = await PublicKey.findProgramAddress(
//       [Buffer.from("game"), Buffer.from(TEST_GAME_ID.toString())],
//       program.programId
//     );

//     [winnerPda] = await PublicKey.findProgramAddress(
//       [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([AGENT_ID_WINNER])],
//       program.programId
//     );

//     [loserPda] = await PublicKey.findProgramAddress(
//       [Buffer.from("agent"), gamePda.toBuffer(), Buffer.from([AGENT_ID_LOSER])],
//       program.programId
//     );

//     // Initialize the game
//     await program.methods
//       .initializeGame(TEST_GAME_ID)
//       .accounts({
//         game: gamePda,
//         authority: wallet.publicKey,
//         systemProgram: anchor.web3.SystemProgram.programId,
//       })
//       .rpc();

//     // Register winner agent
//     await program.methods
//       .registerAgent(AGENT_ID_WINNER, 0, 0, "Winner")
//       .accounts({
//         game: gamePda,
//         agent: winnerPda,
//         authority: wallet.publicKey,
//         systemProgram: anchor.web3.SystemProgram.programId,
//       })
//       .rpc();

//     // Register loser agent
//     await program.methods
//       .registerAgent(AGENT_ID_LOSER, 1, 1, "Loser")
//       .accounts({
//         game: gamePda,
//         agent: loserPda,
//         authority: wallet.publicKey,
//         systemProgram: anchor.web3.SystemProgram.programId,
//       })
//       .rpc();
//   });

//   it("should resolve a battle between two agents", async () => {
//     // Call the resolve_battle_simple instruction
//     const transferAmount = new anchor.BN(50000);
//     await program.methods
//       .resolveBattleSimple(transferAmount)
//       .accounts({
//         winner: winnerPda,
//         loser: loserPda,
//         game: gamePda,
//         authority: wallet.publicKey,
//       })
//       .rpc();

//     // Fetch the updated accounts to verify changes
//     const winnerAccount = await program.account.agent.fetch(winnerPda);
//     const loserAccount = await program.account.agent.fetch(loserPda);

//     // Verify that the `lastAttack` field was updated
//     assert.ok(winnerAccount.lastAttack.toNumber() > 0, "Winner lastAttack not updated");
//     assert.ok(loserAccount.lastAttack.toNumber() > 0, "Loser lastAttack not updated");
//   });
// });
