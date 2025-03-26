import OpenAI from 'openai';
import { ForgeAppModel, TrainingPoolModel } from '../../models/Models.ts';
import { TrainingPoolStatus } from '../../types/index.ts';
import BlockchainService from '../blockchain/index.ts';
import { Webhook } from '../webhook/index.ts';
import { APP_TASK_GENERATION_PROMPT } from './prompts.ts';

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
      // Get all live and paused pools
      const pools = await TrainingPoolModel.find({
        status: { $in: [TrainingPoolStatus.live, TrainingPoolStatus.paused] }
      });

      // Process pools in batches to avoid too many concurrent blockchain calls
      const batchSize = 5;
      for (let i = 0; i < pools.length; i += batchSize) {
        const batch = pools.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (pool) => {
            try {
              // Get current token balance from blockchain
              const balance = await blockchainService.getTokenBalance(
                pool.token.address,
                pool.depositAddress
              );

              // Get SOL balance to check for gas
              const solBalance = await blockchainService.getSolBalance(pool.depositAddress);
              const noGas = solBalance === 0;

              // Update pool funds
              let statusChanged = false;
              if (pool.funds !== balance) {
                pool.funds = balance;
                statusChanged = true;
              }

              // Update status based on token and SOL balances
              if (process.env.NODE_ENV != 'development') {
                if (noGas) {
                  if (pool.status !== TrainingPoolStatus.noGas) {
                    pool.status = TrainingPoolStatus.noGas;
                    statusChanged = true;
                  }
                } else if (balance === 0 || balance < pool.pricePerDemo) {
                  if (pool.status !== TrainingPoolStatus.noFunds) {
                    pool.status = TrainingPoolStatus.noFunds;
                    statusChanged = true;
                  }
                } else if (
                  pool.status === TrainingPoolStatus.noFunds ||
                  pool.status === TrainingPoolStatus.noGas
                ) {
                  pool.status = TrainingPoolStatus.paused;
                  statusChanged = true;
                }
              }

              if (statusChanged) {
                await pool.save();
                console.log(
                  `Updated pool ${pool._id} balance to ${balance} and status to ${pool.status}`
                );
              }
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
