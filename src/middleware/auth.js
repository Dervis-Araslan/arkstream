const jwt = require('jsonwebtoken');
const db = require('../models');

// Ana authentication middleware
const authMiddleware = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({ error: 'Token bulunamadı' });
        }

        // Token'ı verify et
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Kullanıcıyı veritabanından al
        const user = await db.User.findByPk(decoded.id, {
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
        });

        if (!user) {
            return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Kullanıcı aktif mi kontrol et
        if (user.status !== 'active') {
            return res.status(401).json({ error: 'Hesap aktif değil' });
        }

        // Kullanıcı kilitli mi kontrol et
        if (user.isLocked()) {
            return res.status(401).json({ error: 'Hesap kilitli' });
        }

        // Request'e kullanıcı bilgilerini ekle
        req.user = user;
        req.token = token;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Geçersiz token' });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token süresi dolmuş' });
        } else {
            console.error('Auth middleware error:', error);
            return res.status(500).json({ error: 'Authentication hatası' });
        }
    }
};

// İsteğe bağlı authentication middleware (token varsa kontrol et, yoksa devam et)
const optionalAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            const user = await db.User.findByPk(decoded.id, {
                attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
            });

            if (user && user.status === 'active' && !user.isLocked()) {
                req.user = user;
                req.token = token;
            }
        }

        next();
    } catch (error) {
        // İsteğe bağlı auth'da hata olursa sadece devam et
        next();
    }
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication gerekli' });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin yetkisi gerekli' });
    }

    next();
};

// API key authentication middleware (gelecekte API entegrasyonları için)
const apiKeyAuth = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({ error: 'API key gerekli' });
        }

        // API key'i kontrol et (bu örnek için basit kontrol)
        if (apiKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Geçersiz API key' });
        }

        // API kullanıcısı olarak işaretle
        req.user = {
            id: 'api',
            username: 'api_user',
            role: 'api',
            isApiUser: true
        };

        next();
    } catch (error) {
        console.error('API key auth error:', error);
        return res.status(500).json({ error: 'API authentication hatası' });
    }
};

// Rate limiting için kullanıcı bazlı middleware
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const userRequests = new Map();

    return (req, res, next) => {
        const userId = req.user ? req.user.id : req.ip;
        const now = Date.now();

        // Kullanıcının request geçmişini al
        const userRequestData = userRequests.get(userId) || { count: 0, resetTime: now + windowMs };

        // Window süresi dolmuşsa reset et
        if (now > userRequestData.resetTime) {
            userRequestData.count = 0;
            userRequestData.resetTime = now + windowMs;
        }

        // Request sayısını arttır
        userRequestData.count++;
        userRequests.set(userId, userRequestData);

        // Limit aşılmış mı kontrol et
        if (userRequestData.count > maxRequests) {
            const remainingTime = Math.ceil((userRequestData.resetTime - now) / 1000);

            return res.status(429).json({
                error: 'Rate limit aşıldı',
                retryAfter: remainingTime,
                limit: maxRequests,
                windowMs
            });
        }

        // Rate limit bilgilerini header'lara ekle
        res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': Math.max(0, maxRequests - userRequestData.count),
            'X-RateLimit-Reset': Math.ceil(userRequestData.resetTime / 1000)
        });

        next();
    };
};

// WebSocket authentication
const wsAuth = async (ws, req) => {
    try {
        // URL'den token al
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            throw new Error('Token bulunamadı');
        }

        // Token'ı verify et
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Kullanıcıyı al
        const user = await db.User.findByPk(decoded.id, {
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
        });

        if (!user || user.status !== 'active' || user.isLocked()) {
            throw new Error('Geçersiz kullanıcı');
        }

        return user;
    } catch (error) {
        throw new Error(`WebSocket auth failed: ${error.message}`);
    }
};

// Session management
const createSession = (user, options = {}) => {
    const payload = {
        id: user.id,
        username: user.username,
        role: user.role,
        sessionId: require('crypto').randomBytes(16).toString('hex'),
        iat: Math.floor(Date.now() / 1000)
    };

    const tokenOptions = {
        expiresIn: options.expiresIn || '7d',
        issuer: 'ark-stream',
        audience: 'ark-stream-users'
    };

    return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
};

const refreshToken = async (token) => {
    try {
        // Token'ı verify et (expired olsa bile)
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });

        // Token çok eski ise refresh'e izin verme (30 gün)
        const tokenAge = Date.now() / 1000 - decoded.iat;
        if (tokenAge > 30 * 24 * 60 * 60) {
            throw new Error('Token çok eski');
        }

        // Kullanıcıyı kontrol et
        const user = await db.User.findByPk(decoded.id, {
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
        });

        if (!user || user.status !== 'active' || user.isLocked()) {
            throw new Error('Geçersiz kullanıcı');
        }

        // Yeni token oluştur
        return createSession(user);
    } catch (error) {
        throw new Error(`Token refresh failed: ${error.message}`);
    }
};

// Token'ı request'ten çıkar
function extractToken(req) {
    // Authorization header'dan
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Cookie'den
    if (req.cookies && req.cookies.token) {
        return req.cookies.token;
    }

    // Query parameter'den
    if (req.query.token) {
        return req.query.token;
    }

    return null;
}

// Permission check helper
const hasPermission = (user, permission) => {
    if (!user) return false;

    // Admin her şeyi yapabilir
    if (user.role === 'admin') return true;

    // User model'indeki hasPermission metodunu kullan
    if (typeof user.hasPermission === 'function') {
        return user.hasPermission(permission);
    }

    // Fallback: role bazlı basit kontrol
    const rolePermissions = {
        operator: [
            'camera.view', 'camera.create', 'camera.update',
            'stream.view', 'stream.create', 'stream.update', 'stream.start', 'stream.stop',
            'dashboard.view'
        ],
        viewer: ['stream.view', 'dashboard.view']
    };

    return rolePermissions[user.role]?.includes(permission) || false;
};

// IP whitelist kontrolü
const ipWhitelist = (allowedIPs = []) => {
    return (req, res, next) => {
        if (allowedIPs.length === 0) {
            return next(); // Whitelist boşsa herkese izin ver
        }

        const clientIP = req.ip || req.connection.remoteAddress;

        if (!allowedIPs.includes(clientIP)) {
            return res.status(403).json({
                error: 'IP adresi izin listesinde değil',
                ip: clientIP
            });
        }

        next();
    };
};

// Maintenance mode kontrolü
const maintenanceMode = (req, res, next) => {
    const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';

    if (isMaintenanceMode) {
        // Admin'ler maintenance mode'da da erişebilir
        if (req.user && req.user.role === 'admin') {
            return next();
        }

        return res.status(503).json({
            error: 'Sistem bakım modunda',
            message: 'Sistem şu anda bakım yapılmaktadır. Lütfen daha sonra tekrar deneyin.'
        });
    }

    next();
};

module.exports = {
    authMiddleware,
    optionalAuth,
    requireAdmin,
    apiKeyAuth,
    userRateLimit,
    wsAuth,
    createSession,
    refreshToken,
    extractToken,
    hasPermission,
    ipWhitelist,
    maintenanceMode
};