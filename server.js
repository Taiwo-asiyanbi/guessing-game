const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let sessions = {}; // { sessionId: { masterId, players, question, answer, isActive, startTime } }
let scores = {};   // { playerName: points }

// Utility: generate random session IDs
const generateId = () => Math.random().toString(36).substring(2, 9);

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create a new game session (Game Master)
  socket.on("createSession", (playerName) => {
    const sessionId = generateId();
    sessions[sessionId] = {
      masterId: socket.id,
      players: [{ id: socket.id, name: playerName, attemptsLeft: 3 }],
      question: null,
      answer: null,
      isActive: false,
      startTime: null,
    };
    scores[playerName] = scores[playerName] || 0;
    socket.join(sessionId);
    io.to(sessionId).emit("sessionCreated", { sessionId, master: playerName });
  });

  // Join existing session
  socket.on("joinSession", ({ sessionId, playerName }) => {
    const session = sessions[sessionId];
    if (!session || session.isActive) {
      socket.emit("errorMsg", "Cannot join session right now.");
      return;
    }
    session.players.push({ id: socket.id, name: playerName, attemptsLeft: 3 });
    scores[playerName] = scores[playerName] || 0;
    socket.join(sessionId);
    io.to(sessionId).emit("playerJoined", {
      players: session.players.map((p) => p.name),
    });
  });

  // Master sets question and answer
  socket.on("setQuestion", ({ sessionId, question, answer }) => {
    const session = sessions[sessionId];
    if (session.masterId !== socket.id) {
      socket.emit("errorMsg", "Only the game master can set a question.");
      return;
    }
    session.question = question;
    session.answer = answer.toLowerCase();
    io.to(sessionId).emit("questionSet", { question });
  });

  // Start game session
  socket.on("startGame", (sessionId) => {
    const session = sessions[sessionId];
    if (!session || session.masterId !== socket.id) return;
    if (session.players.length < 3) {
      socket.emit("errorMsg", "Need at least 3 players to start.");
      return;
    }
    session.isActive = true;
    session.startTime = Date.now();
    io.to(sessionId).emit("gameStarted", { question: session.question });

    // End game after 60s if no winner
    setTimeout(() => {
      if (session.isActive) {
        session.isActive = false;
        io.to(sessionId).emit("gameEnded", {
          winner: null,
          answer: session.answer,
          scores,
        });
        // Rotate master to next player
        if (session.players.length > 1) {
          session.masterId = session.players[1].id;
          io.to(sessionId).emit("newMaster", {
            master: session.players[1].name,
          });
        }
      }
    }, 60000);
  });

  // Player submits guess
  socket.on("submitGuess", ({ sessionId, guess }) => {
    const session = sessions[sessionId];
    if (!session || !session.isActive) return;

    const player = session.players.find((p) => p.id === socket.id);
    if (!player || player.attemptsLeft <= 0) {
      socket.emit("errorMsg", "No attempts left.");
      return;
    }

    player.attemptsLeft -= 1;
    if (guess.toLowerCase() === session.answer) {
      session.isActive = false;
      scores[player.name] = (scores[player.name] || 0) + 10;

      // Personalized winner message
      socket.emit("winnerMsg", "You have won!");

      io.to(sessionId).emit("gameEnded", {
        winner: player.name,
        answer: session.answer,
        scores,
      });

      // Rotate master to next player
      const currentIndex = session.players.findIndex((p) => p.id === socket.id);
      const nextIndex = (currentIndex + 1) % session.players.length;
      session.masterId = session.players[nextIndex].id;
      io.to(sessionId).emit("newMaster", {
        master: session.players[nextIndex].name,
      });
    } else {
      socket.emit("wrongGuess", { attemptsLeft: player.attemptsLeft });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const [id, session] of Object.entries(sessions)) {
      session.players = session.players.filter((p) => p.id !== socket.id);
      if (session.players.length === 0) {
        delete sessions[id];
      }
    }
  });
});

server.listen(5900, () => {
  console.log("Server running on http://localhost:5900");
});
