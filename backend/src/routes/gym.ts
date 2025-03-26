import express, { Request, Response } from 'express';
import DatabaseService from '../services/db/index.ts';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { TrainingEventModel } from '../models/TrainingEvent.ts';
import { ChatCompletionContentPartImage } from 'openai/resources/index.mjs';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Track sessions with hint generation in progress
const generatingHints = new Set<string>();

// Cache to store generated instruction lists
const cacheExpiryMs = 2 * 60 * 60 * 1000;
const instructionCache = new Map<
  string,
  {
    instructions: string[];
    timestamp: number;
    expiryMs: number;
  }
>();

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
        expiryMs: cacheExpiryMs
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

// Function to clear expired cache entries
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of instructionCache.entries()) {
    if (now - value.timestamp >= value.expiryMs) {
      instructionCache.delete(key);
    }
  }
}

// Clean up cache periodically (every hour)
setInterval(cleanupCache, 60 * 60 * 1000);

async function generateQuest(
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

const router = express.Router();

// Request a quest/hint
router.post('/quest', async (req: Request, res: Response) => {
  try {
    const { address, prompt, installed_applications } = req.body;
    const screenshot = ''; // TODO: remove

    if (!address || !prompt) {
      res.status(400).json({ error: 'address and prompt are required' });
      return;
    }

    // Create or get session
    let session = await DatabaseService.getGymSession(address);
    if (!session) {
      const newSession = await DatabaseService.createGymSession({
        address,
        status: 'active' as const,
        created_at: new Date(),
        updated_at: new Date()
      });

      if (!newSession) {
        res.status(500).json({ error: 'Failed to create session' });
        return;
      }

      session = newSession;
    }

    const sessionId = session._id?.toString();
    if (!sessionId) {
      res.status(500).json({ error: 'Invalid session ID' });
      return;
    }

    // Store latest screenshot in session metadata
    await DatabaseService.updateGymSession(sessionId, {
      preview: screenshot,
      updated_at: new Date()
    });

    // Get current quest from latest quest event
    const latestQuestEvent = await TrainingEventModel.findOne(
      { session: sessionId, type: 'quest' },
      {},
      { sort: { timestamp: -1 } }
    ).lean();

    // Get hint history
    const hintEvents = await TrainingEventModel.find(
      { session: sessionId, type: 'hint' },
      { message: 1 },
      { sort: { timestamp: -1 }, limit: 3 }
    ).lean();
    const hintHistory = hintEvents.map((e) => e.message);

    const questData = await generateQuest(
      screenshot,
      installed_applications || '',
      prompt,
      sessionId
    );

    res.json(questData);
  } catch (error) {
    console.error('Error handling quest/hint request:', error);
    res.status(500).json({ error: 'Failed to handle quest/hint request' });
  }
});

// Check quest progress based on recent screenshots
router.post('/progress', async (req: Request, res: Response) => {
  try {
    const { quest, screenshots } = req.body;
    console.log('CHECKING PROGRESS');
    if (!screenshots || !Array.isArray(screenshots) || screenshots.length === 0) {
      res.status(400).json({ error: 'screenshots array is required' });
      return;
    }

    if (!quest || !quest.subgoals || !Array.isArray(quest.subgoals)) {
      res.status(400).json({ error: 'valid quest object with subgoals is required' });
      return;
    }

    // Take up to last 5 screenshots
    const recentScreenshots = screenshots.slice(-5);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze the recent desktop screenshots and determine which of the following subgoals have been completed:

${quest.subgoals.map((goal: string, i: number) => `${i + 1}. ${goal}`).join('\n')}

Return a JSON array of booleans indicating which subgoals are complete.
Example: [true, false, true] means subgoals 1 and 3 are completed, but 2 is not.

Base your analysis on visual evidence from the screenshots showing completed actions.`
            },
            ...recentScreenshots.map(
              (screenshot) =>
                ({
                  type: 'image_url',
                  image_url: { url: screenshot as string }
                } as ChatCompletionContentPartImage)
            )
          ]
        }
      ]
    });

    const content = response.choices[0].message.content;
    console.log(content);

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Try to parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No valid JSON array found in response');
    }

    const completed_subgoals = JSON.parse(jsonMatch[0]);

    // Count completed objectives
    const completed_objectives = completed_subgoals.filter((complete: boolean) => complete).length;

    res.json({
      completed_subgoals,
      completed_objectives
    });
  } catch (error) {
    console.error('Error checking progress:', error);
    res.status(500).json({ error: 'Failed to check progress' });
  }
});

export { router as gymRoute };
