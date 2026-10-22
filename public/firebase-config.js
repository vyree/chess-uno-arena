/**
 * Client endpoints. Login is PARKED (Sensei, 2026-10-21): no Firebase
 * config ships to the client anymore - players use a nickname and their
 * progress is stored locally on their own device. Only the game-server
 * WebSocket endpoint lives here.
 */
window.CUA_WS_ENDPOINT = 'wss://chess-uno-arena.fly.dev'; // game server on Fly.io (PRIMARY since 2026-10-22)
