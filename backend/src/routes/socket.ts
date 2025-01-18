import { Router } from "express";
import { Server, Socket } from "socket.io";
// @ts-ignore
import VncClient from "vnc-rfb-client";
import { ChildProcess, spawn } from "child_process";
import sharp from "sharp";
import { executeComputerAction } from "../services/vnc/actions.ts";
import OpenAI from "openai";
import { Http2Server } from "http2";
import { Server as HttpServer } from "http";
import DatabaseService from "../services/db/index.ts";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const socketRoute = Router();

async function generateQuest(imageBase64: string) {
  // Predefined single-step quests with hints
  const questTemplates = [
    {
      quest: "Open the activities menu and search for 'Terminal'",
      hint: "Press Super key or click Activities in the top-left corner",
    },
    {
      quest: "Create a folder named 'Projects' on the desktop",
      hint: "Right-click on desktop and select 'New Folder'",
    },
    {
      quest: "Open LibreOffice and start a new spreadsheet",
      hint: "Search for 'LibreOffice Calc' in your applications",
    },
    {
      quest: "Go to a simple web game like Chrome's dino game",
      hint: "Type 'chrome://dino' in Chrome's address bar",
    },
    {
      quest: "Create 'notes.txt' in a folder and write 'hello<TAB>'",
      hint: "Right-click in folder, select 'New Text Document'",
    },
    {
      quest: "Open MS Paint and draw a smiley face",
      hint: "Search for 'Paint' in your start menu",
    },
    {
      quest: "Open the calculator app and perform 123 + 456",
      hint: "Search for 'Calculator' in your applications",
    },
    {
      quest: "Open the browser and search for 'weather today'",
      hint: "Press Super key and type 'Firefox' or 'Chrome'",
    },
    {
      quest: "Take a screenshot of your desktop",
      hint: "Press PrintScreen or use Screenshot tool",
    },
    {
      quest: "Visit a random Wikipedia article and read 2 paragraphs",
      hint: "Go to Wikipedia and click 'Random article'",
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an AI assistant that needs to propose a ms-paint related computer-use quest based on the user's current screen state (try tasks that involve mouse drags, i.e. sliders, doodling [thing] on online mspaint (do this do this)). Please do a doodling task. Please provide the output in a JSON code block with "quest" and "hint" keys. Start with a mspaint related task.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: 150,
    });

    // Extract JSON from markdown code block
    const jsonMatch = response.choices[0].message.content?.match(
      /```json\s*({[\s\S]*?})\s*```/
    );
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error("No valid JSON found in response");
  } catch (error) {
    console.error("Error generating quest:", error);
    // Return a random quest from templates
    return questTemplates[Math.floor(Math.random() * questTemplates.length)];
  }
}

async function generateHint(
  imageBase64: string,
  currentQuest: string,
  socket: Socket
) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Current quest: ${currentQuest}\nProvide a single actionable hint that includes one of these patterns if applicable:\n- Type 'x[TAB]' to autocomplete\n- Scroll in [area] to find [target]\n- Click the [specific element]\n- Move cursor to [exact location]\nKeep it to one sentence.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 60,
      stream: true,
    });

    let hintText = "";
    for await (const chunk of response) {
      if (chunk.choices[0]?.delta?.content) {
        hintText += chunk.choices[0].delta.content;
        socket.emit("hint_update", { hint: hintText });
      }
    }

    // Emit final hint as training event
    const eventData = {
      type: "hint",
      message: hintText,
      session: socket.handshake.query.sessionId,
      frame: 0,
      timestamp: Date.now()
    };

    socket.emit("training_event", eventData);
    await DatabaseService.createTrainingEvent(eventData);

    return hintText;
  } catch (error) {
    console.error("Error generating hint:", error);
    const fallbackHint =
      "Scroll in the environments list to explore available tasks";
    socket.emit("hint_update", { hint: fallbackHint });
    return fallbackHint;
  }
}

class Episode {
  socket: Socket;
  fps: number;
  frameInterval: number;
  client: VncClient | null;
  ffmpeg: ChildProcess | null;
  recordingTimer: NodeJS.Timeout | null;
  frameTimer: NodeJS.Timeout | null;
  isReplayingTrajectory: boolean;
  currentQuest: string | null;
  isGeneratingHint: boolean;
  startTime: number | undefined;
  frameCount: number;

  constructor(
    socket: Socket,
    options: { fps?: number; frameInterval?: number } = {}
  ) {
    this.socket = socket;
    this.fps = options.fps || 15;
    this.frameInterval = options.frameInterval || 1000; // 1 second for sending frames to client
    this.client = null;
    this.ffmpeg = null;
    this.recordingTimer = null;
    this.frameTimer = null;
    this.isReplayingTrajectory = false;
    this.currentQuest = null;
    this.isGeneratingHint = false;
    this.frameCount = 0;
  }

  async connect(host = "127.0.0.1", port = 5900, password = "abc123") {
    const initialEvents = [
      {
        type: "task",
        message: "Neural Link established. You are now part of VM-1's collective intelligence network."
      },
      {
        type: "task",
        message: "As part of the swarm, your interactions teach fundamental patterns of computer control."
      },
      {
        type: "task",
        message: "At scale, simple demonstrations combine into sophisticated patterns, emerging minds that navigate digital worlds with purpose and precision."
      }
    ];

    // Emit and store initial events
    for (const event of initialEvents) {
      const eventData = {
        ...event,
        session: this.socket.handshake.query.sessionId,
        frame: 0,
        timestamp: Date.now()
      };
      this.socket.emit("training_event", eventData);
      await DatabaseService.createTrainingEvent(eventData);
    }

    this.client = new VncClient({
      fps: this.fps,
      debug: false,
      debugLevel: 1,
      encodings: [
        VncClient.consts.encodings.copyRect,
        VncClient.consts.encodings.zrle,
        VncClient.consts.encodings.hextile,
        VncClient.consts.encodings.raw,
        VncClient.consts.encodings.pseudoDesktopSize,
      ],
    });

    this.client.connect({ host, port, password });

    this.client.on("firstFrameUpdate", async () => {
      console.log("VNC Session started, beginning recording...");
      const sessionId = this.socket.handshake.query.sessionId as string;
      this.socket.emit("recording_started", { sessionId });
      
      const eventData = {
        type: "system",
        message: "VNC connection established. Starting session recording.",
        session: sessionId,
        frame: 0,
        timestamp: Date.now()
      };
      this.socket.emit("training_event", eventData);
      await DatabaseService.createTrainingEvent(eventData);

      // Get first frame and generate quest
      const fb = this.client.getFb();
      const { clientWidth, clientHeight } = this.client;
      const jpeg = await sharp(fb, {
        raw: {
          width: clientWidth,
          height: clientHeight,
          channels: 4,
        },
      })
        .jpeg()
        .toBuffer();

      const questData = await generateQuest(jpeg.toString("base64"));
      this.currentQuest = questData.quest;

      // Emit and store quest event
      const questEvent = {
        type: "quest",
        message: questData.quest,
        session: sessionId,
        frame: 0,
        timestamp: Date.now()
      };
      this.socket.emit("training_event", questEvent);
      await DatabaseService.createTrainingEvent(questEvent);

      // Emit and store hint event
      const hintEvent = {
        type: "hint",
        message: questData.hint,
        session: sessionId,
        frame: 0,
        timestamp: Date.now()
      };
      this.socket.emit("training_event", hintEvent);
      await DatabaseService.createTrainingEvent(hintEvent);

      // Also emit quest_update for overlay
      this.socket.emit("quest_update", {
        quest: questData.quest,
        hint: questData.hint,
      });

      this.startRecording();
      this.startFrameSending();
    });

    this.client.on("disconnect", () => {
      console.log("VNC session disconnected.");
      this.close();
    });
  }

  startRecording() {
    const { clientWidth, clientHeight } = this.client;
    const sessionId = this.socket.handshake.query.sessionId as string;
    const videoPath = path.resolve(process.cwd(), `public/recordings/${sessionId}.mp4`);

    // Update session with video path
    DatabaseService.updateRaceSession(sessionId, {
      video_path: videoPath
    });

    const ffmpegArgs = [
      "-loglevel",
      "error",
      "-hide_banner",
      "-y",
      "-f",
      "rawvideo",
      "-vcodec",
      "rawvideo",
      "-an",
      "-pix_fmt",
      "rgba",
      "-s",
      `${clientWidth}x${clientHeight}`,
      "-r",
      `${this.fps}`,
      "-i",
      "-",
      "-an",
      "-r",
      `${this.fps}`,
      "-vcodec",
      "libx264rgb",
      videoPath,
    ];

    // Debug log the full command
    console.log('Starting ffmpeg with command:', 'ffmpeg', ffmpegArgs.join(' '));

    this.ffmpeg = spawn("ffmpeg", ffmpegArgs);

    // Log any ffmpeg errors
    this.ffmpeg.stderr?.on('data', (data) => {
      console.error('FFmpeg error:', data.toString());
    });

    this.recordFrame();
  }

  recordFrame() {
    this.recordingTimer = setTimeout(() => {
      this.recordFrame();
      this.ffmpeg?.stdin?.write(this.client.getFb());
      this.frameCount++;
    }, 1000 / this.fps);
  }

  async startFrameSending() {
    this.frameTimer = setInterval(async () => {
      try {
        const fb = this.client.getFb();
        const { clientWidth, clientHeight } = this.client;

        const jpeg = await sharp(fb, {
          raw: {
            width: clientWidth,
            height: clientHeight,
            channels: 4,
          },
        })
          .jpeg()
          .toBuffer();

        this.socket.emit("frame", {
          buffer: jpeg.toString("base64"),
          width: clientWidth,
          height: clientHeight,
          frame: this.frameCount
        });
      } catch (err) {
        console.error("Error sending frame:", err);
      }
    }, this.frameInterval);
  }

  async close() {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
    }
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill("SIGINT");
    }
    if (this.client) {
      this.client.end();
    }

    // Log disconnection event
    const sessionId = this.socket.handshake.query.sessionId;
    if (sessionId) {
      const eventData = {
        type: "system",
        message: "Disconnected from VNC server",
        session: sessionId,
        frame: 0,
        timestamp: Date.now()
      };
      await DatabaseService.createTrainingEvent(eventData);
    }
  }
}

export function initializeSocketIO(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", async (socket) => {
    console.log("Socket.io connected");

    const { sessionId } = socket.handshake.query;
    if (!sessionId) {
      console.error("No session ID provided");
      socket.disconnect();
      return;
    }

    // Get session details from database
    const session = await DatabaseService.getRaceSession(sessionId as string);
    if (!session) {
      console.error("Session not found");
      socket.disconnect();
      return;
    }

    const episode = new Episode(socket);
    episode.connect(session.vm_ip, session.vm_port, session.vm_password);

    socket.on("disconnect", () => {
      console.log("Socket.io disconnected");
      episode.close();
    });

    socket.on("request_hint", async () => {
      if (episode.isGeneratingHint) {
        console.log("Hint generation already in progress");
        return;
      }

      try {
        episode.isGeneratingHint = true;
        const fb = episode.client.getFb();
        const { clientWidth, clientHeight } = episode.client;

        const jpeg = await sharp(fb, {
          raw: {
            width: clientWidth,
            height: clientHeight,
            channels: 4,
          },
        })
          .jpeg()
          .toBuffer();

        await generateHint(
          jpeg.toString("base64"),
          episode.currentQuest || "",
          socket
        );
      } catch (error) {
        console.error("Error generating hint:", error);
        socket.emit("hint_update", {
          hint: "Try exploring the visible interface elements",
        });
      } finally {
        episode.isGeneratingHint = false;
      }
    });

    socket.on("vnc_keypress", async (data) => {
      console.log(data);

      try {
        const result = await executeComputerAction(
          "key",
          { text: data.key },
          episode.client
        );

        const eventData = {
          type: "keyboard",
          message: `Key pressed: ${data.key}`,
          result,
          session: sessionId,
          frame: data.frame,
          timestamp: Date.now()
        };

        socket.emit("training_event", eventData);
        await DatabaseService.createTrainingEvent(eventData);
      } catch (error) {
        console.error("Error handling keypress:", error);
        const errorEvent = {
          type: "error",
          message: `Failed to process key: ${data.key}`,
          session: sessionId,
          frame: data.frame,
          timestamp: Date.now()
        };
        socket.emit("training_event", errorEvent);
        await DatabaseService.createTrainingEvent(errorEvent);
      }
    });

    socket.on("vnc_mouse", async (data) => {
      try {
        let result;
        let eventMessage;
        let eventData: {
          type: string;
          coordinates: { x: number; y: number } | undefined;
          trajectory: any;
          session: string;
          frame: number;
          timestamp: number;
          message?: string;
        } = {
          type: "mouse",
          coordinates: undefined,
          trajectory: undefined,
          session: sessionId as string,
          frame: data.frame,
          timestamp: Date.now()
        };

        if (!data.action && !data.button && episode.isReplayingTrajectory) {
          return;
        }

        if (data.action?.endsWith("_drag")) {
          episode.isReplayingTrajectory = true;
          result = await executeComputerAction(
            data.action,
            {
              trajectory: data.trajectory,
            },
            episode.client
          );
          episode.isReplayingTrajectory = false;

          eventMessage = `Mouse ${data.action.replace("_", " ")}`;
          eventData.trajectory = data.trajectory;
        } else if (
          data.action === "scroll_up" ||
          data.action === "scroll_down"
        ) {
          result = await executeComputerAction(data.action, {}, episode.client);
          eventMessage = `Mouse ${data.action.replace("_", " ")}`;
        } else {
          if (data.button === 1) {
            result = await executeComputerAction(
              "left_click",
              {},
              episode.client
            );
            eventMessage = "Left click";
          } else if (data.button === 2) {
            result = await executeComputerAction(
              "right_click",
              {},
              episode.client
            );
            eventMessage = "Right click";
          } else if (data.button === 3) {
            result = await executeComputerAction(
              "middle_click",
              {},
              episode.client
            );
            eventMessage = "Middle click";
          } else {
            result = await executeComputerAction(
              "mouse_move",
              {
                coordinate: [data.x, data.y],
              },
              episode.client
            );
            return; // Don't emit events for mouse moves
          }

          if (data.x !== undefined && data.y !== undefined) {
            eventData.coordinates = { x: data.x, y: data.y };
          }
        }

        eventData.message = eventMessage;
        socket.emit("training_event", eventData);
        await DatabaseService.createTrainingEvent(eventData);
      } catch (error) {
        console.error("Error handling mouse event:", error);
        const errorEvent = {
          type: "error",
          message: `Failed to process mouse event: ${(error as Error).message}`,
          session: sessionId,
          frame: data.frame,
          timestamp: Date.now()
        };
        socket.emit("training_event", errorEvent);
        await DatabaseService.createTrainingEvent(errorEvent);
      }
    });
  });

  return io;
}
