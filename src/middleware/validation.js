// Validation helper functions
const isValidIP = (ip) => {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

const isValidPort = (port) => {
    const portNum = parseInt(port);
    return portNum >= 1 && portNum <= 65535;
};

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidUsername = (username) => {
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    return usernameRegex.test(username);
};

const isValidPassword = (password) => {
    return password && password.length >= 6;
};

const isValidResolution = (resolution) => {
    const resolutionRegex = /^\d{3,4}x\d{3,4}$/;
    return resolutionRegex.test(resolution);
};

// Camera validation
const validateCamera = (req, res, next) => {
    const { name, brand, model, ip, port, username, password, resolution, fps } = req.body;
    const errors = [];

    // Required fields
    if (!name || name.trim().length === 0) {
        errors.push('Kamera adı gerekli');
    } else if (name.length > 100) {
        errors.push('Kamera adı çok uzun (max 100 karakter)');
    }

    if (!brand) {
        errors.push('Marka gerekli');
    } else if (!['samsung', 'dahua', 'hikvision', 'axis', 'bosch', 'other'].includes(brand.toLowerCase())) {
        errors.push('Geçersiz marka');
    }

    if (!model || model.trim().length === 0) {
        errors.push('Model gerekli');
    } else if (model.length > 100) {
        errors.push('Model adı çok uzun (max 100 karakter)');
    }

    if (!ip) {
        errors.push('IP adresi gerekli');
    } else if (!isValidIP(ip)) {
        errors.push('Geçersiz IP adresi formatı');
    }

    if (port && !isValidPort(port)) {
        errors.push('Geçersiz port numarası (1-65535)');
    }

    if (!username || username.trim().length === 0) {
        errors.push('Kullanıcı adı gerekli');
    } else if (username.length > 50) {
        errors.push('Kullanıcı adı çok uzun (max 50 karakter)');
    }

    if (!password || password.trim().length === 0) {
        errors.push('Şifre gerekli');
    } else if (password.length > 100) {
        errors.push('Şifre çok uzun (max 100 karakter)');
    }

    // Optional fields validation
    if (resolution && !isValidResolution(resolution)) {
        errors.push('Geçersiz çözünürlük formatı (örn: 1920x1080)');
    }

    if (fps && (fps < 1 || fps > 120)) {
        errors.push('FPS değeri 1-120 arasında olmalı');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Camera update validation
const validateCameraUpdate = (req, res, next) => {
    const { name, brand, model, ip, port, username, password, resolution, fps, status } = req.body;
    const errors = [];

    // Optional fields validation (only if provided)
    if (name !== undefined) {
        if (!name || name.trim().length === 0) {
            errors.push('Kamera adı boş olamaz');
        } else if (name.length > 100) {
            errors.push('Kamera adı çok uzun (max 100 karakter)');
        }
    }

    if (brand !== undefined) {
        if (!['samsung', 'dahua', 'hikvision', 'axis', 'bosch', 'other'].includes(brand.toLowerCase())) {
            errors.push('Geçersiz marka');
        }
    }

    if (model !== undefined) {
        if (!model || model.trim().length === 0) {
            errors.push('Model boş olamaz');
        } else if (model.length > 100) {
            errors.push('Model adı çok uzun (max 100 karakter)');
        }
    }

    if (ip !== undefined && !isValidIP(ip)) {
        errors.push('Geçersiz IP adresi formatı');
    }

    if (port !== undefined && !isValidPort(port)) {
        errors.push('Geçersiz port numarası (1-65535)');
    }

    if (username !== undefined) {
        if (!username || username.trim().length === 0) {
            errors.push('Kullanıcı adı boş olamaz');
        } else if (username.length > 50) {
            errors.push('Kullanıcı adı çok uzun (max 50 karakter)');
        }
    }

    if (password !== undefined) {
        if (!password || password.trim().length === 0) {
            errors.push('Şifre boş olamaz');
        } else if (password.length > 100) {
            errors.push('Şifre çok uzun (max 100 karakter)');
        }
    }

    if (resolution !== undefined && !isValidResolution(resolution)) {
        errors.push('Geçersiz çözünürlük formatı (örn: 1920x1080)');
    }

    if (fps !== undefined && (fps < 1 || fps > 120)) {
        errors.push('FPS değeri 1-120 arasında olmalı');
    }

    if (status !== undefined && !['active', 'inactive', 'maintenance', 'offline'].includes(status)) {
        errors.push('Geçersiz durum değeri');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Stream validation
const validateStream = (req, res, next) => {
    const { cameraId, name, channel, quality, isPublic } = req.body;
    const errors = [];

    // Required fields
    if (!cameraId) {
        errors.push('Kamera ID gerekli');
    } else if (!Number.isInteger(cameraId) || cameraId <= 0) {
        errors.push('Geçersiz kamera ID');
    }

    if (!name || name.trim().length === 0) {
        errors.push('Stream adı gerekli');
    } else if (name.length > 100) {
        errors.push('Stream adı çok uzun (max 100 karakter)');
    }

    // Optional fields validation
    if (channel !== undefined && (!Number.isInteger(channel) || channel < 1 || channel > 32)) {
        errors.push('Kanal numarası 1-32 arasında olmalı');
    }

    if (quality !== undefined && !['low', 'medium', 'high', 'ultra'].includes(quality)) {
        errors.push('Geçersiz kalite değeri (low, medium, high, ultra)');
    }

    if (isPublic !== undefined && typeof isPublic !== 'boolean') {
        errors.push('isPublic boolean değer olmalı');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Stream update validation
const validateStreamUpdate = (req, res, next) => {
    const { name, channel, quality, isPublic, status } = req.body;
    const errors = [];

    // Optional fields validation (only if provided)
    if (name !== undefined) {
        if (!name || name.trim().length === 0) {
            errors.push('Stream adı boş olamaz');
        } else if (name.length > 100) {
            errors.push('Stream adı çok uzun (max 100 karakter)');
        }
    }

    if (channel !== undefined && (!Number.isInteger(channel) || channel < 1 || channel > 32)) {
        errors.push('Kanal numarası 1-32 arasında olmalı');
    }

    if (quality !== undefined && !['low', 'medium', 'high', 'ultra'].includes(quality)) {
        errors.push('Geçersiz kalite değeri (low, medium, high, ultra)');
    }

    if (isPublic !== undefined && typeof isPublic !== 'boolean') {
        errors.push('isPublic boolean değer olmalı');
    }

    if (status !== undefined && !['active', 'inactive', 'starting', 'stopping', 'error', 'reconnecting'].includes(status)) {
        errors.push('Geçersiz durum değeri');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// User validation
const validateUser = (req, res, next) => {
    const { username, email, password, firstName, lastName, role } = req.body;
    const errors = [];

    // Required fields
    if (!username || username.trim().length === 0) {
        errors.push('Kullanıcı adı gerekli');
    } else if (!isValidUsername(username)) {
        errors.push('Kullanıcı adı geçersiz (3-30 karakter, sadece harf, rakam ve _)');
    }

    if (!email || email.trim().length === 0) {
        errors.push('Email gerekli');
    } else if (!isValidEmail(email)) {
        errors.push('Geçersiz email formatı');
    }

    if (!password) {
        errors.push('Şifre gerekli');
    } else if (!isValidPassword(password)) {
        errors.push('Şifre en az 6 karakter olmalı');
    }

    // Optional fields validation
    if (firstName !== undefined && firstName.length > 50) {
        errors.push('Ad çok uzun (max 50 karakter)');
    }

    if (lastName !== undefined && lastName.length > 50) {
        errors.push('Soyad çok uzun (max 50 karakter)');
    }

    if (role !== undefined && !['admin', 'operator', 'viewer'].includes(role)) {
        errors.push('Geçersiz rol (admin, operator, viewer)');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Login validation
const validateLogin = (req, res, next) => {
    const { username, password } = req.body;
    const errors = [];

    if (!username || username.trim().length === 0) {
        errors.push('Kullanıcı adı veya email gerekli');
    }

    if (!password || password.trim().length === 0) {
        errors.push('Şifre gerekli');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Password change validation
const validatePasswordChange = (req, res, next) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const errors = [];

    if (!currentPassword) {
        errors.push('Mevcut şifre gerekli');
    }

    if (!newPassword) {
        errors.push('Yeni şifre gerekli');
    } else if (!isValidPassword(newPassword)) {
        errors.push('Yeni şifre en az 6 karakter olmalı');
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        errors.push('Yeni şifre ve şifre onayı eşleşmiyor');
    }

    if (currentPassword && newPassword && currentPassword === newPassword) {
        errors.push('Yeni şifre mevcut şifreden farklı olmalı');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Query parameter validation
const validatePagination = (req, res, next) => {
    const { page, limit } = req.query;
    const errors = [];

    if (page !== undefined) {
        const pageNum = parseInt(page);
        if (isNaN(pageNum) || pageNum < 1) {
            errors.push('Sayfa numarası 1 veya daha büyük olmalı');
        } else if (pageNum > 1000) {
            errors.push('Sayfa numarası çok büyük (max 1000)');
        }
    }

    if (limit !== undefined) {
        const limitNum = parseInt(limit);
        if (isNaN(limitNum) || limitNum < 1) {
            errors.push('Limit 1 veya daha büyük olmalı');
        } else if (limitNum > 100) {
            errors.push('Limit çok büyük (max 100)');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// Date range validation
const validateDateRange = (req, res, next) => {
    const { startDate, endDate } = req.query;
    const errors = [];

    if (startDate && !Date.parse(startDate)) {
        errors.push('Geçersiz başlangıç tarihi formatı');
    }

    if (endDate && !Date.parse(endDate)) {
        errors.push('Geçersiz bitiş tarihi formatı');
    }

    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start >= end) {
            errors.push('Başlangıç tarihi bitiş tarihinden önce olmalı');
        }

        // Maximum date range (1 year)
        const maxRange = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds
        if (end - start > maxRange) {
            errors.push('Tarih aralığı çok büyük (max 1 yıl)');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation hatası',
            details: errors
        });
    }

    next();
};

// File upload validation
const validateFileUpload = (allowedTypes = [], maxSize = 10 * 1024 * 1024) => {
    return (req, res, next) => {
        if (!req.file && !req.files) {
            return next(); // Dosya yoksa devam et
        }

        const files = req.files || [req.file];
        const errors = [];

        files.forEach((file, index) => {
            if (!file) return;

            // File type kontrolü
            if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
                errors.push(`Dosya ${index + 1}: Desteklenmeyen dosya tipi (${file.mimetype})`);
            }

            // File size kontrolü
            if (file.size > maxSize) {
                const maxSizeMB = Math.round(maxSize / (1024 * 1024));
                errors.push(`Dosya ${index + 1}: Dosya boyutu çok büyük (max ${maxSizeMB}MB)`);
            }

            // File name kontrolü
            if (file.originalname && file.originalname.length > 255) {
                errors.push(`Dosya ${index + 1}: Dosya adı çok uzun (max 255 karakter)`);
            }
        });

        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Dosya validation hatası',
                details: errors
            });
        }

        next();
    };
};

// JSON validation
const validateJSON = (req, res, next) => {
    if (req.is('application/json')) {
        try {
            // Express'in built-in JSON parser zaten bu kontrolü yapıyor
            // Ama ek kontroller ekleyebiliriz

            const contentLength = parseInt(req.get('content-length') || '0');
            const maxJSONSize = 10 * 1024 * 1024; // 10MB

            if (contentLength > maxJSONSize) {
                return res.status(413).json({
                    error: 'JSON payload çok büyük',
                    maxSize: `${maxJSONSize / (1024 * 1024)}MB`
                });
            }

        } catch (error) {
            return res.status(400).json({
                error: 'Geçersiz JSON formatı'
            });
        }
    }

    next();
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Recursive function to sanitize object
    const sanitizeObject = (obj) => {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(sanitizeObject);
        }

        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                // XSS prevention: HTML encode, trim whitespace
                sanitized[key] = value
                    .trim()
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#x27;')
                    .replace(/\//g, '&#x2F;');
            } else {
                sanitized[key] = sanitizeObject(value);
            }
        }

        return sanitized;
    };

    // Sanitize request body
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }

    next();
};

module.exports = {
    validateCamera,
    validateCameraUpdate,
    validateStream,
    validateStreamUpdate,
    validateUser,
    validateLogin,
    validatePasswordChange,
    validatePagination,
    validateFileUpload,
    validateJSON,
    sanitizeInput,
    // Helper functions
    isValidIP,
    isValidPort,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    isValidResolution
};