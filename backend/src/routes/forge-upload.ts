import express, { Request, Response, Router, NextFunction } from 'express';
import multer from 'multer';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, unlink, copyFile, stat, writeFile, readFile, readdir } from 'fs/promises';
import * as path from 'path';
import { Extract } from 'unzipper';
import { createHash } from 'crypto';
import { AWSS3Service } from '../services/aws/index.ts';
import { ForgeRaceSubmission } from '../models/Models.ts';
import { WalletConnectionModel } from '../models/WalletConnection.ts';
import { TrainingPoolModel } from '../models/TrainingPool.ts';
import BlockchainService from '../services/blockchain/index.ts';
import axios from 'axios';
import { ForgeSubmissionProcessingStatus, TrainingPoolStatus } from '../types/index.ts';
import { addToProcessingQueue } from '../services/forge/index.ts';

// Initialize blockchain service
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');

// Configure multer for handling chunk uploads
const upload = multer({
  dest: 'uploads/chunks/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit per chunk
  }
});

// In-memory storage for upload sessions
interface UploadChunk {
  chunkIndex: number;
  path: string;
  size: number;
  checksum: string;
}

interface UploadSession {
  id: string;
  address: string;
  totalChunks: number;
  receivedChunks: Map<number, UploadChunk>;
  metadata: any;
  tempDir: string;
  createdAt: Date;
  lastUpdated: Date;
}

// Store active upload sessions
const activeSessions = new Map<string, UploadSession>();

// Cleanup interval (check for expired sessions every 15 minutes)
const CLEANUP_INTERVAL = 15 * 60 * 1000;
const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Middleware to resolve connect token to wallet address
async function requireWalletAddress(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-connect-token'];
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Connect token is required' });
    return;
  }

  const connection = await WalletConnectionModel.findOne({ token });
  if (!connection) {
    res.status(401).json({ error: 'Invalid connect token' });
    return;
  }

  // Add the wallet address to the request object
  // @ts-ignore - Add walletAddress to the request object
  req.walletAddress = connection.address;
  next();
}

// Middleware to validate upload session
function requireUploadSession(req: Request, res: Response, next: NextFunction) {
  const uploadId = req.params.uploadId || req.body.uploadId;

  if (!uploadId) {
    res.status(400).json({ error: 'Upload ID is required' });
    return;
  }

  const session = activeSessions.get(uploadId);
  if (!session) {
    res.status(404).json({ error: 'Upload session not found or expired' });
    return;
  }

  // @ts-ignore - Add session to the request object
  req.uploadSession = session;
  next();
}

// Start cleanup interval
setInterval(async () => {
  const now = new Date();
  const expiredSessions = [];

  // Find expired sessions
  for (const [id, session] of activeSessions.entries()) {
    if (now.getTime() - session.lastUpdated.getTime() > SESSION_EXPIRY) {
      expiredSessions.push(id);
    }
  }

  // Clean up expired sessions
  for (const id of expiredSessions) {
    const session = activeSessions.get(id);
    if (session) {
      console.log(`Cleaning up expired upload session ${id}`);
      await cleanupSession(session);
      activeSessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

// Helper function to clean up session files
async function cleanupSession(session: UploadSession): Promise<void> {
  try {
    // Delete all chunk files
    for (const chunk of session.receivedChunks.values()) {
      await unlink(chunk.path).catch(() => {});
    }

    // Delete temp directory if it exists
    if (session.tempDir) {
      try {
        const files = await readdir(session.tempDir);
        for (const file of files) {
          await unlink(path.join(session.tempDir, file)).catch(() => {});
        }
        await unlink(session.tempDir).catch(() => {});
      } catch (error) {
        // Ignore errors if directory doesn't exist
      }
    }
  } catch (error) {
    console.error(`Error cleaning up session ${session.id}:`, error);
  }
}

const router: Router = express.Router();

// Initialize a new upload session
router.post('/init', requireWalletAddress, async (req: Request, res: Response) => {
  try {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;
    const { totalChunks, metadata } = req.body;

    if (!totalChunks || !metadata) {
      res.status(400).json({ error: 'Total chunks and metadata are required' });
      return;
    }

    if (totalChunks <= 0 || totalChunks > 1000) {
      res.status(400).json({ error: 'Invalid number of chunks (must be between 1 and 1000)' });
      return;
    }

    // Generate a unique upload ID
    const uploadId = createHash('sha256')
      .update(`${address}-${Date.now()}-${Math.random()}`)
      .digest('hex');

    // Create temp directory for this upload
    const tempDir = path.join('uploads', `temp_${uploadId}`);
    await mkdir(tempDir, { recursive: true });

    // Store metadata in the temp directory
    await writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata));

    // Create and store the session
    const session: UploadSession = {
      id: uploadId,
      address,
      totalChunks: Number(totalChunks),
      receivedChunks: new Map(),
      metadata,
      tempDir,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    activeSessions.set(uploadId, session);

    res.json({
      uploadId,
      expiresIn: SESSION_EXPIRY / 1000, // in seconds
      chunkSize: 100 * 1024 * 1024 // 100MB
    });
  } catch (error) {
    console.error('Error initializing upload:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// Upload a chunk
router.post(
  '/chunk/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  upload.single('chunk'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No chunk uploaded' });
      return;
    }

    try {
      // @ts-ignore - Get session from the request object
      const session: UploadSession = req.uploadSession;
      const chunkIndex = Number(req.body.chunkIndex);
      const checksum = req.body.checksum;

      if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
        await unlink(req.file.path).catch(() => {});
        res.status(400).json({ error: 'Invalid chunk index' });
        return;
      }

      if (!checksum) {
        await unlink(req.file.path).catch(() => {});
        res.status(400).json({ error: 'Checksum is required' });
        return;
      }

      // Verify checksum
      const fileBuffer = await readFile(req.file.path);
      const calculatedChecksum = createHash('sha256').update(fileBuffer).digest('hex');

      if (calculatedChecksum !== checksum) {
        await unlink(req.file.path).catch(() => {});
        res.status(400).json({
          error: 'Checksum verification failed',
          expected: checksum,
          calculated: calculatedChecksum
        });
        return;
      }

      // Store chunk info
      session.receivedChunks.set(chunkIndex, {
        chunkIndex,
        path: req.file.path,
        size: req.file.size,
        checksum
      });

      // Update session timestamp
      session.lastUpdated = new Date();

      res.json({
        uploadId: session.id,
        chunkIndex,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100)
      });
    } catch (error) {
      console.error('Error uploading chunk:', error);
      if (req.file) {
        await unlink(req.file.path).catch(() => {});
      }
      res.status(500).json({ error: 'Failed to process chunk' });
    }
  }
);

// Get upload status
router.get(
  '/status/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  async (req: Request, res: Response) => {
    try {
      // @ts-ignore - Get session from the request object
      const session: UploadSession = req.uploadSession;

      res.json({
        uploadId: session.id,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100),
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      });
    } catch (error) {
      console.error('Error getting upload status:', error);
      res.status(500).json({ error: 'Failed to get upload status' });
    }
  }
);

// Cancel upload
router.delete(
  '/cancel/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  async (req: Request, res: Response) => {
    try {
      // @ts-ignore - Get session from the request object
      const session: UploadSession = req.uploadSession;

      // Clean up session files
      await cleanupSession(session);

      // Remove session
      activeSessions.delete(session.id);

      res.json({ message: 'Upload cancelled successfully' });
    } catch (error) {
      console.error('Error cancelling upload:', error);
      res.status(500).json({ error: 'Failed to cancel upload' });
    }
  }
);

// Complete upload and process files
router.post(
  '/complete/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  async (req: Request, res: Response) => {
    console.log(`[UPLOAD] Starting complete process for upload ${req.params.uploadId}`);

    // Ensure uploads directory exists
    await mkdir('uploads', { recursive: true }).catch((err) => {
      console.error('[UPLOAD] Error ensuring uploads directory exists:', err);
      // Continue anyway, as the directory might already exist
    });
    try {
      // @ts-ignore - Get session from the request object
      const session: UploadSession = req.uploadSession;
      // @ts-ignore - Get walletAddress from the request object
      const address = req.walletAddress;
      console.log(
        `[UPLOAD] Processing upload for address: ${address}, chunks: ${session.receivedChunks.size}/${session.totalChunks}`
      );

      // Check if all chunks have been uploaded
      if (session.receivedChunks.size !== session.totalChunks) {
        console.log(
          `[UPLOAD] Incomplete upload: ${session.receivedChunks.size}/${session.totalChunks} chunks received`
        );
        const missing = Array.from({ length: session.totalChunks }, (_, i) => i).filter(
          (i) => !session.receivedChunks.has(i)
        );
        console.log(`[UPLOAD] Missing chunks: ${missing.join(', ')}`);

        res.status(400).json({
          error: 'Upload incomplete',
          received: session.receivedChunks.size,
          total: session.totalChunks,
          missing
        });
        return;
      }

      console.log(`[UPLOAD] All chunks received, combining into final file`);
      // Create final file path
      const finalFilePath = path.join('uploads', `complete_${session.id}.zip`);
      console.log(`[UPLOAD] Final file path: ${finalFilePath}`);

      // Combine chunks into final file
      const sortedChunks = Array.from(session.receivedChunks.values()).sort(
        (a, b) => a.chunkIndex - b.chunkIndex
      );
      console.log(`[UPLOAD] Sorted ${sortedChunks.length} chunks for combining`);

      // Create write stream for final file
      const writeStream = createWriteStream(finalFilePath);
      console.log(`[UPLOAD] Created write stream for final file`);

      // Write chunks sequentially
      console.log(`[UPLOAD] Starting to write chunks sequentially`);
      for (let i = 0; i < sortedChunks.length; i++) {
        const chunk = sortedChunks[i];
        console.log(
          `[UPLOAD] Writing chunk ${i + 1}/${sortedChunks.length} (index: ${
            chunk.chunkIndex
          }, size: ${chunk.size} bytes)`
        );
        await new Promise<void>((resolve, reject) => {
          const readStream = createReadStream(chunk.path);

          // Handle backpressure
          let draining = false;

          const handleDrain = () => {
            draining = false;
            readStream.resume();
          };

          writeStream.on('drain', handleDrain);

          readStream
            .on('error', (err: Error) => {
              console.error(`[UPLOAD] Error reading chunk ${chunk.chunkIndex}:`, err);
              writeStream.removeListener('drain', handleDrain);
              reject(err);
            })
            .on('data', (chunk) => {
              // If writeStream returns false, it's experiencing backpressure
              if (!writeStream.write(chunk) && !draining) {
                draining = true;
                readStream.pause(); // Pause reading until drain
              }
            })
            .on('end', () => {
              console.log(`[UPLOAD] Finished reading chunk ${chunk.chunkIndex}`);
              writeStream.removeListener('drain', handleDrain);
              resolve();
            });
        });
      }

      // Close the write stream
      console.log(`[UPLOAD] All chunks written, closing write stream`);
      await new Promise<void>((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', () => {
          console.log(`[UPLOAD] Write stream closed successfully`);
          resolve();
        });
        writeStream.on('error', (err: Error) => {
          console.error(`[UPLOAD] Error closing write stream:`, err);
          reject(err);
        });
      });

      // Create extraction directory
      const extractDir = path.join('uploads', `extract_${session.id}`);
      console.log(`[UPLOAD] Creating extraction directory: ${extractDir}`);
      await mkdir(extractDir, { recursive: true });

      // Extract the ZIP file
      console.log(`[UPLOAD] Extracting ZIP file to ${extractDir}`);
      await new Promise<void>((resolve, reject) => {
        createReadStream(finalFilePath)
          .pipe(Extract({ path: extractDir }))
          .on('close', () => {
            console.log(`[UPLOAD] ZIP extraction completed`);
            resolve();
          })
          .on('error', (err: Error) => {
            console.error(`[UPLOAD] Error extracting ZIP:`, err);
            reject(err);
          });
      });

      // Read and parse meta.json
      console.log(`[UPLOAD] Reading meta.json from extracted files`);
      const metaJsonPath = path.join(extractDir, 'meta.json');
      console.log(`[UPLOAD] Meta JSON path: ${metaJsonPath}`);
      const metaJson = await readFile(metaJsonPath, 'utf8');
      console.log(`[UPLOAD] Meta JSON content length: ${metaJson.length}`);
      const meta = JSON.parse(metaJson);
      console.log(`[UPLOAD] Parsed meta data, id: ${meta.id}`);

      // Create UUID from meta.id + address
      const uuid = createHash('sha256').update(`${meta.id}${address}`).digest('hex');
      console.log(`[UPLOAD] Generated submission UUID: ${uuid}`);

      // Create final directory with UUID
      const finalDir = path.join('uploads', `extract_${uuid}`);
      console.log(`[UPLOAD] Creating final directory: ${finalDir}`);
      await mkdir(finalDir, { recursive: true });

      // Move files from extract to final directory
      const requiredFiles = ['input_log.jsonl', 'meta.json', 'recording.mp4'];
      console.log(`[UPLOAD] Moving required files to final directory`);
      for (const file of requiredFiles) {
        const sourcePath = path.join(extractDir, file);
        const destPath = path.join(finalDir, file);
        console.log(`[UPLOAD] Copying ${file} from ${sourcePath} to ${destPath}`);
        try {
          await copyFile(sourcePath, destPath);
          console.log(`[UPLOAD] Successfully copied ${file}`);
        } catch (error) {
          console.error(`[UPLOAD] Error copying file ${file}:`, error);
          res.status(400).json({ error: `Missing required file: ${file}` });
          return;
        }
      }

      // Upload each file to S3
      console.log(`[UPLOAD] Starting S3 upload for ${requiredFiles.length} files`);
      const s3Service = new AWSS3Service(process.env.AWS_ACCESS_KEY, process.env.AWS_SECRET_KEY);
      const uploads = await Promise.all(
        requiredFiles.map(async (file) => {
          const filePath = path.join(finalDir, file);
          console.log(`[UPLOAD] Getting stats for file: ${filePath}`);
          const fileStats = await stat(filePath);
          const s3Key = `forge-races/${Date.now()}-${file}`;
          console.log(
            `[UPLOAD] Uploading ${file} (${fileStats.size} bytes) to S3 with key: ${s3Key}`
          );

          await s3Service.saveItem({
            bucket: 'training-gym',
            file: filePath,
            name: s3Key
          });
          console.log(`[UPLOAD] Successfully uploaded ${file} to S3`);

          return { file, s3Key, size: fileStats.size };
        })
      );
      console.log(`[UPLOAD] All files uploaded to S3 successfully`);

      // Verify time if poolId and generatedTime provided
      if (meta.poolId && meta.generatedTime) {
        console.log(`[UPLOAD] Verifying time for pool submission, poolId: ${meta.poolId}`);
        const now = Date.now();
        if (now - meta.generatedTime > 5 * 60 * 1000) {
          console.log(`[UPLOAD] Generated time expired: ${meta.generatedTime} (now: ${now})`);
          res.status(400).json({ error: 'Generated time expired' });
          return;
        }

        // Verify pool exists and check balance
        console.log(`[UPLOAD] Verifying pool balance and status for poolId: ${meta.poolId}`);
        const pool = await TrainingPoolModel.findById(meta.poolId);
        if (!pool) {
          console.log(`[UPLOAD] Pool not found: ${meta.poolId}`);
          res.status(400).json({ error: 'Pool not found' });
          return;
        }

        // Get current token balance from blockchain to ensure it's up-to-date
        const currentBalance = await blockchainService.getTokenBalance(
          pool.token.address,
          pool.depositAddress
        );

        // Check if pool has sufficient funds
        if (currentBalance < pool.pricePerDemo) {
          console.log(`[UPLOAD] Insufficient funds: ${currentBalance} < ${pool.pricePerDemo}`);
          res.status(400).json({ error: 'Pool has insufficient funds' });
          return;
        }

        // Check if pool is in live status
        if (pool.status !== TrainingPoolStatus.live) {
          console.log(`[UPLOAD] Pool not in live status: ${pool.status}`);
          res.status(400).json({ error: `Pool is not active (status: ${pool.status})` });
          return;
        }

        // Update pool funds in database with current balance
        if (pool.funds !== currentBalance) {
          pool.funds = currentBalance;
          await pool.save();
          console.log(`[UPLOAD] Updated pool funds from ${pool.funds} to ${currentBalance}`);
        }
      }

      // Check for existing submission
      console.log(`[UPLOAD] Checking for existing submission with ID: ${uuid}`);
      const tempSub = await ForgeRaceSubmission.findById(uuid);
      if (tempSub) {
        console.log(`[UPLOAD] Submission already exists with ID: ${uuid}`);
        res.status(400).json({
          message: 'Submission data already uploaded.',
          submissionId: uuid
        });
        return;
      }

      // Create submission record
      console.log(`[UPLOAD] Creating new submission record in database`);
      const submission = await ForgeRaceSubmission.create({
        _id: uuid,
        address,
        meta,
        status: ForgeSubmissionProcessingStatus.PENDING,
        files: uploads
      });
      console.log(`[UPLOAD] Submission created with ID: ${submission._id}`);

      // Add to processing queue
      console.log(`[UPLOAD] Adding submission to processing queue`);
      addToProcessingQueue(uuid);
      console.log(`[UPLOAD] Submission added to processing queue`);

      // Clean up session files
      console.log(`[UPLOAD] Cleaning up session files`);
      await cleanupSession(session);
      console.log(`[UPLOAD] Session files cleaned up`);

      // Remove session
      console.log(`[UPLOAD] Removing session from active sessions`);
      activeSessions.delete(session.id);

      // Clean up temporary files
      console.log(`[UPLOAD] Cleaning up temporary ZIP file: ${finalFilePath}`);
      await unlink(finalFilePath).catch((err: Error) => {
        console.error(`[UPLOAD] Error deleting temporary ZIP file:`, err);
      });

      console.log(`[UPLOAD] Upload complete process finished successfully for ID: ${uuid}`);
      res.json({
        message: 'Upload completed successfully',
        submissionId: submission._id,
        files: uploads
      });
    } catch (error) {
      console.error('[UPLOAD] Error completing upload:', error);
      res.status(500).json({ error: 'Failed to complete upload' });
    }
  }
);

/**
 * ## Chunked Upload API Documentation
 *
 * This API provides endpoints for uploading large files in chunks, which improves reliability
 * and allows for resumable uploads.
 *
 * ### POST /forge/upload/init
 *
 * Initializes a new chunked upload session.
 *
 * #### Request Body
 * ```json
 * {
 *   "totalChunks": 10,           // Required: Total number of chunks to expect
 *   "metadata": {                 // Required: Metadata about the upload
 *     "poolId": "pool123",        // Optional: Pool ID if applicable
 *     "generatedTime": 1647123456789, // Optional: Timestamp when content was generated
 *     "id": "unique-race-id"      // Required: Unique identifier for the race
 *   }
 * }
 * ```
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",     // Unique ID for this upload session
 *   "expiresIn": 86400,          // Seconds until this session expires (24 hours)
 *   "chunkSize": 104857600       // Maximum chunk size in bytes (100MB)
 * }
 * ```
 *
 * ### POST /forge/upload/chunk/:uploadId
 *
 * Uploads a single chunk of the file.
 *
 * #### Request
 * - URL Parameter: `uploadId` - The upload session ID from init
 * - Form Data:
 *   - `chunk`: (file) The binary chunk data
 *   - `chunkIndex`: (number) Zero-based index of this chunk
 *   - `checksum`: (string) SHA256 hash of the chunk for verification
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "chunkIndex": 0,
 *   "received": 1,               // Number of chunks received so far
 *   "total": 10,                 // Total number of chunks expected
 *   "progress": 10               // Upload progress percentage
 * }
 * ```
 *
 * ### GET /forge/upload/status/:uploadId
 *
 * Gets the current status of an upload.
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "received": 5,               // Number of chunks received
 *   "total": 10,                 // Total number of chunks
 *   "progress": 50,              // Upload progress percentage
 *   "createdAt": "2023-01-01T12:00:00.000Z",
 *   "lastUpdated": "2023-01-01T12:05:00.000Z"
 * }
 * ```
 *
 * ### DELETE /forge/upload/cancel/:uploadId
 *
 * Cancels an in-progress upload and cleans up temporary files.
 *
 * #### Response
 * ```json
 * {
 *   "message": "Upload cancelled successfully"
 * }
 * ```
 *
 * ### POST /forge/upload/complete/:uploadId
 *
 * Completes the upload process, combines chunks, and processes the file.
 *
 * #### Response (Success)
 * ```json
 * {
 *   "message": "Upload completed successfully",
 *   "submissionId": "def456...",
 *   "files": [
 *     {
 *       "file": "meta.json",
 *       "s3Key": "forge-races/1647123456789-meta.json",
 *       "size": 1024
 *     },
 *     // ... other files
 *   ]
 * }
 * ```
 *
 * #### Response (Incomplete Upload)
 * ```json
 * {
 *   "error": "Upload incomplete",
 *   "received": 8,
 *   "total": 10,
 *   "missing": [2, 5]            // Indices of missing chunks
 * }
 * ```
 *
 * ### Authentication
 *
 * All endpoints require authentication via the `x-connect-token` header.
 *
 * ### Error Handling
 *
 * All endpoints return appropriate HTTP status codes:
 * - 400: Bad Request (invalid parameters)
 * - 401: Unauthorized (missing or invalid token)
 * - 404: Not Found (upload session not found)
 * - 500: Internal Server Error
 *
 * ### Example Usage
 *
 * ```javascript
 * // Initialize upload
 * const initResponse = await fetch('/api/forge/upload/init', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   },
 *   body: JSON.stringify({
 *     totalChunks: 3,
 *     metadata: { id: 'race-123', poolId: 'pool-456' }
 *   })
 * });
 * const { uploadId } = await initResponse.json();
 *
 * // Upload chunks
 * for (let i = 0; i < 3; i++) {
 *   const chunk = getChunk(i); // Your function to get chunk data
 *   const checksum = calculateSHA256(chunk); // Your function to calculate SHA256
 *
 *   const formData = new FormData();
 *   formData.append('chunk', chunk);
 *   formData.append('chunkIndex', i);
 *   formData.append('checksum', checksum);
 *
 *   await fetch(`/api/forge/upload/chunk/${uploadId}`, {
 *     method: 'POST',
 *     headers: {
 *       'x-connect-token': 'user-token'
 *     },
 *     body: formData
 *   });
 * }
 *
 * // Complete upload
 * const completeResponse = await fetch(`/api/forge/upload/complete/${uploadId}`, {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   }
 * });
 * const result = await completeResponse.json();
 * console.log(`Upload completed with submission ID: ${result.submissionId}`);
 * ```
 */

export { router as forgeUploadRoute };
