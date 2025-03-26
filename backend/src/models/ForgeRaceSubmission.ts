import mongoose from 'mongoose';
import { DBForgeRaceSubmission, ForgeSubmissionProcessingStatus } from '../types/index.ts';

export const forgeRaceSubmissionSchema = new mongoose.Schema<DBForgeRaceSubmission>(
  {
    _id: { type: String },
    address: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(ForgeSubmissionProcessingStatus),
      default: ForgeSubmissionProcessingStatus.PENDING
    },
    files: [
      {
        file: String,
        s3Key: String,
        size: Number
      }
    ],
    grade_result: {
      type: {
        summary: String,
        score: Number,
        reasoning: String
      },
      required: false
    },
    error: { type: String, required: false },
    reward: { type: Number, required: false },
    maxReward: { type: Number, required: false },
    clampedScore: { type: Number, required: false },
    treasuryTransfer: {
      type: {
        tokenAddress: String,
        treasuryWallet: String,
        amount: Number,
        timestamp: Number,
        txHash: String
      },
      required: false
    }
  },
  {
    collection: 'forge_race_submissions',
    timestamps: true
  }
);

// Index to help with querying pending submissions
forgeRaceSubmissionSchema.index({ status: 1, createdAt: 1 });

export const ForgeRaceSubmission = mongoose.model('ForgeRaceSubmission', forgeRaceSubmissionSchema);
