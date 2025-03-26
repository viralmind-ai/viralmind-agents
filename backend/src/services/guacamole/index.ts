import axios, { AxiosError, isAxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { handleAxiosError } from '../util.ts';
import { ActiveConnection, FrameInfo, GuacamoleConnection } from '../../types/guacamole.ts';

const execAsync = promisify(exec);

export class GuacamoleService {
  private baseUrl: string;
  private adminUsername: string;
  private adminPassword: string;
  private dataSource: string;
  public recordingsPath: string;
  private gymSecret: string;
  private tempDir: string;

  constructor() {
    this.baseUrl = process.env.GUACAMOLE_URL || 'http://guacamole:8080/guacamole';
    this.adminUsername = process.env.GUACAMOLE_USERNAME || 'guacadmin';
    this.adminPassword = process.env.GUACAMOLE_PASSWORD || 'guacadmin';
    this.dataSource = process.env.GUACAMOLE_DATASOURCE || 'mysql';
    this.recordingsPath = '/var/lib/guacamole/recordings';
    this.gymSecret = process.env.GYM_SECRET || 'guacadmin';
    this.tempDir = '/tmp/guac-frames';

    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private encodeClientIdentifier(connectionId: string): string {
    const components = [connectionId, 'c', this.dataSource];
    const str = components.join('\0');
    return Buffer.from(str).toString('base64');
  }

  public async listActiveConnections(username: string): Promise<Record<string, ActiveConnection>> {
    try {
      const adminToken = await this.getAdminToken();
      const response = await axios.get<Record<string, ActiveConnection>>(
        `${this.baseUrl}/api/session/data/${this.dataSource}/activeConnections`,
        {
          headers: {
            'Guacamole-Token': adminToken
          }
        }
      );

      return Object.fromEntries(
        Object.entries(response.data).filter(([_, connection]) => connection.username === username)
      );
    } catch (error) {
      throw error;
    }
  }

  public async killConnection(connectionId: string): Promise<void> {
    try {
      const adminToken = await this.getAdminToken();
      await axios.patch(
        `${this.baseUrl}/api/session/data/${this.dataSource}/activeConnections`,
        [
          {
            op: 'remove',
            path: `/${connectionId}`
          }
        ],
        {
          headers: {
            'Content-Type': 'application/json',
            'Guacamole-Token': adminToken
          }
        }
      );
    } catch (error) {
      console.error('Error killing connection:', error);
      throw error;
    }
  }

  private async getAdminToken(): Promise<string> {
    try {
      const params = new URLSearchParams();
      params.append('username', this.adminUsername);
      params.append('password', this.adminPassword);

      const response = await axios.post(`${this.baseUrl}/api/tokens`, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!response.data?.authToken) {
        console.error('Auth response:', response.data);
        throw new Error('No auth token in response');
      }

      return response.data.authToken;
    } catch (error) {
      console.error('Auth error.');
      throw error;
    }
  }

  private async createUser(adminToken: string, username: string): Promise<void> {
    try {
      try {
        // Check if user exists first
        await axios.get(`${this.baseUrl}/api/session/data/${this.dataSource}/users/${username}`, {
          headers: {
            'Guacamole-Token': adminToken
          }
        });
        // Even if user exists, ensure they have the correct permissions
        // await axios.patch(
        //   `${this.baseUrl}/api/session/data/${this.dataSource}/users/${username}/permissions`,
        //   [
        //     {
        //       op: 'add',
        //       path: '/connectionGroupPermissions/ROOT',
        //       value: 'READ'
        //     }
        //   ],
        //   {
        //     headers: {
        //       'Content-Type': 'application/json',
        //       'Guacamole-Token': adminToken
        //     }
        //   }
        // );
        // console.log(`Updated permissions for existing user ${username}`);
        return;
      } catch (error: any) {
        // If 404, user doesn't exist, continue with creation
        if (error.response?.status !== 404) {
          throw error;
        }
      }

      // Create the user
      await axios.post(
        `${this.baseUrl}/api/session/data/${this.dataSource}/users`,
        {
          username,
          password: this.gymSecret,
          attributes: {
            disabled: '',
            expired: '',
            'access-window-start': '',
            'access-window-end': '',
            'valid-from': '',
            'valid-until': '',
            timezone: null,
            'guac-full-name': '',
            'guac-organization': '',
            'guac-organizational-role': ''
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Guacamole-Token': adminToken
          }
        }
      );

      console.log(`Created user ${username}`);

      // Grant the user basic permissions to read the ROOT connection group
      // await axios.patch(
      //   `${this.baseUrl}/api/session/data/${this.dataSource}/users/${username}/permissions`,
      //   [
      //     {
      //       op: 'add',
      //       path: '/connectionGroupPermissions/ROOT',
      //       value: 'READ'
      //     }
      //   ],
      //   {
      //     headers: {
      //       'Content-Type': 'application/json',
      //       'Guacamole-Token': adminToken
      //     }
      //   }
      // );
      // console.log(`Granted permissions to user ${username}`);
    } catch (error) {
      console.log('Error in Guac createUser.');
      if (isAxiosError(error)) {
        handleAxiosError(error);
      } else {
        console.log(error);
      }
    }
  }

  private async getUserToken(username: string): Promise<string> {
    try {
      // Get admin token first to create/update user if needed
      const adminToken = await this.getAdminToken();
      await this.createUser(adminToken, username);

      // Now get the user token
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', this.gymSecret);

      const response = await axios.post(`${this.baseUrl}/api/tokens`, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!response.data?.authToken) {
        throw new Error('No auth token in response');
      }

      return response.data.authToken;
    } catch (error) {
      console.log('Error getting guac user token');
      if (isAxiosError(error)) {
        handleAxiosError(error);
      }
      throw error;
    }
  }

  private async createOrGetRDPConnection(
    token: string,
    ip: string,
    username: string,
    password: string
  ): Promise<string> {
    try {
      const connectionName = `RDP-${ip}-${username}`;
      let connectionId: string | null = null;

      // Try to get existing connection
      try {
        const response = await axios.get(
          `${this.baseUrl}/api/session/data/${this.dataSource}/connections`,
          {
            headers: {
              'Guacamole-Token': token
            }
          }
        );

        // Look for existing connection with same name
        const connections = response.data;
        for (const [id, connection] of Object.entries(connections)) {
          if ((connection as any).name === connectionName) {
            connectionId = id as string;
            break;
          }
        }
      } catch (error) {
        console.log('Error checking existing connections:', error);
      }

      // Define the RDP connection configuration
      const connection: GuacamoleConnection = {
        name: connectionName,
        parentIdentifier: 'ROOT',
        protocol: 'rdp',
        parameters: {
          hostname: ip,
          port: '3389',
          username: username,
          password: password,
          security: 'any',
          'ignore-cert': 'true',
          width: '1280',
          height: '800',
          dpi: '96',
          'recording-path': '/var/lib/guacamole/recordings',
          'recording-name': '${HISTORY_UUID}',
          'recording-include-keys': 'true',
          'create-recording-path': 'true',
          'enable-recording': 'true',
          'enable-wallpaper': 'true',
          'disable-auth': 'false'
        },
        attributes: {
          'max-connections': '1',
          'max-connections-per-user': '1'
        }
      };

      if (connectionId) {
        // Update existing connection
        await axios.put(
          `${this.baseUrl}/api/session/data/${this.dataSource}/connections/${connectionId}`,
          connection,
          {
            headers: {
              'Content-Type': 'application/json',
              'Guacamole-Token': token
            }
          }
        );
        console.log(`Updated existing connection: ${connectionName}`);
        return connectionId;
      }

      // Create new connection if none exists
      console.log(`Creating new connection: ${connectionName}`);
      const createResponse = await axios.post(
        `${this.baseUrl}/api/session/data/${this.dataSource}/connections`,
        connection,
        {
          headers: {
            'Content-Type': 'application/json',
            'Guacamole-Token': token
          }
        }
      );

      if (!createResponse.data?.identifier) {
        throw new Error('No connection identifier in response');
      }

      return createResponse.data.identifier;
    } catch (error) {
      console.error('Connection creation/update error:', error);
      if (isAxiosError(error)) {
        handleAxiosError(error);
      }
      throw error;
    }
  }

  public async createSession(
    ip: string,
    username: string,
    password: string,
    address: string
  ): Promise<{ token: string; connectionId: string; clientId: string }> {
    try {
      // Get admin token first
      const adminToken = await this.getAdminToken();

      // Create/verify user exists and has permissions
      await this.createUser(adminToken, address);

      // Create or get existing RDP connection using admin token
      const connectionId = await this.createOrGetRDPConnection(adminToken, ip, username, password);
      console.log('Connection created/retrieved:', connectionId);

      // Grant the user access to the connection
      await axios.patch(
        `${this.baseUrl}/api/session/data/${this.dataSource}/users/${address}/permissions`,
        [
          {
            op: 'add',
            path: `/connectionPermissions/${connectionId}`,
            value: 'READ'
          }
        ],
        {
          headers: {
            'Content-Type': 'application/json',
            'Guacamole-Token': adminToken
          }
        }
      );
      console.log('Granted connection permissions to user');

      // Now get user token for the session
      const userToken = await this.getUserToken(address);
      console.log('Got user token');

      // Generate the client identifier
      const clientId = this.encodeClientIdentifier(connectionId);
      console.log('Generated client ID:', clientId);

      return {
        token: userToken,
        connectionId,
        clientId
      };
    } catch (error) {
      console.error('Error creating Guacamole session');
      throw error;
    }
  }

  private async extractFramesFromRecording(
    recordingPath: string,
    numFrames: number = 1,
    fps: number = 1
  ): Promise<FrameInfo[]> {
    try {
      console.log('Starting frame extraction for recording:', recordingPath);

      // Verify recording file exists and is readable
      if (!fs.existsSync(recordingPath)) {
        throw new Error(`Recording file not found at ${recordingPath}`);
      }

      const recordingStats = fs.statSync(recordingPath);
      console.log('Recording file stats:', {
        size: recordingStats.size,
        mtime: recordingStats.mtime
      });

      // Create unique temporary directory
      const sessionId = path.basename(recordingPath);
      const tempSessionDir = path.join(this.tempDir, sessionId);

      console.log('Creating temp directory:', tempSessionDir);
      if (!fs.existsSync(tempSessionDir)) {
        fs.mkdirSync(tempSessionDir, { recursive: true });
      }

      // Run guacenc with verbose output
      const videoPath = path.join(tempSessionDir, 'recording.m4v');
      console.log('Converting recording to video...');

      try {
        const { stdout, stderr } = await execAsync(`guacenc -f "${recordingPath}" 2>&1`);
        console.log('guacenc stdout:', stdout);
        console.log('guacenc stderr:', stderr);
      } catch (error: any) {
        console.error('guacenc error:', error);
        console.error('guacenc stdout:', error.stdout);
        console.error('guacenc stderr:', error.stderr);
        throw new Error(`guacenc failed: ${error.message}`);
      }

      // The output will be recordingPath + '.m4v'
      const sourceVideoPath = recordingPath + '.m4v';
      console.log('Checking for video at:', sourceVideoPath);

      if (!fs.existsSync(sourceVideoPath)) {
        console.error('Video file not found after conversion');
        // List directory contents for debugging
        const dirContents = fs.readdirSync(path.dirname(recordingPath));
        console.log('Directory contents:', dirContents);
        throw new Error('Video conversion failed - output file not found');
      }

      // Move the video to our temp directory
      console.log('Moving video to temp directory');
      fs.renameSync(sourceVideoPath, videoPath);

      // Get video duration
      console.log('Getting video duration');
      const { stdout: durationOutput } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      );
      const duration = parseFloat(durationOutput);
      console.log('Video duration:', duration);

      // Calculate frame positions
      const frames: FrameInfo[] = [];
      const frameInterval = 1 / fps;
      const startTime = Math.max(0, duration - numFrames * frameInterval);

      console.log('Extracting frames:', {
        numFrames,
        frameInterval,
        startTime
      });

      for (let i = 0; i < numFrames; i++) {
        const timestamp = startTime + i * frameInterval;
        const outputPath = path.join(tempSessionDir, `frame-${i}.png`);

        console.log(`Extracting frame ${i} at timestamp ${timestamp}`);
        try {
          const { stdout: ffmpegOut, stderr: ffmpegErr } = await execAsync(
            `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 -y "${outputPath}"`
          );
          if (ffmpegErr) {
            console.log('ffmpeg stderr:', ffmpegErr);
          }
        } catch (error: any) {
          console.error('ffmpeg error:', error);
          continue;
        }

        if (fs.existsSync(outputPath)) {
          frames.push({
            timestamp: timestamp * 1000, // Convert to milliseconds
            buffer: fs.readFileSync(outputPath)
          });
        }
      }

      console.log(`Successfully extracted ${frames.length} frames`);

      // Cleanup
      try {
        fs.rmSync(tempSessionDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Error cleaning up temp directory:', error);
      }

      return frames.reverse();
    } catch (error) {
      console.error('Error in extractFramesFromRecording:', error);
      throw error;
    }
  }

  public async getActiveSession(address: string): Promise<{
    token: string;
    connectionId: string;
    recordingId: string;
    clientId: string;
  } | null> {
    try {
      // Get user token
      const token = await this.getUserToken(address);

      // Get connection history
      const historyResponse = await axios.get(
        `${this.baseUrl}/api/session/data/${this.dataSource}/history/connections`,
        {
          headers: {
            'Guacamole-Token': token
          }
        }
      );

      // Find active connection
      const activeConnection = historyResponse.data?.find((entry: any) => entry.endDate === null);
      if (!activeConnection?.connectionIdentifier) {
        return null;
      }

      return {
        token,
        connectionId: activeConnection.connectionIdentifier,
        recordingId: activeConnection.uuid,
        clientId: this.encodeClientIdentifier(activeConnection.connectionIdentifier)
      };
    } catch (error) {
      console.error('Error getting active session.');
      if ((error as Error).message.includes('AxiosError')) {
        const err = error as AxiosError;
        console.log({
          code: err.code,
          status: err.response?.status,
          message: err.response?.statusText,
          details: err.response?.data
        });
      } else console.log(error);

      return null;
    }
  }

  public async getScreenshots(
    token: string,
    clientId: string,
    guacUsername: string,
    numFrames: number = 1,
    fps: number = 1
  ): Promise<FrameInfo[]> {
    try {
      const historyResponse = await axios.get(
        `${this.baseUrl}/api/session/data/${this.dataSource}/history/connections`,
        {
          headers: {
            'Guacamole-Token': token
          }
        }
      );

      const activeConnection = historyResponse.data?.find((entry: any) => entry.endDate === null);
      if (!activeConnection?.uuid) throw new Error('No active connection found');

      const recordingPath = path.join(this.recordingsPath, activeConnection.uuid);

      if (fs.existsSync(recordingPath)) {
        const stats = fs.statSync(recordingPath);
        console.log('Recording file stats:', {
          size: stats.size,
          mtime: stats.mtime,
          age: Date.now() - stats.mtimeMs
        });

        // Wait a short time if the file was just modified
        if (Date.now() - stats.mtimeMs < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        const frames = await this.extractFramesFromRecording(recordingPath, numFrames, fps);
        if (frames.length > 0) {
          return frames;
        }

        throw new Error('No frames extracted from recording file');
      }

      throw new Error('Recording file not found');
    } catch (error) {
      console.error('Error getting screenshots:', error);
      throw error;
    }
  }

  // For backward compatibility
  public async getScreenshot(
    token: string,
    clientId: string,
    guacUsername: string
  ): Promise<Buffer> {
    const frames = await this.getScreenshots(token, clientId, guacUsername, 1, 1);
    if (frames.length === 0) {
      throw new Error('No frames extracted');
    }
    return frames[0].buffer;
  }

  public async removeReadPermission(address: string, connectionId: string) {
    try {
      // Get admin token to modify permissions
      const adminToken = await this.getAdminToken();

      // Remove READ permission from the connection
      await axios.patch(
        `${this.baseUrl}/api/session/data/${this.dataSource}/users/${address}/permissions`,
        [
          {
            op: 'remove',
            path: `/connectionPermissions/${connectionId}`,
            value: 'READ'
          }
        ],
        {
          headers: {
            'Content-Type': 'application/json',
            'Guacamole-Token': adminToken
          }
        }
      );

      console.log(`Removed READ permission for user ${address} on connection ${connectionId}`);
    } catch (error) {
      // If it's a 404, the permission is already removed - treat as success
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.log(`Permission already removed for user ${address} on connection ${connectionId}`);
        return;
      }

      // For any other error, log but don't throw to prevent breaking the expiry flow
      console.error('Error removing READ permission:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
      }
    }
  }

  public async cleanupSession(token: string, connectionId: string) {
    // Delete the connection
    await axios.delete(
      `${this.baseUrl}/api/session/data/${this.dataSource}/connections/${connectionId}`,
      {
        headers: {
          'Guacamole-Token': token
        }
      }
    );

    // Delete the token
    await axios.delete(`${this.baseUrl}/api/tokens/${token}`, {
      headers: {
        'Guacamole-Token': token
      }
    });
  }
}

export default GuacamoleService;
