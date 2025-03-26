import mongoose from 'mongoose';
import { DBTrainingEvent } from '../types/index.ts';

export const trainingEventSchema = new mongoose.Schema<DBTrainingEvent>(
  {
    session: { type: String, ref: 'RaceSession', required: true },
    type: {
      type: String,
      enum: [
        'task',
        'mouse',
        'keyboard',
        'scroll',
        'system',
        'hint',
        'quest',
        'error',
        'reasoning',
        'reward'
      ],
      required: true
    },
    message: { type: String, required: true },
    frame: { type: Number, required: true },
    timestamp: { type: Number, required: true }, // Milliseconds since session start
    coordinates: {
      x: { type: Number },
      y: { type: Number }
    },
    trajectory: [
      {
        x: { type: Number },
        y: { type: Number },
        timestamp: { type: Number },
        velocity: {
          x: { type: Number },
          y: { type: Number },
          magnitude: { type: Number }
        },
        acceleration: {
          x: { type: Number },
          y: { type: Number },
          magnitude: { type: Number }
        }
      }
    ],
    created_at: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { collection: 'training_events' }
);

export const TrainingEventModel = mongoose.model('TrainingEvent', trainingEventSchema);
