import getSolPriceInUSDT from "../../hooks/solPrice.js";
import DatabaseService from '../db/index.js';
import BlockchainService from '../blockchain/index.js';
import axios from 'axios';

class TournamentService {
  constructor() {
    this.solanaRpc = process.env.RPC_URL;
  }

  // validate
  async validateChallenge(challenge) {
    if (!challenge)
      throw new Error("Challenge not found");

    if (challenge.status === "upcoming")
      throw new Error(`Tournament starts in ${challenge.start_date}`);
    if (challenge.status === "concluded")
      throw new Error("Tournament has already concluded");
    if (challenge.status != "active")
      throw new Error("Tournament is not active");

    if (!challenge.idl?.address)
      throw new Error("Program ID not found");
    if (!challenge.tournamentPDA)
      throw new Error("Tournament PDA not found");
    if (!challenge.system_message)
      throw new Error("System prompt not found");
  }

  /**
 * Retrieves the current tournament scores and rankings.
 * 
 * @returns {Promise<Array<Object>|null>} An array of score objects if successful, null if failed.
 * Each score object contains:
 * @property {string} account - The participant's account address
 * @property {number} score - Total points accumulated
 * @property {Array<Object>} engagements - List of all tweet engagements
 * @property {string} engagements[].tweet_id - ID of the engaged tweet
 * @property {string} engagements[].type - Type of engagement (like/retweet/reply/quote)
 * @property {number} engagements[].points - Points earned from this engagement
 * @property {string} engagements[].timestamp - When the engagement occurred
 * 
 * @example
 * const scores = await checkScores();
 * if (scores) {
 *   scores.forEach(score => {
 *     console.log(`${score.account}: ${score.score} points`);
 *   });
 * }
 */
  async checkScores() {
    try {
      const response = await axios.get(
        `http://${process.env.SERVICE_HOST}:${process.env.SERVICE_PORT}/scores`
      );
      return response.data;
    } catch (error) {
      console.error('Error checking winner:', error);
      return null;
    }
  }

  /**
   * Registers an account's attempt to participate in the tournament.
   * This must be called before any engagements can be recorded for the account.
   * 
   * @param {string} address - The account address to register
   * @returns {Promise<Object|null>} Response object if successful, null if failed
   * @property {string} status - "success" if the attempt was registered
   * @property {string} account - The registered account address
   * 
   * @example
   * const result = await makeAttempt('0x123...abc');
   * if (result) {
   *   console.log(`Registered account: ${result.account}`);
   * }
   * 
   * @throws Will return null if the server request fails
   * @notes
   * - Each account can only make one attempt
   * - The account must be registered before any engagements can be recorded
   * - The attempt persists until the tournament ends
   */
  async makeAttempt(address) {
    try {
      const response = await axios.post(
        `http://${process.env.SERVICE_HOST}:${process.env.SERVICE_PORT}/attempt`,
        { account: address }
      );
      return response.data;
    } catch (error) {
      console.error('Error making attempt:', error);
      return null;
    }
  }

  // Process tournament win
  async processWin(challengeId, winner, entryFee, isValidTransaction) {
    console.log('🎉 Processing tournament win...');

    try {
      // Calculate prize amounts
      console.log('💰 Calculating prize amounts...');
      const solPrice = await getSolPriceInUSDT();
      console.log(`💱 Current SOL price in USDT: ${solPrice}`);

      const challenge = await DatabaseService.getChallengeById(challengeId);
      const fee_multiplier = challenge.fee_multiplier || 100;
      const winningPrize = entryFee * fee_multiplier;
      console.log(`🏆 Winning prize in SOL: ${winningPrize}`);

      const usdPrize = winningPrize * solPrice;
      console.log(`💵 Prize value in USD: $${usdPrize}`);

      if (isValidTransaction) {
        console.log('🔗 Initiating blockchain tournament conclusion...');
        const blockchainService = new BlockchainService(
          this.solanaRpc,
          challenge.idl?.address
        );

        const concluded = await blockchainService.concludeTournament(
          challenge.tournamentPDA,
          winner
        );
        console.log(`✅ Tournament concluded on blockchain. TX: ${concluded}`);

        // Update challenge status
        await DatabaseService.updateChallenge(challengeId, {
          status: "concluded",
          expiry: new Date(),
          winning_prize: winningPrize,
          usd_prize: usdPrize,
          winner: winner,
        });

        return {
          success: true,
          transaction: concluded,
          prize: {
            sol: winningPrize,
            usd: usdPrize
          }
        };
      } else {
        // Handle invalid transaction case
        console.log('⚠️ Transaction validation failed, proceeding with manual verification');

        // Update challenge status for manual verification
        await DatabaseService.updateChallenge(challengeId, {
          status: "concluded",
          expiry: new Date(),
        });

        return {
          success: false,
          message: "Transaction verification failed, manual verification required"
        };
      }
    } catch (error) {
      console.error('❌ Error processing tournament win:', error);
      throw error;
    }
  }

  // Verify tournament entry transaction
  async verifyTransaction(signature, tournamentPDA, entryFee, walletAddress) {
    const blockchainService = new BlockchainService(
      this.solanaRpc,
      process.env.PROGRAM_ID
    );

    return blockchainService.verifyTransaction(
      signature,
      tournamentPDA,
      entryFee,
      walletAddress
    );
  }

  // Check if challenge is active
  async isChallengeActive(challengeId) {
    const challenge = await DatabaseService.getChallengeById(challengeId);
    return challenge?.status === "active";
  }

  // Update challenge entry fee and expiry
  async updateChallengeEntry(challengeId, entryFee) {
    const challenge = await DatabaseService.getChallengeById(challengeId);
    const now = new Date();
    const oneHourInMillis = 3600000;

    await DatabaseService.updateChallenge(challengeId, {
      entryFee: entryFee,
      ...(challenge.expiry - now < oneHourInMillis && {
        expiry: new Date(now.getTime() + oneHourInMillis),
      }),
    });
  }

  // Validate challenge status
  async validateChallengeStatus(challengeId) {
    const challenge = await DatabaseService.getChallengeById(challengeId);
    if (!challenge) throw new Error("Challenge not found");

    if (challenge.status === "upcoming") {
      throw new Error(`Tournament starts in ${challenge.start_date}`);
    } else if (challenge.status === "concluded") {
      throw new Error("Tournament has already concluded");
    } else if (challenge.status !== "active") {
      throw new Error("Tournament is not active");
    }

    return challenge;
  }
}

// Export singleton instance
export default new TournamentService();
