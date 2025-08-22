const express = require('express');
const { Op } = require('sequelize');
const db = require('../models');
const { requireRole } = require('../middleware/permissions');
const { validatePagination, validateDateRange } = require('../middleware/validation');

const router = express.Router();

// Tüm route'lar admin yetkisi gerektiriyor
router.use(requireRole('admin'));

// Sistem genel durumu - GET /api/admin/system-overview
router.get('/system-overview', async (req, res) => {
    try {
        // Veritabanı istatistikleri
        const dbStats = await Promise.all([
            db.Camera.count(),
            db.Stream.count(),
            db.User.count(),
            db.StreamLog.count(),
            db.ViewerSession.count()
        ]);

        // Sistem sağlığı
        const systemHealth = await db.SystemStats.getSystemHealth();
        const latestStats = await db.SystemStats.getLatestStats();

        // Disk kullanımı (basit hesaplama)
        const fs = require('fs');
        const path = require('path');
        let diskUsage = null;

        try {
            const hlsPath = path.join(__dirname, '..', 'public', 'hls');
            if (fs.existsSync(hlsPath)) {
                const files = fs.readdirSync(hlsPath);
                const totalSize = files.reduce((sum, file) => {
                    const filePath = path.join(hlsPath, file);
                    const stats = fs.statSync(filePath);
                    return sum + stats.size;
                }, 0);
                diskUsage = {
                    hlsFiles: files.length,
                    totalSize: Math.round(totalSize / (1024 * 1024)), // MB
                    path: hlsPath
                };
            }
        } catch (error) {
            console.warn('Disk usage calculation failed:', error.message);
        }

        // Aktif bağlantılar
        const activeConnections = {
            streams: await db.Stream.count({ where: { status: 'active' } }),
            viewers: await db.Stream.sum('viewerCount') || 0,
            cameras: await db.Camera.count({ where: { isOnline: true } })
        };

        // Son error'lar
        const recentErrors = await db.StreamLog.findAll({
            where: { level: 'error' },
            order: [['createdAt', 'DESC']],
            limit: 5,
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['name']
                }
            ]
        });

        res.json({
            database: {
                cameras: dbStats[0],
                streams: dbStats[1],
                users: dbStats[2],
                logs: dbStats[3],
                sessions: dbStats[4]
            },
            system: {
                health: systemHealth,
                stats: latestStats,
                diskUsage
            },
            connections: activeConnections,
            recentErrors: recentErrors.map(error => ({
                id: error.id,
                message: error.message,
                stream: error.stream?.name || 'Unknown',
                timestamp: error.createdAt
            }))
        });
    } catch (error) {
        console.error('System overview error:', error);
        res.status(500).json({ error: 'Sistem durumu alınamadı' });
    }
});

// Detaylı sistem logları - GET /api/admin/system-logs
router.get('/system-logs', validatePagination, validateDateRange, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            level,
            action,
            streamId,
            userId,
            startDate,
            endDate,
            search
        } = req.query;

        const offset = (page - 1) * limit;
        const where = {};

        // Filtreleme
        if (level) where.level = level;
        if (action) where.action = action;
        if (streamId) where.streamId = streamId;
        if (userId) where.userId = userId;

        if (startDate && endDate) {
            where.createdAt = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        if (search) {
            where.message = { [Op.like]: `%${search}%` };
        }

        const { count, rows: logs } = await db.StreamLog.findAndCountAll({
            where,
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name'],
                    required: false
                },
                {
                    model: db.User,
                    as: 'user',
                    attributes: ['id', 'username'],
                    required: false
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('System logs error:', error);
        res.status(500).json({ error: 'Sistem logları alınamadı' });
    }
});

// Veritabanı bakımı - POST /api/admin/maintenance
router.post('/maintenance', async (req, res) => {
    try {
        const { action, options = {} } = req.body;

        const results = {};

        switch (action) {
            case 'cleanup_logs':
                const daysToKeep = options.daysToKeep || 30;
                const deletedLogs = await db.StreamLog.cleanupOldLogs(daysToKeep);
                results.deletedLogs = deletedLogs;
                break;

            case 'cleanup_stats':
                const statsDaysToKeep = options.daysToKeep || 7;
                const deletedStats = await db.SystemStats.cleanupOldStats(statsDaysToKeep);
                results.deletedStats = deletedStats;
                break;

            case 'cleanup_sessions':
                const sessionDaysToKeep = options.daysToKeep || 30;
                const deletedSessions = await db.ViewerSession.cleanupOldSessions(sessionDaysToKeep);
                results.deletedSessions = deletedSessions;
                break;

            case 'cleanup_inactive_sessions':
                const timeoutMinutes = options.timeoutMinutes || 30;
                const endedSessions = await db.ViewerSession.endInactiveSessions(timeoutMinutes);
                results.endedSessions = endedSessions;
                break;

            case 'vacuum_database':
                // MySQL için OPTIMIZE TABLE
                const tables = ['cameras', 'streams', 'users', 'stream_logs', 'system_stats', 'viewer_sessions'];
                for (const table of tables) {
                    await db.sequelize.query(`OPTIMIZE TABLE ${table}`);
                }
                results.optimizedTables = tables.length;
                break;

            case 'reset_error_counts':
                await db.Stream.update(
                    { errorCount: 0, errorMessage: null },
                    { where: { errorCount: { [Op.gt]: 0 } } }
                );
                results.resetStreams = await db.Stream.count({ where: { errorCount: 0 } });
                break;

            default:
                return res.status(400).json({ error: 'Geçersiz bakım işlemi' });
        }

        // Bakım işlemini logla
        console.log(`Maintenance operation ${action} performed by admin ${req.user.username}`, results);

        res.json({
            message: `${action} işlemi başarıyla tamamlandı`,
            results,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Maintenance operation error:', error);
        res.status(500).json({ error: 'Bakım işlemi yapılamadı' });
    }
});

// Performans metrikleri - GET /api/admin/performance
router.get('/performance', async (req, res) => {
    try {
        const { hours = 24 } = req.query;

        // Son N saatin sistem istatistikleri
        const stats = await db.SystemStats.getStatsHistory(parseInt(hours));
        const avgStats = await db.SystemStats.getAverageStats(parseInt(hours));

        // Database performans metrikleri
        const dbMetrics = await Promise.all([
            // Slow query analizi (MySQL specific)
            db.sequelize.query(`
        SELECT 
          COUNT(*) as total_queries,
          AVG(query_time) as avg_query_time,
          MAX(query_time) as max_query_time
        FROM performance_schema.events_statements_summary_by_digest 
        WHERE last_seen > DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
        LIMIT 1
      `, { type: db.sequelize.QueryTypes.SELECT }),

            // Table size bilgileri
            db.sequelize.query(`
        SELECT 
          table_name,
          ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
      `, { type: db.sequelize.QueryTypes.SELECT })
        ]);

        // Memory kullanımı
        const memoryUsage = process.memoryUsage();

        // Stream performansı
        const streamPerformance = await db.Stream.findAll({
            where: { status: 'active' },
            attributes: [
                'id', 'name', 'quality', 'viewerCount', 'bandwidth',
                'currentFps', 'errorCount', 'startedAt'
            ],
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['name', 'brand', 'isOnline']
                }
            ]
        });

        res.json({
            period: `${hours}h`,
            system: {
                average: avgStats,
                history: stats.map(stat => ({
                    timestamp: stat.createdAt,
                    cpu: stat.cpuUsage,
                    memory: stat.memoryUsage,
                    streams: stat.activeStreams,
                    viewers: stat.totalViewers,
                    bandwidth: stat.totalBandwidth
                }))
            },
            database: {
                performance: dbMetrics[0][0] || {},
                tableSizes: dbMetrics[1] || []
            },
            process: {
                memory: {
                    rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
                    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                    external: Math.round(memoryUsage.external / 1024 / 1024)
                },
                uptime: Math.floor(process.uptime()),
                version: process.version,
                platform: process.platform
            },
            streams: {
                active: streamPerformance.length,
                performance: streamPerformance.map(stream => ({
                    id: stream.id,
                    name: stream.name,
                    quality: stream.quality,
                    viewers: stream.viewerCount,
                    bandwidth: stream.bandwidth,
                    fps: stream.currentFps,
                    errors: stream.errorCount,
                    uptime: stream.startedAt ?
                        Math.floor((Date.now() - stream.startedAt.getTime()) / 1000) : 0,
                    camera: {
                        name: stream.camera?.name,
                        online: stream.camera?.isOnline
                    }
                }))
            }
        });
    } catch (error) {
        console.error('Performance metrics error:', error);
        res.status(500).json({ error: 'Performans metrikleri alınamadı' });
    }
});

// Güvenlik analizi - GET /api/admin/security
router.get('/security', async (req, res) => {
    try {
        const { hours = 24 } = req.query;
        const startDate = new Date();
        startDate.setHours(startDate.getHours() - parseInt(hours));

        // Failed login attempts
        const failedLogins = await db.User.findAll({
            where: {
                loginAttempts: { [Op.gt]: 0 }
            },
            attributes: ['id', 'username', 'loginAttempts', 'lockedUntil', 'lastLoginAt', 'lastLoginIp']
        });

        // Locked accounts
        const lockedAccounts = failedLogins.filter(user =>
            user.lockedUntil && user.lockedUntil > new Date()
        );

        // Suspicious IP addresses (multiple failed attempts)
        const suspiciousIPs = {};
        failedLogins.forEach(user => {
            if (user.lastLoginIp && user.loginAttempts > 3) {
                suspiciousIPs[user.lastLoginIp] = (suspiciousIPs[user.lastLoginIp] || 0) + 1;
            }
        });

        // Recent admin actions
        const adminActions = await db.StreamLog.findAll({
            where: {
                createdAt: { [Op.gte]: startDate }
            },
            include: [
                {
                    model: db.User,
                    as: 'user',
                    where: { role: 'admin' },
                    attributes: ['username', 'lastLoginIp']
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: 50
        });

        // Unusual activity patterns
        const unusualActivity = [];

        // Multiple concurrent streams from same IP
        const viewerSessions = await db.ViewerSession.findAll({
            where: {
                isActive: true,
                ipAddress: { [Op.ne]: null }
            },
            attributes: ['ipAddress'],
            group: ['ipAddress'],
            having: db.sequelize.literal('COUNT(*) > 5'),
            raw: true
        });

        unusualActivity.push(...viewerSessions.map(session => ({
            type: 'multiple_concurrent_streams',
            ip: session.ipAddress,
            description: 'Aynı IP\'den çok sayıda eşzamanlı stream'
        })));

        // High bandwidth usage
        const highBandwidthStreams = await db.Stream.findAll({
            where: {
                status: 'active',
                bandwidth: { [Op.gt]: 10 } // 10 Mbps'den fazla
            },
            attributes: ['id', 'name', 'bandwidth', 'viewerCount']
        });

        unusualActivity.push(...highBandwidthStreams.map(stream => ({
            type: 'high_bandwidth',
            streamId: stream.id,
            streamName: stream.name,
            bandwidth: stream.bandwidth,
            description: `Yüksek bandwidth kullanımı: ${stream.bandwidth} Mbps`
        })));

        res.json({
            period: `${hours}h`,
            authentication: {
                failedLogins: failedLogins.length,
                lockedAccounts: lockedAccounts.length,
                suspiciousIPs: Object.keys(suspiciousIPs).length
            },
            accounts: {
                failed: failedLogins.map(user => ({
                    id: user.id,
                    username: user.username,
                    attempts: user.loginAttempts,
                    locked: !!(user.lockedUntil && user.lockedUntil > new Date()),
                    lastIp: user.lastLoginIp
                })),
                locked: lockedAccounts.map(user => ({
                    id: user.id,
                    username: user.username,
                    lockedUntil: user.lockedUntil
                }))
            },
            network: {
                suspiciousIPs: Object.entries(suspiciousIPs).map(([ip, count]) => ({
                    ip,
                    failedAttempts: count
                }))
            },
            adminActivity: adminActions.map(action => ({
                id: action.id,
                action: action.action,
                message: action.message,
                admin: action.user?.username,
                adminIP: action.user?.lastLoginIp,
                timestamp: action.createdAt
            })),
            unusualActivity
        });
    } catch (error) {
        console.error('Security analysis error:', error);
        res.status(500).json({ error: 'Güvenlik analizi yapılamadı' });
    }
});

// Sistem konfigürasyonu - GET /api/admin/config
router.get('/config', async (req, res) => {
    try {
        // Environment variables (güvenli olanlar)
        const safeEnvVars = {
            NODE_ENV: process.env.NODE_ENV,
            PORT: process.env.PORT,
            DB_HOST: process.env.DB_HOST,
            DB_PORT: process.env.DB_PORT,
            DB_NAME: process.env.DB_NAME,
            HLS_SEGMENT_DURATION: process.env.HLS_SEGMENT_DURATION,
            HLS_PLAYLIST_SIZE: process.env.HLS_PLAYLIST_SIZE,
            MAINTENANCE_MODE: process.env.MAINTENANCE_MODE
        };

        // Sistem limitleri
        const limits = {
            maxStreams: 100, // Konfigürasyondan gelecek
            maxViewersPerStream: 1000,
            maxCameras: 500,
            maxUsers: 100
        };

        // Mevcut kullanım
        const currentUsage = {
            streams: await db.Stream.count(),
            cameras: await db.Camera.count(),
            users: await db.User.count(),
            activeStreams: await db.Stream.count({ where: { status: 'active' } })
        };

        // Feature flags
        const features = {
            streamRecording: false,
            cloudStorage: false,
            emailNotifications: false,
            apiRateLimit: true,
            maintenanceMode: process.env.MAINTENANCE_MODE === 'true'
        };

        res.json({
            environment: safeEnvVars,
            limits,
            currentUsage,
            features,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Config retrieval error:', error);
        res.status(500).json({ error: 'Konfigürasyon alınamadı' });
    }
});

// Sistem konfigürasyonu güncelleme - PUT /api/admin/config
router.put('/config', async (req, res) => {
    try {
        const { features, limits } = req.body;

        // Feature flags güncelleme (environment variables)
        if (features) {
            if (features.hasOwnProperty('maintenanceMode')) {
                process.env.MAINTENANCE_MODE = features.maintenanceMode ? 'true' : 'false';
            }
            // Diğer feature'lar için database tablosu veya config dosyası kullanılabilir
        }

        // Limits güncelleme (genellikle config dosyasında saklanır)
        // Bu örnekte sadece response döndürüyoruz

        console.log(`System config updated by admin ${req.user.username}:`, { features, limits });

        res.json({
            message: 'Konfigürasyon başarıyla güncellendi',
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Config update error:', error);
        res.status(500).json({ error: 'Konfigürasyon güncellenemedi' });
    }
});

// Backup oluşturma - POST /api/admin/backup
router.post('/backup', async (req, res) => {
    try {
        const { type = 'full', tables = [] } = req.body;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(__dirname, '..', 'backups');

        // Backup dizinini oluştur
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const backupFile = path.join(backupDir, `backup-${timestamp}.sql`);

        let mysqldumpCmd;
        if (type === 'full') {
            mysqldumpCmd = `mysqldump -h ${process.env.DB_HOST} -u ${process.env.DB_USERNAME} -p${process.env.DB_PASSWORD} ${process.env.DB_NAME} > ${backupFile}`;
        } else if (type === 'partial' && tables.length > 0) {
            mysqldumpCmd = `mysqldump -h ${process.env.DB_HOST} -u ${process.env.DB_USERNAME} -p${process.env.DB_PASSWORD} ${process.env.DB_NAME} ${tables.join(' ')} > ${backupFile}`;
        } else {
            return res.status(400).json({ error: 'Geçersiz backup tipi veya tablo listesi' });
        }

        // Mysqldump çalıştır
        const { exec } = require('child_process');
        exec(mysqldumpCmd, (error, stdout, stderr) => {
            if (error) {
                console.error('Backup error:', error);
                return res.status(500).json({ error: 'Backup oluşturulamadı' });
            }

            // Backup dosya boyutunu kontrol et
            const stats = fs.statSync(backupFile);

            res.json({
                message: 'Backup başarıyla oluşturuldu',
                backup: {
                    file: backupFile,
                    size: Math.round(stats.size / 1024), // KB
                    type,
                    tables: type === 'partial' ? tables : 'all',
                    timestamp: new Date()
                }
            });
        });
    } catch (error) {
        console.error('Backup creation error:', error);
        res.status(500).json({ error: 'Backup oluşturulamadı' });
    }
});

// Export verileri - GET /api/admin/export
router.get('/export', async (req, res) => {
    try {
        const { type, format = 'json', startDate, endDate } = req.query;

        let data;
        const dateFilter = {};

        if (startDate && endDate) {
            dateFilter.createdAt = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        switch (type) {
            case 'cameras':
                data = await db.Camera.findAll({
                    where: dateFilter,
                    attributes: { exclude: ['password'] }
                });
                break;

            case 'streams':
                data = await db.Stream.findAll({
                    where: dateFilter,
                    include: [{ model: db.Camera, as: 'camera', attributes: ['name', 'brand'] }]
                });
                break;

            case 'users':
                data = await db.User.findAll({
                    where: dateFilter,
                    attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
                });
                break;

            case 'logs':
                data = await db.StreamLog.findAll({
                    where: dateFilter,
                    include: [
                        { model: db.Stream, as: 'stream', attributes: ['name'] },
                        { model: db.User, as: 'user', attributes: ['username'] }
                    ],
                    order: [['createdAt', 'DESC']],
                    limit: 10000 // Limit to prevent large exports
                });
                break;

            case 'sessions':
                data = await db.ViewerSession.findAll({
                    where: dateFilter,
                    include: [{ model: db.Stream, as: 'stream', attributes: ['name'] }],
                    order: [['startedAt', 'DESC']],
                    limit: 10000
                });
                break;

            default:
                return res.status(400).json({ error: 'Geçersiz export tipi' });
        }

        // Format'a göre response
        if (format === 'csv') {
            // CSV format için basit implementasyon
            const csv = convertToCSV(data);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=${type}-export.csv`);
            res.send(csv);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=${type}-export.json`);
            res.json({
                type,
                exportDate: new Date(),
                recordCount: data.length,
                data
            });
        }
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export yapılamadı' });
    }
});

// Helper function for CSV conversion
function convertToCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0].toJSON ? data[0].toJSON() : data[0]);
    const csvRows = [headers.join(',')];

    data.forEach(row => {
        const values = headers.map(header => {
            const value = row[header];
            return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
        });
        csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
}

module.exports = router;