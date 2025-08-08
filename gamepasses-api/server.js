app.get('/gamepasses/:userId', async (req, res) => {
  const userId = req.params.userId;
  const offset = parseInt(req.query.offset) || 0;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // máximo 100 por seguridad

  const cacheKey = `${userId}_all`;
  let allPasses = cache.get(cacheKey);

  if (!allPasses) {
    // ... igual que antes ...
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
