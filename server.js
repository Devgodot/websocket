const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class Lobby {
  constructor(id, maxPlayers, lobbyManager) {
    this.id = id;
    this.players = [];
    this.maxPlayers = maxPlayers;
    this.active = false;
    this.lobbyManager = lobbyManager; // Reference to the LobbyManager
    this.playerData = new Map(); // Store player information
  }

  addPlayer(ws, reconnecting = false) {
    if (this.players.length < this.maxPlayers || reconnecting) {
      ws.disconnected = false;
if (!reconnecting) {
      this.players.push(ws);
      this.playerData.set(ws.id, { position: { x: 0, y: 0 }, rotation: 0, health: 100 }); // Initialize player data
}
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
      this.playerData.delete(ws.id); // Remove player data
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

  updatePlayerData(ws, data) {
    if (this.playerData.has(ws.id)) {
      const playerData = this.playerData.get(ws.id);
      Object.assign(playerData, data); // Update player data
      this.playerData.set(ws.id, playerData);
      this.broadcast({ type: 'updatePlayerData', id: ws.id, data: playerData });
    }
  }

  getAllPlayerData() {
    const allPlayerData = [];
    this.playerData.forEach((data, id) => {
      allPlayerData.push({ id, data });
    });
    return allPlayerData;
  }
}

class LobbyManager {
  constructor() {
    this.lobbies = [];
    this.playerLobbies = new Map(); // Store player lobby information
    this.disconnectedPlayers = new Map(); // Store disconnected player information
  }

  createLobby(maxPlayers) {
    const lobby = new Lobby(uuidv4(), maxPlayers, this);
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

  assignPlayerToLobby(ws, lobby, reconnecting = false) {
    ws.lobbyId = lobby.id;
    this.playerLobbies.set(ws.id, lobby.id);
        lobby.addPlayer(ws, reconnecting);
    ws.send(JSON.stringify({ type: 'lobbyId', id: lobby.id })); // Send lobby ID to the player

    // Send all player data to the reconnecting player
    if (reconnecting) {
      const allPlayerData = lobby.getAllPlayerData();
      ws.send(JSON.stringify({ type: 'allPlayerData', data: allPlayerData }));
    }
  }

  removePlayerFromLobby(ws) {
    const lobbyId = this.playerLobbies.get(ws.id);
    if (lobbyId) {
      const lobby = this.getLobbyById(lobbyId);
      if (lobby) {
        lobby.removePlayer(ws);
      }
      this.playerLobbies.delete(ws.id);
      this.disconnectedPlayers.set(ws.id, { lobbyId, playerData: lobby.playerData.get(ws.id) }); // Store disconnected player information
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

  handleReconnection(ws) {
    const disconnectedPlayer = this.disconnectedPlayers.get(ws.id);
    if (disconnectedPlayer) {
      const lobby = this.getLobbyById(disconnectedPlayer.lobbyId);
      if (lobby) {
        console.log(`${ws.id} reconnected to Lobby ${lobby.id}.`);
        lobby.playerData.set(ws.id, disconnectedPlayer.playerData); // Restore player data
        this.assignPlayerToLobby(ws, lobby, true); // Pass true to indicate reconnection
        this.disconnectedPlayers.delete(ws.id); // Remove from disconnected players
      }
    } 
  }
}

const wss = new WebSocket.Server({ port: 8080 });
const lobbyManager = new LobbyManager();

wss.on('connection', function connection(ws) {
  ws.id = uuidv4(); // Generate a unique ID for the player

  ws.on('message', function incoming(message) {
    const data = JSON.parse(message);
    if (data.type === 'setId') {
      ws.id = data.id;
       // Handle reconnection
      lobbyManager.handleReconnection(ws);
    } else if (data.type === 'setLobbySize') {
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
    } else if (data.type === 'updatePlayerData') {
      const lobby = lobbyManager.getLobbyById(ws.lobbyId);
      if (lobby) {
        lobby.updatePlayerData(ws, data.data);
      }
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
});

console.log('WebSocket server is running on port 8080.');