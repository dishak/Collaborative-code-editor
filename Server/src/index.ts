import express, { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";
import cors from "cors";
import bcrypt from "bcrypt";
import ConnectDB from "./database";
import User from "./database/models/User";

const app = express();
const httpServer = app.listen(8080, () => {
  console.log("Server listening on port 8080");
});
app.use(cors());
app.use(express.json());

// connect to redis after launching it from docker

const redis_url =
  process.env.REDIS_URL === "No-Url-provided" ? "" : process.env.REDIS_URL;

const redisClient = createClient({
  url: redis_url,
});

const redisClientSubscribing = createClient({
  url: redis_url,
});

redisClient.connect().catch((err) => {
  console.log(err);
});
redisClientSubscribing.connect().catch((err) => {
  console.log(err);
});

type room = {
  name: string;
  roomId: string;
  users: Array<{
    username: string;
    ws: WebSocket;
  }>;
  code: string;
  chats: Array<{
    username: string;
    message: string;
  }>;
  language: string;
  result: string;
};

const rooms: room[] = [];

// Controllers
// typescript-eslint/no-explicit-any
function handleUserJoined(message: any, ws: WebSocket) {
  const { roomId, username } = message;

  // Find the room based on roomId
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    const notFoundMessage = JSON.stringify({
      Title: "Not-found",
    });
    ws.send(notFoundMessage);
    return;
  }

  console.log(ROOM);

  // Check if the user is already in the room
  const existingUserIndex = ROOM.users.findIndex(
    (user) => user.username === username,
  );
  if (existingUserIndex !== -1) {
    // Update the existing user's WebSocket connection
    ROOM.users[existingUserIndex].ws = ws;

    // Send room info to the existing user
    const roomInfoMessage = JSON.stringify({
      Title: "Room-Info",
      roomId,
      roomName: ROOM.name,
      users: ROOM.users.map((user) => user.username),
      code: ROOM.code,
      chats: ROOM.chats,
      language: ROOM.language,
      result: ROOM.result,
    });
    ws.send(roomInfoMessage);
    return;
  }

  // Add the user to the room
  ROOM.users.push({ username, ws });

  // Send a message to all other users in the room about the new user
  const newUserMessage = JSON.stringify({
    Title: "New-User",
    username,
  });

  ROOM.users.forEach((user) => {
    if (user.ws !== ws && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(newUserMessage);
    }
  });

  // Send room info to the newly joined user
  const roomInfoMessage = JSON.stringify({
    Title: "Room-Info",
    roomId,
    roomName: ROOM.name,
    users: ROOM.users.map((user) => user.username),
    code: ROOM.code,
    chats: ROOM.chats,
    language: ROOM.language,
    result: ROOM.result,
  });
  ws.send(roomInfoMessage);
}

function handleUserLeft(message: any) {
  const { roomId, username } = message;

  // Find the room based on roomId
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    return;
  }

  // Remove the user from the room
  ROOM.users = ROOM.users.filter((user) => user.username !== username);

  // Notify remaining users in the room
  const userLeftMessage = JSON.stringify({
    Title: "User-left",
    username,
    users: ROOM.users.map((user) => user.username),
  });

  ROOM.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(userLeftMessage);
    }
  });
}

function handleNewChat(message: any) {
  const { roomId, username, chat } = message;
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    return;
  }
  ROOM.chats.push({ username, message: chat });
  const newChatMessage = JSON.stringify({
    Title: "New-chat",
    username,
    chat,
  });
  ROOM.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(newChatMessage);
    }
  });
}

function handleLangChange(message: any) {
  const { roomId, lang } = message;
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    return;
  }
  ROOM.language = lang;
  const langChangeMessage = {
    Title: "lang-change",
    lang,
  };
  ROOM.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify(langChangeMessage));
    }
  });
}

function handleCodeChange(message: any) {
  const { roomId, code } = message;
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    return;
  }
  ROOM.code = code;
  const CodeChangeMessage = {
    Title: "Code-change",
    code,
  };
  ROOM.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify(CodeChangeMessage));
    }
  });
}

async function handleSubmitted(message: any) {
  const { roomId } = message;
  const ROOM = rooms.find((Room) => Room.roomId === roomId);
  if (!ROOM) {
    return;
  }

  const SubmitClickedMessage = {
    Title: "Submit-clicked",
  };

  ROOM.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify(SubmitClickedMessage));
    }
  });

  if (process.env.REDIS_URL === "No-Url-provided" || !process.env.REDIS_URL) {
    const resultMessage = {
      Title: "No-worker",
    };
    ROOM.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(resultMessage));
      }
    });
    return;
  }

  // push the message into submissions queue
  await redisClient.lPush("submissions", JSON.stringify(message));

  // subscribe to the roomId
  redisClientSubscribing.subscribe(roomId, (result) => {
    console.log(`Result for ${roomId}: ${result}`);

    // Parse the result received from the subscription
    const parsedResult = JSON.parse(result);

    // Create a new JSON object containing the required fields
    const resultMessage = {
      Title: "Result",
      stdout: parsedResult.stdout,
      stderr: parsedResult.stderr,
      status: parsedResult.status.description,
      compile_output: parsedResult.compile_output,
    };

    // Send the resultMessageString to each user in the room
    ROOM.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(resultMessage));
      }
    });
  });
}

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.on("error", console.error);

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    console.log("Message received:", message);
    if (message.Title === "User-joined") {
      handleUserJoined(message, ws);
    } else if (message.Title === "User-left") {
      handleUserLeft(message);
    } else if (message.Title === "New-chat") {
      handleNewChat(message);
    } else if (message.Title === "lang-change") {
      handleLangChange(message);
    } else if (message.Title === "Code-change") {
      handleCodeChange(message);
    } else if (message.Title === "Submitted") {
      handleSubmitted(message);
    }
  });

  ws.send(
    JSON.stringify({ Title: "Greet", msg: "Hello! Message From Server!!" }),
  );
});

app.post("/signin", async (req: Request, res: Response) => {
  await ConnectDB();
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: "user not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    return res.status(200).json({ message: "Login successful" });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/signup", async (req: Request, res: Response) => {
  await ConnectDB();
  const { username, password } = req.body;

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    return res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/create", (req: Request, res: Response) => {
  const { username, roomName, roomId } = req.body;
  if (!username || !roomName || !roomId) {
    res.status(400).json({ error: "Some error" });
    return;
  }

  const newRoom: room = {
    name: roomName,
    roomId,
    users: [],
    code: "",
    chats: [],
    language: "python",
    result: "",
  };

  rooms.push(newRoom);
  res.status(200).json({ message: "Room created successfully" });
});

// dummy route to confirm fe is hitting the be correctly from s3 to ec2
app.get("/", (req: Request, res: Response) => {
  console.log("Welcome!");
  res.send("Welcome to the server!");
});
