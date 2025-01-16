import * as anchor from "@project-serum/anchor";
import { Program, AnchorProvider } from "@project-serum/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import fs from "fs";
import path from "path";

describe("Basic Connection Test (with IDL patch)", () => {
  // 1. Load the provider.
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  // 2. Load your IDL JSON.
  //    Make sure this path is correct for your local file structure.
  const idlPath = path.join(__dirname, "..", "target", "idl", "middle_earth_ai_program.json");
  const rawIdl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  // 3. Patch the IDL to remove/fix any malformed types.
  if (rawIdl.types && Array.isArray(rawIdl.types)) {
    const originalCount = rawIdl.types.length;
    // Filter out any invalid type definitions.
    rawIdl.types = rawIdl.types.filter((t: any) => {
      if (!t?.type?.kind) {
        console.warn(`Removing invalid type definition:`, t);
        return false;
      }
      return true;
    });
    const newCount = rawIdl.types.length;
    console.log(`Patched IDL: removed ${originalCount - newCount} invalid type entries`);
  }

  // 4. Create a Program instance from the patched IDL.
  const programId = new PublicKey("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");
  const program = new anchor.Program(rawIdl as anchor.Idl, programId, provider);

  it("Should connect to the program and verify the IDL name", async () => {
    // Confirm that we've loaded the IDL properly.
    console.log("Program ID:", program.programId.toString());
    console.log("IDL Name:", program.idl.name);

    // Assert the IDL name.
    assert.equal(program.idl.name, "middle_earth_ai_program", "IDL name mismatch");
  });

  it("Should attempt to call initializeGame", async () => {
    // Derive a test game PDA.
    const TEST_GAME_ID = 1234;
    const [gamePda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("game"), Buffer.from(TEST_GAME_ID.toString())],
      program.programId
    );

    console.log("Game PDA:", gamePda.toString(), "Bump:", bump);

    // Call the `initializeGame` instruction.
    await program.methods
      .initializeGame(new anchor.BN(TEST_GAME_ID), bump)
      .accounts({
        game: gamePda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch the game account.
    const gameAccount = await program.account.game.fetch(gamePda);
    console.log("Game account fetched:", gameAccount);
    assert.equal(gameAccount.gameId.toNumber(), TEST_GAME_ID, "Game ID mismatch");
  });
});
