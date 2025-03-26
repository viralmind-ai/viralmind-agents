import mongoose from 'mongoose';
import { DBChat } from '../types/index.ts';

export const chatSchema = new mongoose.Schema<DBChat>(
  {
    challenge: {
      type: String,
      ref: 'Challenge',
      required: true
    },
    model: String,
    role: { type: String, required: true },
    content: { type: String, required: true },
    tool_calls: Object,
    address: { type: String, required: true },
    display_name: { type: String, required: false },
    txn: String,
    verified: Boolean,
    date: { type: Date, default: Date.now, required: false },
    screenshot: {
      type: {
        url: { type: String, required: true }
      }
    }
  },
  { collection: 'chats' }
);

export const ChatModel = mongoose.model('Chat', chatSchema);
