import mongoose from 'mongoose';
import {
  ForgeSubmissionGradeResult,
  ForgeTreasuryTransfer,
  DBForgeRaceSubmission,
  ForgeSubmissionProcessingStatus,
  WebhookColor,
  EmbedField
} from '../../types/index.ts';
import { ForgeRaceSubmission, TrainingPoolModel, ForgeAppModel } from '../../models/Models.ts';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import { spawn } from 'child_process';
import { Webhook } from '../webhook/index.ts';

const FORGE_WEBHOOK = process.env.GYM_FORGE_WEBHOOK;

// Global processing queue
let isProcessing = false;
const processingQueue: string[] = [];

export async function addToProcessingQueue(submissionId: string) {
  processingQueue.push(submissionId);
  processNextInQueue().catch(console.error);
}

export async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) return;

  isProcessing = true;
  const submissionId = processingQueue[0];
  let submission:
    | (mongoose.Document<unknown, {}, DBForgeRaceSubmission> & DBForgeRaceSubmission)
    | null = null;

  try {
    // Retry findById 3 times with 100ms delay between attempts
    let retries = 3;
    while (retries > 0) {
      try {
        submission = await ForgeRaceSubmission.findById(submissionId);
        if (submission) break;
        retries--;
        if (retries === 0) {
          throw new Error(`Submission ${submissionId} not found`);
        }
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        // Wait 100ms before retrying
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // After retries, ensure submission is not null
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found after retries`);
    }

    // Update status to processing
    submission.status = ForgeSubmissionProcessingStatus.PROCESSING;
    await submission.save();

    await notifyForgeWebhook('processing', {
      title: submission?.meta?.quest.title,
      app: submission?.meta?.quest.app,
      duration: submission.meta.duration_seconds,
      address: submission.address
    });

    // Run grading pipeline
    const extractDir = path.join('uploads', `extract_${submissionId}`);
    console.log('Running pipeline for directory:', extractDir);
    try {
      // Check if directory exists
      await fs.access(extractDir);
      console.log('Extract directory exists');

      // List directory contents
      const files = await fs.readdir(extractDir);
      console.log('Directory contents:', files);

      await new Promise<void>((resolve, reject) => {
        const process = spawn('/usr/src/app/backend/pipeline', [
          '-f',
          'desktop',
          '-i',
          extractDir,
          '--grade'
        ]);

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
          stdout += data;
          console.log('Pipeline stdout:', data.toString());
        });

        process.stderr.on('data', (data) => {
          stderr += data;
          console.error('Pipeline stderr:', data.toString());
        });

        process.on('close', (code: number) => {
          if (code === 0) {
            resolve();
          } else {
            console.error('Pipeline stdout:', stdout);
            console.error('Pipeline stderr:', stderr);
            reject(new Error(`Pipeline failed:\nstdout: ${stdout}\nstderr: ${stderr}`));
          }
        });

        process.on('error', (err) => {
          console.error('Pipeline spawn error:', err);
          reject(err);
        });
      });

      // Check if scores.json exists
      const scoresPath = path.join(extractDir, 'scores.json');
      try {
        await fs.access(scoresPath);
        console.log('scores.json exists');
      } catch (error) {
        console.error('scores.json not found:', error);
        throw new Error('scores.json not found after pipeline run');
      }

      // Read and parse scores.json
      console.log('Reading scores.json');
      const scoresContent = await fs.readFile(scoresPath, 'utf8');
      console.log('scores.json content:', scoresContent);
      const gradeResult: ForgeSubmissionGradeResult = JSON.parse(scoresContent);
      console.log('Parsed grade result:', gradeResult);

      // Get pool details and calculate reward
      let reward = undefined;
      let maxReward = undefined;
      let clampedScore = undefined;
      let treasuryTransfer: ForgeTreasuryTransfer | undefined = undefined;
      let retries = 3;

      // Get pool details if poolId exists
      console.log('Checking for poolId:', submission?.meta?.quest.pool_id);
      let pool = null;
      if (submission?.meta?.quest.pool_id) {
        console.log('Looking up pool:', submission?.meta?.quest.pool_id);
        pool = await TrainingPoolModel.findById(submission?.meta?.quest.pool_id);
        console.log('Found pool:', pool ? pool.name : 'null');
      }

      if (submission?.meta?.quest.pool_id && !pool) {
        throw new Error(`Pool not found: ${submission?.meta?.quest.pool_id}`);
      }

      if (pool) {
        console.log('Processing pool reward:', pool.name);
        while (retries > 0) {
          try {
            // Verify time is within last 5 minutes
            const now = Date.now();
            const generatedTime = submission?.meta?.quest.reward.time;
            // if (now - generatedTime > 5 * 60 * 1000) {
            //   throw new Error("Generated time expired");
            // }
            // Default maxReward is the pool's pricePerDemo
            maxReward = pool.pricePerDemo;

            // Check if the task has a rewardLimit
            if (submission?.meta?.quest.task_id) {
              const app = await ForgeAppModel.findOne({
                pool_id: pool._id.toString(),
                'tasks._id': submission?.meta?.quest.task_id
              });

              if (app) {
                const task = app.tasks.find(
                  (t) => t._id.toString() === submission?.meta?.quest.task_id
                );
                if (task?.rewardLimit) {
                  // Use the task's rewardLimit instead of the pool's pricePerDemo
                  maxReward = task.rewardLimit;
                }
              }
            }

            // Calculate final reward based on grade_result score (clamped 0-100)
            clampedScore = Math.max(0, Math.min(100, gradeResult.score));

            // Check for previous submissions with same or higher score
            const previousSubmission = await ForgeRaceSubmission.findOne({
              address: submission.address,
              'meta.quest.pool_id': pool._id.toString(),
              'meta.quest.title': submission?.meta?.quest.title,
              'grade_result.score': { $gte: gradeResult.score },
              _id: { $ne: submission._id }
            }).sort({ 'grade_result.score': -1 });

            if (previousSubmission) {
              reward = 0;
              // Add prefix to reasoning
              gradeResult.reasoning = `( system: no reward given - previous submission exists with score of ${
                previousSubmission.grade_result?.score || 0
              } ) ${gradeResult.reasoning}`;
            } else if (clampedScore < 50) {
              reward = 0;
              // Add prefix to reasoning
              gradeResult.reasoning = `( system: reward returned to pool due to <50% quality score ) ${gradeResult.reasoning}`;
            } else {
              reward = Math.max(0, Math.min(maxReward, (maxReward * clampedScore) / 100));
            }

            // Create treasury transfer record if reward exists
            if (reward && reward > 0) {
              treasuryTransfer = {
                tokenAddress: pool.token.address,
                treasuryWallet: pool.depositAddress,
                amount: reward,
                timestamp: Date.now()
              };
              console.log('Creating treasury transfer for reward:', treasuryTransfer);
              console.log('Creating treasury transfer to address:', submission.address);

              if (process.env.NODE_ENV === 'development') break;

              try {
                console.log('Attempting blockchain transfer');
                // Create keypair from private key
                const fromWallet = Keypair.fromSecretKey(
                  Buffer.from(pool.depositPrivateKey, 'base64')
                );

                // Get initial treasury balance
                const blockchainService = new (await import('../blockchain/index.js')).default(
                  process.env.RPC_URL || '',
                  '' // Program ID not needed for token transfers
                );

                const treasuryBalance = await blockchainService.getTokenBalance(
                  pool.token.address,
                  pool.depositAddress
                );
                console.log('Initial treasury balance:', treasuryBalance);

                // Attempt blockchain transfer
                const result = await blockchainService.transferToken(
                  pool.token.address,
                  reward,
                  fromWallet,
                  submission.address
                );

                if (result && treasuryTransfer) {
                  treasuryTransfer.txHash = result.signature;
                }

                // Get final treasury balance
                const finalBalance = await blockchainService.getTokenBalance(
                  pool.token.address,
                  pool.depositAddress
                );
                console.log('Final treasury balance:', finalBalance);

                // Include pool info in webhook
                const poolInfo = {
                  name: pool.name,
                  token: pool.token,
                  treasuryBalance: finalBalance
                };

                await notifyForgeWebhook('success', {
                  title: submission?.meta?.quest.title,
                  app: submission?.meta?.quest.app,
                  duration: submission.meta.duration_seconds,
                  score: gradeResult.score,
                  reward,
                  maxReward,
                  clampedScore,
                  summary: gradeResult.summary,
                  feedback: gradeResult.reasoning,
                  treasuryTransfer,
                  address: submission.address,
                  pool: poolInfo
                });
              } catch (error) {
                console.error('Treasury transfer failed:', error);
                // Continue processing but log the error
                await notifyForgeWebhook('transfer-error', {
                  title: submission?.meta?.quest.title,
                  reward,
                  error: (error as Error).message,
                  address: submission.address,
                  pool: {
                    name: pool.name,
                    token: pool.token
                  }
                });
              }
            }

            break; // Exit retry loop if successful
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error('Failed to calculate reward:', error);
            } else {
              // Wait 1 second before retrying
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }
      }

      submission.grade_result = gradeResult;
      submission.reward = reward;
      submission.maxReward = maxReward;
      submission.clampedScore = clampedScore;
      submission.treasuryTransfer = treasuryTransfer;
      submission.status = ForgeSubmissionProcessingStatus.COMPLETED;
      await submission.save();

      // Always send a webhook notification for successful processing, even if there was no reward
      // Only send if it wasn't already sent during the reward processing
      if (!reward || reward === 0 || !treasuryTransfer) {
        await notifyForgeWebhook('success', {
          title: submission?.meta?.quest.title,
          app: submission?.meta?.quest.app,
          duration: submission.meta.duration_seconds,
          score: gradeResult.score,
          reward: reward || 0,
          maxReward: maxReward || 0,
          clampedScore: clampedScore || 0,
          summary: gradeResult.summary,
          feedback: gradeResult.reasoning,
          address: submission.address,
          pool: pool
            ? {
                name: pool.name,
                token: pool.token
              }
            : undefined
        });
      }
    } catch (error) {
      throw new Error(`Failed to process submission: ${(error as Error).message}`);
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    // Update submission with error
    await ForgeRaceSubmission.findByIdAndUpdate(submissionId, {
      status: ForgeSubmissionProcessingStatus.FAILED,
      error: errorMessage
    });

    await notifyForgeWebhook('error', {
      error: errorMessage,
      address: submission?.address
    });
  } finally {
    // Remove from queue and reset processing flag
    processingQueue.shift();
    isProcessing = false;

    // Process next item if available
    if (processingQueue.length > 0) {
      processNextInQueue().catch(console.error);
    }
  }
}

/**
 * Send a notification to the forge webhook
 */
async function notifyForgeWebhook(
  type: 'processing' | 'success' | 'transfer-error' | 'error',
  data: {
    title?: string;
    app?: string;
    duration?: number;
    score?: number;
    reward?: number;
    maxReward?: number;
    clampedScore?: number;
    summary?: string;
    feedback?: string;
    error?: string;
    treasuryTransfer?: ForgeTreasuryTransfer;
    address?: string;
    pool?: {
      name: string;
      token: {
        symbol: string;
        address: string;
      };
      treasuryBalance?: number;
    };
  }
) {
  if (!FORGE_WEBHOOK) return;
  const webhook = new Webhook(FORGE_WEBHOOK);

  try {
    // Prepare fields based on available data
    const fields: EmbedField[] = [];

    if (data.title) {
      fields.push({
        name: '📝 Task',
        value: data.title,
        inline: true
      });
    }

    if (data.app) {
      fields.push({
        name: '🖥️ App',
        value: data.app,
        inline: true
      });
    }

    if (data.duration) {
      fields.push({
        name: '⏱️ Duration',
        value: `${data.duration}s`,
        inline: true
      });
    }

    if (data.address) {
      fields.push({
        name: '👤 Submitter',
        value: `[${data.address.slice(0, 4)}...${data.address.slice(
          -4
        )}](https://solscan.io/account/${data.address})`,
        inline: true
      });
    }

    if (data.score !== undefined) {
      fields.push({
        name: '📊 Score',
        value: `${data.score}/100 ${data.score >= 80 ? '🏆' : '📝'}`,
        inline: true
      });
    }

    if (data.reward !== undefined && data.maxReward) {
      fields.push({
        name: '💎 Reward',
        value: `${data.reward.toFixed(2)} ${data.pool?.token.symbol || '$VIRAL'} (${
          data.clampedScore
        }% of ${data.maxReward.toFixed(2)})`,
        inline: true
      });
    }

    if (data.pool) {
      fields.push({
        name: '🏦 Pool',
        value: `${data.pool.name}\n${data.pool.token.symbol} ([${data.pool.token.address.slice(
          0,
          4
        )}...${data.pool.token.address.slice(-4)}](https://solscan.io/token/${
          data.pool.token.address
        }))`,
        inline: true
      });

      if (data.pool.treasuryBalance !== undefined) {
        fields.push({
          name: '💰 Treasury Balance',
          value: `${data.pool.treasuryBalance.toLocaleString()} ${data.pool.token.symbol}`,
          inline: true
        });
      }
    }

    if (data.treasuryTransfer?.txHash) {
      fields.push({
        name: '🔗 Transaction',
        value: `[View on Solscan](https://solscan.io/tx/${data.treasuryTransfer.txHash})`,
        inline: true
      });
    }

    if (data.summary) {
      fields.push({
        name: '📋 Summary',
        value: data.summary,
        inline: false
      });
    }

    if (data.feedback) {
      fields.push({
        name: '💭 Feedback',
        value: data.feedback,
        inline: false
      });
    }

    if (data.error) {
      fields.push({
        name: '❌ Error',
        value: `\`\`\`${data.error}\`\`\``,
        inline: false
      });
    }

    // Determine title and color based on type
    let title = '';
    let color = WebhookColor.INFO;

    switch (type) {
      case 'processing':
        title = '🎯 Processing New Submission';
        color = WebhookColor.INFO;
        break;
      case 'success':
        title = '✨ Submission Graded Successfully';
        color = WebhookColor.SUCCESS;
        break;
      case 'transfer-error':
        title = '⚠️ Treasury Transfer Failed';
        color = WebhookColor.WARNING;
        break;
      case 'error':
        title = '❌ Submission Processing Failed';
        color = WebhookColor.ERROR;
        break;
    }

    // Send webhook using the webhook service
    await webhook.sendEmbed({
      title,
      fields,
      color
    });
  } catch (error) {
    console.error('Error sending forge webhook:', error);
  }
}
