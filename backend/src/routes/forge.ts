import express, { Request, Response, Router, NextFunction } from 'express';
import { Keypair, PublicKey } from '@solana/web3.js';
import OpenAI from 'openai';
import { TrainingPoolModel } from '../models/TrainingPool.js';
import { WalletConnectionModel } from '../models/WalletConnection.js';
import { addToProcessingQueue } from '../services/forge/processing.ts';
import { ForgeAppModel } from '../models/ForgeApp.js';
import { ForgeRaceModel } from '../models/ForgeRace.js';
import { ForgeRaceSubmission } from '../models/ForgeRaceSubmission.js';
import { AWSS3Service } from '../services/aws/index.ts';
import BlockchainService from '../services/blockchain/index.ts';

const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');
import multer from 'multer';
import { createReadStream } from 'fs';
import { mkdir, unlink, copyFile, stat } from 'fs/promises';
import * as path from 'path';
import { Extract } from 'unzipper';
import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import {
  AppInfo,
  AppWithLimitInfo,
  ConnectBody,
  CreatePoolBody,
  TaskWithLimitInfo,
  DBTrainingPool,
  TrainingPoolStatus,
  UpdatePoolBody,
  UploadLimitType,
  ForgeSubmissionProcessingStatus
} from '../types/index.ts';
import {
  APP_TASK_GENERATION_PROMPT,
  generateAppsForPool,
  startRefreshInterval,
  SYSTEM_PROMPT,
  TASK_SHOT_EXAMPLES
} from '../services/forge/index.ts';
import { Webhook } from '../services/webhook/index.ts';
import { requireWalletAddress } from '../services/auth/index.ts';

// Set up interval to refresh pool balances
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
// set up the discord webhook
const FORGE_WEBHOOK = process.env.GYM_FORGE_WEBHOOK;
const webhook = new Webhook(FORGE_WEBHOOK);

// Configure multer for handling file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 15 * 1024 * 1024 * 1024 // 15GB limit for /upload-race endpoint
  }
});

// start the refresh interval for pool data
startRefreshInterval();

// App task generation prompt template

const router: Router = express.Router();

// Upload race data endpoint
router.post(
  '/upload-race',
  requireWalletAddress,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    try {
      const s3Service = new AWSS3Service(process.env.AWS_ACCESS_KEY, process.env.AWS_SECRET_KEY);

      // Create temporary directory for initial extraction
      const tempDir = path.join('uploads', `temp_${Date.now()}`);
      await mkdir(tempDir, { recursive: true });

      // Extract meta.json first to get ID
      await new Promise((resolve, reject) => {
        createReadStream(req.file!.path)
          .pipe(Extract({ path: tempDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Read and parse meta.json
      const metaJson = await new Promise<string>((resolve, reject) => {
        let data = '';
        createReadStream(path.join(tempDir, 'meta.json'))
          .on('data', (chunk) => (data += chunk))
          .on('end', () => resolve(data))
          .on('error', reject);
      });
      const meta = JSON.parse(metaJson);

      // Create UUID from meta.id + address
      const uuid = createHash('sha256').update(`${meta.id}${address}`).digest('hex');

      // Create final directory with UUID
      const extractDir = path.join('uploads', `extract_${uuid}`);
      await mkdir(extractDir, { recursive: true });

      // Move files from temp to final directory
      const requiredFiles = ['input_log.jsonl', 'meta.json', 'recording.mp4'];
      for (const file of requiredFiles) {
        const tempPath = path.join(tempDir, file);
        const finalPath = path.join(extractDir, file);
        try {
          // Use fs.copyFile instead of pipe
          await copyFile(tempPath, finalPath);
        } catch (error) {
          await unlink(req.file.path);
          await unlink(tempDir).catch(() => {});
          res.status(400).json({ error: `Missing required file: ${file}` });
          return;
        }
      }

      // Clean up temp directory
      await unlink(tempDir).catch(() => {});

      // Upload each file to S3
      const uploads = await Promise.all(
        requiredFiles.map(async (file) => {
          const filePath = path.join(extractDir, file);
          const fileStats = await stat(filePath);
          const s3Key = `forge-races/${Date.now()}-${file}`;

          await s3Service.saveItem({
            bucket: 'training-gym',
            file: filePath,
            name: s3Key
          });

          return { file, s3Key, size: fileStats.size };
        })
      );

      // Verify time if poolId and generatedTime provided
      if (meta.poolId && meta.generatedTime) {
        const now = Date.now();
        if (now - meta.generatedTime > 5 * 60 * 1000) {
          res.status(400).json({ error: 'Generated time expired' });
          return;
        }

        // Check upload limits
        const pool = await TrainingPoolModel.findById(meta.poolId);
        if (!pool) {
          res.status(404).json({ error: 'Pool not found' });
          return;
        }

        // Check gym-wide upload limits
        if (pool.uploadLimit?.type) {
          let gymSubmissions;
          const poolId = pool._id.toString();

          switch (pool.uploadLimit.limitType) {
            case UploadLimitType.perDay:
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                createdAt: { $gte: today },
                status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              if (gymSubmissions >= pool.uploadLimit.type) {
                res.status(400).json({ error: 'Daily upload limit reached for this gym' });
                return;
              }
              break;

            case UploadLimitType.total:
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              if (gymSubmissions >= pool.uploadLimit.type) {
                res.status(400).json({ error: 'Total upload limit reached for this gym' });
                return;
              }
              break;
          }
        }

        // Check task-specific upload limit
        if (meta.quest?.task_id) {
          const app = await ForgeAppModel.findOne({
            pool_id: meta.poolId,
            'tasks._id': meta.quest.task_id
          });

          if (app) {
            const task = app.tasks.find((t) => t._id.toString() === meta.quest.task_id);
            if (task?.uploadLimit) {
              const taskSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.task_id': meta.quest.task_id,
                status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              if (taskSubmissions >= task.uploadLimit) {
                res.status(400).json({ error: 'Upload limit reached for this task' });
                return;
              }

              // Check gym-wide per-task limit if applicable
              if (
                pool.uploadLimit?.limitType === UploadLimitType.perTask &&
                pool.uploadLimit?.type &&
                taskSubmissions >= pool.uploadLimit.type
              ) {
                res.status(400).json({ error: 'Per-task upload limit reached for this gym' });
                return;
              }
            }
          }
        }
      }

      // check for existing submission
      const tempSub = await ForgeRaceSubmission.findById(uuid);
      if (tempSub) {
        res
          .json({
            message: 'Submission data already uploaded.',
            submissionId: uuid
          })
          .status(400);
      }

      // Create submission record
      const submission = await ForgeRaceSubmission.create({
        _id: uuid,
        address,
        meta,
        status: ForgeSubmissionProcessingStatus.PENDING,
        files: uploads
      });

      // Add to processing queue
      addToProcessingQueue(uuid);

      res.json({
        message: 'Race data uploaded successfully',
        submissionId: submission._id,
        files: uploads
      });
    } catch (error) {
      console.error('Error uploading race data:', error);
      // Clean up temporary file on error
      if (req.file) {
        await unlink(req.file.path).catch(() => {});
      }
      res.status(500).json({ error: 'Failed to upload race data' });
    }
  }
);

// Get submission status
router.get('/submission/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const submission = await ForgeRaceSubmission.findById(id);

    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    res.json({
      status: submission.status,
      grade_result: submission.grade_result,
      error: submission.error,
      meta: submission.meta,
      files: submission.files,
      reward: submission.reward,
      maxReward: submission.maxReward,
      clampedScore: submission.clampedScore,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    });
  } catch (error) {
    console.error('Error getting submission:', error);
    res.status(500).json({ error: 'Failed to get submission status' });
  }
});

// List submissions for an address
router.get('/submissions', requireWalletAddress, async (req: Request, res: Response) => {
  try {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    const submissions = await ForgeRaceSubmission.find({ address })
      .sort({ createdAt: -1 })
      .select('-__v');

    res.json(submissions);
  } catch (error) {
    console.error('Error listing submissions:', error);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// List submissions for a pool ID
router.get(
  '/pool-submissions/:poolId',
  requireWalletAddress,
  async (req: Request, res: Response) => {
    try {
      const { poolId } = req.params;

      if (!poolId) {
        res.status(400).json({ error: 'Pool ID is required' });
        return;
      }

      // @ts-ignore - Get walletAddress from the request object
      const address = req.walletAddress;

      // Verify that the pool belongs to the user
      const pool = await TrainingPoolModel.findById(poolId);
      if (!pool) {
        res.status(404).json({ error: 'Pool not found' });
        return;
      }

      if (pool.ownerAddress !== address) {
        res.status(403).json({ error: 'Not authorized to view submissions for this pool' });
        return;
      }

      const submissions = await ForgeRaceSubmission.find({ 'meta.quest.pool_id': poolId })
        .sort({ createdAt: -1 })
        .select('-__v');

      res.json(submissions);
    } catch (error) {
      console.error('Error listing pool submissions:', error);
      res.status(500).json({ error: 'Failed to list pool submissions' });
    }
  }
);

// Store wallet address for token
router.post('/connect', async (req: Request<{}, {}, ConnectBody>, res: Response) => {
  try {
    const { token, address, signature, timestamp } = req.body;

    if (!token || !address) {
      res.status(400).json({ error: 'Token and address are required' });
      return;
    }

    // If signature and timestamp are provided, verify the signature
    if (signature && timestamp) {
      // Check if timestamp is within 5 minutes
      const now = Date.now();
      if (now - timestamp > 5 * 60 * 1000) {
        res.status(400).json({ error: 'Timestamp expired' });
        return;
      }

      try {
        // Create the message that was signed
        const message = `viralmind desktop\nnonce: ${timestamp}`;
        const messageBytes = new TextEncoder().encode(message);

        // Convert base64 signature to Uint8Array
        const signatureBytes = Buffer.from(signature, 'base64');

        // Convert address to PublicKey
        const publicKey = new PublicKey(address);

        // Verify the signature
        const verified = nacl.sign.detached.verify(
          messageBytes,
          signatureBytes,
          publicKey.toBytes()
        );

        if (!verified) {
          res.status(400).json({ error: 'Invalid signature' });
          return;
        }
      } catch (verifyError) {
        console.error('Error verifying signature:', verifyError);
        res.status(400).json({ error: 'Signature verification failed' });
        return;
      }
    } else {
      // For backward compatibility, allow connections without signature
      // In production, you might want to require signatures
      console.warn('Connection without signature from address:', address);
    }

    // Store connection token with address
    await WalletConnectionModel.updateOne({ token }, { token, address }, { upsert: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Error connecting wallet:', error);
    res.status(500).json({ error: 'Failed to connect wallet' });
  }
});

// Check connection status
router.get(
  '/check-connection',
  async (req: Request<{}, {}, {}, { token?: string }>, res: Response) => {
    try {
      const token = req.query.token;

      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      const connection = await WalletConnectionModel.findOne({ token });

      res.json({
        connected: !!connection,
        address: connection?.address
      });
    } catch (error) {
      console.error('Error checking connection:', error);
      res.status(500).json({ error: 'Failed to check connection status' });
    }
  }
);

// System prompt for the AI assistant

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface ChatBody {
  messages: Message[];
  task_prompt: string;
  app: AppInfo;
}

// Sample few-shot conversation history
// Add route to router
router.post('/chat', async (req: Request<{}, {}, ChatBody>, res: Response) => {
  try {
    const { messages, task_prompt, app } = req.body;

    if (!messages || !Array.isArray(messages) || !task_prompt || !app) {
      res.status(400).json({ error: 'Messages array, task prompt, and app info are required' });
      return;
    }

    // Format context message
    const contextMessage = `Task: ${task_prompt}\nApp: ${app.name} (${app.type}${
      app.type === 'executable' ? `, Path: ${app.path}` : `, URL: ${app.url}`
    })`;

    // Randomly select 3 few-shot examples
    const randomExamples = [...TASK_SHOT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3);

    // Prepare messages for OpenAI API
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      // Include all three random examples
      ...randomExamples.flatMap((example) => example.conversation),
      { role: 'user', content: contextMessage },
      ...messages
    ];

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: apiMessages,
      tools: [
        {
          type: 'function',
          function: {
            name: 'validate_task_request',
            description:
              "Validate if the user's task request is appropriate and can be assisted with",
            parameters: {
              type: 'object',
              required: ['title', 'app', 'objectives', 'content'],
              properties: {
                title: {
                  type: 'string',
                  description: 'Brief title for the task'
                },
                app: {
                  type: 'string',
                  description: 'Name of the app being used'
                },
                icon_url: {
                  type: 'string',
                  description: "URL for the app's favicon"
                },
                objectives: {
                  type: 'array',
                  description:
                    'List of 4 objectives to complete the task (first objective must be opening/navigating to the app with the app name wrapped in <app> tags, stop at checkout for purchases)',
                  items: {
                    type: 'string'
                  }
                },
                content: {
                  type: 'string',
                  description: "The assistant's message to the user"
                }
              }
            }
          }
        }
      ]
    } as any);

    const assistantMessage = response.choices[0].message;

    // Handle tool calls if present
    if (assistantMessage.tool_calls?.length) {
      const toolCall = assistantMessage.tool_calls[0];
      // Add tool call to response
      res.json({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          }
        ]
      });
    } else {
      // Return regular message
      res.json({
        role: 'assistant',
        content: assistantMessage.content
      });
    }
  } catch (error) {
    console.error('Error handling chat:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Refresh pool balance
router.post(
  '/refresh',
  requireWalletAddress,
  async (req: Request<{}, {}, { id: string }>, res: Response) => {
    try {
      const { id } = req.body;

      if (!id) {
        res.status(400).json({ error: 'Pool ID is required' });
        return;
      }

      const pool = await TrainingPoolModel.findById(id);
      if (!pool) {
        res.status(404).json({ error: 'Training pool not found' });
        return;
      }

      // @ts-ignore - Get walletAddress from the request object
      const address = req.walletAddress;

      // Verify that the pool belongs to the user
      if (pool.ownerAddress !== address) {
        res.status(403).json({ error: 'Not authorized to refresh this pool' });
        return;
      }

      // Get current token balance from blockchain
      const balance = await blockchainService.getTokenBalance(
        pool.token.address,
        pool.depositAddress
      );

      // Get SOL balance to check for gas
      const solBalance = await blockchainService.getSolBalance(pool.depositAddress);
      const noGas = solBalance === 0;

      // Update pool funds and status
      pool.funds = balance;

      // Update status based on token and SOL balances
      if (process.env.NODE_ENV != 'development') {
        if (noGas) {
          pool.status = TrainingPoolStatus.noGas;
        } else if (balance === 0) {
          pool.status = TrainingPoolStatus.noFunds;
        } else if (balance < pool.pricePerDemo) {
          pool.status = TrainingPoolStatus.noFunds;
        } else if (
          pool.status === TrainingPoolStatus.noFunds ||
          pool.status === TrainingPoolStatus.noGas
        ) {
          pool.status = TrainingPoolStatus.paused;
        }
      }

      await pool.save();

      // Get demonstration count
      const demoCount = await ForgeRaceSubmission.countDocuments({
        'meta.quest.pool_id': pool._id.toString()
      });

      // Return pool without private key but with demo count and noGas flag
      const { depositPrivateKey: _, ...poolObj } = pool.toObject();
      res.json({
        ...poolObj,
        demonstrations: demoCount,
        solBalance
      });
    } catch (error) {
      console.error('Error refreshing pool balance:', error);
      res.status(500).json({ error: 'Failed to refresh pool balance' });
    }
  }
);

// List training pools
router.post('/list', requireWalletAddress, async (req: Request, res: Response) => {
  try {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;

    const pools = await TrainingPoolModel.find({ ownerAddress: address }).select(
      '-depositPrivateKey'
    ); // Exclude private key from response

    // Get demonstration counts for each pool
    const poolsWithDemos = await Promise.all(
      pools.map(async (pool) => {
        const demoCount = await ForgeRaceSubmission.countDocuments({
          'meta.quest.pool_id': pool._id.toString()
        });

        // Update status to 'no-funds' if balance is 0 or less than pricePerDemo
        if (process.env.NODE_ENV != 'development') {
          if (
            (pool.funds === 0 || pool.funds < pool.pricePerDemo) &&
            pool.status !== TrainingPoolStatus.noFunds
          ) {
            pool.status = TrainingPoolStatus.noFunds;
            await pool.save(); // Save the updated status
          }
        }

        // Get token balance from blockchain
        const tokenBalance = await blockchainService.getTokenBalance(
          pool.token.address,
          pool.depositAddress
        );

        // Get SOL balance for gas
        const solBalance = await blockchainService.getSolBalance(pool.depositAddress);

        const poolObj = pool.toObject();
        return {
          ...poolObj,
          demonstrations: demoCount,
          solBalance,
          tokenBalance
        };
      })
    );

    res.json(poolsWithDemos);
  } catch (error) {
    console.error('Error listing pools:', error);
    res.status(500).json({ error: 'Failed to list training pools' });
  }
});

// Create training pool
router.post(
  '/create',
  requireWalletAddress,
  async (req: Request<{}, {}, CreatePoolBody>, res: Response) => {
    try {
      const { name, skills, token, pricePerDemo, apps } = req.body;

      if (!name || !skills || !token) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // @ts-ignore - Get walletAddress from the request object
      const ownerAddress = req.walletAddress;

      // Generate Solana keypair for deposit address
      const keypair = Keypair.generate();
      const depositAddress = keypair.publicKey.toString();
      const depositPrivateKey = Buffer.from(keypair.secretKey).toString('base64');

      const pool = new TrainingPoolModel({
        name,
        skills,
        token,
        ownerAddress,
        status: TrainingPoolStatus.noFunds,
        demonstrations: 0,
        funds: 0,
        pricePerDemo: pricePerDemo ? Math.max(1, pricePerDemo) : 10, // Default to 10 if not provided, minimum of 1
        depositAddress,
        depositPrivateKey
      });

      await pool.save();

      const poolId = pool._id.toString();

      // If predefined apps were provided, use those
      if (apps && Array.isArray(apps) && apps.length > 0) {
        console.log(`Using ${apps.length} predefined apps for pool ${poolId}`);

        try {
          // Store the predefined apps
          for (const app of apps) {
            await ForgeAppModel.create({
              ...app,
              pool_id: poolId
            });
          }

          // Log success
          console.log(`Successfully added ${apps.length} predefined apps for pool ${poolId}`);
          await webhook.sendText(
            `✅ Added ${apps.length} predefined apps for pool "${pool.name}" (${poolId})\n${apps
              .map((a) => `- ${a.name}`)
              .join('\n')}`
          );
        } catch (error) {
          const appError = error as Error;
          console.error('Error adding predefined apps:', appError);
          await webhook.sendText(
            `❌ Error adding predefined apps for pool ${poolId}: ${appError.message}`
          );
          // Continue with creating the pool, just log the error
        }
      } else {
        // No predefined apps, generate them using OpenAI (non-blocking)
        generateAppsForPool(poolId, skills).catch((error) => {
          console.error('Error generating initial apps:', error);
        });
      }

      // Create response object without private key
      const { depositPrivateKey: _, ...response } = pool.toObject();

      res.json(response);
    } catch (error) {
      console.error('Error creating pool:', error);
      res.status(500).json({ error: 'Failed to create training pool' });
    }
  }
);

// Update training pool
router.post(
  '/update',
  requireWalletAddress,
  async (req: Request<{}, {}, UpdatePoolBody>, res: Response) => {
    try {
      const { id, name, status, skills, pricePerDemo, apps } = req.body;

      if (!id) {
        res.status(400).json({ error: 'Pool ID is required' });
        return;
      }

      if (status && ![TrainingPoolStatus.live, TrainingPoolStatus.paused].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const pool = await TrainingPoolModel.findById(id);
      if (!pool) {
        res.status(404).json({ error: 'Training pool not found' });
        return;
      }

      // @ts-ignore - Get walletAddress from the request object
      if (pool.ownerAddress !== req.walletAddress) {
        res.status(403).json({ error: 'Not authorized to update this pool' });
        return;
      }

      // Only allow status update if funds > 0 and funds >= pricePerDemo
      if (status && (pool.funds === 0 || pool.funds < pool.pricePerDemo)) {
        res.status(400).json({ error: 'Cannot update status: pool has insufficient funds' });
        return;
      }

      // Create update operations
      let updateOperation: any = {};

      // Build $set operation for regular updates
      const setUpdates: Partial<DBTrainingPool> = {};
      if (name) setUpdates.name = name;
      if (status) setUpdates.status = status;
      if (skills) setUpdates.skills = skills;
      if (pricePerDemo !== undefined) setUpdates.pricePerDemo = Math.max(1, pricePerDemo);

      // Add $set operation if we have updates
      if (Object.keys(setUpdates).length > 0) {
        updateOperation.$set = setUpdates;
      }

      // Handle upload limit updates - allow setting to null to remove limits
      if (req.body.hasOwnProperty('uploadLimit')) {
        if (req.body.uploadLimit === null) {
          // If uploadLimit is explicitly set to null, remove the upload limit
          updateOperation.$unset = { uploadLimit: 1 };
        } else {
          // Otherwise update with the new value
          if (!updateOperation.$set) updateOperation.$set = {};
          updateOperation.$set.uploadLimit = req.body.uploadLimit;
        }
      }

      const updatedPool = await TrainingPoolModel.findByIdAndUpdate(id, updateOperation, {
        new: true
      }).select('-depositPrivateKey'); // Exclude private key from response

      // If apps were provided, update the apps
      if (apps && Array.isArray(apps) && apps.length > 0) {
        try {
          // Delete existing apps for this pool
          await ForgeAppModel.deleteMany({ pool_id: id });

          // Store the new apps
          for (const app of apps) {
            await ForgeAppModel.create({
              ...app,
              pool_id: id
            });
          }

          console.log(`Successfully updated ${apps.length} apps for pool ${id}`);
          // await notifyForgeWebhook(
          //   `✅ Updated ${apps.length} apps for pool "${updatedPool?.name}" (${id})\n${apps
          //     .map((a) => `- ${a.name}`)
          //     .join('\n')}`
          // );
        } catch (error) {
          const appError = error as Error;
          console.error('Error updating apps:', appError);
          // await notifyForgeWebhook(
          //   `❌ Error updating apps for pool ${id}: ${appError.message}`
          // );
        }
      }
      // If skills were updated but no apps were provided, generate apps
      else if (skills) {
        generateAppsForPool(id, skills).catch((error) => {
          console.error('Error regenerating apps:', error);
        });
      }

      res.json(updatedPool);
    } catch (error) {
      console.error('Error updating pool:', error);
      res.status(500).json({ error: 'Failed to update training pool' });
    }
  }
);

// Get active gym races
router.get('/gym', async (_req: Request, res: Response) => {
  try {
    const races = await ForgeRaceModel.find({
      status: 'active',
      type: 'gym'
    }).sort({
      createdAt: -1
    });
    res.json(races);
  } catch (error) {
    console.error('Error getting gym races:', error);
    res.status(500).json({ error: 'Failed to get gym races' });
  }
});

// Get reward calculation
router.get('/reward', requireWalletAddress, async (req: Request, res: Response) => {
  const { poolId } = req.query;
  // @ts-ignore - Get walletAddress from the request object
  const address = req.walletAddress;

  if (!poolId || typeof poolId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid poolId' });
    return;
  }

  // Get the pool to check pricePerDemo
  const pool = await TrainingPoolModel.findById(poolId);
  if (!pool) {
    res.status(404).json({ error: 'Pool not found' });
    return;
  }

  // Check if pool has enough funds for at least one demo
  if (pool.funds < pool.pricePerDemo) {
    res.status(400).json({ error: 'Pool has insufficient funds' });
    return;
  }

  // Round time down to last minute
  const currentTime = Math.floor(Date.now() / 60000) * 60000;
  // Create hash using poolId + address + time + secret
  // const hash = createHash('sha256')
  //   .update(`${poolId}${address}${currentTime}${process.env.IPC_SECRET}`)
  //   .digest('hex');
  // // Convert first 8 chars of hash to number between 0-1
  // const rng = parseInt(hash.slice(0, 8), 16) / 0xffffffff;

  // Use pricePerDemo as the base reward value
  const reward = pool.pricePerDemo;

  res.json({
    time: currentTime,
    maxReward: reward,
    pricePerDemo: pool.pricePerDemo
  });
});

// Generate apps endpoint
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    // Generate new apps using OpenAI
    const formatted_prompt = APP_TASK_GENERATION_PROMPT.replace('{skill list}', prompt);
    const response = await openai.chat.completions.create({
      model: 'o3-mini',
      reasoning_effort: 'medium',
      messages: [
        {
          role: 'user',
          content: formatted_prompt
        }
      ]
    } as any); // Type assertion to handle custom model params

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse JSON content
    try {
      const parsedContent = JSON.parse(content);
      res.json({
        content: parsedContent
      });
    } catch (parseError) {
      console.error('Error parsing JSON content:', parseError);
      // Return unparsed content if JSON parsing fails
      res.json({
        content: content,
        parsing_error: 'Failed to parse content as JSON'
      });
    }
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

/**
 * ## API Documentation
 *
 * ### POST /forge/generate
 *
 * Generates content using OpenAI's API based on the provided prompt.
 *
 * #### Request Body
 * ```json
 * {
 *   "prompt": "string" // Required: The prompt to send to OpenAI
 * }
 * ```
 *
 * #### Response
 * ```json
 * {
 *   "content": {} // Parsed JSON content from OpenAI's response
 * }
 * ```
 *
 * #### Error Response
 * If JSON parsing fails:
 * ```json
 * {
 *   "content": "string", // Unparsed content from OpenAI's response
 *   "parsing_error": "Failed to parse content as JSON"
 * }
 * ```
 *
 * If OpenAI request fails:
 * ```json
 * {
 *   "error": "Failed to generate content"
 * }
 * ```
 *
 * #### Example Usage
 * ```javascript
 * const response = await fetch('/api/forge/generate', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json'
 *   },
 *   body: JSON.stringify({
 *     prompt: "Generate app tasks for the following skills: Browser Management, File Operations"
 *   })
 * });
 * const data = await response.json();
 * // data.content will contain the parsed JSON array of app tasks
 * ```
 */

// Get $VIRAL balance for an address
router.get('/balance/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!address) {
      res.status(400).json({ error: 'Address is required' });
      return;
    }

    const balance = await blockchainService.getTokenBalance(process.env.VIRAL_TOKEN || '', address);

    res.json({ balance });
  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// Get all tasks with filtering options
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { pool_id, min_reward, max_reward, categories, query } = req.query;

    // Build initial query for apps
    let appQuery: any = {};

    // Filter by pool_id if specified
    if (pool_id) {
      appQuery.pool_id = pool_id.toString();
    }

    // Filter by categories if specified
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories;

        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          appQuery.categories = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i');
      appQuery.$or = [{ name: searchRegex }, { 'tasks.prompt': searchRegex }];
    }

    // Get all apps matching the initial query
    let apps = await ForgeAppModel.find(appQuery).populate(
      'pool_id',
      'name status pricePerDemo uploadLimit'
    );

    // Filter by live pools if no specific pool_id was provided
    if (!pool_id) {
      apps = apps.filter((app) => {
        const pool = app.pool_id as unknown as DBTrainingPool;
        return pool && pool.status === TrainingPoolStatus.live;
      });
    }

    // Process apps to extract tasks and apply reward filtering
    const tasks = [];

    for (const app of apps) {
      const pool = app.pool_id as unknown as DBTrainingPool;

      // Check gym-wide upload limit
      let gymLimitReached = false;
      let gymSubmissions = 0;

      if (pool.uploadLimit?.type) {
        const poolId = (pool as any)._id.toString();

        switch (pool.uploadLimit.limitType) {
          case UploadLimitType.perDay:
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              createdAt: { $gte: today },
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });

            // Check if gym has reached daily limit
            gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
            break;

          case UploadLimitType.total:
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });

            // Check if gym has reached total limit
            gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
            break;
        }
      }

      // Process each task in the app
      for (const task of app.tasks) {
        // Determine the effective reward for this task
        // First check if task has a specific rewardLimit, otherwise use pool's pricePerDemo
        const effectiveReward =
          task.rewardLimit !== undefined ? task.rewardLimit : pool.pricePerDemo;

        // Apply reward filtering
        if (
          (min_reward !== undefined && (effectiveReward || 0) < Number(min_reward)) ||
          (max_reward !== undefined && (effectiveReward || 0) > Number(max_reward))
        ) {
          // Skip this task if it doesn't meet the reward criteria
          continue;
        }

        // Calculate task limit information
        let taskLimitReached = false;
        let taskSubmissions = 0;
        let limitReason: string | null = null;

        // Count submissions for this specific task
        if (
          task.uploadLimit ||
          (pool.uploadLimit?.limitType === UploadLimitType.perTask && pool.uploadLimit?.type)
        ) {
          taskSubmissions = await ForgeRaceSubmission.countDocuments({
            'meta.quest.task_id': task._id.toString(),
            status: ForgeSubmissionProcessingStatus.COMPLETED,
            reward: { $gt: 0 }
          });

          // Check if task has reached its limit
          if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
            taskLimitReached = true;
            limitReason = 'Task limit reached';
          }

          // Check gym-wide per-task limit if applicable
          if (
            !taskLimitReached &&
            pool.uploadLimit?.limitType === UploadLimitType.perTask &&
            pool.uploadLimit?.type &&
            taskSubmissions >= pool.uploadLimit.type
          ) {
            taskLimitReached = true;
            limitReason = 'Per-task gym limit reached';
          }
        }

        // If gym limit is reached, mark all tasks as limited
        if (gymLimitReached) {
          taskLimitReached = true;
          limitReason =
            pool.uploadLimit?.limitType === UploadLimitType.perDay
              ? 'Daily gym limit reached'
              : 'Total gym limit reached';
        }

        // Add task with app information to the result array
        tasks.push({
          _id: task._id,
          prompt: task.prompt,
          uploadLimit: task.uploadLimit,
          rewardLimit: task.rewardLimit,
          uploadLimitReached: taskLimitReached,
          currentSubmissions: taskSubmissions,
          limitReason: limitReason,
          app: {
            _id: app._id,
            name: app.name,
            domain: app.domain,
            description: app.description,
            categories: app.categories,
            gymLimitType: pool.uploadLimit?.limitType,
            gymSubmissions: gymSubmissions,
            gymLimitValue: pool.uploadLimit?.type,
            pool_id: app.pool_id
          }
        });
      }
    }

    res.json(tasks);
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

// Get all apps with filtering options
router.get('/apps', async (req: Request, res: Response) => {
  try {
    const { pool_id, min_reward, max_reward, categories, query } = req.query;

    // First, build a query for pools if we need to filter by reward
    let poolQuery: any = {};
    let poolIds: string[] = [];

    if (min_reward !== undefined || max_reward !== undefined) {
      if (min_reward !== undefined) {
        poolQuery.pricePerDemo = { $gte: Number(min_reward) };
      }

      if (max_reward !== undefined) {
        poolQuery.pricePerDemo = {
          ...poolQuery.pricePerDemo,
          $lte: Number(max_reward)
        };
      }

      // If no pool_id specified, only include live pools
      if (!pool_id) {
        poolQuery.status = TrainingPoolStatus.live;
      }

      // Get matching pool IDs
      const pools = await TrainingPoolModel.find(poolQuery).select('_id');
      poolIds = pools.map((pool) => pool._id.toString());

      // If no pools match the reward criteria, return empty array early
      if (poolIds.length === 0) {
        res.json([]);
        return;
      }
    }

    // Build query for apps
    let appQuery: any = {};

    // Filter by pool_id if specified, or by poolIds from reward filter
    if (pool_id) {
      appQuery.pool_id = pool_id.toString();
    } else if (poolIds.length > 0) {
      appQuery.pool_id = { $in: poolIds };
    }

    // Filter by categories if specified
    if (categories) {
      try {
        // Parse the JSON array of categories
        const categoriesArray = (categories as string).split(',');
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          // Use $in operator to match any of the categories
          appQuery.categories = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
        // If parsing fails, just don't apply the category filter
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      // We need to use $or to search across multiple fields
      const searchRegex = new RegExp(query, 'i');

      appQuery.$or = [{ name: searchRegex }, { 'tasks.prompt': searchRegex }];
    }

    // Execute the query with appropriate population
    let apps;
    if (pool_id || poolIds.length > 0) {
      // If we're already filtering by specific pools, just get those apps
      apps = await ForgeAppModel.find(appQuery).populate(
        'pool_id',
        'name status pricePerDemo uploadLimit'
      );
    } else {
      // Otherwise, get all apps and filter by live pools
      apps = await ForgeAppModel.find(appQuery)
        .populate('pool_id', 'name status pricePerDemo uploadLimit')
        .then((apps) =>
          apps.filter((app) => {
            const pool = app.pool_id as unknown as DBTrainingPool;
            return pool && pool.status === TrainingPoolStatus.live;
          })
        );
    }

    // Mark tasks that have reached their upload limits instead of filtering them out
    const appsWithLimitInfo = await Promise.all(
      apps.map(async (app) => {
        const pool = app.pool_id as unknown as DBTrainingPool;
        // Create a new object with the required properties
        const appObj: AppWithLimitInfo = {
          ...app.toObject(),
          gymLimitReached: false,
          gymSubmissions: 0,
          gymLimitType: undefined,
          gymLimitValue: undefined
        };

        // Check gym-wide upload limit
        let gymLimitReached = false;
        let gymSubmissions = 0;

        if (pool.uploadLimit?.type) {
          const poolId = (pool as any)._id.toString();

          switch (pool.uploadLimit.limitType) {
            case UploadLimitType.perDay:
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                createdAt: { $gte: today },
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if gym has reached daily limit
              gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
              break;

            case UploadLimitType.total:
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if gym has reached total limit
              gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
              break;
          }
        }

        // Add gym limit info to app object
        appObj.gymLimitReached = gymLimitReached;
        appObj.gymSubmissions = gymSubmissions;
        appObj.gymLimitType = pool.uploadLimit?.limitType;
        appObj.gymLimitValue = pool.uploadLimit?.type;

        // Process tasks and add limit information
        const tasksWithLimitInfo = await Promise.all(
          app.tasks.map(async (task) => {
            let taskLimitReached = false;
            let taskSubmissions = 0;
            let limitReason: string | null = null;

            // Count submissions for this specific task
            if (
              task.uploadLimit ||
              (pool.uploadLimit?.limitType === UploadLimitType.perTask && pool.uploadLimit?.type)
            ) {
              taskSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.task_id': task._id.toString(),
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if task has reached its limit
              if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
                taskLimitReached = true;
                limitReason = 'Task limit reached';
              }

              // Check gym-wide per-task limit if applicable
              if (
                !taskLimitReached &&
                pool.uploadLimit?.limitType === UploadLimitType.perTask &&
                pool.uploadLimit?.type &&
                taskSubmissions >= pool.uploadLimit.type
              ) {
                taskLimitReached = true;
                limitReason = 'Per-task gym limit reached';
              }
            }

            // If gym limit is reached, mark all tasks as limited
            if (gymLimitReached) {
              taskLimitReached = true;
              limitReason =
                pool.uploadLimit?.limitType === UploadLimitType.perDay
                  ? 'Daily gym limit reached'
                  : 'Total gym limit reached';
            }

            // Add limit info to task object
            return {
              ...task,
              uploadLimitReached: taskLimitReached,
              currentSubmissions: taskSubmissions,
              limitReason: limitReason
            } as TaskWithLimitInfo;
          })
        );

        // Return app with all tasks and limit information
        return {
          ...appObj,
          tasks: tasksWithLimitInfo
        };
      })
    );

    // Return all apps with limit information
    res.json(appsWithLimitInfo);
  } catch (error) {
    console.error('Error getting apps:', error);
    res.status(500).json({ error: 'Failed to get apps' });
  }
});

// Get available forge pools (non-sensitive information)
router.get('/pools', async (_req: Request, res: Response) => {
  try {
    // Only return live pools with non-sensitive information
    const pools = await TrainingPoolModel.find({ status: TrainingPoolStatus.live })
      .select('_id name pricePerDemo')
      .lean();

    res.json(pools);
  } catch (error) {
    console.error('Error getting pools:', error);
    res.status(500).json({ error: 'Failed to get pools' });
  }
});

// Get all possible categories
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    // Aggregate to get unique categories across all apps
    const categoriesResult = await ForgeAppModel.aggregate([
      { $unwind: '$categories' },
      { $group: { _id: '$categories' } },
      { $sort: { _id: 1 } }
    ]);

    // Format the result as an array of category names
    const categories = categoriesResult.map((item) => item._id);

    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

export { router as forgeRoute };
