import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Merklewhitelist } from "../target/types/merklewhitelist";
import { getMerkleProof, getMerkleTree, getMerkleRoot } from '@metaplex-foundation/js';
import BN from 'bn.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

describe("merklewhitelist", () => {
  //configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  //wallet to pay for account creations
  const payer = provider.wallet as anchor.Wallet;
  //retrieve our Rust program IDL
  const program = anchor.workspace.Merklewhitelist as Program<Merklewhitelist>;

  //generate a keypair that will represent our token
  const mintKeypair = anchor.web3.Keypair.generate();

  let merkleDistributorPdaBump: number
  let merkleDistributor: anchor.web3.PublicKey
  let recipientAddress: anchor.web3.PublicKey

  // PDA
  async function setMerkleDistributors() {
    [merkleDistributor, merkleDistributorPdaBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("MerkleTokenDistributor"),
        payer.publicKey.toBuffer(),
      ],
      program.programId,
    );

    await program.methods.initDistributor(
      merkleDistributorPdaBump,
    ).accounts({
      merkleDistributor: merkleDistributor,
      payer: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
      .signers([payer.payer])
      .rpc();
  }

  //ATA
  async function setRecipientAddress() {
    recipientAddress = await anchor.utils.token.associatedAddress({
      mint: mintKeypair.publicKey,
      owner: payer.publicKey,
    });

  }

  async function initAccount() {
    const lamports: number = await program.provider.connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    );

    const mint_tx = new anchor.web3.Transaction().add(
      //create an account from the mint keypair we created
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
        lamports
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        0,
        payer.publicKey,
        payer.publicKey,
      ),
    );

    await anchor.AnchorProvider.env().sendAndConfirm(
      mint_tx, [mintKeypair]
    );

    const airdropSignature = await provider.connection.requestAirdrop(
      mintKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );

    const latestBlockHash = await provider.connection.getLatestBlockhash();

    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSignature,
    });
  }
  before(async () => {
    await setMerkleDistributors();
    await setRecipientAddress();

  });

  const addresses = [
    payer.publicKey.toBuffer(),
    'Ur1CbWSGsXCdedknRbJsEk7urwAvu1uddmQv51nAnXB',
    'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS',
  ];

  it("Mints a token to a wallet", async () => {
    await initAccount();

    let amount = new BN(0);

    const leaf = addresses[0];

    let root = getMerkleRoot(addresses);
    let proof = getMerkleProof(addresses, leaf);

    let result = await program.methods.mintTokenToWallet(
      merkleDistributorPdaBump,
      amount,
      root,
      proof,
    ).accounts({
      mint: mintKeypair.publicKey,
      merkleDistributor: merkleDistributor,
      recipient: recipientAddress,
      payer: payer.publicKey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
    }).signers([payer.payer])
      .rpc();

    assert(result);
  });

  it("errors on invalid proof", async () => {
    await initAccount();

    let amount = new BN(0);

    const leaf = addresses[0];

    let root = getMerkleRoot(addresses);
    let proof = getMerkleProof(addresses, leaf);
    proof.pop(); // introduce an error in the proof

    try {
      await program.methods.mintTokenToWallet(
        merkleDistributorPdaBump,
        amount,
        root,
        proof,
      ).accounts({
        mint: mintKeypair.publicKey,
        merkleDistributor: merkleDistributor,
        recipient: recipientAddress,
        payer: payer.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      }).signers([payer.payer])
        .rpc();
    } catch (err) {
      assert(err.error.errorCode.code == "InvalidProof")
    }
  });
});
