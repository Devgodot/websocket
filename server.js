const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class Lobby {
  constructor(id, maxPlayers, lobbyManager) {
    this.id = id;
    this.players = [];
    this.maxPlayers = maxPlayers;
    this.active = false;
    this.lobbyManager = lobbyManager; // Reference to the LobbyManager
  }

  addPlayer(ws) {
    if (this.players.length < this.maxPlayers) {
      ws.disconnected = false;
      this.players.push(ws);
      this.broadcast({ message: 'join', id: `${ws.id}` });
      this.broadcastLobbyLength();
      this.broadcastPlayerIds();
      if (this.players.length === this.maxPlayers) {
        this.activateLobby();
      }
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Lobby is full' }));
    }
  }

  removePlayer(ws) {
    if (this.active) {
      ws.disconnected = true;
      this.broadcast({ message: 'left', id: `${ws.id}` });
    } else {
      this.players = this.players.filter(player => player !== ws);
      this.broadcast({ message: 'left', id: `${ws.id}` });
      this.broadcastLobbyLength();
      this.broadcastPlayerIds();
    }
    this.checkAndDeleteLobby();
  }

  checkAndDeleteLobby() {
    if (this.players.every(player => player.disconnected)) {
      this.lobbyManager.deleteLobby(this.id);
      console.log(`Lobby ${this.id} deleted because all players are disconnected.`);
    }
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.players.forEach(player => {
      player.send(message);
    });
  }

  broadcastLobbyLength() {
    const data = { type: 'lobbyLength', length: this.players.length };
    this.broadcast(data);
  }

  broadcastPlayerIds() {
    const playerIds = this.players.map(player => player.id);
    const data = { type: 'playerIds', ids: playerIds };
    this.broadcast(data);
  }

  activateLobby() {
    this.active = true;
    this.broadcast({ type: 'lobbyStatus', status: 'active' });
    console.log(`Lobby ${this.id} is now active.`);

    // Generate a list of unique random numbers within the range of 0 to maxPlayers
    const uniqueNumbers = Array.from({ length: 10 }, (_, i) => i);
    uniqueNumbers.sort(() => Math.random() - 0.5); // Shuffle the array

    // Assign each player a unique number and send it to them
    this.players.forEach((player, index) => {
      const assignedNumber = uniqueNumbers;
      player.send(JSON.stringify({ type: 'assignedNumber', number: assignedNumber }));
    });
  }
}

class LobbyManager {
  constructor() {
    this.lobbies = [];
    this.playerLobbies = new Map(); // Store player lobby information
  }

  createLobby(maxPlayers) {
    const lobby = new Lobby(this.lobbies.length + 1, maxPlayers, this);
    this.lobbies.push(lobby);
    return lobby;
  }

  deleteLobby(lobbyId) {
    this.lobbies = this.lobbies.filter(lobby => lobby.id !== lobbyId);
  }

  getAvailableLobby() {
    let lobby = this.lobbies.find(lobby => lobby.players.length < lobby.maxPlayers && !lobby.active);
    if (!lobby) {
      lobby = this.createLobby(5); // Default max players per lobby
    }
    return lobby;
  }

  getLobbyById(lobbyId) {
    return this.lobbies.find(lobby => lobby.id === lobbyId);
  }

  assignPlayerToLobby(ws, lobby) {
    ws.lobbyId = lobby.id;
    this.playerLobbies.set(ws.id, lobby.id);
    lobby.addPlayer(ws);
    ws.send(JSON.stringify({ type: 'lobbyId', id: lobby.id })); // Send lobby ID to the player
  }

  removePlayerFromLobby(ws) {
    const lobbyId = this.playerLobbies.get(ws.id);
    if (lobbyId) {
      const lobby = this.getLobbyById(lobbyId);
      if (lobby) {
        lobby.removePlayer(ws);
      }
      this.playerLobbies.delete(ws.id);
    }
  }

  joinLobbyById(ws, lobbyId) {
    const lobby = this.getLobbyById(lobbyId);
    if (lobby) {
      this.assignPlayerToLobby(ws, lobby);
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found' }));
    }
  }

  getNonActiveLobbyBySize(size) {
    return this.lobbies.find(lobby => lobby.maxPlayers === size && !lobby.active);
  }
}

const wss = new WebSocket.Server({ port: 8080 });
const lobbyManager = new LobbyManager();

wss.on('connection', function connection(ws) {
  ws.id = uuidv4(); // Generate a unique ID for the player

  ws.on('message', function incoming(message) {
    const data = JSON.parse(message);
    if (data.type === 'setLobbySize') {
      let lobby = lobbyManager.getNonActiveLobbyBySize(data.size);
      if (lobby) {
        console.log(`Found non-active lobby ${lobby.id} with size ${data.size}.`);
      } else {
        lobby = lobbyManager.createLobby(data.size);
        console.log(`Created new lobby ${lobby.id} with size ${data.size}.`);
      }
      lobbyManager.assignPlayerToLobby(ws, lobby);
    } else if (data.type === 'deleteLobby') {
      const lobby = lobbyManager.getLobbyById(ws.lobbyId);
      if (lobby) {
        lobbyManager.deleteLobby(lobby.id);
        console.log(`Lobby ${lobby.id} deleted.`);
      }
    } else if (data.type === 'joinLobby') {
      lobbyManager.joinLobbyById(ws, data.lobbyId);
    } else {
      const lobby = lobbyManager.getLobbyById(ws.lobbyId);
      if (lobby) {
        console.log('Received: %s', message);
        lobby.broadcast({ type: 'message', id: `${ws.id}`, data: `${message}` });
      }
    }
  });

  ws.on('error', function(error) {
    console.error('Connection error:', error);
  });

  ws.on('close', function close() {
    console.log(`${ws.id} disconnected from Lobby ${ws.lobbyId}.`);
    lobbyManager.removePlayerFromLobby(ws);
  });

  // Handle reconnection
  const previousLobbyId = lobbyManager.playerLobbies.get(ws.id);
  if (previousLobbyId) {
    const lobby = lobbyManager.getLobbyById(previousLobbyId);
    if (lobby) {
      console.log(`${ws.id} reconnected to Lobby ${lobby.id}.`);
      lobbyManager.assignPlayerToLobby(ws, lobby);
    }
  } else {
    const lobby = lobbyManager.getAvailableLobby();
    console.log(`${ws.id} connected to Lobby ${lobby.id}.`);
    lobbyManager.assignPlayerToLobby(ws, lobby);
  }
});

console.log('WebSocket server is running on port 8080.');