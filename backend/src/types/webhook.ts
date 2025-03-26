// Types based on Discord Webhook API
export interface WebhookPayload {
  url: string;
  content?: string;
  username?: string;
  avatar_url?: string;
  tts?: boolean;
  embeds?: Embed[];
  allowed_mentions?: AllowedMentions;
  components?: Component[];
  files?: File[];
  flags?: number;
  thread_name?: string;
  applied_tags?: string[];
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: EmbedFooter;
  image?: EmbedImage;
  thumbnail?: EmbedThumbnail;
  author?: EmbedAuthor;
  fields?: EmbedField[];
}

export interface EmbedFooter {
  text: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface EmbedImage {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface EmbedThumbnail {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface EmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface AllowedMentions {
  parse?: ('roles' | 'users' | 'everyone')[];
  roles?: string[];
  users?: string[];
  replied_user?: boolean;
}

export interface Component {
  type: number;
  components?: Component[];
  style?: number;
  label?: string;
  emoji?: Emoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options?: SelectOption[];
}

export interface Emoji {
  id?: string;
  name?: string;
  animated?: boolean;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: Emoji;
  default?: boolean;
}

export interface File {
  name: string;
  content: Buffer | string;
}

// Predefined colors
export enum WebhookColor {
  SUCCESS = 5793266, // Green
  ERROR = 15158332, // Red
  INFO = 3447003, // Blue
  WARNING = 16098851, // Yellow
  PURPLE = 0x9945ff // Purple
}
