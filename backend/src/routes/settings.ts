import express, { Request, Response } from 'express';
import DatabaseService from '../services/db/index.ts';
import BlockcahinService from '../services/blockchain/index.ts';
const router = express.Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const challenges = await DatabaseService.getSettings();
    const pages = await DatabaseService.getPages({});
    const endpoints = pages?.find((page) => page.name === 'api-endpoints')?.content?.endpoints;
    const faq = pages?.find((page) => page.name === 'faq')?.content?.faq;
    const jailToken = pages?.find((page) => page.name === 'viral-token')?.content;

    const solPrice = await BlockcahinService.getSolPriceInUSDT();

    // Get active/upcoming challenge
    const display_conditions = ['active', 'upcoming'];
    let activeChallenge = challenges?.find((challenge) =>
      display_conditions.includes(challenge.status)
    );

    // Add prize calculation to active challenge if it exists
    if (activeChallenge) {
      const prize = activeChallenge.winning_prize || activeChallenge.entryFee! * 100;
      const usdPrize = prize * solPrice;
      activeChallenge = {
        //@ts-ignore
        ...activeChallenge.toObject(),
        prize,
        usdPrize
      };
    }

    // Get concluded challenges, sorted by most recent first
    const concludedChallenges = challenges
      ?.filter((challenge) => challenge.status === 'concluded')
      .sort((a, b) => new Date(b.expiry!).getTime() - new Date(a.expiry!).getTime())
      .map((challenge) => {
        const plainChallenge = challenge;
        const prize = plainChallenge.winning_prize || plainChallenge.entryFee! * 100;
        const usdPrize = prize * solPrice;
        return {
          ...plainChallenge,
          prize,
          usdPrize
        };
      });

    const totalWinningPrize = challenges
      ?.filter((challenge) => challenge.winning_prize)
      .map((challenge) => {
        const treasury = challenge.winning_prize! * (challenge.developer_fee! / 100);
        const total_payout = challenge.winning_prize! - treasury;

        return {
          treasury: treasury * solPrice,
          total_payout: total_payout * solPrice
        };
      });

    const totalTreasury = totalWinningPrize?.reduce((acc, item) => acc + item.treasury, 0);
    const totalPayout = totalWinningPrize?.reduce((acc, item) => acc + item.total_payout, 0);

    const breakAttempts = await DatabaseService.getChatCount({ role: 'user' });
    const response = {
      endpoints: endpoints,
      faq: faq,
      challenges: challenges,
      jailToken: jailToken,
      activeChallenge: activeChallenge,
      concludedChallenges: concludedChallenges,
      treasury: totalTreasury,
      total_payout: totalPayout,
      breakAttempts: breakAttempts,
      solPrice: solPrice
    };

    res.send(response);
  } catch (error) {
    console.log('Error fetching settings:', error);
    res.status(500).send({ error: 'Failed to fetch settings' });
  }
});

export { router as settingsRoute };
