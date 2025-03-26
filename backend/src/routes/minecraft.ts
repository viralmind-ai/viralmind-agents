import express, { Request, Response } from 'express';
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import BlockchainService from '../services/blockchain/index.ts';
import DatabaseService from '../services/db/index.ts';
import { ChallengeModel } from '../models/Models.ts';
import { Webhook } from '../services/webhook/index.ts';

dotenv.config();

const router = express.Router();
const solanaRpc = process.env.RPC_URL!;
const ipcSecret = process.env.IPC_SECRET!;
const DISCORD_WEBHOOK_URL = process.env.MINECRAFT_CHAT_WEBHOOK;
const VIRAL_TOKEN = new PublicKey('HW7D5MyYG4Dz2C98axfjVBeLWpsEnofrqy6ZUwqwpump');

router.get('/whitelist', async (req: Request, res: Response) => {
  try {
    const { name } = req.query;

    if (!name) {
      res.status(400).json({ error: 'Missing challenge name' });
      return;
    }

    const challenge = await ChallengeModel.findOne(
      { name: { $regex: name, $options: 'i' } },
      {
        whitelist: 1
      }
    ).lean();

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    res.json({ whitelist: challenge.whitelist || [] });
  } catch (error) {
    console.error('Error getting whitelist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reveal', async (req: Request, res: Response) => {
  try {
    const { address, username, signature, challengeName } = req.body;

    if (!address || !username || !signature || !challengeName) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Get challenge and verify it exists
    const challenge = await ChallengeModel.findOne(
      { name: { $regex: challengeName, $options: 'i' } },
      {
        _id: 1,
        name: 1,
        game_ip: 1,
        whitelist: 1
      }
    ).lean();

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    // Verify signature
    try {
      const publicKey = new PublicKey(address);
      const message = new TextEncoder().encode(username);
      const signatureUint8 = Buffer.from(signature, 'base64');

      const verified = nacl.sign.detached.verify(message, signatureUint8, publicKey.toBytes());

      if (!verified) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } catch (error) {
      console.error('Signature verification error:', error);
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Get token balance
    const connection = new Connection(solanaRpc, 'confirmed');
    let tokenBalance = 0;

    try {
      const filters = [
        { dataSize: 165 },
        {
          memcmp: {
            offset: 32,
            bytes: address
          }
        },
        {
          memcmp: {
            offset: 0,
            bytes: VIRAL_TOKEN.toBase58()
          }
        }
      ];

      const accounts = await connection.getProgramAccounts(
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        { filters }
      );

      if (accounts.length > 0) {
        const info = await connection.getTokenAccountBalance(accounts[0].pubkey);
        tokenBalance = info.value.uiAmount || 0;
      }
    } catch (error) {
      console.error('Error getting token balance:', error);
    }

    // Update whitelist
    const whitelist = (challenge.whitelist || []).map((entry) => ({
      username: entry.username,
      address: entry.address,
      viral_balance: entry.viral_balance,
      signature: entry.signature
    }));
    const filteredWhitelist = whitelist.filter((entry) => entry.address !== address);

    // Add new whitelist entry as plain object
    filteredWhitelist.push({
      username,
      address,
      viral_balance: tokenBalance,
      signature
    });

    // Update challenge with new whitelist
    await DatabaseService.updateChallenge(challenge._id!, {
      whitelist: filteredWhitelist
    });

    // Send Discord webhook
    const webhook = new Webhook(DISCORD_WEBHOOK_URL);
    await webhook.sendEmbed({
      title: 'New Server IP Reveal',
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true
        },
        {
          name: 'Wallet',
          value: address,
          inline: true
        },
        {
          name: '$VIRAL Balance',
          value: tokenBalance.toString(),
          inline: true
        },
        {
          name: 'Challenge',
          value: challengeName,
          inline: true
        }
      ],
      color: 0x9945ff // Purple color
    });

    res.json({
      success: true,
      game_ip: challenge.game_ip
    });
  } catch (error) {
    console.error('Error in /reveal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reward', async (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (secret !== ipcSecret) {
      res.status(401).json({ error: 'Invalid secret' });
      return;
    }

    // Find active tournament
    const challenge = await ChallengeModel.findOne({
      status: 'active',
      game: { $exists: true }
    });

    if (!challenge) {
      res.status(404).json({ error: 'No active game tournament found' });
      return;
    }

    // Find winner's address from whitelist
    const winnerEntry = challenge.whitelist?.find(
      (entry) => entry.username?.toLowerCase() === username.toLowerCase()
    );

    if (!winnerEntry || !winnerEntry.address) {
      res.status(404).json({ error: 'Winner not found in whitelist' });
      return;
    }

    const programId = challenge.idl?.address;
    const tournamentPDA = challenge.tournamentPDA;

    if (!programId || !tournamentPDA) {
      res.status(404).json({ error: 'Tournament program info not found' });
      return;
    }

    // Conclude tournament on-chain with winner's address
    const blockchainService = new BlockchainService(solanaRpc, programId);
    const concluded = await blockchainService.concludeTournament(
      tournamentPDA,
      winnerEntry.address // Using the address from whitelist instead of username
    );

    // Add victory message to chat
    const victoryMessage = {
      challenge: challenge.name!,
      model: 'gpt-4o-mini',
      role: 'assistant',
      content: `🏆 Tournament concluded! Winner: ${username}\nTransaction: ${concluded}`,
      tool_calls: {},
      address: winnerEntry.address!,
      date: new Date()
    };

    await DatabaseService.createChat(victoryMessage);

    // Update challenge status
    await DatabaseService.updateChallenge(challenge._id!, {
      status: 'concluded'
    });

    res.json({ success: true, transaction: concluded });
  } catch (error) {
    console.error('Error processing reward:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { username, content, secret } = req.body;

    console.log(username, content, secret);
    console.log(process.env);

    if (!username || !content || !secret) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (secret !== ipcSecret) {
      res.status(401).json({ error: 'Invalid secret' });
      return;
    }

    // if (username !== "viral_steve") {
    //   res.status(403).json({ error: 'Unauthorized username' });
    //   return
    // }

    // Find active game challenge
    const challenge = await ChallengeModel.findOne({
      game: { $exists: true },
      status: 'active'
    });

    if (!challenge) {
      res.status(404).json({ error: 'No active game challenge found' });
      return;
    }

    // Create chat message
    await DatabaseService.createChat({
      challenge: challenge.name!,
      role: username === 'viral_steve' ? 'assistant' : 'player',
      content: content,
      address: username,
      display_name: username,
      date: new Date()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as minecraftRoute };
