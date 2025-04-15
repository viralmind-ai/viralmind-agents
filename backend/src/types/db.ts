import { Types } from 'mongoose';
import {
  TrainingPoolStatus,
  IDL,
  UploadLimitType,
  VPSRegion,
  ForgeSubmissionProcessingStatus
} from './index.ts';

export interface DBChallenge {
  _id?: string;
  title?: string;
  name?: string;
  description?: string;
  image?: string;
  pfp?: string;
  task?: string;
  label?: string;
  level?: string;
  status: string;
  model?: string;
  system_message?: string;
  deployed?: boolean;
  tournamentPDA?: string;
  idl?: IDL;
  entryFee?: number;
  characterLimit?: number;
  charactersPerWord?: number;
  contextLimit?: number;
  chatLimit?: number;
  max_actions?: number;
  expiry?: Date;
  initial_pool_size?: number;
  developer_fee?: number;
  tools?: Array<any>;
  fee_multiplier?: number;
  prize?: number;
  usdPrize?: number;
  winning_message?: string;
  phrase?: string;
  winning_prize?: number;
  tools_description?: string;
  custom_rules?: string;
  disable: any[];
  success_function?: string;
  fail_function?: string;
  tool_choice?: string;
  start_date?: Date;
  expiry_logic?: 'score' | 'time';
  scores?: Array<{
    account?: string;
    address?: string;
    score?: number;
    timestamp: Date;
  }>;
  game?: string;
  game_ip?: string;
  stream_src?: string;
  whitelist?: Array<{
    username?: string;
    address?: string;
    viral_balance?: number;
    signature?: string;
  }>;
}

export interface DBChat {
  _id?: Types.ObjectId;
  challenge: string;
  model?: string;
  role: string;
  content: string;
  tool_calls?: object;
  address: string;
  display_name?: string;
  txn?: string;
  verified?: boolean;
  date?: Date;
  screenshot?: {
    url: string;
  };
}

export interface DBPage {
  _id?: Types.ObjectId;
  name: string;
  content: any;
}

export interface DBUser {
  _id?: Types.ObjectId;
  api_key: string;
  address: string;
  date_created: Date;
}

export interface DBForgeApp {
  _id?: Types.ObjectId;
  name: string;
  domain: string;
  description?: string;
  categories: string[];
  pool_id: Types.ObjectId;
  tasks: {
    _id: Types.ObjectId;
    prompt: string;
    uploadLimit?: number;
    rewardLimit?: number;
  }[];
}

export interface DBForgeRace {
  _id?: Types.ObjectId;
  title: string;
  description: string;
  category: string;
  icon: string;
  skills: string;
  agent_prompt: string;
  pool_id: Types.ObjectId;
}

export interface DBForgeRaceSubmission {
  _id?: string;
  address: string;
  meta: any;
  status?: ForgeSubmissionProcessingStatus;
  files?: Array<{
    file?: string;
    s3Key?: string;
    size?: number;
  }>;
  grade_result?: {
    summary?: string;
    score?: number;
    reasoning?: string;
  };
  error?: string;
  reward?: number;
  maxReward?: number;
  clampedScore?: number;
  treasuryTransfer?: {
    tokenAddress?: string;
    treasuryWallet?: string;
    amount?: number;
    timestamp?: number;
    txHash?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DBGymSession {
  _id?: Types.ObjectId;
  address: string;
  status: 'active' | 'completed' | 'expired';
  preview?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DBGymVps {
  _id?: Types.ObjectId;
  id: string;
  ip: string;
  region: string;
  username: string;
  ssh_keypair: {
    public: string;
    private: string;
  };
  users: {
    username: string;
    password: string;
  }[];
}

export interface DBRace {
  _id?: Types.ObjectId;
  id: string;
  title: string;
  description: string;
  category: 'creative' | 'mouse' | 'slacker' | 'gaming' | 'wildcard';
  icon: string;
  colorScheme?: 'pink' | 'blue' | 'purple' | 'orange' | 'indigo' | 'emerald';
  prompt: string;
  reward: number;
  buttonText: string;
  stakeRequired?: number;
}

export interface DBTrainingPool {
  _id?: Types.ObjectId;
  id: string;
  name: string;
  status: TrainingPoolStatus;
  demonstrations: number;
  funds: number;
  pricePerDemo: number;
  token: {
    type: 'SOL' | 'VIRAL' | 'CUSTOM';
    symbol: string;
    address: string;
  };
  skills: string;
  ownerEmail?: string;
  ownerAddress: string;
  depositAddress: string;
  depositPrivateKey: string; // Store private key securely
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
}
export interface DBRaceSession {
  _id?: Types.ObjectId;
  address: string;
  challenge: string;
  prompt: string;
  category: 'creative' | 'mouse' | 'slacker' | 'gaming' | 'wildcard';
  vm_ip: string;
  vm_port: number;
  vm_password: string;
  vm_region: VPSRegion;
  vm_credentials: {
    guacToken?: string;
    guacConnectionId?: string;
    guacClientId?: string;
    username: string;
    password: string;
  };
  status?: 'active' | 'completed' | 'expired';
  video_path?: string;
  preview?: string; // Base64 encoded screenshot
  created_at?: Date;
  updated_at?: Date;
  transaction_signature?: string;
  stream_id?: string;
}

export interface DBTrainingEvent {
  _id?: Types.ObjectId;
  session: Types.ObjectId | string;
  type:
    | 'task'
    | 'mouse'
    | 'keyboard'
    | 'scroll'
    | 'system'
    | 'hint'
    | 'quest'
    | 'error'
    | 'reasoning'
    | 'reward';
  message: string;
  frame: number;
  timestamp: number; // Milliseconds since session start
  coordinates?: {
    x?: number;
    y?: number;
  };
  trajectory?: Array<{
    x?: number;
    y?: number;
    timestamp?: number;
    velocity?: {
      x?: number;
      y?: number;
      magnitude?: number;
    };
    acceleration?: {
      x?: number;
      y?: number;
      magnitude?: number;
    };
  }>;
  created_at?: Date;
  metadata?: any;
}

export interface DBWalletConnection {
  _id?: Types.ObjectId;
  token: string;
  address: string;
  nickname?: string;
  createdAt: Date;
}
