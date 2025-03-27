import { ValidationSchema, ValidationRules } from '../middleware/validator.ts';

/**
 * Schema for wallet connection request
 */
export const connectWalletSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  address: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isSolanaAddress()
    ]
  },
  signature: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  timestamp: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
  }
};

/**
 * Schema for checking wallet connection
 */
export const checkConnectionSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for chat request
 */
export const chatRequestSchema: ValidationSchema = {
  messages: {
    required: true,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.isNonEmptyArray()
    ]
  },
  task_prompt: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  app: {
    required: true,
    rules: [ValidationRules.isObject()]
  }
};

/**
 * Schema for refreshing pool balance
 */
export const refreshPoolSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for creating a training pool
 */
export const createPoolSchema: ValidationSchema = {
  name: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  skills: {
    required: true,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.isNonEmptyArray()
    ]
  },
  token: {
    required: true,
    rules: [ValidationRules.isObject()]
  },
  pricePerDemo: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(1)]
  },
  apps: {
    required: false,
    rules: [ValidationRules.isArray()]
  }
};

/**
 * Schema for updating a training pool
 */
export const updatePoolSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  name: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  status: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['live', 'paused'], 'Status must be either "live" or "paused"')
    ]
  },
  skills: {
    required: false,
    rules: [ValidationRules.isArray()]
  },
  pricePerDemo: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(1)]
  },
  apps: {
    required: false,
    rules: [ValidationRules.isArray()]
  },
  uploadLimit: {
    required: false,
    rules: [ValidationRules.isObject()]
  }
};

/**
 * Schema for reward calculation query
 */
export const rewardQuerySchema: ValidationSchema = {
  poolId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for generating content
 */
export const generateContentSchema: ValidationSchema = {
  prompt: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};
