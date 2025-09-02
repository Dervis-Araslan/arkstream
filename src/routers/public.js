const express = require('express');
const path = require('path');
const { Stream, Camera, Category, StreamCategory } = require('../models');
const { getStreamService } = require('../services/stream');

const router = express.Router();
const streamService = getStreamService();

// Ana sayfa
router.get('/', (req, res) => {
    const publicPath = path.resolve(process.cwd(), 'public', 'index.html');
    res.sendFile(publicPath);
});

// Kategorileri listele - PUBLIC API
router.get('/api/categories/public', async (req, res) => {
    try {
        const categories = await Category.findAll({
            where: { is_active: true },
            include: [{
                model: Stream,
                as: 'streams',
                attributes: [],
                where: {
                    is_active: true,
                    status: 'streaming'
                },
                required: false
            }],
            attributes: [
                'id', 'name', 'description', 'color', 'icon', 'sort_order',
                [require('sequelize').fn('COUNT', require('sequelize').col('streams.id')), 'stream_count']
            ],
            group: ['Category.id'],
            order: [['sort_order', 'ASC']]
        });

        const publicCategories = categories.map(category => ({
            id: category.id,
            name: category.name,
            description: category.description,
            color: category.color,
            icon: category.icon,
            streamCount: parseInt(category.getDataValue('stream_count')) || 0
        }));

        res.json({
            success: true,
            data: publicCategories
        });
    } catch (error) {
        console.error('Public categories API error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori listesi alınamadı'
        });
    }
});

// Aktif yayınları listele - PUBLIC API (kategori filtreli)
router.get('/api/streams/public', async (req, res) => {
    try {
        const { category } = req.query; // ?category=uuid şeklinde

        let whereCondition = {
            is_active: true,
            status: 'streaming'
        };

        let includeConditions = [{
            model: Camera,
            as: 'camera',
            where: { is_active: true },
            attributes: ['name', 'brand', 'model']
        }, {
            model: Category,
            as: 'categories',
            attributes: ['id', 'name', 'color', 'icon'],
            required: false
        }];

        // Eğer kategori parametresi varsa, sadece o kategorideki streamleri getir
        if (category) {
            includeConditions[1] = {
                model: Category,
                as: 'categories',
                attributes: ['id', 'name', 'color', 'icon'],
                where: { id: category },
                required: true // Bu kategoride olmayan streamleri hariç tut
            };
        }

        const streams = await Stream.findAll({
            where: whereCondition,
            include: includeConditions,
            attributes: ['id', 'stream_name', 'hls_url', 'resolution', 'status'],
            order: [['created_at', 'DESC']]
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
            viewers: 0,
            categories: stream.categories ? stream.categories.map(cat => ({
                id: cat.id,
                name: cat.name,
                color: cat.color,
                icon: cat.icon
            })) : []
        }));

        res.json({
            success: true,
            data: publicStreams,
            filter: category ? { category } : null
        });
    } catch (error) {
        console.error('Public streams API error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın listesi alınamadı'
        });
    }
});

// Kategoriye göre yayın sayısı - PUBLIC API
router.get('/api/categories/:categoryId/streams/count', async (req, res) => {
    try {
        const { categoryId } = req.params;

        const count = await Stream.count({
            where: {
                is_active: true,
                status: 'streaming'
            },
            include: [{
                model: Camera,
                as: 'camera',
                where: { is_active: true }
            }, {
                model: Category,
                as: 'categories',
                where: { id: categoryId },
                required: true
            }]
        });

        res.json({
            success: true,
            data: {
                categoryId,
                activeStreamCount: count
            }
        });
    } catch (error) {
        console.error('Category stream count API error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori yayın sayısı alınamadı'
        });
    }
});

// Belirli kategorilerdeki yayınları getir - PUBLIC API
router.post('/api/streams/by-categories', async (req, res) => {
    try {
        const { categories } = req.body; // [categoryId1, categoryId2, ...]

        if (!Array.isArray(categories) || categories.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Kategori listesi gereklidir'
            });
        }

        const streams = await Stream.findAll({
            where: {
                is_active: true,
                status: 'streaming'
            },
            include: [{
                model: Camera,
                as: 'camera',
                where: { is_active: true },
                attributes: ['name', 'brand', 'model']
            }, {
                model: Category,
                as: 'categories',
                attributes: ['id', 'name', 'color', 'icon'],
                where: { id: categories },
                required: true
            }],
            attributes: ['id', 'stream_name', 'hls_url', 'resolution', 'status'],
            order: [['created_at', 'DESC']]
        });

        const publicStreams = streams.map(stream => ({
            id: stream.id,
            name: stream.stream_name,
            location: stream.camera.name,
            status: 'live',
            streamUrl: stream.hls_url,
            brand: stream.camera.brand,
            model: stream.camera.model,
            resolution: stream.resolution,
            viewers: 0,
            categories: stream.categories.map(cat => ({
                id: cat.id,
                name: cat.name,
                color: cat.color,
                icon: cat.icon
            }))
        }));

        res.json({
            success: true,
            data: publicStreams,
            filter: { categories }
        });
    } catch (error) {
        console.error('Streams by categories API error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori yayınları alınamadı'
        });
    }
});

module.exports = router;