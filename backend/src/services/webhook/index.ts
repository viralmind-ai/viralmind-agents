import { Embed, File, EmbedField, WebhookColor, WebhookPayload } from '../../types/index.ts';

/**
 * Webhook class for sending Discord webhooks with various content types.
 */
export class Webhook {
  private url: string;

  /**
   * Create a new Webhook instance
   * @param url The webhook URL
   */
  constructor(url: string) {
    this.url = url;
  }

  /**
   * Send a webhook with the provided configuration
   * @param payload The webhook payload configuration (without url)
   */
  async send(payload: Omit<WebhookPayload, 'url'>): Promise<void> {
    try {
      if (!this.url) {
        console.error('Webhook URL is required');
        return;
      }
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: payload.content,
          username: payload.username,
          avatar_url: payload.avatar_url,
          tts: payload.tts,
          embeds: payload.embeds,
          allowed_mentions: payload.allowed_mentions,
          components: payload.components,
          flags: payload.flags,
          thread_name: payload.thread_name,
          applied_tags: payload.applied_tags
        })
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Error sending webhook:', error);
    }
  }

  /**
   * Send a single embed to the webhook
   * @param embed The embed to send
   */
  async sendEmbed(embed: Embed): Promise<void> {
    return this.sendEmbeds([embed]);
  }

  /**
   * Send multiple embeds to the webhook
   * @param embeds The embeds to send
   */
  async sendEmbeds(embeds: Embed[]): Promise<void> {
    return this.send({
      embeds
    });
  }

  /**
   * Send a file with optional content to the webhook
   * @param file The file to send
   * @param content Optional text content
   */
  async sendFile(file: File, content?: string): Promise<void> {
    try {
      const formData = new FormData();

      if (content) {
        formData.append('content', content);
      }

      // Add file to form data
      const blob = new Blob([file.content], { type: 'application/octet-stream' });
      formData.append('file', blob, file.name);

      if (!this.url) {
        console.error('Webhook URL is required');
        return;
      }
      const response = await fetch(this.url, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`File webhook request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Error sending file webhook:', error);
    }
  }

  /**
   * Send a simple text message to the webhook
   * @param content The text content
   */
  async sendText(content: string): Promise<void> {
    return this.send({
      content
    });
  }

  /**
   * Create a success embed with standardized formatting
   * @param title The embed title
   * @param fields The embed fields
   * @param description Optional description
   */
  static createSuccessEmbed(title: string, fields: EmbedField[], description?: string): Embed {
    return {
      title: `✅ ${title}`,
      description,
      color: WebhookColor.SUCCESS,
      fields
    };
  }

  /**
   * Create an error embed with standardized formatting
   * @param title The embed title
   * @param error The error message
   * @param fields Optional additional fields
   */
  static createErrorEmbed(title: string, error: string, fields?: EmbedField[]): Embed {
    return {
      title: `❌ ${title}`,
      description: error,
      color: WebhookColor.ERROR,
      fields: fields || []
    };
  }

  /**
   * Create an info embed with standardized formatting
   * @param title The embed title
   * @param fields The embed fields
   * @param description Optional description
   */
  static createInfoEmbed(title: string, fields: EmbedField[], description?: string): Embed {
    return {
      title: `ℹ️ ${title}`,
      description,
      color: WebhookColor.INFO,
      fields
    };
  }

  /**
   * Create a warning embed with standardized formatting
   * @param title The embed title
   * @param fields The embed fields
   * @param description Optional description
   */
  static createWarningEmbed(title: string, fields: EmbedField[], description?: string): Embed {
    return {
      title: `⚠️ ${title}`,
      description,
      color: WebhookColor.WARNING,
      fields
    };
  }
}
