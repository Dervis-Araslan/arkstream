const express = require('express');
const path = require('path');
const { Stream, Camera } = require('../models');
const { getStreamService } = require('../services/stream');

const router = express.Router();
const streamService = getStreamService();

// Ana sayfa
router.get('/', (req, res) => {
    const publicPath = path.resolve(process.cwd(), 'public', 'index.html');
    res.sendFile(publicPath);
});

// Aktif yayınları listele - PUBLIC API
router.get('/api/streams/public', async (req, res) => {
    try {
        const streams = await Stream.findAll({
            where: {
                is_active: true,
                status: 'streaming'  // Bu önemli
            },
            include: [{
                model: Camera,
                as: 'camera',
                where: { is_active: true },
                attributes: ['name', 'brand', 'model']
            }],
            attributes: ['id', 'stream_name', 'hls_url', 'resolution', 'status']
        });


        const publicStreams = streams.map(stream => ({
            id: stream.id,
            name: stream.stream_name,
            location: stream.camera.name,
            status: 'live', // Sadece streaming olanları aldığımız için
            streamUrl: stream.hls_url,
            brand: stream.camera.brand,
            model: stream.camera.model,
            resolution: stream.resolution,
            viewers: 0
        }));

        res.json({
            success: true,
            data: publicStreams
        });
    } catch (error) {
        console.error('Public streams API error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın listesi alınamadı'
        });
    }
});

module.exports = router;