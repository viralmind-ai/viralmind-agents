import { Schema, model } from 'mongoose';
import { DBTrainingPool, TrainingPoolStatus, UploadLimitType } from '../types/index.ts';

const trainingPoolSchema = new Schema<DBTrainingPool>(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(TrainingPoolStatus),
      default: TrainingPoolStatus.live,
      required: true
    },
    demonstrations: { type: Number, default: 0 },
    funds: { type: Number, default: 0 },
    pricePerDemo: { type: Number, default: 10, min: 1 },
    token: {
      type: {
        type: String,
        enum: ['SOL', 'VIRAL', 'CUSTOM'],
        required: true
      },
      symbol: { type: String, required: true },
      address: { type: String, required: true }
    },
    skills: { type: String, required: true },
    ownerEmail: { type: String, required: false },
    ownerAddress: { type: String, required: true },
    depositAddress: { type: String, required: true },
    depositPrivateKey: { type: String, required: true },
    uploadLimit: {
      type: {
        type: Number,
        required: false
      },
      limitType: {
        type: String,
        enum: Object.values(UploadLimitType),
        required: false
      }
    }
  },
  {
    timestamps: true,
    collection: 'training_pools'
  }
);

export const TrainingPoolModel = model<DBTrainingPool>('TrainingPool', trainingPoolSchema);
