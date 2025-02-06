const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class Lobby {
  constructor(id) {
    this.id = id;
    this.players = [];
  }

  addPlayer(ws) {
    this.players.push(ws);
    this.broadcast({ message: 'join', id: `${ws.id}` });
    this.broadcastLobbyLength();
    this.broadcastPlayerIds();
  }

  removePlayer(ws) {
    this.players = this.players.filter(player => player !== ws);
    this.broadcast({ message: 'left', id: `${ws.id}` });
    this.broadcastLobbyLength();
    this.broadcastPlayerIds();
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.players.forEach(player => {
      player.send(message);
    });
  }
  broadcastPlayerIds() {
    const playerIds = this.players.map(player => player.id);
    const data = { type: 'playerIds', ids: playerIds };
    this.broadcast(data);
  }
  broadcastLobbyLength() {
    const data = { type: 'lobbyLength', length: this.players.length };
    this.broadcast(data);
  }
}

class LobbyManager {
  constructor(maxPlayersPerLobby) {
    this.maxPlayersPerLobby = maxPlayersPerLobby;
    this.lobbies = [];
  }

  getAvailableLobby() {
    let lobby = this.lobbies.find(lobby => lobby.players.length < this.maxPlayersPerLobby);
    if (!lobby) {
      lobby = new Lobby(this.lobbies.length + 1);
      this.lobbies.push(lobby);
    }
    return lobby;
  }
}

const wss = new WebSocket.Server({ port: 8080 });
const lobbyManager = new LobbyManager(5); // Set max players per lobby to 5

wss.on('connection', function connection(ws) {
  const lobby = lobbyManager.getAvailableLobby();
  ws.id = uuidv4(); // Generate a unique ID for the player
  console.log(`${ws.id} connected to Lobby ${lobby.id}.`);
  lobby.addPlayer(ws);

  ws.on('message', function incoming(message) {
    console.log('Received: %s', message);
    lobby.broadcast({ type: 'message', content: `${ws.id}: ${message}` });
  });

  ws.on('error', function(error) {
    console.error('Connection error:', error);
  });

  ws.on('close', function close() {
    console.log(`${ws.id} disconnected from Lobby ${lobby.id}.`);
    lobby.removePlayer(ws);
  });
});

console.log('WebSocket server is running on port 8080.');