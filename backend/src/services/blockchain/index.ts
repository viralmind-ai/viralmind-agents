import {
  Connection,
  Transaction,
  TransactionInstruction,
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import DatabaseService from '../db/index.ts';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import axios from 'axios';

class BlockchainService {
  connection: Connection;
  programId: string;
  constructor(solanaRpc: string, programId: string) {
    this.connection = new Connection(solanaRpc, 'confirmed');
    this.programId = programId;
  }

  static async getSolPriceInUSDT() {
    let defaultSolPrice = 230;

    try {
      const tokenPage = await DatabaseService.getPages({ name: 'viral-token' });
      if (tokenPage && tokenPage[0]?.content?.sol_price) {
        defaultSolPrice = tokenPage[0].content.sol_price;
      }

      try {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
        );
        const data = await response.json();
        if (data?.solana?.usd) {
          return data.solana.usd;
        }
        return defaultSolPrice;
      } catch (err) {
        console.error('Error fetching Sol price from CoinGecko:', err);
        return defaultSolPrice;
      }
    } catch (err) {
      console.error('Error fetching token page:', err);
      return defaultSolPrice;
    }
  }

  async getSolBalance(walletAddress: string): Promise<number> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(walletPubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting SOL balance:', error);
      return 0;
    }
  }

  async getTokenBalance(tokenMint: string, walletAddress: string): Promise<number> {
    try {
      // Convert string addresses to PublicKeys
      const mintPubkey = new PublicKey(tokenMint);
      const walletPubkey = new PublicKey(walletAddress);

      // Get the associated token account address
      const tokenAccountAddress = getAssociatedTokenAddressSync(mintPubkey, walletPubkey);

      try {
        // Get the token account info
        const tokenAccountInfo = await this.connection.getTokenAccountBalance(tokenAccountAddress);
        return tokenAccountInfo.value.uiAmount || 0;
      } catch (error) {
        // If the token account doesn't exist, return 0
        // The error message can vary, but it's usually about not finding the account
        if (
          (error as any).message?.includes('could not find') ||
          (error as any).message?.includes('Invalid param') ||
          (error as any).code === -32602
        ) {
          return 0;
        }
        throw error; // Re-throw other errors
      }
    } catch (error) {
      console.error('Error getting token balance:', error);
      return 0;
    }
  }

  async getQuickNodePriorityFees(): Promise<number> {
    try {
      const config = {
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'qn_estimatePriorityFees',
        params: { last_n_blocks: 100, api_version: 2 }
      };

      const response = await axios.post(process.env.RPC_URL!, data, config);

      console.log('QuickNode priority fees response:', response.data);

      // Use QuickNode's recommended fee or fallback to medium priority
      const result = response.data.result;
      // If recommended fee is available, use it, otherwise use medium priority
      return result.recommended || result.per_compute_unit.medium || 500000;
    } catch (error) {
      console.error('Failed to fetch QuickNode priority fees:', error);
      // Return a reasonable default if the API call fails
      return 1_000_000;
    }
  }

  async transferToken(
    tokenMint: string,
    amount: number,
    fromWallet: Keypair,
    toAddress: string,
    retryCount: number = 0
  ): Promise<{ signature: string; usedFeePercentage: number } | false> {
    try {
      const feePercentages = [0.01, 0.1, 0.5, 1.0];
      const currentFeePercentage = feePercentages[retryCount] || 1.0;

      console.log(
        `Attempt ${retryCount + 1} with ${currentFeePercentage * 100}% of base priority fee`
      );

      const sourceAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        fromWallet,
        new PublicKey(tokenMint),
        fromWallet.publicKey
      );

      const destinationAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        fromWallet,
        new PublicKey(tokenMint),
        new PublicKey(toAddress)
      );

      const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenMint));
      const decimals = (tokenInfo.value?.data as any).parsed.info.decimals;

      const basePriorityFee = await this.getQuickNodePriorityFees();
      const adjustedPriorityFee = Math.floor(basePriorityFee * currentFeePercentage);

      console.log(`Base priority fee: ${basePriorityFee}, Using: ${adjustedPriorityFee}`);

      const transaction = new Transaction();
      const transferAmount = amount * Math.pow(10, decimals);

      transaction.add(
        createTransferInstruction(
          sourceAccount.address,
          destinationAccount.address,
          fromWallet.publicKey,
          transferAmount
        )
      );

      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: adjustedPriorityFee })
      );

      const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockHash.blockhash;
      transaction.feePayer = fromWallet.publicKey;

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [fromWallet],
        {
          commitment: 'confirmed',
          maxRetries: 5
        }
      );

      console.log(
        '\x1b[32m',
        `Transaction Success!🎉 (${currentFeePercentage * 100}% fee)`,
        `\n    https://explorer.solana.com/tx/${signature}?cluster=mainnet`
      );

      return {
        signature,
        usedFeePercentage: currentFeePercentage * 100
      };
    } catch (error: any) {
      console.error('\x1b[31m', 'Transfer failed:', {
        message: error.message,
        logs: error?.logs
      });

      // Retry with higher fee if possible
      if (retryCount < 3) {
        console.log(`Retrying with higher fee percentage...`);
        return this.transferToken(tokenMint, amount, fromWallet, toAddress, retryCount + 1);
      }

      return false;
    }
  }

  // Utility to calculate the discriminator
  calculateDiscriminator(instructionName: string) {
    const hash = createHash('sha256').update(`global:${instructionName}`, 'utf-8').digest();
    return hash.slice(0, 8);
  }

  // Verify a transaction

  async verifyTransaction(
    signature: string,
    tournamentPDA: string,
    expectedAmount: number,
    senderWalletAddress: string
  ) {
    try {
      let verified = false;
      // Fetch transaction details
      const transactionDetails = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed'
      });

      // Check if transaction exists
      if (!transactionDetails) {
        console.log(`Transaction not found. ${signature}`);
        return verified;
      }

      const { meta, transaction } = transactionDetails;

      // Ensure the transaction was successful
      if (meta?.err) {
        console.log(`Transaction ${signature} failed with error: ${JSON.stringify(meta.err)}`);
        return verified;
      }

      // Extract inner instructions
      const innerInstructions = meta?.innerInstructions || [];

      // Initialize variable to hold total transferred lamports
      let totalLamportsSent = 0;

      // Iterate through inner instructions to find system transfers
      for (const innerInstruction of innerInstructions) {
        for (const instruction of innerInstruction.instructions) {
          // Check if the instruction is a system program transfer
          // Todo: figure out what is up with these things... are the instructiosn typed incorrectly
          if (
            //@ts-ignore
            instruction.program === 'system' &&
            //@ts-ignore
            instruction.parsed &&
            //@ts-ignore
            instruction.parsed.type === 'transfer'
          ) {
            //@ts-ignore
            const info = instruction.parsed.info;
            const sender = info.source;
            const recipient = info.destination;
            const lamports = info.lamports;
            if (recipient === tournamentPDA && sender === senderWalletAddress) {
              verified = true;
            }
            // Accumulate lamports
            totalLamportsSent += lamports;
          }
        }
      }

      // After processing all inner instructions, check if any matching transfer was found
      if (totalLamportsSent === 0) {
        console.log(`No matching transfers found from sender to recipient. ${signature}`);
        return false;
      }

      // Convert lamports to SOL (1 SOL = 1e9 lamports)
      const amountReceivedSOL = totalLamportsSent / LAMPORTS_PER_SOL;

      // Calculate tolerance
      const tolerance = expectedAmount * 0.03;
      const isWithinTolerance = Math.abs(amountReceivedSOL - expectedAmount) <= tolerance;

      // Verify amount with tolerance
      if (!isWithinTolerance) {
        console.log(
          `Amount mismatch. Expected: ~${expectedAmount} SOL, Received: ${amountReceivedSOL} SOL ${signature}`
        );
        return false;
      }

      // If all verifications pass
      console.log('Transaction verified successfully.');
      console.log(`Sender: ${senderWalletAddress}`);
      console.log(`Recipient: ${tournamentPDA}`);
      console.log(`Total Amount Received: ${amountReceivedSOL} SOL`);
      return verified;
    } catch (error) {
      console.error(`Verification failed: ${(error as Error).message} ${signature}`);
      return false;
    }
  }

  // Get tournament data
  async getTournamentData(tournamentPDA: string) {
    try {
      // Fetch the account info
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tournamentPDA));
      if (!accountInfo) {
        return false;
      }

      const data = Buffer.from(accountInfo.data);
      // Read authority (first 32 bytes)
      const authority = new PublicKey(data.subarray(8, 40)); // Skip 8-byte discriminator

      // Read state (1 byte)
      const state = data.readUInt8(40);

      // Read entry fee (8 bytes)
      const entryFee = data.readBigUInt64LE(41);

      return {
        authority: authority.toString(),
        state,
        entryFee: Number(entryFee) / LAMPORTS_PER_SOL // Convert BigInt to number if needed
      };
    } catch (error) {
      console.error('Error fetching tournament data:', error);
      return false;
    }
  }

  //   Conclude Tournament
  async concludeTournament(tournamentPDA: string, winnerAccount: string) {
    try {
      // Load wallet keypair (payer/authority)
      const keypairFile = readFileSync('./secrets/solana-keypair.json');
      const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keypairFile.toString())));
      // Fetch tournament account
      const tournamentAccountInfo = await this.connection.getAccountInfo(
        new PublicKey(tournamentPDA)
      );
      if (!tournamentAccountInfo) {
        return false;
      }

      // Define the instruction data for ConcludeTournament
      const discriminator = this.calculateDiscriminator('conclude_tournament');

      // Instruction data is just the discriminator
      const data = Buffer.from(discriminator);

      // Define the accounts involved
      const keys = [
        {
          pubkey: new PublicKey(tournamentPDA),
          isSigner: false,
          isWritable: true
        }, // Tournament PDA
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // Payer/Authority
        {
          pubkey: new PublicKey(winnerAccount),
          isSigner: false,
          isWritable: true
        }, // Winner account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } // System program
      ];

      // Create the instruction
      const instruction = new TransactionInstruction({
        keys,
        programId: new PublicKey(this.programId),
        data
      });

      // Create the transaction and add the instruction
      const transaction = new Transaction().add(instruction);

      // Send the transaction
      const signature = await this.connection.sendTransaction(transaction, [wallet], {
        preflightCommitment: 'confirmed'
      });

      // Confirm the transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      console.log('ConcludeTournament transaction signature:', signature);
      return signature;
    } catch (error) {
      console.error('Error concluding tournament:', error);
      return false;
    }
  }
}

export default BlockchainService;
