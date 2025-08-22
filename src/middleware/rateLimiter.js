// In-memory rate limiter (production'da Redis kullanılmalı)
class MemoryStore {
    constructor() {
        this.data = new Map();
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Her dakika temizle
    }

    async increment(key, windowMs) {
        const now = Date.now();
        const windowStart = now - windowMs;

        // Mevcut veriyi al
        let record = this.data.get(key) || { count: 0, resetTime: now + windowMs, requests: [] };

        // Eski request'leri temizle
        record.requests = record.requests.filter(time => time > windowStart);

        // Yeni request'i ekle
        record.requests.push(now);
        record.count = record.requests.length;

        // Reset time'ı güncelle
        if (now > record.resetTime) {
            record.resetTime = now + windowMs;
        }

        this.data.set(key, record);

        return {
            totalHits: record.count,
            resetTime: record.resetTime
        };
    }

    async reset(key) {
        this.data.delete(key);
    }

    cleanup() {
        const now = Date.now();
        for (const [key, record] of this.data.entries()) {
            if (record.resetTime < now) {
                this.data.delete(key);
            }
        }
    }

    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.data.clear();
    }
}

// Rate limiter factory
const createRateLimiter = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 dakika
        max = 100, // 100 request
        message = 'Rate limit aşıldı',
        standardHeaders = true,
        legacyHeaders = false,
        store = new MemoryStore(),
        keyGenerator = (req) => req.ip,
        skip = () => false,
        onLimitReached = null,
        skipSuccessfulRequests = false,
        skipFailedRequests = false
    } = options;

    return async (req, res, next) => {
        try {
            // Skip kontrolü
            if (skip(req, res)) {
                return next();
            }

            // Key oluştur
            const key = keyGenerator(req);
            if (!key) {
                return next();
            }

            // Rate limit kontrolü
            const result = await store.increment(key, windowMs);
            const totalHits = result.totalHits;
            const resetTime = result.resetTime;

            // Headers ekle
            if (standardHeaders) {
                res.set({
                    'RateLimit-Limit': max,
                    'RateLimit-Remaining': Math.max(0, max - totalHits),
                    'RateLimit-Reset': Math.ceil(resetTime / 1000),
                    'RateLimit-Policy': `${max};w=${windowMs / 1000}`
                });
            }

            if (legacyHeaders) {
                res.set({
                    'X-RateLimit-Limit': max,
                    'X-RateLimit-Remaining': Math.max(0, max - totalHits),
                    'X-RateLimit-Reset': Math.ceil(resetTime / 1000)
                });
            }

            // Limit aşılmış mı?
            if (totalHits > max) {
                // onLimitReached callback'i çağır
                if (onLimitReached) {
                    onLimitReached(req, res, options);
                }

                // Error response
                const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);

                res.set('Retry-After', retryAfter);

                return res.status(429).json({
                    error: message,
                    limit: max,
                    current: totalHits,
                    remaining: 0,
                    resetTime: new Date(resetTime).toISOString(),
                    retryAfter
                });
            }

            // Response hook'u (başarılı/başarısız request'leri skip etmek için)
            const originalSend = res.send;
            res.send = function (body) {
                const statusCode = res.statusCode;

                // Skip logic
                if ((skipSuccessfulRequests && statusCode < 400) ||
                    (skipFailedRequests && statusCode >= 400)) {
                    store.reset(key);
                }

                return originalSend.call(this, body);
            };

            next();
        } catch (error) {
            console.error('Rate limiter error:', error);
            next(); // Error durumunda devam et
        }
    };
};

// Hazır rate limiter konfigürasyonları
const rateLimiters = {
    // Genel API rate limiter
    general: createRateLimiter({
        windowMs: 15 * 60 * 1000, // 15 dakika
        max: 100, // 100 request per 15 minutes
        message: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin.',
        standardHeaders: true
    }),

    // Authentication rate limiter (daha sıkı)
    auth: createRateLimiter({
        windowMs: 15 * 60 * 1000, // 15 dakika
        max: 10, // 10 request per 15 minutes
        message: 'Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.',
        keyGenerator: (req) => `auth:${req.ip}`,
        skipSuccessfulRequests: true // Başarılı login'leri sayma
    }),

    // API key kullananlara daha yüksek limit
    apiKey: createRateLimiter({
        windowMs: 60 * 1000, // 1 dakika
        max: 1000, // 1000 request per minute
        message: 'API rate limit aşıldı',
        keyGenerator: (req) => `api:${req.headers['x-api-key'] || req.ip}`
    }),

    // Upload endpoint'i için
    upload: createRateLimiter({
        windowMs: 60 * 60 * 1000, // 1 saat
        max: 20, // 20 upload per hour
        message: 'Çok fazla dosya yükleme isteği. Lütfen 1 saat sonra tekrar deneyin.',
        keyGenerator: (req) => `upload:${req.user ? req.user.id : req.ip}`
    }),

    // Stream endpoint'leri için
    stream: createRateLimiter({
        windowMs: 60 * 1000, // 1 dakika
        max: 30, // 30 request per minute
        message: 'Stream API rate limit aşıldı',
        keyGenerator: (req) => `stream:${req.user ? req.user.id : req.ip}`
    }),

    // Public endpoint'ler için
    public: createRateLimiter({
        windowMs: 60 * 1000, // 1 dakika
        max: 60, // 60 request per minute
        message: 'Public API rate limit aşıldı'
    })
};

// Kullanıcı bazlı rate limiter
const userBasedRateLimit = (userLimits = {}) => {
    const defaultLimits = {
        admin: { windowMs: 60 * 1000, max: 1000 },
        operator: { windowMs: 60 * 1000, max: 300 },
        viewer: { windowMs: 60 * 1000, max: 100 },
        anonymous: { windowMs: 60 * 1000, max: 20 }
    };

    const limits = { ...defaultLimits, ...userLimits };

    return (req, res, next) => {
        const userRole = req.user ? req.user.role : 'anonymous';
        const userLimit = limits[userRole] || limits.anonymous;

        const limiter = createRateLimiter({
            ...userLimit,
            keyGenerator: (req) => `user:${req.user ? req.user.id : req.ip}:${userRole}`,
            message: `${userRole} için rate limit aşıldı`
        });

        limiter(req, res, next);
    };
};

// IP whitelist ile rate limiter bypass
const createRateLimiterWithWhitelist = (options = {}, whitelist = []) => {
    const limiter = createRateLimiter(options);

    return (req, res, next) => {
        const clientIP = req.ip || req.connection.remoteAddress;

        // IP whitelist'te varsa bypass et
        if (whitelist.includes(clientIP)) {
            return next();
        }

        limiter(req, res, next);
    };
};

// Progressive rate limiter (zamanla artan kısıtlama)
const createProgressiveRateLimit = (stages = []) => {
    const defaultStages = [
        { threshold: 0, windowMs: 60 * 1000, max: 60 },
        { threshold: 50, windowMs: 60 * 1000, max: 30 },
        { threshold: 80, windowMs: 60 * 1000, max: 10 },
        { threshold: 95, windowMs: 60 * 1000, max: 5 }
    ];

    const finalStages = stages.length > 0 ? stages : defaultStages;
    const store = new MemoryStore();

    return async (req, res, next) => {
        try {
            const key = req.ip;
            const result = await store.increment(key, 60 * 60 * 1000); // 1 saatlik window
            const currentUsage = result.totalHits;

            // Hangi stage'de olduğumuzu belirle
            let currentStage = finalStages[0];
            for (const stage of finalStages) {
                if (currentUsage >= stage.threshold) {
                    currentStage = stage;
                }
            }

            // Seçilen stage'e göre rate limit uygula
            const stageLimiter = createRateLimiter({
                windowMs: currentStage.windowMs,
                max: currentStage.max,
                keyGenerator: () => `progressive:${key}`,
                message: `Progressive rate limit aşıldı (Stage: ${currentUsage} requests)`
            });

            stageLimiter(req, res, next);
        } catch (error) {
            console.error('Progressive rate limiter error:', error);
            next();
        }
    };
};

// Burst rate limiter (kısa süreli yoğun trafik için)
const createBurstRateLimit = (burstOptions = {}, sustainedOptions = {}) => {
    const burstLimiter = createRateLimiter({
        windowMs: 1000, // 1 saniye
        max: 10, // 10 request per second
        ...burstOptions,
        keyGenerator: (req) => `burst:${req.ip}`
    });

    const sustainedLimiter = createRateLimiter({
        windowMs: 60 * 1000, // 1 dakika
        max: 100, // 100 request per minute
        ...sustainedOptions,
        keyGenerator: (req) => `sustained:${req.ip}`
    });

    return (req, res, next) => {
        burstLimiter(req, res, (err) => {
            if (err) return next(err);
            sustainedLimiter(req, res, next);
        });
    };
};

// Rate limit middleware'leri endpoint'lere göre uygula
const applyRateLimits = (app) => {
    // Auth endpoint'leri
    app.use('/api/auth/login', rateLimiters.auth);
    app.use('/api/auth/register', rateLimiters.auth);

    // Upload endpoint'leri
    app.use('/api/*/upload', rateLimiters.upload);

    // Stream endpoint'leri
    app.use('/api/streams', rateLimiters.stream);

    // Public endpoint'ler
    app.use('/api/streams/public', rateLimiters.public);

    // Genel API rate limit
    app.use('/api', rateLimiters.general);
};

// Rate limit istatistikleri
const getRateLimitStats = (store) => {
    if (store instanceof MemoryStore) {
        const stats = {
            totalKeys: store.data.size,
            keys: Array.from(store.data.entries()).map(([key, data]) => ({
                key,
                count: data.count,
                resetTime: new Date(data.resetTime).toISOString()
            }))
        };
        return stats;
    }
    return null;
};

// Rate limit monitoring
const monitorRateLimit = () => {
    const limiterStats = new Map();

    return {
        record: (key, limit, current) => {
            limiterStats.set(key, {
                limit,
                current,
                timestamp: Date.now(),
                percentage: (current / limit) * 100
            });
        },

        getStats: () => {
            return Array.from(limiterStats.entries()).map(([key, stats]) => ({
                key,
                ...stats,
                timestamp: new Date(stats.timestamp).toISOString()
            }));
        },

        getHighUsage: (threshold = 80) => {
            return Array.from(limiterStats.entries())
                .filter(([, stats]) => stats.percentage >= threshold)
                .map(([key, stats]) => ({ key, ...stats }));
        }
    };
};

module.exports = {
    createRateLimiter,
    rateLimiters,
    userBasedRateLimit,
    createRateLimiterWithWhitelist,
    createProgressiveRateLimit,
    createBurstRateLimit,
    applyRateLimits,
    getRateLimitStats,
    monitorRateLimit,
    MemoryStore
};