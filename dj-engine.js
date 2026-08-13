export function normalizeDjText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function primaryDjArtist(track) {
  const raw = String(track?.artist || "").split(/\s+(?:feat\.?|ft\.?|x|&|y)\s+|,|;/i)[0] || "";
  return normalizeDjText(raw);
}

export function djGenreBucket(track) {
  const g = normalizeDjText(track?.genre || "");
  if (!g) return "neutral";
  if (/reggaeton|urbano|latin trap|trap|hip hop|rap|dance|edm|electro|house|techno|salsa|merengue|dembow|rock|punk|metal/.test(g)) return "energy";
  if (/r b|rnb|soul|lo fi|lofi|ambient|acoustic|acustic|ballad|balada|indie|jazz|chill|downtempo|bossa/.test(g)) return "chill";
  return "neutral";
}

export function scoreDjTrack(track, context = {}) {
  if (!track?.id) return -Infinity;
  const currentId = String(context.currentId || "");
  if (track.id === currentId) return -Infinity;
  const mode = String(context.mode || "taste");
  const stats = context.stats || {};
  const favoriteIds = context.favoriteIds instanceof Set ? context.favoriteIds : new Set(context.favoriteIds || []);
  const recentIds = Array.isArray(context.recentIds) ? context.recentIds : [];
  const feedback = context.feedback || {};
  const artist = primaryDjArtist(track);
  const genre = normalizeDjText(track.genre || "");
  const plays = Math.max(0, Number(stats[track.id] || 0));
  let score = 30;

  score += Math.min(24, Math.log2(plays + 1) * 6);
  if (mode === "favorites" && !favoriteIds.has(track.id)) return -Infinity;
  if (favoriteIds.has(track.id)) score += mode === "favorites" ? 42 : 22;

  const djLastIds = Array.isArray(context.djLastIds) ? context.djLastIds : [];
  const djRecentIndex = djLastIds.indexOf(track.id);
  if (djRecentIndex >= 0 && djRecentIndex < 6) score -= 70 - djRecentIndex * 8;
  else if (djRecentIndex >= 6 && djRecentIndex < 12) score -= 18;

  const recentIndex = recentIds.indexOf(track.id);
  if (recentIndex >= 0 && recentIndex < 5) score -= 48 - recentIndex * 5;
  else if (recentIndex >= 5 && recentIndex < 15) score -= 16;

  const bucket = djGenreBucket(track);
  if (mode === "energy") score += bucket === "energy" ? 28 : bucket === "chill" ? -18 : 0;
  if (mode === "chill") score += bucket === "chill" ? 28 : bucket === "energy" ? -16 : 0;
  if (mode === "discovery") {
    score += Math.max(0, 22 - Math.min(22, plays * 3));
    if (favoriteIds.has(track.id)) score -= 8;
  }
  if (mode === "surprise") score += Math.max(0, 16 - Math.min(16, plays * 2));

  score += Number(feedback.artistWeights?.[artist] || 0) * 9;
  if (genre) score += Number(feedback.genreWeights?.[genre] || 0) * 6;

  const recentArtists = Array.isArray(context.recentArtists) ? context.recentArtists : [];
  const sameArtistCount = recentArtists.filter((a) => a && a === artist).length;
  score -= sameArtistCount * 16;

  return score;
}

export function rankDjTracks(tracks, context = {}) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((track) => ({ track, score: scoreDjTrack(track, context) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score || String(a.track.title || "").localeCompare(String(b.track.title || "")));
}

export function chooseDjTrack(tracks, context = {}, random = Math.random) {
  const ranked = rankDjTracks(tracks, context);
  if (!ranked.length) return null;
  const pool = ranked.slice(0, Math.min(12, ranked.length));
  const floor = Math.min(...pool.map((x) => x.score));
  const weighted = pool.map((x) => ({ ...x, weight: Math.max(1, x.score - floor + 4) }));
  const total = weighted.reduce((n, x) => n + x.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * total;
  for (const x of weighted) {
    cursor -= x.weight;
    if (cursor <= 0) return x.track;
  }
  return weighted[0].track;
}
