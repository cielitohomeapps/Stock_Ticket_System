const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Content-Security-Policy", "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return next();
}

function noStoreApiResponses(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  return next();
}

function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = 30,
  maxKeys = DEFAULT_MAX_KEYS,
  scope = "api",
  now = () => Date.now(),
  keyGenerator = (req) => req.user?.id || req.socket?.remoteAddress || "anonymous",
} = {}) {
  const safeWindowMs = Math.max(1_000, Number(windowMs) || DEFAULT_WINDOW_MS);
  const safeMax = Math.max(1, Number(max) || 30);
  const safeMaxKeys = Math.max(100, Number(maxKeys) || DEFAULT_MAX_KEYS);
  const buckets = new Map();

  function pruneExpired(currentTime) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const currentTime = now();
    if (buckets.size >= safeMaxKeys) pruneExpired(currentTime);

    const actorKey = String(keyGenerator(req) || "anonymous").slice(0, 256);
    const key = `${scope}:${actorKey}`;
    if (!buckets.has(key) && buckets.size >= safeMaxKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = {count: 0, resetAt: currentTime + safeWindowMs};
      buckets.set(key, bucket);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
    res.setHeader("RateLimit-Limit", String(safeMax));
    res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

    if (bucket.count >= safeMax) {
      res.setHeader("RateLimit-Remaining", "0");
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
        code: "RATE_LIMITED",
        requestId: req.id,
      });
    }

    bucket.count += 1;
    res.setHeader("RateLimit-Remaining", String(Math.max(0, safeMax - bucket.count)));
    return next();
  };
}

module.exports = {
  securityHeaders,
  noStoreApiResponses,
  createRateLimiter,
};
