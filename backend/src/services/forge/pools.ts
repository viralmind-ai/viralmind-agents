import OpenAI from 'openai';
import { ForgeAppModel, TrainingPoolModel } from '../../models/Models.ts';
import { DBTrainingPool, TrainingPoolStatus } from '../../types/index.ts';
import BlockchainService from '../blockchain/index.ts';
import { Webhook } from '../webhook/index.ts';
import { APP_TASK_GENERATION_PROMPT } from './prompts.ts';
import { Document, Types } from 'mongoose';
import { sendEmail } from '../email/index.ts';

// setup the pool refresher
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');
const BALANCE_REFRESH_INTERVAL = 30 * 1000; // 30 seconds
// set up the discord webhook
const FORGE_WEBHOOK = process.env.GYM_FORGE_WEBHOOK;
const webhook = new Webhook(FORGE_WEBHOOK);

// setup llm globals
const activeGenerations = new Map<string, Promise<void>>();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
let refreshInterval: NodeJS.Timeout;

export function stopRefreshInterval() {
  clearInterval(refreshInterval);
}

export function startRefreshInterval() {
  refreshInterval = setInterval(async () => {
    try {
      // Get all pools
      const pools = await TrainingPoolModel.find();

      // Process pools in batches to avoid too many concurrent blockchain calls
      const batchSize = 5;
      for (let i = 0; i < pools.length; i += batchSize) {
        const batch = pools.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (pool) => {
            try {
              await updatePoolStatus(pool);
            } catch (error) {
              console.error(`Error refreshing pool ${pool._id}:`, error);
            }
          })
        );

        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < pools.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error('Error in periodic pool balance refresh:', error);
    }
  }, BALANCE_REFRESH_INTERVAL);
}

// Generate apps for a pool
export async function generateAppsForPool(poolId: string, skills: string): Promise<void> {
  // Cancel any existing generation for this pool
  const existingPromise = activeGenerations.get(poolId);
  if (existingPromise) {
    console.log(`Canceling existing app generation for pool ${poolId}`);
    await webhook.sendText(`🔄 Canceling existing app generation for pool ${poolId}`);
    // Let the existing promise continue but we'll ignore its results
    activeGenerations.delete(poolId);
  }

  // Start new generation
  let generationPromise: Promise<void>;
  generationPromise = (async () => {
    const pool = await TrainingPoolModel.findById(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    await webhook.sendText(
      `🎬 Starting app generation for pool "${pool.name}" (${poolId})\nSkills: ${skills}`
    );
    try {
      // Delete existing apps for this pool
      await ForgeAppModel.deleteMany({ pool_id: poolId });

      // Generate new apps using OpenAI
      const prompt = APP_TASK_GENERATION_PROMPT.replace('{skill list}', skills);
      const response = await openai.chat.completions.create({
        model: 'o3-mini',
        reasoning_effort: 'medium',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      } as any); // Type assertion to handle custom model params

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      // Only proceed if this is still the active generation
      // @ts-ignore
      if (activeGenerations.get(poolId) === generationPromise) {
        // Parse content from response
        const generatedContent = JSON.parse(content);

        // Extract apps from the new format (object with name and apps array)
        const collectionName = generatedContent.name || 'Generated Gym';
        const apps = generatedContent.apps || [];

        // Store new apps
        for (const app of apps) {
          await ForgeAppModel.create({
            ...app,
            pool_id: poolId
          });
        }
        console.log(`Successfully generated apps for pool ${poolId}`);
        await webhook.sendText(
          `✅ Generated ${apps.length} apps for gym "${collectionName}" in pool "${
            pool.name
          }" (${poolId})\n${apps.map((a: { name: string }) => `- ${a.name}`).join('\n')}`
        );
      } else {
        console.log(`App generation was superseded for pool ${poolId}`);
      }
    } catch (error) {
      const err = error as Error;
      console.error('Error generating apps:', err);
      await webhook.sendText(`❌ Error generating apps for pool ${poolId}: ${err.message}`);
      throw err;
    } finally {
      // Clean up if this is still the active generation
      // @ts-ignore
      if (activeGenerations.get(poolId) === generationPromise) {
        activeGenerations.delete(poolId);
      }
    }
  })();

  // Store the promise
  activeGenerations.set(poolId, generationPromise);

  return generationPromise;
}

export async function updatePoolStatus(
  pool: Document<unknown, {}, DBTrainingPool> &
    DBTrainingPool &
    Required<{ _id: Types.ObjectId }> & { __v: number }
) {
  const balance = await blockchainService.getTokenBalance(pool.token.address, pool.depositAddress);
  const solBalance = await blockchainService.getSolBalance(pool.depositAddress);
  const noGas = solBalance <= BlockchainService.MIN_SOL_BALANCE;
  let statusChanged = false;
  if (process.env.NODE_ENV != 'development') {
    // Update pool funds
    pool.funds = balance;
    if (noGas) {
      // pool has no SOL
      if (pool.status !== TrainingPoolStatus.noGas) {
        pool.status = TrainingPoolStatus.noGas;
        statusChanged = true;
      }
    } else if (balance === 0 || balance < pool.pricePerDemo) {
      // pool has no $VIRAL
      if (pool.status !== TrainingPoolStatus.noFunds) {
        pool.status = TrainingPoolStatus.noFunds;
        statusChanged = true;
      }
    } else if (
      pool.status === TrainingPoolStatus.noFunds ||
      pool.status === TrainingPoolStatus.noGas
    ) {
      // pool has been funded, re-enable it
      pool.status = TrainingPoolStatus.paused;
      statusChanged = true;
    }
  }
  await pool.save();
  if (statusChanged && pool.ownerEmail) {
    if (pool.status === TrainingPoolStatus.noGas) {
      sendEmail({
        to: pool.ownerEmail,
        subject: `Viralmind Forge '${pool.name}' Out of Gas`,
        text: `The wallet for your forge ${pool.name} does not have enough SOL to pay the gas for $VIRAL transactions.\nPlease send some SOL to your forge via the Viralmind App.\n\nThank you for contributing to open computer use data!\n - The Viralmind Team`
      }).catch((e) => {
        console.log(e);
      });
    } else if (pool.status === TrainingPoolStatus.noFunds) {
      sendEmail({
        to: pool.ownerEmail,
        subject: `Viralmind Forge '${pool.name}' Out of Funds`,
        text: `The wallet for your forge ${pool.name} does not have enough $VIRAL to send rewards for successful task completions.\nPlease deposit more $VIRAL to your forge via the Viralmind App.\n\nThank you for contributing to open computer use data!\n - The Viralmind Team`
      }).catch((e) => {
        console.log(e);
      });
    } else if (pool.status === TrainingPoolStatus.paused) {
      sendEmail({
        to: pool.ownerEmail,
        subject: `Viralmind Forge '${pool.name}' Successfully Funded`,
        text: `The wallet for your forge ${pool.name} has been successfully funded. Your tasks will now appear in the desktop app.\n\nThank you for contributing to open computer use data!\n - The Viralmind Team`
      }).catch((e) => {
        console.log(e);
      });
    }
  }
  return { solBalance, funds: balance, status: pool.status };
}
