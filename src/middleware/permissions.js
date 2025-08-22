// Role bazlı yetki kontrolü middleware'i
const requireRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication gerekli' });
        }

        // Role hierarchy tanımla
        const roleHierarchy = {
            'admin': 3,
            'operator': 2,
            'viewer': 1
        };

        const userRoleLevel = roleHierarchy[req.user.role] || 0;
        const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

        // Kullanıcının rolü gerekli rolden düşükse erişim engelle
        if (userRoleLevel < requiredRoleLevel) {
            return res.status(403).json({
                error: `${requiredRole} yetkisi gerekli`,
                currentRole: req.user.role,
                requiredRole
            });
        }

        next();
    };
};

// Spesifik permission kontrolü middleware'i
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication gerekli' });
        }

        if (!hasPermission(req.user, permission)) {
            return res.status(403).json({
                error: `${permission} yetkisi gerekli`,
                userRole: req.user.role
            });
        }

        next();
    };
};

// Çoklu permission kontrolü (herhangi biri yeterli)
const requireAnyPermission = (permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication gerekli' });
        }

        const hasAnyPermission = permissions.some(permission =>
            hasPermission(req.user, permission)
        );

        if (!hasAnyPermission) {
            return res.status(403).json({
                error: `Şu yetkilerden biri gerekli: ${permissions.join(', ')}`,
                userRole: req.user.role
            });
        }

        next();
    };
};

// Tüm permission'lar gerekli
const requireAllPermissions = (permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication gerekli' });
        }

        const hasAllPermissions = permissions.every(permission =>
            hasPermission(req.user, permission)
        );

        if (!hasAllPermissions) {
            return res.status(403).json({
                error: `Şu yetkilerin tümü gerekli: ${permissions.join(', ')}`,
                userRole: req.user.role
            });
        }

        next();
    };
};

// Resource sahiplik kontrolü
const requireOwnership = (resourceParam = 'id', resourceType = 'generic') => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication gerekli' });
            }

            // Admin her şeye erişebilir
            if (req.user.role === 'admin') {
                return next();
            }

            const resourceId = req.params[resourceParam];
            if (!resourceId) {
                return res.status(400).json({ error: 'Resource ID gerekli' });
            }

            // Resource'un sahiplik kontrolünü yap
            const isOwner = await checkResourceOwnership(req.user.id, resourceId, resourceType);

            if (!isOwner) {
                return res.status(403).json({
                    error: 'Bu kaynağa erişim izniniz yok',
                    resourceType,
                    resourceId
                });
            }

            next();
        } catch (error) {
            console.error('Ownership check error:', error);
            res.status(500).json({ error: 'Sahiplik kontrolü yapılamadı' });
        }
    };
};

// Stream erişim kontrolü
const requireStreamAccess = async (req, res, next) => {
    try {
        const { id: streamId } = req.params;

        if (!streamId) {
            return res.status(400).json({ error: 'Stream ID gerekli' });
        }

        const db = require('../models');
        const stream = await db.Stream.findByPk(streamId);

        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        // Public stream'lere herkes erişebilir
        if (stream.isPublic) {
            return next();
        }

        // Private stream için authentication gerekli
        if (!req.user) {
            return res.status(401).json({ error: 'Bu stream için authentication gerekli' });
        }

        // Admin ve operator'lar tüm stream'lere erişebilir
        if (req.user.role === 'admin' || req.user.role === 'operator') {
            return next();
        }

        // Viewer'lar sadece public stream'lere erişebilir
        return res.status(403).json({ error: 'Bu stream\'e erişim izniniz yok' });

    } catch (error) {
        console.error('Stream access check error:', error);
        res.status(500).json({ error: 'Stream erişim kontrolü yapılamadı' });
    }
};

// IP bazlı erişim kontrolü
const requireIPAccess = (allowedIPs = []) => {
    return (req, res, next) => {
        // IP whitelist boşsa herkese izin ver
        if (allowedIPs.length === 0) {
            return next();
        }

        const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

        // IP'yi normalize et
        const normalizedIP = normalizeIP(clientIP);

        const hasAccess = allowedIPs.some(allowedIP => {
            return normalizedIP === normalizeIP(allowedIP) ||
                isIPInRange(normalizedIP, allowedIP);
        });

        if (!hasAccess) {
            return res.status(403).json({
                error: 'IP adresi erişim listesinde değil',
                clientIP: normalizedIP
            });
        }

        next();
    };
};

// Zaman bazlı erişim kontrolü
const requireTimeAccess = (allowedHours = { start: 0, end: 24 }) => {
    return (req, res, next) => {
        const now = new Date();
        const currentHour = now.getHours();

        const { start, end } = allowedHours;

        let isAllowed = false;
        if (start <= end) {
            // Normal zaman aralığı (örn: 09:00 - 17:00)
            isAllowed = currentHour >= start && currentHour < end;
        } else {
            // Gece geçen zaman aralığı (örn: 22:00 - 06:00)
            isAllowed = currentHour >= start || currentHour < end;
        }

        if (!isAllowed) {
            return res.status(403).json({
                error: 'Bu saatlerde erişim izni yok',
                allowedHours: `${start}:00 - ${end}:00`,
                currentTime: `${currentHour}:${now.getMinutes().toString().padStart(2, '0')}`
            });
        }

        next();
    };
};

// API rate limiting (kullanıcı bazlı)
const requireAPIRateLimit = (maxRequests = 100, windowMs = 60 * 1000) => {
    const userRequests = new Map();

    return (req, res, next) => {
        const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
        const now = Date.now();

        // Kullanıcının request geçmişini al
        const requestData = userRequests.get(key) || {
            count: 0,
            resetTime: now + windowMs,
            requests: []
        };

        // Window süresi dolmuşsa reset et
        if (now > requestData.resetTime) {
            requestData.count = 0;
            requestData.resetTime = now + windowMs;
            requestData.requests = [];
        }

        // Eski request'leri temizle
        requestData.requests = requestData.requests.filter(time => time > now - windowMs);

        // Yeni request'i ekle
        requestData.requests.push(now);
        requestData.count = requestData.requests.length;
        userRequests.set(key, requestData);

        // Limit kontrol et
        if (requestData.count > maxRequests) {
            const remainingTime = Math.ceil((requestData.resetTime - now) / 1000);

            return res.status(429).json({
                error: 'API rate limit aşıldı',
                limit: maxRequests,
                windowMs,
                retryAfter: remainingTime,
                requests: requestData.count
            });
        }

        // Rate limit header'larını ekle
        res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': Math.max(0, maxRequests - requestData.count),
            'X-RateLimit-Reset': Math.ceil(requestData.resetTime / 1000),
            'X-RateLimit-Window': windowMs
        });

        next();
    };
};

// Feature flag kontrolü
const requireFeature = (featureName) => {
    return (req, res, next) => {
        const features = process.env.ENABLED_FEATURES ?
            process.env.ENABLED_FEATURES.split(',') : [];

        if (!features.includes(featureName)) {
            return res.status(403).json({
                error: `Feature '${featureName}' aktif değil`,
                availableFeatures: features
            });
        }

        next();
    };
};

// Development mode kontrolü
const requireDevelopmentMode = (req, res, next) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({
            error: 'Bu endpoint sadece development modunda kullanılabilir'
        });
    }
    next();
};

// Helper functions
function hasPermission(user, permission) {
    if (!user) return false;

    // Admin her şeyi yapabilir
    if (user.role === 'admin') return true;

    // User model'deki hasPermission metodunu kullan
    if (typeof user.hasPermission === 'function') {
        return user.hasPermission(permission);
    }

    // Fallback: role bazlı permission mapping
    const rolePermissions = {
        'operator': [
            // Camera permissions
            'camera.view', 'camera.create', 'camera.update', 'camera.test',
            // Stream permissions
            'stream.view', 'stream.create', 'stream.update', 'stream.start', 'stream.stop',
            // Dashboard permissions
            'dashboard.view', 'dashboard.stats',
            // System permissions
            'system.monitor'
        ],
        'viewer': [
            'stream.view', 'dashboard.view'
        ]
    };

    const userPermissions = rolePermissions[user.role] || [];
    return userPermissions.includes(permission);
}

async function checkResourceOwnership(userId, resourceId, resourceType) {
    const db = require('../models');

    try {
        switch (resourceType) {
            case 'stream':
                // Stream'in sahibi kim? (Bu örnekte kamera sahibi)
                const stream = await db.Stream.findByPk(resourceId, {
                    include: [{ model: db.Camera, as: 'camera' }]
                });
                return stream && stream.camera.createdBy === userId;

            case 'camera':
                const camera = await db.Camera.findByPk(resourceId);
                return camera && camera.createdBy === userId;

            case 'user':
                // Kullanıcı sadece kendi profilini düzenleyebilir
                return resourceId == userId;

            default:
                return false;
        }
    } catch (error) {
        console.error('Resource ownership check error:', error);
        return false;
    }
}

function normalizeIP(ip) {
    // IPv6 wrapped IPv4'ü temizle
    if (ip && ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    return ip;
}

function isIPInRange(ip, range) {
    // CIDR notation kontrolü (örn: 192.168.1.0/24)
    if (range.includes('/')) {
        const [network, prefixLength] = range.split('/');
        const prefix = parseInt(prefixLength);

        // Basit IPv4 CIDR kontrolü
        const ipParts = ip.split('.').map(Number);
        const networkParts = network.split('.').map(Number);

        const ipBinary = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
        const networkBinary = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];

        const mask = (-1 << (32 - prefix)) >>> 0;

        return (ipBinary & mask) === (networkBinary & mask);
    }

    return false;
}

// Permission middleware factory
const createPermissionMiddleware = (options = {}) => {
    const {
        permissions = [],
        roles = [],
        requireAll = false,
        allowSelf = false,
        resourceType = null
    } = options;

    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication gerekli' });
            }

            // Role kontrolü
            if (roles.length > 0) {
                if (!roles.includes(req.user.role)) {
                    return res.status(403).json({
                        error: `Gerekli roller: ${roles.join(', ')}`,
                        userRole: req.user.role
                    });
                }
            }

            // Permission kontrolü
            if (permissions.length > 0) {
                const checkMethod = requireAll ? 'every' : 'some';
                const hasRequiredPermissions = permissions[checkMethod](permission =>
                    hasPermission(req.user, permission)
                );

                if (!hasRequiredPermissions) {
                    const errorMsg = requireAll ?
                        `Tüm yetkiler gerekli: ${permissions.join(', ')}` :
                        `Şu yetkilerden biri gerekli: ${permissions.join(', ')}`;

                    return res.status(403).json({
                        error: errorMsg,
                        userRole: req.user.role
                    });
                }
            }

            // Self access kontrolü
            if (allowSelf && req.params.id) {
                if (req.user.id == req.params.id) {
                    return next(); // Kendi kaynağına erişiyor
                }
            }

            // Resource ownership kontrolü
            if (resourceType && req.params.id) {
                const isOwner = await checkResourceOwnership(req.user.id, req.params.id, resourceType);
                if (!isOwner && req.user.role !== 'admin') {
                    return res.status(403).json({
                        error: 'Bu kaynağa erişim izniniz yok',
                        resourceType
                    });
                }
            }

            next();
        } catch (error) {
            console.error('Permission middleware error:', error);
            res.status(500).json({ error: 'Yetki kontrolü yapılamadı' });
        }
    };
};

module.exports = {
    requireRole,
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireOwnership,
    requireStreamAccess,
    requireIPAccess,
    requireTimeAccess,
    requireAPIRateLimit,
    requireFeature,
    requireDevelopmentMode,
    createPermissionMiddleware,
    hasPermission,
    checkResourceOwnership
};