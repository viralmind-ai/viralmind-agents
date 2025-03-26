import mongoose from 'mongoose';
import { DBPage } from '../types/index.ts';

export const pageSchema = new mongoose.Schema<DBPage>(
  {
    name: String,
    content: Object
  },
  { collection: 'pages' }
);

export const PagesModel = mongoose.model('Pages', pageSchema);
