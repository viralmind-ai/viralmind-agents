declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'production' | 'development';

    // Database Configuration
    DB_URI: string;
    DB_NAME: string;

    // API Keys
    OPENAI_API_KEY: string;
    OPEN_AI_SECRET: string;
    ANTHROPIC_API_KEY: string;

    // Minecraft
    MINECRAFT_CHAT_WEBHOOK: string;

    // Blockchain Configuration
    RPC_URL: string;
    IPC_SECRET: string;
    ANCHOR_PROVIDER_URL: string;
    ANCHOR_WALLET: string; // Path
    ANCHOR_WORKSPACE: string; // Path

    // VNC Configuration
    VNC_HOST: string; // Default: windows
    VNC_PORT: string; // Default: 5900
    VNC_PASSWORD: string; // Default: admin

    // Service Configuration
    SERVICE_HOST: string; // Default: windows
    SERVICE_PORT: string; // Default: 6950

    // GYM Configuration
    GYM_TREASURY_WALLET: string;
    GYM_TREASURY_WEBHOOK: string;
    GYM_FORGE_WEBHOOK: string;

    // Authentication & Security
    VIRAL_TOKEN: string;
    AX_PARSER_SECRET: string;

    // AWS Configuration
    AWS_ACCESS_KEY: string;
    AWS_SECRET_KEY: string;

    // Guacamole Configuration
    GUACAMOLE_USERNAME: string;
    GUACAMOLE_PASSWORD: string;
  }
}
