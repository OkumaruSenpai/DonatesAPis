const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

const app = express();
const cache = new NodeCache({ stdTTL: 600 });
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "5c33c9b1-0d17-47a4-ad9c-a4c92fd253f4";
const MAX_GAMES = 10;

// Lista de proxies a probar (en orden de preferencia)
const proxies = [
  'https://games.roproxy.com',
  'https://games.rproxy.io',
  'https://api.bloxproxy.xyz/games',
  'https://games.roblox-api.com',
];

app.use(rateLimit({ windowMs: 60 * 1000, max: 10 }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/gamepasses/')) {
    const key = req.header('x-api-key');
    if (!key || key !== API_KEY) return res.status(401).json({ error: "API Key incorrecta" });
  }
  next();
});

// Función para probar todos los proxies y usar el primero que responde bien
async function tryAllProxies(urlPath) {
  for (let base of proxies) {
    try {
      const resp = await axios.get(base + urlPath);
      if (resp.status === 200 && resp.data) return resp.data;
    } catch (err) {
      // Si es error, simplemente prueba el siguiente
      continue;
    }
  }
  throw new Error("Ningún proxy respondió correctamente.");
}

// Endpoint principal con paginación y multi-proxy
app.get('/gamepasses/:userId', async (req, res) => {
  const userId = req.params.userId;
  const offset = parseInt(req.query.offset) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // máx 100 por página

  const cacheKey = `${userId}_all`;
  let allPasses = cache.get(cacheKey);

  if (!allPasses) {
    let games = [];
    let gamesCursor = null;
    try {
      do {
        let path = `/v2/users/${userId}/games?accessFilter=Public&limit=50${gamesCursor ? '&cursor=' + encodeURIComponent(gamesCursor) : ''}`;
        let data = await tryAllProxies(path);
        games = games.concat((data.data || []).map(game => game.id));
        gamesCursor = data.nextPageCursor;
      } while (gamesCursor && games.length < MAX_GAMES);
      games = games.slice(0, MAX_GAMES);
    } catch (err) {
      return res.status(502).json({ error: "Error obteniendo universos: " + err.message });
    }

    let passes = [];
    try {
      await Promise.all(games.map(async (gameId) => {
        let passCursor = null;
        do {
          let path = `/v1/games/${gameId}/game-passes?sortOrder=Asc&limit=50${passCursor ? '&cursor=' + encodeURIComponent(passCursor) : ''}`;
          let data = await tryAllProxies(path);
          let arr = data.data || [];
          passes = passes.concat(arr.filter(gp => gp.price && gp.price > 0)
            .map(gp => ({
              id: gp.id,
              name: gp.displayName || gp.name,
              price: gp.price,
              gameId: gameId,
              imageUrl: gp.imageUrl || null,
              url: `https://www.roblox.com/game-pass/${gp.id}`
            })));
          passCursor = data.nextPageCursor;
        } while (passCursor);
      }));
    } catch (err) {
      return res.status(502).json({ error: "Error obteniendo GamePasses: " + err.message });
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


app.listen(PORT, () => {
  console.log(`API GamePasses escuchando en puerto ${PORT}`);
});

