const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

const app = express();
const cache = new NodeCache({ stdTTL: 600 });
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "0fbfa053-a41d-487b-b5f3-930d505d3a0e";
const MAX_GAMES = 10;

// Limit requests for protection (10 por minuto)
app.use(rateLimit({ windowMs: 60 * 1000, max: 10 }));

// Simple logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// API Key check for security
app.use((req, res, next) => {
  if (req.path.startsWith('/gamepasses/')) {
    const key = req.header('x-api-key');
    if (!key || key !== API_KEY) return res.status(401).json({ error: "API Key incorrecta" });
  }
  next();
});

const GAMES_URL = (userId, cursor) => 
  `https://games.roproxy.com/v2/users/${userId}/games?accessFilter=Public&limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
const GAMEPASSES_URL = (gameId, cursor) => 
  `https://games.roproxy.com/v1/games/${gameId}/game-passes?sortOrder=Asc&limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;

// Endpoint principal con paginación
app.get('/gamepasses/:userId', async (req, res) => {
  const userId = req.params.userId;
  const offset = parseInt(req.query.offset) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // máx 100 por página

  const cacheKey = `${userId}_all`;
  let allPasses = cache.get(cacheKey);

  if (!allPasses) {
    let games = [], cursor = null;
    try {
      do {
        let response = await axios.get(GAMES_URL(userId, cursor));
        games = games.concat((response.data.data || []).map(game => game.id));
        cursor = response.data.nextPageCursor;
      } while (cursor && games.length < MAX_GAMES);
      games = games.slice(0, MAX_GAMES);
    } catch (err) {
      return res.status(500).json({ error: "Error obteniendo universos: " + err.message });
    }

    let passes = [];
    try {
      await Promise.all(games.map(async (gameId) => {
        let passCursor = null;
        do {
          let response = await axios.get(GAMEPASSES_URL(gameId, passCursor));
          let data = response.data.data || [];
          passes = passes.concat(data.filter(gp => gp.price && gp.price > 0)
            .map(gp => ({
              id: gp.id,
              name: gp.displayName || gp.name,
              price: gp.price,
              gameId: gameId,
              imageUrl: gp.imageUrl || null,
              url: `https://www.roblox.com/game-pass/${gp.id}`
            })));
          passCursor = response.data.nextPageCursor;
        } while (passCursor);
      }));
    } catch (err) {
      return res.status(500).json({ error: "Error obteniendo GamePasses: " + err.message });
    }
    passes.sort((a, b) => a.price - b.price);
    cache.set(cacheKey, passes);
    allPasses = passes;
  }

  // Paginar
  const paginated = allPasses.slice(offset, offset + limit);
  res.json({
    data: paginated,
    total: allPasses.length,
    hasMore: offset + limit < allPasses.length
  });
});

// Mensaje básico en la raíz
app.get('/', (req, res) => {
  res.send('API para obtener GamePasses de un usuario de Roblox. Usa /gamepasses/<userId>?offset=0&limit=50 con el header x-api-key.');
});

app.listen(PORT, () => {
  console.log(`API GamePasses escuchando en puerto ${PORT}`);
});

