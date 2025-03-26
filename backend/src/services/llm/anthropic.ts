import { Anthropic } from '@anthropic-ai/sdk';
import { ILLMService, LLMConfig, StreamResponse, GenericModelMessage } from '../../types/index.ts';

export class AnthropicService implements ILLMService {
  private anthropic: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.anthropic = new Anthropic({
      apiKey: config.apiKey
    });
  }

  async createChatCompletion(
    messages: GenericModelMessage[],
    tools?: Anthropic.Beta.BetaTool[],
    _toolChoice?: Anthropic.Beta.BetaToolChoice
  ): Promise<StreamResponse> {
    try {
      // Extract system message if present
      const systemMessage = messages.find((m) => m.role === 'system')?.content;
      const filteredMessages = messages.filter((m) => m.role !== 'system');

      const apiParams: Anthropic.Beta.Messages.MessageCreateParams = {
        model: this.config.model,
        messages: filteredMessages as Anthropic.Beta.BetaMessage[],
        system: systemMessage,
        max_tokens: this.config.maxTokens ?? 1024,
        temperature: this.config.temperature ?? 0.9,
        stream: true,
        tools: tools ?? [
          {
            type: 'computer_20241022',
            name: 'computer',
            display_width_px: 1280,
            display_height_px: 720,
            display_number: 1
          }
        ]
      };

      const stream = await this.anthropic.beta.messages.create(apiParams);
      if (!stream) throw new Error('Failed to create message stream');

      let currentToolCall: {
        id: string;
        name: string;
        arguments: string;
      } | null = null;

      return {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const chunk of stream) {
              if (!chunk || typeof chunk !== 'object') {
                console.warn('Received invalid chunk:', chunk);
                continue;
              }

              if (
                chunk.type === 'content_block_start' &&
                chunk.content_block?.type === 'tool_use' &&
                chunk.content_block?.id &&
                chunk.content_block?.name
              ) {
                currentToolCall = {
                  id: chunk.content_block.id,
                  name: chunk.content_block.name,
                  arguments: ''
                };
              } else if (
                chunk.type === 'content_block_delta' &&
                chunk.delta?.type === 'input_json_delta' &&
                currentToolCall &&
                chunk.delta?.partial_json
              ) {
                currentToolCall.arguments += chunk.delta.partial_json;
              } else if (chunk.type === 'content_block_stop' && currentToolCall?.arguments) {
                try {
                  JSON.parse(currentToolCall.arguments); // Validate JSON
                  yield {
                    type: 'tool_call',
                    function: {
                      id: currentToolCall.id,
                      name: currentToolCall.name,
                      arguments: currentToolCall.arguments
                    }
                  };
                } catch (e) {
                  yield {
                    type: 'error',
                    message: 'Invalid tool call arguments'
                  };
                }
                currentToolCall = null;
              } else if (
                chunk.type === 'content_block_delta' &&
                chunk.delta?.type === 'text_delta'
              ) {
                yield {
                  type: 'text_delta',
                  delta: chunk.delta.text
                };
              }

              const finishReason = (chunk as Anthropic.Beta.Messages.BetaRawMessageDeltaEvent).delta
                ?.stop_reason;
              if (finishReason && finishReason !== 'tool_use') {
                yield { type: 'stop' };
              }
            }
          } catch (error) {
            console.error('Error in Anthropic stream:', error);
            yield {
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown error occurred'
            };
          }
        }
      };
    } catch (error) {
      console.error('Anthropic Service Error:', error);
      throw error;
    }
  }
}
