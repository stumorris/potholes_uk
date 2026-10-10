// Tiny in-memory fixed-window rate limiter (per IP). Good enough for a single
// instance; swap for a shared store (e.g. Redis) if you run several.
export function rateLimit({ windowMs, max, message = 'Too many requests, please try again later.' }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start >= windowMs) { h = { start: now, count: 0 }; hits.set(key, h); }
    if (++h.count > max) return res.status(429).json({ error: message });
    next();
  };
}
