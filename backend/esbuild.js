import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'build',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  mainFields: ['module', 'main'],
  external: [
    // Node.js built-in modules
    'crypto',
    'path',
    'fs',
    'util',
    'stream',
    'events',
    'http',
    'https',
    'net',
    'tls',
    'os',
    'buffer',
    
    // External packages that should not be bundled
    '@anthropic-ai/sdk',
    '@aws-sdk/client-s3',
    '@coral-xyz/anchor',
    '@solana/spl-token',
    '@solana/web3.js',
    '@vultr/vultr-node',
    'axios',
    'body-parser',
    'bs58',
    'commander',
    'dotenv',
    'dots-wrapper',
    'express',
    'fs',
    'http2-express-bridge',
    'mongoose',
    'mysql2',
    'node-rdpjs',
    'node-ssh',
    'node-telegram-bot-api',
    'openai',
    'random-words',
    'sharp',
    'socket.io',
    'sshpk',
    'url',
    'vnc-rfb-client'
  ]
});
