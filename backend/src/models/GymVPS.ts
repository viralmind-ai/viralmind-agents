import mongoose from 'mongoose';
import { DBGymVps } from '../types/index.ts';

export const gymVPSSchema = new mongoose.Schema<DBGymVps>(
  {
    id: { type: String, required: true, unique: true },
    ip: { type: String, required: true },
    region: { type: String, required: true },
    username: { type: String, required: true },
    ssh_keypair: {
      type: {
        public: { type: String, required: true },
        private: { type: String, required: true }
      },
      required: true
    },
    users: {
      type: [
        {
          username: { type: String, required: true },
          password: { type: String, required: true }
        }
      ],
      required: true
    }
  },
  { collection: 'gym_servers' }
);

export const GymVpsModel = mongoose.model('GymVPS', gymVPSSchema);
