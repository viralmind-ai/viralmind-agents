import mongoose from 'mongoose';

const ForgeAppSchema = new mongoose.Schema({
  name: { type: String, required: true },
  domain: { type: String, required: true },
  description: { type: String, required: true },
  categories: [{ type: String, required: true }],
  pool_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingPool', required: true },
  tasks: [{
    prompt: { type: String, required: true }
  }]
},
{ 
  collection: "forge_apps",
  timestamps: true 
});

export const ForgeApp = mongoose.model('ForgeApp', ForgeAppSchema);
