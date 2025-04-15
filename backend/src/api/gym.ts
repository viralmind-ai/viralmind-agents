import express, { Request, Response } from 'express';
import DatabaseService from '../services/db/index.ts';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { TrainingEventModel } from '../models/TrainingEvent.ts';
import { ChatCompletionContentPartImage } from 'openai/resources/index.mjs';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { validateBody } from '../middleware/validator.ts';
import { questRequestSchema, progressCheckSchema } from './schemas/gym.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import { generateDesktopQuest, getLeaderboardData } from '../services/gym/gym.ts';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Clean up cache periodically (every hour)

const router = express.Router();

// Request a quest/hint
router.post(
  '/quest',
  validateBody(questRequestSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { address, prompt, installed_applications } = req.body;
    const screenshot = ''; // TODO: remove

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
        throw ApiError.internalError('Failed to create session');
      }

      session = newSession;
    }

    const sessionId = session._id?.toString();
    if (!sessionId) {
      throw ApiError.internalError('Invalid session ID');
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

    const questData = await generateDesktopQuest(
      screenshot,
      installed_applications || '',
      prompt,
      sessionId
    );

    return res.status(200).json(successResponse(questData));
  })
);

// Check quest progress based on recent screenshots
router.post(
  '/progress',
  validateBody(progressCheckSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { quest, screenshots } = req.body;
    console.log('CHECKING PROGRESS');

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
              (screenshot: string) =>
                ({
                  type: 'image_url',
                  image_url: { url: screenshot }
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

    return res.status(200).json(
      successResponse({
        completed_subgoals,
        completed_objectives
      })
    );
  })
);

router.get(
  '/leaderboards',
  errorHandlerAsync(async (_req, res) => {
    const data = await getLeaderboardData();
    return res.status(200).json(successResponse(data));
  })
);

export { router as gymApi };
