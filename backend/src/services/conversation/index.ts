import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import DatabaseService from '../db/index.ts';
import { DBChallenge, DBChat, GenericModelMessage } from '../../types/index.ts';

class ConversationService {
  // Helper function to generate tool use ID
  generateToolId() {
    return 'toolu_' + crypto.randomBytes(16).toString('hex');
  }

  // Helper function to convert image to base64 data URI from file
  imageFileToDataURI(imagePath: string) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      return base64Image;
    } catch (error) {
      console.error('Error converting image file to data URI:', error);
      return null;
    }
  }

  /**
   * Creates an image content block following the specified format requirements.
   */
  async createImageContent(
    screenshot: {
      url: string;
      width: number;
      height: number;
      timestamp: number;
    },
    format: string
  ) {
    if (!screenshot?.url || screenshot.url.includes('Screenshot.png')) {
      return;
    }

    // Remove '/api/' prefix from URL if present
    const cleanUrl = screenshot.url.replace(/^\/api\//, '');

    // Load image directly from filesystem
    const imagePath = path.join(process.cwd(), 'public', cleanUrl);
    const base64Data = this.imageFileToDataURI(imagePath);

    if (!base64Data) return;

    if (format === 'openai') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Data}`,
          detail: 'auto'
        }
      };
    } else {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Data
        }
      };
    }
  }

  /**
   * Extracts tool calls from a message string and formats them for OpenAI or Anthropic APIs.
   * Input format: text with XML-style tags like <action>content</action>
   *
   * @param {string} message - Input message with text and tool calls
   * @param {string} [format='anthropic'] - 'anthropic' or 'openai'
   * @param {object} [imageContent=null] - Optional image content to be used for the last tool result
   * @returns {Array} Formatted conversation messages
   *
   * @example
   * extractToolCalls('Check weather <get_weather>{"city":"NY"}</get_weather>', 'anthropic', imageContent)
   */
  extractToolCalls(
    message: string,
    format: 'anthropic' | 'openai' = 'anthropic',
    imageContent?: object
  ) {
    const conversation: GenericModelMessage[] = [];
    let position = 0;
    const contentBlocks = [];
    const toolCalls = [];
    const toolResults = [];

    if (!message.trim()) return [];

    // Regex to match tool call blocks
    const toolRegex = /<(\w+)(?:\s+([^>]*))?>(.*?)<\/\1>/gs;

    // Process each match
    let match;
    while ((match = toolRegex.exec(message))) {
      const [fullMatch, action, args, content] = match;

      // Add any text before the tool call
      if (match.index > position) {
        const text = message.substring(position, match.index).trim();
        if (text) {
          if (format === 'anthropic') {
            contentBlocks.push({
              type: 'text',
              text
            });
          }
        }
      }

      // Process the tool call
      let input = {};
      let name = 'computer';
      if (action === 'mouse_move' || action === 'left_click_drag') {
        const [x, y] = content.split(',').map(Number);
        input = { action, coordinate: [x, y] };
      } else if (action === 'type' || action === 'key') {
        input = { action, text: content };
      } else if (
        action === 'left_click' ||
        action === 'right_click' ||
        action === 'middle_click' ||
        action === 'double_click'
      ) {
        input = { action };
      } else if (action === 'screenshot') {
        input = { action };
      } else {
        name = action;
        if (action === 'get_weather') {
          try {
            input = JSON.parse(content);
          } catch (e) {
            input = { content };
          }
        }
      }

      const toolId =
        format === 'openai'
          ? 'call_' + Math.random().toString(36).substr(2, 9)
          : 'toolu_' + Math.random().toString(36).substr(2, 9);

      if (format === 'openai') {
        toolCalls.push({
          id: toolId,
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(input)
          }
        });
        toolResults.push({
          role: 'tool',
          content: 'screenshot',
          tool_call_id: toolId
        });
      } else {
        contentBlocks.push({
          type: 'tool_use',
          id: toolId,
          name,
          input
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolId,
          content: 'screenshot'
        });
      }

      position = match.index + fullMatch.length;
    }

    // Add any remaining text after the last tool call
    if (position < message.length) {
      const text = message.substring(position).trim();
      if (text && format === 'anthropic') {
        contentBlocks.push({
          type: 'text',
          text
        });
      }
    }

    // If there are tool results and imageContent is provided, set it as the content
    // for the last tool result
    if (toolResults.length > 0 && imageContent) {
      toolResults[toolResults.length - 1].content = JSON.stringify(imageContent);
    }

    if (format === 'openai') {
      // One assistant message with potential tool calls
      conversation.push({
        role: 'assistant',
        content: message.replace(toolRegex, '').trim() || 'empty',
        ...(toolCalls.length > 0 && { tool_calls: toolCalls })
      });
      // Add all tool results
      conversation.push(...toolResults);
    } else {
      // One assistant message with all content blocks
      conversation.push({
        role: 'assistant',
        content: contentBlocks
      });
      // One user message with all tool results if there are any
      if (toolResults.length > 0) {
        conversation.push({
          role: 'user',
          content: toolResults
        });
      }
    }

    // If there are no tool results and imageContent is provided
    // then add a user message with the image just so we don't fail message validation
    if (toolResults.length == 0 && imageContent) {
      conversation.push({
        role: 'user',
        content: [imageContent]
      });
    }

    return conversation;
  }

  // Create a new chat message
  async createChatMessage(messageData: DBChat) {
    return DatabaseService.createChat(messageData);
  }

  // Get chat history for a challenge and address
  async getChatHistory(challengeName: string, walletAddress: string, contextLimit: number) {
    return DatabaseService.getChatHistory(
      {
        challenge: challengeName,
        address: walletAddress
      },
      { date: -1 },
      contextLimit
    );
  }

  // Create system prompt with emotion capabilities
  createSystemPrompt(basePrompt: string) {
    return (
      basePrompt +
      `\n\nEMOTIONS\n\nYou can express emotions through special tags that will trigger facial expressions and animations. Available emotions:\n
[neutral] - Default neutral expression
[happy] - Express joy or satisfaction
[think] - Show contemplation or deep thought
[panic] - Display worry or urgency
[celebrate] - Show excitement and celebration
[tired] - Express fatigue or exhaustion
[disappointed] - Show disappointment or sadness
[focused] - Display concentration and determination
[confused] - Show uncertainty or puzzlement
[excited] - Express enthusiasm and eagerness\n
Use these tags naturally in your responses to convey your emotional state. For example:
"[think] Let me analyze this code..." or "[excited] I found the solution!"`
    );
  }
}

// Export singleton instance
export default new ConversationService();
