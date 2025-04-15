import { randomBytes } from 'node:crypto';
import OpenAI from 'openai';
import { ForgeRaceSubmission, TrainingPoolModel } from '../../models/Models.ts';
import { TrainingPoolStatus } from '../../types/index.ts';

// Cache to store generated instruction lists
const CACHE_EXPIRY = 2 * 60 * 60 * 1000;
const instructionCache = new Map<
  string,
  {
    instructions: string[];
    timestamp: number;
    expiryMs: number;
  }
>();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let cleanupCache: NodeJS.Timeout;

export function startCacheInterval() {
  cleanupCache = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of instructionCache.entries()) {
      if (now - value.timestamp >= value.expiryMs) {
        instructionCache.delete(key);
      }
    }
  }, 60 * 60 * 1000);
}

export function stopCacheInterval() {
  clearInterval(cleanupCache);
}

export async function generateDesktopQuest(
  imageUrl: string,
  installed_applications: string,
  pool_prompt: string,
  sessionId: string
) {
  try {
    // First generate instruction list from pool prompt
    const instructions = await generateInstructionList(pool_prompt);

    // Select random instruction
    const randomIndex = Math.floor(Math.random() * instructions.length);
    const selectedInstruction = instructions[randomIndex];

    const response = await openai.chat.completions.create({
      model: 'o3-mini',
      //@ts-ignore: ignore the error here -- it's defined in the documention, not sure why the types are broken
      reasoning_effort: 'medium',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `DESKTOP TASK GENERATION PROMPT
Convert abstract computer usage instructions into concrete, reproducible scenarios.

INPUT:
1. INSTALLED_APPLICATIONS: ${installed_applications}
2. INSTRUCTION: ${selectedInstruction}

OUTPUT:
{
   "task_id": "unique_identifier", 
   "title": "3-4 word action summary",
   "original_instruction": "Raw instruction text",
   "concrete_scenario": "Specific context using real-world examples",
   "objective": "One sentence with specific terms (no words like 'current' or 'this')",
   "relevant_applications": ["Only apps from INSTALLED_APPLICATIONS"],
   "subgoals": [
       "Concise, specific steps",
       "No obvious explanations",
       "No UI element descriptions unless ambiguous"
   ]
}

RULES:
- Keep subgoals brief and clear
- For web tasks, use real websites in these categories:

HEALTH & MEDICAL:
- Reference: drugs.com, webmd.com, mayoclinic.org, medlineplus.gov
- Insurance: uhc.com, cigna.com, anthem.com, aetna.com
- Pharmacy: cvs.com, walgreens.com, riteaid.com
- Telemedicine: teladoc.com, doctor-on-demand.com, mdlive.com

TRAVEL:
- Airlines: delta.com, united.com, aa.com, southwest.com
- Hotels: marriott.com, hilton.com, ihg.com
- Booking: expedia.com, kayak.com, booking.com
- Car Rental: enterprise.com, hertz.com, avis.com

SHOPPING:
- General: amazon.com, walmart.com, target.com, ebay.com
- Electronics: bestbuy.com, newegg.com
- Fashion: nordstrom.com, macys.com, zara.com
- Home: wayfair.com, ikea.com, homedepot.com
- Pet: chewy.com, petco.com, petsmart.com

FOOD:
- Delivery: doordash.com, ubereats.com, grubhub.com
- Grocery: instacart.com, freshdirect.com, walmart.com/grocery
- Restaurant Booking: opentable.com, resy.com
- Recipe: allrecipes.com, foodnetwork.com, epicurious.com

ENTERTAINMENT:
- Streaming: netflix.com, hulu.com, disney.com, hbomax.com
- Music: spotify.com, pandora.com, apple.com/music
- Gaming: steam.com, epicgames.com, xbox.com
- Events: ticketmaster.com, stubhub.com, eventbrite.com

SOCIAL/COMMUNICATION:
- Social: facebook.com, instagram.com, twitter.com, linkedin.com
- Video: youtube.com, vimeo.com, twitch.tv
- Email: gmail.com, outlook.com, yahoo.com
- Chat: whatsapp.com, telegram.org, discord.com

PRODUCTIVITY:
- Work: slack.com, zoom.us, microsoft365.com, webex.com
- Cloud: dropbox.com, drive.google.com, box.com
- Documents: docs.google.com, office.com
- Notes: evernote.com, notion.so, onenote.com

INFORMATION:
- News: cnn.com, bbc.com, reuters.com, apnews.com
- Reference: wikipedia.org, stackoverflow.com, quora.com
- Weather: weather.com, accuweather.com, wunderground.com
- Maps: google.com/maps, waze.com, openstreetmap.org
- Education: coursera.org, udemy.com, khanacademy.org

FINANCE:
- Banking: chase.com, bankofamerica.com, wellsfargo.com
- Investment: fidelity.com, vanguard.com, schwab.com
- Payment: paypal.com, venmo.com, cashapp.com
- Crypto: coinbase.com, binance.com
- Tax: turbotax.com, hrblock.com

GOVERNMENT & UTILITIES:
- Government: irs.gov, ssa.gov, usps.com
- Utilities: pay bills via local utility websites
- DMV: dmv.org and state-specific DMV sites
- Benefits: benefits.gov, medicare.gov

RULES:
- No made-up or hypothetical URLs
- No referential terms ('current', 'this', 'desired')
- Only use applications from input list
- Each step must be independently actionable
- Skip obvious explanations
- Focus on key actions`
            }
            // {
            //   type: 'image_url',
            //   image_url: { url: imageUrl }
            // }
          ]
        }
      ]
      // max_tokens: 500
    });

    const jsonMatch = response.choices[0].message.content?.match(/{[\s\S]*}/);
    if (jsonMatch && jsonMatch[0]) {
      const questData = JSON.parse(jsonMatch[0]);
      return questData;
    }

    throw new Error('No valid JSON found in response');
  } catch (error) {
    if ((error as Error).message.includes('Invalid MIME type')) {
      console.log(
        'Error generating quest: Invalid MIME type. Likely tried to send an empty frame.'
      );
    } else {
      console.error('Error generating quest:', error);
    }

    return {
      task_id: randomBytes(16).toString('hex'),
      title: 'Generic Desktop Task',
      original_instruction: 'Generate fallback task',
      concrete_scenario: 'Complete a basic computer operation',
      objective: 'Perform a simple task using available applications',
      relevant_applications: [],
      subgoals: ['Open an application', 'Complete basic operation']
    };
  }
}

// Meta prompt to turn a training-pool prompt into a json list of instruction
async function generateInstructionList(pool_prompt: string): Promise<string[]> {
  try {
    // Generate cache key from pool prompt
    const cacheKey = Buffer.from(pool_prompt).toString('base64');

    // Check cache
    const cached = instructionCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < cached.expiryMs) {
      console.log('Using cached instructions');
      return cached.instructions;
    }

    const system_prompt = `You are an AI assistant that converts high-level skills and subtasks into natural user instructions. Your task is to:

1. For each skill/subtask in the input, generate 3-5 different ways a user might ask for help with that specific task
2. Maintain the exact context and terminology from the input skills - if a skill mentions specific software, features, or processes, include those details
3. Write instructions as if a user is asking a desktop assistant for help (e.g. "Could you help me...", "Can you show me how to...")
4. Keep the original meaning and intent of each skill while varying the phrasing
5. Output the instructions as a JSON array of strings
6. Focus on tasks that could be accomplished through a computer interface
7. Write as if the user is asking an assistant to help them configure these tools
8. Include realistic details that a crypto/Telegram community admin would care about
9. Maintain consistent context across related tasks
10. Format each instruction as a request for computer assistance

Pool prompt to convert:
${pool_prompt}

Generate a JSON array of natural user instructions based on the skills and sub-skills in this pool prompt. Each instruction should be a string representing a realistic user request.

The output should follow this format:
[
  "Can you help me change the default search engine to Bing?",
  "Please help me clear my browsing history and remove tracking cookies",
  "I accidentally closed an important tab, can you help me get it back?",
  ...
]

Remember to:
- Phrase instructions conversationally
- Vary the language and word choice
- Include specific details where appropriate
- Keep instructions realistic and natural
- Focus on common user tasks
- Avoid technical jargon unless necessary
- Make instructions actionable and clear`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: system_prompt
        }
      ]
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Try to parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch && jsonMatch[0]) {
      const instructions = JSON.parse(jsonMatch[0]);
      console.log(instructions);

      // Cache the results
      instructionCache.set(cacheKey, {
        instructions,
        timestamp: now,
        expiryMs: CACHE_EXPIRY
      });

      return instructions;
    }
    // Fallback: split pool prompt into lines and filter empty lines
    const lines = pool_prompt
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('-') && !line.startsWith('#'));

    return lines;
  } catch (error) {
    console.error('Error generating instruction list:', error);
    // Fallback: split pool prompt into lines
    const lines = pool_prompt
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('-') && !line.startsWith('#'));
    return lines;
  }
}

/**
 * Get leaderboard and stats information
 * @returns Object containing forge leaderboard, worker leaderboard, and overall stats
 */
export async function getLeaderboardData() {
  // Get worker leaderboard
  const workerLeaderboardData: {
    address: string;
    tasks: number;
    rewards: number;
    nickname?: string;
  }[] = await ForgeRaceSubmission.aggregate([
    { $match: { status: 'completed', reward: { $exists: true, $gt: 0 } } },
    {
      $group: {
        _id: '$address',
        tasks: { $sum: 1 },
        rewards: { $sum: '$reward' }
      }
    },
    {
      $lookup: {
        from: 'wallet_connections',
        localField: '_id',
        foreignField: 'address',
        as: 'walletConnection'
      }
    },
    { $sort: { rewards: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        address: '$_id',
        tasks: 1,
        rewards: 1,
        nickname: { $arrayElemAt: ['$walletConnection.nickname', 0] }
      }
    }
  ]);

  // Add rank and nickname to worker leaderboard
  const workerLeaderboard = workerLeaderboardData.map((worker, index) => ({
    rank: index + 1,
    address: worker.address,
    nickname: worker.nickname || '', // Nickname is optional
    tasks: worker.tasks,
    rewards: worker.rewards
  }));

  // Get forge leaderboard - convert string pool_id to ObjectId
  const forgeLeaderboardData = await ForgeRaceSubmission.aggregate([
    {
      $match: {
        status: 'completed',
        reward: { $exists: true, $gt: 0 },
        'meta.quest.pool_id': { $exists: true }
      }
    },
    {
      $group: {
        _id: { $toObjectId: '$meta.quest.pool_id' }, // Convert string to ObjectId
        tasks: { $sum: 1 },
        payout: { $sum: '$reward' }
      }
    },
    {
      $lookup: {
        from: 'training_pools',
        localField: '_id',
        foreignField: '_id',
        as: 'pool'
      }
    },
    { $unwind: { path: '$pool', preserveNullAndEmptyArrays: true } },
    { $sort: { tasks: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        name: { $ifNull: ['$pool.name', 'Unknown Pool'] }, // Handle missing pool
        tasks: 1,
        payout: 1
      }
    }
  ]);

  // Add rank to forge leaderboard
  const forgeLeaderboard = forgeLeaderboardData.map((forge, index) => ({
    rank: index + 1,
    name: forge.name,
    tasks: forge.tasks,
    payout: forge.payout
  }));

  // Get overall stats

  const totalWorkersResult = await ForgeRaceSubmission.aggregate([
    { $group: { _id: '$address' } },
    { $count: 'total' }
  ]);

  const totalWorkers = totalWorkersResult.length > 0 ? totalWorkersResult[0].total : 0;

  const tasksStats = await ForgeRaceSubmission.aggregate([
    { $match: { status: 'completed' } },
    {
      $group: {
        _id: null,
        tasksCompleted: { $sum: 1 },
        totalRewards: { $sum: '$reward' }
      }
    }
  ]);

  const tasksCompleted = tasksStats.length > 0 ? tasksStats[0].tasksCompleted : 0;
  const totalRewards = tasksStats.length > 0 ? tasksStats[0].totalRewards : 0;

  const activeForges = await TrainingPoolModel.countDocuments({
    status: TrainingPoolStatus.live
  });

  // Compile final result
  return {
    forgeLeaderboard,
    workersLeaderboard: workerLeaderboard,
    stats: {
      totalWorkers,
      tasksCompleted,
      totalRewards,
      activeForges
    }
  };
}
