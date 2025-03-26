// Define interface for extended app object with limit information
export interface AppWithLimitInfo {
  _id: any;
  name: string;
  domain: string;
  description?: string | null;
  categories?: string[];
  pool_id: any;
  tasks: any[];
  createdAt?: Date;
  updatedAt?: Date;
  gymLimitReached: boolean;
  gymSubmissions: number;
  gymLimitType?: UploadLimitType;
  gymLimitValue?: number;
}

export enum TrainingPoolStatus {
  live = 'live',
  paused = 'paused',
  noFunds = 'no-funds',
  noGas = 'no-gas'
}

export enum UploadLimitType {
  perTask = 'per-task',
  perDay = 'per-day',
  total = 'total'
}

// Define interface for task with limit information
export interface TaskWithLimitInfo {
  _id: any;
  prompt: string;
  uploadLimit?: number;
  rewardLimit?: number;
  uploadLimitReached: boolean;
  currentSubmissions: number;
  limitReason: string | null;
}

export interface ConnectBody {
  token: string;
  address: string;
  signature?: string;
  timestamp?: number;
}

export interface CreatePoolBody {
  name: string;
  skills: string;
  token: {
    type: 'SOL' | 'VIRAL' | 'CUSTOM';
    symbol: string;
    address: string;
  };
  ownerAddress?: string; // Now optional since we get it from the token
  pricePerDemo?: number;
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
  apps?: {
    name: string;
    domain: string;
    description?: string;
    categories?: string[];
    tasks: {
      prompt: string;
      uploadLimit?: number;
      rewardLimit?: number;
    }[];
  }[];
}

export interface UpdatePoolBody {
  id: string;
  name?: string;
  status?: TrainingPoolStatus.live | TrainingPoolStatus.paused;
  skills?: string;
  pricePerDemo?: number;
  uploadLimit?: {
    type: number;
    limitType: UploadLimitType;
  };
  apps?: {
    name: string;
    domain: string;
    description?: string;
    categories?: string[];
    tasks: {
      prompt: string;
      uploadLimit?: number;
      rewardLimit?: number;
    }[];
  }[];
}

export interface AppInfo {
  type: 'executable' | 'website';
  name: string;
  path?: string;
  url?: string;
}

export enum ForgeSubmissionProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface ForgeSubmissionMetaData {
  id: string;
  timestamp: string;
  duration_seconds: number;
  status: string;
  reason: string;
  title: string;
  description: string;
  platform: string;
  arch: string;
  version: string;
  locale: string;
  primary_monitor: {
    width: number;
    height: number;
  };
  quest: {
    title: string;
    app: string;
    icon_url: string;
    objectives: string[];
    content: string;
  };
}

export interface ForgeSubmissionGradeResult {
  summary: string;
  score: number;
  reasoning: string;
}

// Interface for treasury transfer details
export interface ForgeTreasuryTransfer {
  tokenAddress: string;
  treasuryWallet: string;
  amount: number;
  timestamp: number;
  txHash?: string;
}
