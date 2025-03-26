import { OpenAIService } from './openai.ts';
import { AnthropicService } from './anthropic.ts';
import { ILLMService, LLMConfig, StreamResponse, GenericModelMessage } from '../../types/index.ts';
import dotenv from 'dotenv';

dotenv.config();

export class LLMService implements ILLMService {
  private service: ILLMService;

  constructor(model: string) {
    if (!model) {
      throw new Error('Model name is required');
    }

    let apiKey: string;
    if (model.startsWith('gpt-')) {
      apiKey = process.env.OPEN_AI_SECRET || '';
      if (!apiKey) throw new Error('OpenAI API key is required');
    } else if (model.startsWith('claude-')) {
      apiKey = process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) throw new Error('Anthropic API key is required');
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }

    const config: LLMConfig = {
      model,
      apiKey,
      maxTokens: 1024,
      temperature: 0.9
    };

    if (model.startsWith('gpt-')) {
      this.service = new OpenAIService(config);
    } else {
      this.service = new AnthropicService(config);
    }
  }

  async createChatCompletion(
    messages: GenericModelMessage[],
    tools?: any,
    toolChoice?: any
  ): Promise<StreamResponse> {
    return this.service.createChatCompletion(messages, tools, toolChoice);
  }
}

export { OpenAIService } from './openai.ts';
export { AnthropicService } from './anthropic.ts';
export * from '../../types/llm.ts';
