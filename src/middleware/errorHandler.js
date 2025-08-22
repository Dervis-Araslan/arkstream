const fs = require('fs');
const path = require('path');

// Ana error handler middleware
const errorHandler = (err, req, res, next) => {
    // Varsayılan error response
    let error = {
        message: err.message || 'Internal Server Error',
        status: err.status || 500,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    };

    // Request bilgileri
    const requestInfo = {
        method: req.method,
        url: req.url,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
        user: req.user ? { id: req.user.id, username: req.user.username } : null
    };

    // Farklı error tiplerini handle et
    if (err.name === 'ValidationError') {
        // Sequelize validation errors
        error = handleValidationError(err);
    } else if (err.name === 'SequelizeValidationError') {
        error = handleSequelizeValidationError(err);
    } else if (err.name === 'SequelizeUniqueConstraintError') {
        error = handleUniqueConstraintError(err);
    } else if (err.name === 'SequelizeForeignKeyConstraintError') {
        error = handleForeignKeyError(err);
    } else if (err.name === 'SequelizeConnectionError') {
        error = handleConnectionError(err);
    } else if (err.name === 'JsonWebTokenError') {
        error = handleJWTError(err);
    } else if (err.name === 'MulterError') {
        error = handleMulterError(err);
    } else if (err.code === 'ENOENT') {
        error = handleFileNotFoundError(err);
    } else if (err.code === 'EACCES') {
        error = handlePermissionError(err);
    } else if (err.type === 'entity.too.large') {
        error = handlePayloadTooLargeError(err);
    }

    // Error'u logla
    logError(error, requestInfo, err);

    // Response gönder
    res.status(error.status).json({
        error: error.message,
        status: error.status,
        timestamp: requestInfo.timestamp,
        path: req.url,
        details: error.details,
        stack: error.stack
    });
};

// Validation error handler
const handleValidationError = (err) => {
    return {
        message: 'Validation Error',
        status: 400,
        details: err.errors || err.message
    };
};

// Sequelize validation error handler
const handleSequelizeValidationError = (err) => {
    const errors = err.errors.map(error => ({
        field: error.path,
        message: error.message,
        value: error.value
    }));

    return {
        message: 'Veritabanı validation hatası',
        status: 400,
        details: errors
    };
};

// Unique constraint error handler
const handleUniqueConstraintError = (err) => {
    const field = err.errors[0]?.path || 'unknown';
    const value = err.errors[0]?.value || 'unknown';

    return {
        message: `Bu ${field} zaten kullanılıyor: ${value}`,
        status: 409,
        details: {
            field,
            value,
            constraint: err.parent?.constraint
        }
    };
};

// Foreign key constraint error handler
const handleForeignKeyError = (err) => {
    return {
        message: 'İlişkili kayıt bulunamadı veya kullanımda',
        status: 400,
        details: {
            constraint: err.parent?.constraint,
            table: err.parent?.table,
            detail: err.parent?.detail
        }
    };
};

// Database connection error handler
const handleConnectionError = (err) => {
    return {
        message: 'Veritabanı bağlantı hatası',
        status: 503,
        details: process.env.NODE_ENV === 'development' ? err.parent?.message : 'Service temporarily unavailable'
    };
};

// JWT error handler
const handleJWTError = (err) => {
    let message = 'Token hatası';

    if (err.message === 'jwt expired') {
        message = 'Token süresi dolmuş';
    } else if (err.message === 'invalid token') {
        message = 'Geçersiz token';
    } else if (err.message === 'jwt malformed') {
        message = 'Bozuk token formatı';
    }

    return {
        message,
        status: 401,
        details: { type: err.name }
    };
};

// Multer error handler (file upload)
const handleMulterError = (err) => {
    let message = 'Dosya yükleme hatası';

    if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'Dosya boyutu çok büyük';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
        message = 'Çok fazla dosya';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        message = 'Beklenmeyen dosya alanı';
    }

    return {
        message,
        status: 400,
        details: {
            code: err.code,
            field: err.field
        }
    };
};

// File not found error handler
const handleFileNotFoundError = (err) => {
    return {
        message: 'Dosya bulunamadı',
        status: 404,
        details: {
            path: err.path,
            syscall: err.syscall
        }
    };
};

// Permission error handler
const handlePermissionError = (err) => {
    return {
        message: 'Dosya izin hatası',
        status: 403,
        details: {
            path: err.path,
            syscall: err.syscall
        }
    };
};

// Payload too large error handler
const handlePayloadTooLargeError = (err) => {
    return {
        message: 'Request payload çok büyük',
        status: 413,
        details: {
            limit: err.limit,
            length: err.length
        }
    };
};

// Error logging function
const logError = (error, requestInfo, originalError) => {
    const logData = {
        timestamp: requestInfo.timestamp,
        level: 'ERROR',
        message: error.message,
        status: error.status,
        request: requestInfo,
        stack: originalError.stack,
        details: error.details
    };

    // Console'a yazdır
    console.error(`[${logData.timestamp}] ERROR: ${error.message}`);
    console.error(`Request: ${requestInfo.method} ${requestInfo.url}`);
    console.error(`User: ${requestInfo.user ? requestInfo.user.username : 'Anonymous'}`);
    console.error(`IP: ${requestInfo.ip}`);

    if (process.env.NODE_ENV === 'development') {
        console.error('Stack:', originalError.stack);
    }

    // Dosyaya yaz (eğer log dizini varsa)
    writeErrorLog(logData);

    // Critical error'ları ayrı handle et
    if (error.status >= 500) {
        handleCriticalError(logData);
    }
};

// Error log dosyasına yazma
const writeErrorLog = (logData) => {
    try {
        const logDir = path.join(process.cwd(), 'logs');

        // Log dizini yoksa oluştur
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logFile = path.join(logDir, `error-${new Date().toISOString().split('T')[0]}.log`);
        const logLine = JSON.stringify(logData) + '\n';

        fs.appendFileSync(logFile, logLine);
    } catch (writeError) {
        console.error('Log yazma hatası:', writeError.message);
    }
};

// Critical error handling
const handleCriticalError = (logData) => {
    // Email, Slack, Discord vb. bildirim servisleri buraya eklenebilir
    console.error('🚨 CRITICAL ERROR DETECTED:', logData.message);

    // Örnek: Email bildirimi (implement edilebilir)
    // sendCriticalErrorEmail(logData);

    // Örnek: Slack bildirimi (implement edilebilir)
    // sendSlackAlert(logData);

    // Health check endpoint'ini güncelle
    updateHealthStatus('unhealthy', logData.message);
};

// Health status güncelleme
let healthStatus = { status: 'healthy', lastError: null, lastUpdated: new Date() };

const updateHealthStatus = (status, message = null) => {
    healthStatus = {
        status,
        lastError: message,
        lastUpdated: new Date()
    };
};

const getHealthStatus = () => healthStatus;

// 404 handler
const notFoundHandler = (req, res, next) => {
    const error = {
        message: `Route bulunamadı: ${req.method} ${req.originalUrl}`,
        status: 404,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method
    };

    console.warn(`[${error.timestamp}] 404: ${error.message} - IP: ${req.ip}`);

    res.status(404).json({
        error: error.message,
        status: 404,
        timestamp: error.timestamp,
        path: error.path,
        suggestions: getSuggestions(req.originalUrl)
    });
};

// URL önerileri
const getSuggestions = (path) => {
    const commonRoutes = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/cameras',
        '/api/streams',
        '/api/dashboard',
        '/health'
    ];

    // Basit string similarity
    const suggestions = commonRoutes
        .map(route => ({
            route,
            similarity: calculateSimilarity(path, route)
        }))
        .filter(item => item.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .map(item => item.route);

    return suggestions.length > 0 ? suggestions : ['Mevcut endpoint\'ler için API dökümantasyonunu kontrol edin'];
};

// Basit string similarity hesaplama
const calculateSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
};

// Levenshtein distance hesaplama
const levenshteinDistance = (str1, str2) => {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
};

// Async error wrapper
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Express async error'ları yakalamak için
const handleAsyncErrors = () => {
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);

        // Graceful shutdown
        setTimeout(() => {
            console.error('Unhandled rejection nedeniyle uygulama kapatılıyor...');
            process.exit(1);
        }, 5000);
    });

    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);

        // Log error
        const logData = {
            timestamp: new Date().toISOString(),
            level: 'FATAL',
            message: error.message,
            stack: error.stack,
            type: 'uncaughtException'
        };

        writeErrorLog(logData);

        // Graceful shutdown
        setTimeout(() => {
            console.error('Uncaught exception nedeniyle uygulama kapatılıyor...');
            process.exit(1);
        }, 1000);
    });
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    handleAsyncErrors,
    getHealthStatus,
    updateHealthStatus
};