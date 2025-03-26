import mongoose from 'mongoose';
import { DBChallenge } from '../types/index.ts';

export const challengeSchema = new mongoose.Schema<DBChallenge>(
  {
    _id: String,
    title: String,
    name: String,
    description: String,
    image: String,
    pfp: String,
    task: String,
    label: String,
    level: String,
    status: { type: String, default: 'active' },
    model: String,
    system_message: String,
    deployed: Boolean,
    tournamentPDA: String,
    idl: Object,
    entryFee: Number,
    characterLimit: Number,
    charactersPerWord: Number,
    contextLimit: Number,
    chatLimit: Number,
    max_actions: Number,
    expiry: Date,
    initial_pool_size: Number,
    developer_fee: Number,
    tools: Array,
    fee_multiplier: Number,
    prize: Number,
    usdPrize: Number,
    winning_message: String,
    phrase: String,
    winning_prize: Number,
    tools_description: String,
    custom_rules: String,
    disable: Array,
    success_function: String,
    fail_function: String,
    tool_choice: String,
    start_date: Date,
    expiry_logic: { type: String, enum: ['score', 'time'], default: 'time' },
    scores: [
      {
        account: String,
        address: String,
        score: Number,
        timestamp: { type: Date, default: Date.now }
      }
    ],
    game: String,
    game_ip: String,
    stream_src: String,
    whitelist: [
      {
        username: String,
        address: String,
        viral_balance: Number,
        signature: String
      }
    ]
  },
  { collection: 'challenges' }
);

export const ChallengeModel = mongoose.model('Challenge', challengeSchema);
