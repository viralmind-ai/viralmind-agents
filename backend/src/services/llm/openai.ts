import OpenAI from 'openai';
import { ILLMService, LLMConfig, StreamResponse, GenericModelMessage } from '../../types/index.ts';

export class OpenAIService implements ILLMService {
  private openai: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: config.apiKey
    });
  }

  async createChatCompletion(
    messages: GenericModelMessage[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
    toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
  ): Promise<StreamResponse> {
    try {
      const stream = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: this.config.temperature ?? 0.9,
        max_tokens: this.config.maxTokens ?? 1024,
        top_p: 0.7,
        frequency_penalty: 1.0,
        presence_penalty: 1.0,
        stream: true,
        tools: tools,
        tool_choice: toolChoice,
        parallel_tool_calls: false
      });

      return {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta;

              if (delta?.content) {
                yield {
                  type: 'text_delta',
                  delta: delta.content
                };
              }

              if (delta?.tool_calls?.[0]) {
                const toolCall = delta.tool_calls[0];
                if (toolCall.function && toolCall.id) {
                  yield {
                    type: 'tool_call',
                    function: {
                      id: toolCall.id,
                      name: toolCall.function.name || 'unknown',
                      arguments: toolCall.function.arguments || ''
                    }
                  };
                }
              }

              if (chunk.choices[0]?.finish_reason === 'stop') {
                yield { type: 'stop' };
              }
            }
          } catch (error) {
            yield {
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown error occurred'
            };
          }
        }
      };
    } catch (error) {
      console.error('OpenAI Service Error:', error);
      throw error;
    }
  }
}
