const express = require('express');
const { Op } = require('sequelize');
const db = require('../models');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

// Ana dashboard istatistikleri - GET /api/dashboard
router.get('/', requirePermission('dashboard.view'), async (req, res) => {
    try {
        // Temel sayılar
        const totalCameras = await db.Camera.count();
        const onlineCameras = await db.Camera.count({ where: { isOnline: true } });
        const totalStreams = await db.Stream.count();
        const activeStreams = await db.Stream.count({ where: { status: 'active' } });
        const totalViewers = await db.Stream.sum('viewerCount') || 0;

        // Sistem durumu
        const systemHealth = await db.SystemStats.getSystemHealth();
        const latestStats = await db.SystemStats.getLatestStats();

        // Son 24 saatteki aktiviteler
        const last24h = new Date();
        last24h.setHours(last24h.getHours() - 24);

        const recentLogs = await db.StreamLog.findAll({
            where: {
                createdAt: { [Op.gte]: last24h }
            },
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: db.Camera,
                            as: 'camera',
                            attributes: ['id', 'name', 'brand']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        // Error sayısı (son 24 saat)
        const errorCount = await db.StreamLog.count({
            where: {
                level: 'error',
                createdAt: { [Op.gte]: last24h }
            }
        });

        // Kamera marka dağılımı
        const camerasByBrand = await db.Camera.findAll({
            attributes: [
                'brand',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['brand'],
            raw: true
        });

        // Stream kalite dağılımı
        const streamsByQuality = await db.Stream.findAll({
            attributes: [
                'quality',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['quality'],
            raw: true
        });

        // Toplam bandwidth
        const totalBandwidth = await db.Stream.sum('bandwidth', {
            where: { status: 'active' }
        }) || 0;

        res.json({
            summary: {
                cameras: {
                    total: totalCameras,
                    online: onlineCameras,
                    offline: totalCameras - onlineCameras
                },
                streams: {
                    total: totalStreams,
                    active: activeStreams,
                    inactive: totalStreams - activeStreams
                },
                viewers: {
                    total: totalViewers,
                    bandwidth: Math.round(totalBandwidth * 100) / 100
                },
                errors: {
                    last24h: errorCount
                }
            },
            system: {
                health: systemHealth,
                stats: latestStats ? {
                    cpuUsage: latestStats.cpuUsage,
                    memoryUsage: latestStats.memoryUsage,
                    uptime: latestStats.uptime
                } : null
            },
            distributions: {
                camerasByBrand: camerasByBrand.reduce((acc, item) => {
                    acc[item.brand] = parseInt(item.count);
                    return acc;
                }, {}),
                streamsByQuality: streamsByQuality.reduce((acc, item) => {
                    acc[item.quality] = parseInt(item.count);
                    return acc;
                }, {})
            },
            recentActivity: recentLogs.map(log => ({
                id: log.id,
                action: log.action,
                level: log.level,
                message: log.message,
                timestamp: log.createdAt,
                stream: log.stream ? {
                    id: log.stream.id,
                    name: log.stream.name,
                    camera: log.stream.camera ? {
                        name: log.stream.camera.name,
                        brand: log.stream.camera.brand
                    } : null
                } : null
            }))
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Dashboard istatistikleri alınamadı' });
    }
});

// Sistem istatistikleri geçmişi - GET /api/dashboard/system-stats
router.get('/system-stats', requirePermission('dashboard.view'), async (req, res) => {
    try {
        const { hours = 24 } = req.query;

        const stats = await db.SystemStats.getStatsHistory(parseInt(hours));

        res.json({
            period: `${hours}h`,
            data: stats.map(stat => ({
                timestamp: stat.createdAt,
                cpuUsage: stat.cpuUsage,
                memoryUsage: stat.memoryUsage,
                activeStreams: stat.activeStreams,
                totalViewers: stat.totalViewers,
                totalBandwidth: stat.totalBandwidth
            }))
        });
    } catch (error) {
        console.error('System stats history error:', error);
        res.status(500).json({ error: 'Sistem istatistik geçmişi alınamadı' });
    }
});

// Stream performans istatistikleri - GET /api/dashboard/stream-performance
router.get('/stream-performance', requirePermission('dashboard.view'), async (req, res) => {
    try {
        // En çok izlenen stream'ler
        const topStreams = await db.Stream.findAll({
            where: { status: 'active' },
            order: [['viewerCount', 'DESC']],
            limit: 10,
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['name', 'brand', 'location']
                }
            ]
        });

        // Error'lu stream'ler
        const errorStreams = await db.Stream.findAll({
            where: {
                status: 'error',
                errorCount: { [Op.gt]: 0 }
            },
            order: [['errorCount', 'DESC']],
            limit: 5,
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['name', 'brand', 'location']
                }
            ]
        });

        // Bandwidth kullanımı
        const bandwidthUsage = await db.Stream.findAll({
            where: {
                status: 'active',
                bandwidth: { [Op.gt]: 0 }
            },
            order: [['bandwidth', 'DESC']],
            limit: 10,
            attributes: ['id', 'name', 'quality', 'bandwidth', 'viewerCount']
        });

        res.json({
            topStreams: topStreams.map(stream => ({
                id: stream.id,
                name: stream.name,
                viewerCount: stream.viewerCount,
                quality: stream.quality,
                uptime: stream.calculateUptime(),
                camera: stream.camera ? {
                    name: stream.camera.name,
                    brand: stream.camera.brand,
                    location: stream.camera.location
                } : null
            })),
            errorStreams: errorStreams.map(stream => ({
                id: stream.id,
                name: stream.name,
                errorCount: stream.errorCount,
                lastError: stream.errorMessage,
                camera: stream.camera ? {
                    name: stream.camera.name,
                    brand: stream.camera.brand
                } : null
            })),
            bandwidthUsage: bandwidthUsage.map(stream => ({
                id: stream.id,
                name: stream.name,
                quality: stream.quality,
                bandwidth: stream.bandwidth,
                viewerCount: stream.viewerCount,
                bandwidthPerViewer: stream.viewerCount > 0 ?
                    Math.round((stream.bandwidth / stream.viewerCount) * 100) / 100 : 0
            }))
        });
    } catch (error) {
        console.error('Stream performance error:', error);
        res.status(500).json({ error: 'Stream performans istatistikleri alınamadı' });
    }
});

// Viewer istatistikleri - GET /api/dashboard/viewer-stats
router.get('/viewer-stats', requirePermission('dashboard.view'), async (req, res) => {
    try {
        const { period = '24h' } = req.query;

        // Zaman aralığını hesapla
        const endDate = new Date();
        const startDate = new Date();

        switch (period) {
            case '1h':
                startDate.setHours(startDate.getHours() - 1);
                break;
            case '24h':
                startDate.setHours(startDate.getHours() - 24);
                break;
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                break;
            default:
                startDate.setHours(startDate.getHours() - 24);
        }

        // Viewer session'ları al
        const sessions = await db.ViewerSession.findAll({
            where: {
                startedAt: {
                    [Op.between]: [startDate, endDate]
                }
            },
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: db.Camera,
                            as: 'camera',
                            attributes: ['name', 'brand']
                        }
                    ]
                }
            ]
        });

        // İstatistikleri hesapla
        const totalSessions = sessions.length;
        const uniqueViewers = new Set(sessions.map(s => s.ipAddress)).size;
        const averageDuration = sessions.length > 0 ?
            sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length : 0;

        // Cihaz dağılımı
        const deviceStats = sessions.reduce((acc, session) => {
            acc[session.device] = (acc[session.device] || 0) + 1;
            return acc;
        }, {});

        // Ülke dağılımı
        const countryStats = sessions.reduce((acc, session) => {
            if (session.country) {
                acc[session.country] = (acc[session.country] || 0) + 1;
            }
            return acc;
        }, {});

        // Saatlik dağılım
        const hourlyStats = {};
        sessions.forEach(session => {
            const hour = session.startedAt.getHours();
            hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
        });

        // En popüler stream'ler
        const streamStats = sessions.reduce((acc, session) => {
            if (session.stream) {
                const streamId = session.stream.id;
                if (!acc[streamId]) {
                    acc[streamId] = {
                        id: streamId,
                        name: session.stream.name,
                        camera: session.stream.camera?.name,
                        sessions: 0
                    };
                }
                acc[streamId].sessions += 1;
            }
            return acc;
        }, {});

        const popularStreams = Object.values(streamStats)
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10);

        res.json({
            period,
            summary: {
                totalSessions,
                uniqueViewers,
                averageDuration: Math.round(averageDuration),
                currentViewers: await db.Stream.getTotalViewers()
            },
            distributions: {
                devices: deviceStats,
                countries: countryStats,
                hourly: hourlyStats
            },
            popularStreams
        });
    } catch (error) {
        console.error('Viewer stats error:', error);
        res.status(500).json({ error: 'Viewer istatistikleri alınamadı' });
    }
});

// Error analizi - GET /api/dashboard/error-analysis
router.get('/error-analysis', requirePermission('dashboard.view'), async (req, res) => {
    try {
        const { hours = 24 } = req.query;

        const startDate = new Date();
        startDate.setHours(startDate.getHours() - parseInt(hours));

        // Error log'larını al
        const errorLogs = await db.StreamLog.findAll({
            where: {
                level: 'error',
                createdAt: { [Op.gte]: startDate }
            },
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: db.Camera,
                            as: 'camera',
                            attributes: ['name', 'brand', 'ip']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // Error tiplerini kategorize et
        const errorCategories = {
            connection: 0,
            ffmpeg: 0,
            camera: 0,
            system: 0,
            other: 0
        };

        const errorsByStream = {};
        const errorsByCamera = {};

        errorLogs.forEach(log => {
            // Kategori belirleme
            const message = log.message.toLowerCase();
            if (message.includes('connection') || message.includes('timeout') || message.includes('refused')) {
                errorCategories.connection++;
            } else if (message.includes('ffmpeg') || message.includes('codec') || message.includes('stream')) {
                errorCategories.ffmpeg++;
            } else if (message.includes('camera') || message.includes('rtsp')) {
                errorCategories.camera++;
            } else if (message.includes('system') || message.includes('memory') || message.includes('cpu')) {
                errorCategories.system++;
            } else {
                errorCategories.other++;
            }

            // Stream bazlı gruplandırma
            if (log.stream) {
                const streamKey = `${log.stream.id}-${log.stream.name}`;
                errorsByStream[streamKey] = (errorsByStream[streamKey] || 0) + 1;
            }

            // Kamera bazlı gruplandırma
            if (log.stream?.camera) {
                const cameraKey = `${log.stream.camera.name} (${log.stream.camera.ip})`;
                errorsByCamera[cameraKey] = (errorsByCamera[cameraKey] || 0) + 1;
            }
        });

        // En çok error veren stream'ler
        const topErrorStreams = Object.entries(errorsByStream)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([stream, count]) => {
                const [id, name] = stream.split('-');
                return { id: parseInt(id), name, errorCount: count };
            });

        // En çok error veren kameralar
        const topErrorCameras = Object.entries(errorsByCamera)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([camera, count]) => ({ camera, errorCount: count }));

        res.json({
            period: `${hours}h`,
            summary: {
                totalErrors: errorLogs.length,
                categorized: errorCategories
            },
            topErrorStreams,
            topErrorCameras,
            recentErrors: errorLogs.slice(0, 20).map(log => ({
                id: log.id,
                message: log.message,
                timestamp: log.createdAt,
                stream: log.stream ? log.stream.name : 'Unknown',
                camera: log.stream?.camera ? log.stream.camera.name : 'Unknown'
            }))
        });
    } catch (error) {
        console.error('Error analysis error:', error);
        res.status(500).json({ error: 'Error analizi yapılamadı' });
    }
});

// Real-time dashboard verileri - GET /api/dashboard/realtime
router.get('/realtime', requirePermission('dashboard.view'), async (req, res) => {
    try {
        // Aktif stream'lerin real-time durumu
        const activeStreams = await db.Stream.findAll({
            where: { status: 'active' },
            attributes: ['id', 'name', 'viewerCount', 'bandwidth', 'currentFps'],
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['name', 'isOnline']
                }
            ]
        });

        // Sistem kaynakları
        const systemStats = await db.SystemStats.getLatestStats();

        // Son 5 dakikadaki aktiviteler
        const last5min = new Date();
        last5min.setMinutes(last5min.getMinutes() - 5);

        const recentActivity = await db.StreamLog.count({
            where: {
                createdAt: { [Op.gte]: last5min }
            }
        });

        res.json({
            timestamp: new Date(),
            activeStreams: activeStreams.map(stream => ({
                id: stream.id,
                name: stream.name,
                viewerCount: stream.viewerCount,
                bandwidth: stream.bandwidth,
                fps: stream.currentFps,
                cameraOnline: stream.camera?.isOnline || false
            })),
            system: systemStats ? {
                cpuUsage: systemStats.cpuUsage,
                memoryUsage: systemStats.memoryUsage,
                totalBandwidth: systemStats.totalBandwidth,
                uptime: systemStats.uptime
            } : null,
            activity: {
                recentEvents: recentActivity
            }
        });
    } catch (error) {
        console.error('Realtime dashboard error:', error);
        res.status(500).json({ error: 'Real-time veriler alınamadı' });
    }
});

module.exports = router;