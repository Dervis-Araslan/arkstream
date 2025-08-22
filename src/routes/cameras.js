const express = require('express');
const { Op } = require('sequelize');
const db = require('../models');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { validateCamera, validateCameraUpdate } = require('../middleware/validation');

const router = express.Router();

// Kamera listesi - GET /api/cameras
router.get('/', requirePermission('camera.view'), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            brand,
            status,
            location,
            search,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const where = {};

        // Filtreleme
        if (brand) {
            where.brand = brand;
        }

        if (status) {
            where.status = status;
        }

        if (location) {
            where.location = {
                [Op.like]: `%${location}%`
            };
        }

        if (search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { model: { [Op.like]: `%${search}%` } },
                { location: { [Op.like]: `%${search}%` } },
                { ip: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows: cameras } = await db.Camera.findAndCountAll({
            where,
            include: [
                {
                    model: db.Stream,
                    as: 'streams',
                    attributes: ['id', 'name', 'status', 'viewerCount', 'quality'],
                    required: false
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset),
            distinct: true
        });

        // Hassas bilgileri gizle
        const sanitizedCameras = cameras.map(camera => {
            const cameraData = camera.toJSON();
            delete cameraData.password;
            return cameraData;
        });

        res.json({
            cameras: sanitizedCameras,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get cameras error:', error);
        res.status(500).json({ error: 'Kameralar alınamadı' });
    }
});

// Tek kamera detayı - GET /api/cameras/:id
router.get('/:id', requirePermission('camera.view'), async (req, res) => {
    try {
        const { id } = req.params;

        const camera = await db.Camera.findByPk(id, {
            include: [
                {
                    model: db.Stream,
                    as: 'streams',
                    include: [
                        {
                            model: db.StreamLog,
                            as: 'logs',
                            limit: 10,
                            order: [['createdAt', 'DESC']]
                        }
                    ]
                }
            ]
        });

        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        // Hassas bilgileri gizle
        const cameraData = camera.toJSON();
        delete cameraData.password;

        res.json(cameraData);
    } catch (error) {
        console.error('Get camera error:', error);
        res.status(500).json({ error: 'Kamera detayları alınamadı' });
    }
});

// Yeni kamera ekleme - POST /api/cameras
router.post('/', requirePermission('camera.create'), validateCamera, async (req, res) => {
    try {
        const {
            name,
            brand,
            model,
            ip,
            port = 554,
            username,
            password,
            location,
            description,
            resolution,
            fps
        } = req.body;

        // IP ve port kombinasyonu benzersiz olmalı
        const existingCamera = await db.Camera.findOne({
            where: { ip, port }
        });

        if (existingCamera) {
            return res.status(400).json({
                error: 'Bu IP ve port kombinasyonu zaten kullanılıyor'
            });
        }

        // Kamerayı oluştur
        const camera = await db.Camera.create({
            name,
            brand,
            model,
            ip,
            port,
            username,
            password,
            location,
            description,
            resolution,
            fps,
            status: 'active'
        });

        // Hassas bilgileri gizle
        const cameraData = camera.toJSON();
        delete cameraData.password;

        // Log kaydı
        console.log(`Camera created: ${camera.name} (${camera.ip}:${camera.port}) by user ${req.user.id}`);

        res.status(201).json({
            message: 'Kamera başarıyla eklendi',
            camera: cameraData
        });
    } catch (error) {
        console.error('Create camera error:', error);
        res.status(500).json({ error: 'Kamera eklenemedi' });
    }
});

// Kamera güncelleme - PUT /api/cameras/:id
router.put('/:id', requirePermission('camera.update'), validateCameraUpdate, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const camera = await db.Camera.findByPk(id);
        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        // IP ve port değişikliği kontrol et
        if ((updateData.ip && updateData.ip !== camera.ip) ||
            (updateData.port && updateData.port !== camera.port)) {
            const newIp = updateData.ip || camera.ip;
            const newPort = updateData.port || camera.port;

            const existingCamera = await db.Camera.findOne({
                where: {
                    ip: newIp,
                    port: newPort,
                    id: { [Op.ne]: id }
                }
            });

            if (existingCamera) {
                return res.status(400).json({
                    error: 'Bu IP ve port kombinasyonu zaten kullanılıyor'
                });
            }
        }

        // Kamerayı güncelle
        await camera.update(updateData);

        // Eğer RTSP bilgileri değiştiyse aktif stream'leri yeniden başlat
        if (updateData.ip || updateData.port || updateData.username || updateData.password) {
            const activeStreams = await db.Stream.findAll({
                where: {
                    cameraId: camera.id,
                    status: 'active'
                }
            });

            // Stream Manager'dan yeniden başlat (eğer mevcut ise)
            for (const stream of activeStreams) {
                // Bu işlem async olarak yapılabilir
                setImmediate(async () => {
                    try {
                        const streamManager = req.app.locals.streamManager;
                        if (streamManager) {
                            await streamManager.restartStream(stream.id);
                        }
                    } catch (error) {
                        console.error(`Error restarting stream ${stream.id}:`, error);
                    }
                });
            }
        }

        // Hassas bilgileri gizle
        const cameraData = camera.toJSON();
        delete cameraData.password;

        console.log(`Camera updated: ${camera.name} by user ${req.user.id}`);

        res.json({
            message: 'Kamera başarıyla güncellendi',
            camera: cameraData
        });
    } catch (error) {
        console.error('Update camera error:', error);
        res.status(500).json({ error: 'Kamera güncellenemedi' });
    }
});

// Kamera silme - DELETE /api/cameras/:id
router.delete('/:id', requirePermission('camera.delete'), async (req, res) => {
    try {
        const { id } = req.params;
        const { force = false } = req.query;

        const camera = await db.Camera.findByPk(id, {
            include: [
                {
                    model: db.Stream,
                    as: 'streams'
                }
            ]
        });

        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        // Aktif stream'ler varsa uyarı ver
        const activeStreams = camera.streams.filter(stream => stream.status === 'active');
        if (activeStreams.length > 0 && !force) {
            return res.status(400).json({
                error: 'Kameranın aktif stream\'leri var. Önce stream\'leri durdurun veya force=true parametresi kullanın',
                activeStreams: activeStreams.length
            });
        }

        // Aktif stream'leri durdur
        const streamManager = req.app.locals.streamManager;
        if (streamManager) {
            for (const stream of activeStreams) {
                try {
                    await streamManager.stopStream(stream.id);
                } catch (error) {
                    console.error(`Error stopping stream ${stream.id}:`, error);
                }
            }
        }

        // Kamerayı sil (soft delete)
        await camera.destroy();

        console.log(`Camera deleted: ${camera.name} by user ${req.user.id}`);

        res.json({
            message: 'Kamera başarıyla silindi'
        });
    } catch (error) {
        console.error('Delete camera error:', error);
        res.status(500).json({ error: 'Kamera silinemedi' });
    }
});

// Kamera durumu test etme - POST /api/cameras/:id/test
router.post('/:id/test', requirePermission('camera.view'), async (req, res) => {
    try {
        const { id } = req.params;

        const camera = await db.Camera.findByPk(id);
        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        // RTSP bağlantısını test et
        const testResult = await testCameraConnection(camera);

        // Sonucu kaydet
        await camera.updateConnectionStatus(testResult.success, testResult.error);

        res.json({
            success: testResult.success,
            message: testResult.message,
            details: testResult.details,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Test camera error:', error);
        res.status(500).json({ error: 'Kamera testi yapılamadı' });
    }
});

// Kamera RTSP URL'i alma - GET /api/cameras/:id/rtsp
router.get('/:id/rtsp', requirePermission('camera.view'), async (req, res) => {
    try {
        const { id } = req.params;
        const { channel = 1 } = req.query;

        const camera = await db.Camera.findByPk(id);
        if (!camera) {
            return res.status(404).json({ error: 'Kamera bulunamadı' });
        }

        const rtspUrl = camera.generateRtspUrl(parseInt(channel));

        res.json({
            rtspUrl,
            channel: parseInt(channel),
            camera: {
                id: camera.id,
                name: camera.name,
                brand: camera.brand,
                model: camera.model
            }
        });
    } catch (error) {
        console.error('Get RTSP URL error:', error);
        res.status(500).json({ error: 'RTSP URL alınamadı' });
    }
});

// Toplu kamera işlemleri - POST /api/cameras/bulk
router.post('/bulk', requireRole('admin'), async (req, res) => {
    try {
        const { action, cameraIds, data } = req.body;

        if (!action || !cameraIds || !Array.isArray(cameraIds)) {
            return res.status(400).json({ error: 'Geçersiz toplu işlem parametreleri' });
        }

        const cameras = await db.Camera.findAll({
            where: {
                id: cameraIds
            }
        });

        if (cameras.length !== cameraIds.length) {
            return res.status(400).json({ error: 'Bazı kameralar bulunamadı' });
        }

        let results = [];

        switch (action) {
            case 'delete':
                for (const camera of cameras) {
                    try {
                        await camera.destroy();
                        results.push({ id: camera.id, success: true });
                    } catch (error) {
                        results.push({ id: camera.id, success: false, error: error.message });
                    }
                }
                break;

            case 'update_status':
                if (!data.status) {
                    return res.status(400).json({ error: 'Status değeri gerekli' });
                }

                for (const camera of cameras) {
                    try {
                        await camera.update({ status: data.status });
                        results.push({ id: camera.id, success: true });
                    } catch (error) {
                        results.push({ id: camera.id, success: false, error: error.message });
                    }
                }
                break;

            case 'test_connection':
                for (const camera of cameras) {
                    try {
                        const testResult = await testCameraConnection(camera);
                        await camera.updateConnectionStatus(testResult.success, testResult.error);
                        results.push({
                            id: camera.id,
                            success: testResult.success,
                            message: testResult.message
                        });
                    } catch (error) {
                        results.push({ id: camera.id, success: false, error: error.message });
                    }
                }
                break;

            default:
                return res.status(400).json({ error: 'Geçersiz işlem' });
        }

        console.log(`Bulk camera operation ${action} performed by user ${req.user.id} on ${cameraIds.length} cameras`);

        res.json({
            message: `Toplu ${action} işlemi tamamlandı`,
            results
        });
    } catch (error) {
        console.error('Bulk camera operation error:', error);
        res.status(500).json({ error: 'Toplu işlem yapılamadı' });
    }
});

// Kamera istatistikleri - GET /api/cameras/stats
router.get('/stats', requirePermission('camera.view'), async (req, res) => {
    try {
        const totalCameras = await db.Camera.count();
        const activeCameras = await db.Camera.count({ where: { status: 'active' } });
        const onlineCameras = await db.Camera.count({ where: { isOnline: true } });

        const brandStats = await db.Camera.findAll({
            attributes: [
                'brand',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['brand'],
            raw: true
        });

        const statusStats = await db.Camera.findAll({
            attributes: [
                'status',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['status'],
            raw: true
        });

        res.json({
            total: totalCameras,
            active: activeCameras,
            online: onlineCameras,
            offline: totalCameras - onlineCameras,
            brandBreakdown: brandStats.reduce((acc, item) => {
                acc[item.brand] = parseInt(item.count);
                return acc;
            }, {}),
            statusBreakdown: statusStats.reduce((acc, item) => {
                acc[item.status] = parseInt(item.count);
                return acc;
            }, {})
        });
    } catch (error) {
        console.error('Get camera stats error:', error);
        res.status(500).json({ error: 'Kamera istatistikleri alınamadı' });
    }
});

// Kamera bağlantı testi fonksiyonu
async function testCameraConnection(camera) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const timeout = 10000; // 10 saniye timeout

        const rtspUrl = camera.generateRtspUrl(1);

        // FFprobe ile RTSP bağlantısını test et
        const ffprobe = spawn('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-rtsp_transport', 'tcp',
            '-timeout', '5000000', // 5 saniye
            rtspUrl
        ]);

        let output = '';
        let errorOutput = '';

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        const timer = setTimeout(() => {
            ffprobe.kill('SIGKILL');
            resolve({
                success: false,
                message: 'Bağlantı zaman aşımına uğradı',
                error: 'Connection timeout',
                details: { timeout: timeout / 1000 }
            });
        }, timeout);

        ffprobe.on('close', (code) => {
            clearTimeout(timer);

            if (code === 0) {
                try {
                    const streamInfo = JSON.parse(output);
                    resolve({
                        success: true,
                        message: 'Kamera bağlantısı başarılı',
                        details: {
                            streams: streamInfo.streams?.length || 0,
                            hasVideo: streamInfo.streams?.some(s => s.codec_type === 'video') || false,
                            hasAudio: streamInfo.streams?.some(s => s.codec_type === 'audio') || false
                        }
                    });
                } catch (parseError) {
                    resolve({
                        success: false,
                        message: 'Kamera yanıtı geçersiz',
                        error: 'Invalid response format',
                        details: { parseError: parseError.message }
                    });
                }
            } else {
                resolve({
                    success: false,
                    message: 'Kamera bağlantısı başarısız',
                    error: errorOutput || 'Unknown connection error',
                    details: { exitCode: code }
                });
            }
        });

        ffprobe.on('error', (error) => {
            clearTimeout(timer);
            resolve({
                success: false,
                message: 'FFprobe hatası',
                error: error.message,
                details: { type: 'spawn_error' }
            });
        });
    });
}

module.exports = router;