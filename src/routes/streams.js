const express = require('express');
const { Op } = require('sequelize');
const db = require('../models');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { validateStream, validateStreamUpdate, validatePagination, validateDateRange } = require('../middleware/validation');

const router = express.Router();

// Stream listesi - GET /api/streams
router.get('/', requirePermission('stream.view'), validatePagination, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            quality,
            cameraId,
            search,
            isPublic,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const where = {};

        // Filtreleme
        if (status) {
            where.status = status;
        }

        if (quality) {
            where.quality = quality;
        }

        if (cameraId) {
            where.cameraId = cameraId;
        }

        if (isPublic !== undefined) {
            where.isPublic = isPublic === 'true';
        }

        if (search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { streamKey: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows: streams } = await db.Stream.findAndCountAll({
            where,
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['id', 'name', 'brand', 'model', 'location', 'isOnline']
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset),
            distinct: true
        });

        // HLS URL'lerini ekle
        const streamsWithUrls = streams.map(stream => {
            const streamData = stream.toJSON();
            streamData.hlsUrl = stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`);
            streamData.uptime = stream.calculateUptime();
            return streamData;
        });

        res.json({
            streams: streamsWithUrls,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get streams error:', error);
        res.status(500).json({ error: 'Stream\'ler alınamadı' });
    }
});

// Public stream listesi - GET /api/streams/public
router.get('/public', async (req, res) => {
    try {
        const streams = await db.Stream.getPublicStreams();

        // Sadece gerekli bilgileri döndür
        const publicStreams = streams.map(stream => ({
            id: stream.id,
            name: stream.name,
            streamKey: stream.streamKey,
            quality: stream.quality,
            viewerCount: stream.viewerCount,
            status: stream.status,
            hlsUrl: stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`),
            camera: {
                name: stream.camera.name,
                brand: stream.camera.brand,
                location: stream.camera.location
            }
        }));

        res.json({
            streams: publicStreams,
            total: publicStreams.length
        });
    } catch (error) {
        console.error('Get public streams error:', error);
        res.status(500).json({ error: 'Public stream\'ler alınamadı' });
    }
});

// Stream key ile stream bulma - GET /api/streams/key/:streamKey
router.get('/key/:streamKey', async (req, res) => {
    try {
        const { streamKey } = req.params;

        const stream = await db.Stream.getStreamByKey(streamKey);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        // Public değilse ve kullanıcı giriş yapmamışsa erişim engelle
        if (!stream.isPublic && !req.user) {
            return res.status(403).json({ error: 'Bu stream\'e erişim izniniz yok' });
        }

        // Private stream için yetki kontrolü
        if (!stream.isPublic && req.user && !req.user.canAccessStream(stream)) {
            return res.status(403).json({ error: 'Bu stream\'e erişim izniniz yok' });
        }

        // Viewer count'u arttır
        await stream.updateViewerCount(true);

        // HLS URL'ini ekle
        const streamData = {
            id: stream.id,
            name: stream.name,
            streamKey: stream.streamKey,
            quality: stream.quality,
            status: stream.status,
            hlsUrl: stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`),
            camera: {
                name: stream.camera.name,
                brand: stream.camera.brand,
                location: stream.camera.location
            }
        };

        res.json(streamData);
    } catch (error) {
        console.error('Get stream by key error:', error);
        res.status(500).json({ error: 'Stream alınamadı' });
    }
});

// Tek stream detayı - GET /api/streams/:id
router.get('/:id', requirePermission('stream.view'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id, {
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: { exclude: ['password'] }
                },
                {
                    model: db.StreamLog,
                    as: 'logs',
                    limit: 20,
                    order: [['createdAt', 'DESC']],
                    include: [
                        {
                            model: db.User,
                            as: 'user',
                            attributes: ['id', 'username'],
                            required: false
                        }
                    ]
                }
            ]
        });

        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        // HLS URL'ini ekle
        const streamData = stream.toJSON();
        streamData.hlsUrl = stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`);
        streamData.uptime = stream.calculateUptime();

        res.json(streamData);
    } catch (error) {
        console.error('Get stream error:', error);
        res.status(500).json({ error: 'Stream detayları alınamadı' });
    }
});

// Yeni stream oluşturma - POST /api/streams
router.post('/', requirePermission('stream.create'), validateStream, async (req, res) => {
    try {
        const {
            cameraId,
            name,
            channel = 1,
            quality = 'medium',
            isPublic = true
        } = req.body;

        // Kamera var mı kontrol et
        const camera = await db.Camera.findByPk(cameraId);
        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        // Aynı isimde stream var mı kontrol et
        const existingStream = await db.Stream.findOne({
            where: { name }
        });

        if (existingStream) {
            return res.status(400).json({ error: 'Bu isimde bir stream zaten mevcut' });
        }

        // RTSP URL'ini oluştur
        const rtspUrl = camera.generateRtspUrl(channel);

        // Stream'i oluştur
        const stream = await db.Stream.create({
            cameraId,
            name,
            channel,
            quality,
            isPublic,
            rtspUrl
        });

        // HLS URL'ini ekle
        const streamData = stream.toJSON();
        streamData.hlsUrl = stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`);

        // Log kaydı
        await db.StreamLog.logStreamAction(
            stream.id,
            'config_update',
            'Stream created',
            { userId: req.user.id }
        );

        console.log(`Stream created: ${stream.name} for camera ${camera.name} by user ${req.user.id}`);

        res.status(201).json({
            message: 'Stream başarıyla oluşturuldu',
            stream: streamData
        });
    } catch (error) {
        console.error('Create stream error:', error);
        res.status(500).json({ error: 'Stream oluşturulamadı' });
    }
});

// Stream güncelleme - PUT /api/streams/:id
router.put('/:id', requirePermission('stream.update'), validateStreamUpdate, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const stream = await db.Stream.findByPk(id, {
            include: [{ model: db.Camera, as: 'camera' }]
        });

        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        // İsim değişikliği kontrolü
        if (updateData.name && updateData.name !== stream.name) {
            const existingStream = await db.Stream.findOne({
                where: {
                    name: updateData.name,
                    id: { [Op.ne]: id }
                }
            });

            if (existingStream) {
                return res.status(400).json({ error: 'Bu isimde bir stream zaten mevcut' });
            }
        }

        // RTSP URL'ini güncelle (eğer channel değiştiyse)
        if (updateData.channel && updateData.channel !== stream.channel) {
            updateData.rtspUrl = stream.camera.generateRtspUrl(updateData.channel);
        }

        // Stream'i güncelle
        await stream.update(updateData);

        // Eğer aktif ise ve önemli ayarlar değiştiyse yeniden başlat
        const criticalChanges = ['channel', 'quality', 'rtspUrl'];
        const needsRestart = stream.status === 'active' &&
            criticalChanges.some(field => updateData.hasOwnProperty(field));

        if (needsRestart) {
            const streamManager = req.app.locals.streamManager;
            if (streamManager) {
                setImmediate(async () => {
                    try {
                        await streamManager.restartStream(stream.id);
                    } catch (error) {
                        console.error(`Error restarting stream ${stream.id}:`, error);
                    }
                });
            }
        }

        // Log kaydı
        await db.StreamLog.logStreamAction(
            stream.id,
            'config_update',
            'Stream configuration updated',
            {
                userId: req.user.id,
                details: updateData
            }
        );

        // HLS URL'ini ekle
        const streamData = stream.toJSON();
        streamData.hlsUrl = stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`);

        console.log(`Stream updated: ${stream.name} by user ${req.user.id}`);

        res.json({
            message: 'Stream başarıyla güncellendi',
            stream: streamData,
            restarted: needsRestart
        });
    } catch (error) {
        console.error('Update stream error:', error);
        res.status(500).json({ error: 'Stream güncellenemedi' });
    }
});

// Stream silme - DELETE /api/streams/:id
router.delete('/:id', requirePermission('stream.delete'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        // Aktif ise önce durdur
        if (stream.status === 'active') {
            const streamManager = req.app.locals.streamManager;
            if (streamManager) {
                try {
                    await streamManager.stopStream(stream.id);
                } catch (error) {
                    console.error(`Error stopping stream ${stream.id}:`, error);
                }
            }
        }

        // Stream'i sil
        await stream.destroy();

        console.log(`Stream deleted: ${stream.name} by user ${req.user.id}`);

        res.json({
            message: 'Stream başarıyla silindi'
        });
    } catch (error) {
        console.error('Delete stream error:', error);
        res.status(500).json({ error: 'Stream silinemedi' });
    }
});

// Stream başlatma - POST /api/streams/:id/start
router.post('/:id/start', requirePermission('stream.start'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id, {
            include: [{ model: db.Camera, as: 'camera' }]
        });

        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        if (stream.status === 'active') {
            return res.status(400).json({ error: 'Stream zaten aktif' });
        }

        // Kamera online mı kontrol et
        if (!stream.camera.isOnline) {
            return res.status(400).json({ error: 'Kamera offline durumda' });
        }

        const streamManager = req.app.locals.streamManager;
        if (!streamManager) {
            return res.status(500).json({ error: 'Stream manager mevcut değil' });
        }

        // Stream'i başlat
        const result = await streamManager.startStream(id, req.user.id);

        if (result.success) {
            res.json({
                message: 'Stream başarıyla başlatıldı',
                streamKey: stream.streamKey,
                hlsUrl: stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`)
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Start stream error:', error);
        res.status(500).json({ error: 'Stream başlatılamadı' });
    }
});

// Stream durdurma - POST /api/streams/:id/stop
router.post('/:id/stop', requirePermission('stream.stop'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        if (stream.status === 'inactive') {
            return res.status(400).json({ error: 'Stream zaten durmuş durumda' });
        }

        const streamManager = req.app.locals.streamManager;
        if (!streamManager) {
            return res.status(500).json({ error: 'Stream manager mevcut değil' });
        }

        // Stream'i durdur
        const result = await streamManager.stopStream(id, req.user.id);

        if (result.success) {
            res.json({
                message: 'Stream başarıyla durduruldu'
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Stop stream error:', error);
        res.status(500).json({ error: 'Stream durdurulamadı' });
    }
});

// Stream yeniden başlatma - POST /api/streams/:id/restart
router.post('/:id/restart', requirePermission('stream.start'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        const streamManager = req.app.locals.streamManager;
        if (!streamManager) {
            return res.status(500).json({ error: 'Stream manager mevcut değil' });
        }

        // Stream'i yeniden başlat
        const result = await streamManager.restartStream(id, req.user.id);

        if (result.success) {
            res.json({
                message: 'Stream başarıyla yeniden başlatıldı',
                hlsUrl: stream.generateHlsUrl(`${req.protocol}://${req.get('host')}`)
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Restart stream error:', error);
        res.status(500).json({ error: 'Stream yeniden başlatılamadı' });
    }
});

// Stream istatistikleri - GET /api/streams/:id/stats
router.get('/:id/stats', requirePermission('stream.view'), async (req, res) => {
    try {
        const { id } = req.params;
        const { period = '24h' } = req.query;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

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

        // Log istatistikleri
        const logStats = await db.StreamLog.getViewerStats(id, startDate, endDate);

        // Viewer session istatistikleri
        const sessionStats = await db.ViewerSession.getSessionStats(id, startDate, endDate);

        // Stream genel bilgileri
        const streamInfo = {
            id: stream.id,
            name: stream.name,
            status: stream.status,
            currentViewers: stream.viewerCount,
            totalViews: stream.totalViews,
            uptime: stream.calculateUptime(),
            quality: stream.quality,
            bitrate: stream.bitrate,
            currentFps: stream.currentFps,
            errorCount: stream.errorCount
        };

        res.json({
            stream: streamInfo,
            period,
            logs: logStats,
            sessions: sessionStats,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Get stream stats error:', error);
        res.status(500).json({ error: 'Stream istatistikleri alınamadı' });
    }
});

// Stream log'ları - GET /api/streams/:id/logs
router.get('/:id/logs', requirePermission('stream.view'), validatePagination, validateDateRange, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            page = 1,
            limit = 50,
            level,
            action,
            startDate,
            endDate
        } = req.query;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        const offset = (page - 1) * limit;
        const where = { streamId: id };

        // Filtreleme
        if (level) {
            where.level = level;
        }

        if (action) {
            where.action = action;
        }

        if (startDate && endDate) {
            where.createdAt = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        const { count, rows: logs } = await db.StreamLog.findAndCountAll({
            where,
            include: [
                {
                    model: db.User,
                    as: 'user',
                    attributes: ['id', 'username', 'firstName', 'lastName'],
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
        console.error('Get stream logs error:', error);
        res.status(500).json({ error: 'Stream log\'ları alınamadı' });
    }
});

// Aktif viewer'lar - GET /api/streams/:id/viewers
router.get('/:id/viewers', requirePermission('stream.view'), async (req, res) => {
    try {
        const { id } = req.params;

        const stream = await db.Stream.findByPk(id);
        if (!stream) {
            return res.status(404).json({ error: 'Stream bulunamadı' });
        }

        const activeSessions = await db.ViewerSession.getActiveSessions(id);

        const viewers = activeSessions.map(session => ({
            sessionId: session.sessionId,
            ipAddress: session.ipAddress,
            country: session.country,
            city: session.city,
            device: session.device,
            browser: session.browser,
            quality: session.quality,
            startedAt: session.startedAt,
            duration: Math.floor((new Date() - session.startedAt) / 1000),
            user: session.user ? {
                id: session.user.id,
                username: session.user.username
            } : null
        }));

        res.json({
            streamId: id,
            streamName: stream.name,
            totalViewers: viewers.length,
            viewers
        });
    } catch (error) {
        console.error('Get stream viewers error:', error);
        res.status(500).json({ error: 'Viewer listesi alınamadı' });
    }
});

// Toplu stream işlemleri - POST /api/streams/bulk
router.post('/bulk', requireRole('admin'), async (req, res) => {
    try {
        const { action, streamIds, data } = req.body;

        if (!action || !streamIds || !Array.isArray(streamIds)) {
            return res.status(400).json({ error: 'Geçersiz toplu işlem parametreleri' });
        }

        const streams = await db.Stream.findAll({
            where: { id: streamIds }
        });

        if (streams.length !== streamIds.length) {
            return res.status(400).json({ error: 'Bazı stream\'ler bulunamadı' });
        }

        const streamManager = req.app.locals.streamManager;
        let results = [];

        switch (action) {
            case 'start':
                for (const stream of streams) {
                    try {
                        if (streamManager && stream.status !== 'active') {
                            const result = await streamManager.startStream(stream.id, req.user.id);
                            results.push({
                                id: stream.id,
                                success: result.success,
                                message: result.success ? 'Started' : result.error
                            });
                        } else {
                            results.push({
                                id: stream.id,
                                success: false,
                                message: 'Already active or manager unavailable'
                            });
                        }
                    } catch (error) {
                        results.push({ id: stream.id, success: false, error: error.message });
                    }
                }
                break;

            case 'stop':
                for (const stream of streams) {
                    try {
                        if (streamManager && stream.status === 'active') {
                            const result = await streamManager.stopStream(stream.id, req.user.id);
                            results.push({
                                id: stream.id,
                                success: result.success,
                                message: result.success ? 'Stopped' : result.error
                            });
                        } else {
                            results.push({
                                id: stream.id,
                                success: false,
                                message: 'Already inactive or manager unavailable'
                            });
                        }
                    } catch (error) {
                        results.push({ id: stream.id, success: false, error: error.message });
                    }
                }
                break;

            case 'delete':
                for (const stream of streams) {
                    try {
                        // Aktif ise önce durdur
                        if (streamManager && stream.status === 'active') {
                            await streamManager.stopStream(stream.id, req.user.id);
                        }

                        await stream.destroy();
                        results.push({ id: stream.id, success: true });
                    } catch (error) {
                        results.push({ id: stream.id, success: false, error: error.message });
                    }
                }
                break;

            case 'update_quality':
                if (!data.quality) {
                    return res.status(400).json({ error: 'Quality değeri gerekli' });
                }

                for (const stream of streams) {
                    try {
                        await stream.update({ quality: data.quality });

                        // Aktif ise yeniden başlat
                        if (streamManager && stream.status === 'active') {
                            await streamManager.restartStream(stream.id, req.user.id);
                        }

                        results.push({ id: stream.id, success: true });
                    } catch (error) {
                        results.push({ id: stream.id, success: false, error: error.message });
                    }
                }
                break;

            case 'update_visibility':
                if (data.isPublic === undefined) {
                    return res.status(400).json({ error: 'isPublic değeri gerekli' });
                }

                for (const stream of streams) {
                    try {
                        await stream.update({ isPublic: data.isPublic });
                        results.push({ id: stream.id, success: true });
                    } catch (error) {
                        results.push({ id: stream.id, success: false, error: error.message });
                    }
                }
                break;

            default:
                return res.status(400).json({ error: 'Geçersiz işlem' });
        }

        console.log(`Bulk stream operation ${action} performed by user ${req.user.id} on ${streamIds.length} streams`);

        res.json({
            message: `Toplu ${action} işlemi tamamlandı`,
            results,
            summary: {
                total: results.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
            }
        });
    } catch (error) {
        console.error('Bulk stream operation error:', error);
        res.status(500).json({ error: 'Toplu işlem yapılamadı' });
    }
});

// Stream istatistikleri özeti - GET /api/streams/stats
router.get('/stats', requirePermission('stream.view'), async (req, res) => {
    try {
        const totalStreams = await db.Stream.count();
        const activeStreams = await db.Stream.count({ where: { status: 'active' } });
        const totalViewers = await db.Stream.getTotalViewers();

        const qualityStats = await db.Stream.findAll({
            attributes: [
                'quality',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['quality'],
            raw: true
        });

        const statusStats = await db.Stream.findAll({
            attributes: [
                'status',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['status'],
            raw: true
        });

        // Bandwidth toplamı
        const bandwidthSum = await db.Stream.sum('bandwidth', {
            where: { status: 'active' }
        });

        // Top streams by viewers
        const topStreams = await db.Stream.findAll({
            where: { status: 'active' },
            order: [['viewerCount', 'DESC']],
            limit: 5,
            attributes: ['id', 'name', 'viewerCount', 'quality'],
            include: [
                {
                    model: db.Camera,
                    as: 'camera',
                    attributes: ['name', 'brand']
                }
            ]
        });

        res.json({
            summary: {
                total: totalStreams,
                active: activeStreams,
                inactive: totalStreams - activeStreams,
                totalViewers,
                totalBandwidth: Math.round((bandwidthSum || 0) * 100) / 100
            },
            distributions: {
                qualityBreakdown: qualityStats.reduce((acc, item) => {
                    acc[item.quality] = parseInt(item.count);
                    return acc;
                }, {}),
                statusBreakdown: statusStats.reduce((acc, item) => {
                    acc[item.status] = parseInt(item.count);
                    return acc;
                }, {})
            },
            topStreams: topStreams.map(stream => ({
                id: stream.id,
                name: stream.name,
                viewerCount: stream.viewerCount,
                quality: stream.quality,
                camera: stream.camera ? {
                    name: stream.camera.name,
                    brand: stream.camera.brand
                } : null
            }))
        });
    } catch (error) {
        console.error('Get stream stats error:', error);
        res.status(500).json({ error: 'Stream istatistikleri alınamadı' });
    }
});

module.exports = router;