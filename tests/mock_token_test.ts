import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Mock Token Transfer Test", () => {
  // Use the local Anchor provider (by default it connects to localhost or devnet).
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const connection = provider.connection;       // The Solana RPC connection
  const payer = provider.wallet.payer;          // The payer, from .anchor/test-ledger or local wallet
  let mint: PublicKey;                          // Our ephemeral token mint

  // Ephemeral user keypairs
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  it("Creates a mock token and transfers it between userA and userB", async () => {
    // Step 1) Airdrop some SOL to userA and userB so they can pay for transactions
    await connection.requestAirdrop(userA.publicKey, 1e9); // 1 SOL
    await connection.requestAirdrop(userB.publicKey, 1e9); // 1 SOL

    // Wait for airdrops to finalize. In dev or local environment, 2 confirmations are typically enough.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 2) Create a new token mint (with decimals=9 for example).
    // The payer is the mint authority. (No freeze authority for simplicity.)
    mint = await createMint(
      connection,
      payer,               // Pays the transaction & init costs
      payer.publicKey,     // Mint authority
      null,                // No freeze authority
      9                    // Decimals
    );
    console.log("Created Mint:", mint.toBase58());

    // Step 3) Create associated token accounts (ATA) for userA & userB and mint tokens to userA
    const userAATA = await getOrCreateAssociatedTokenAccount(
      connection,         // RPC Connection
      payer,              // Fee payer
      mint,               // Mint address
      userA.publicKey     // Owner of this token account
    );
    const userBATA = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      userB.publicKey
    );

    // Step 4) Mint tokens to userA's ATA
    // We mint 1,000 tokens in base units (1,000 tokens if decimals=9 => 1,000 * 10^9)
    await mintTo(
      connection,
      payer,
      mint,
      userAATA.address,
      payer.publicKey,      // The mint authority
      1_000_000_000         // in base units
    );
    console.log(`Minted tokens to userA's ATA: ${userAATA.address.toBase58()}`);

    // Step 5) Check userA's initial balance
    let userABalance = await getAccount(connection, userAATA.address);
    console.log("User A tokens (initial):", Number(userABalance.amount));
    expect(Number(userABalance.amount)).to.equal(1_000_000_000);

    // Step 6) Check userB's initial balance
    let userBBalance = await getAccount(connection, userBATA.address);
    console.log("User B tokens (initial):", Number(userBBalance.amount));
    expect(Number(userBBalance.amount)).to.equal(0);

    // Step 7) Transfer some tokens from userA -> userB.
    // userA must sign the transfer because userA is the token owner.
    // We transfer 500 tokens in base units (half of them).
    await transfer(
      connection,
      userA,                   // userA is the signer
      userAATA.address,        // Source token account
      userBATA.address,        // Destination token account
      userA,                   // same as signer
      500_000_000              // transfer amount in base units
    );

    // Step 8) Check final balances
    userABalance = await getAccount(connection, userAATA.address);
    userBBalance = await getAccount(connection, userBATA.address);

    console.log("User A tokens (final):", Number(userABalance.amount));
    console.log("User B tokens (final):", Number(userBBalance.amount));

    expect(Number(userABalance.amount)).to.equal(500_000_000);  // half left
    expect(Number(userBBalance.amount)).to.equal(500_000_000);  // half gained
  });
});
