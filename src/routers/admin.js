const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { requireAuth, requireAdmin, loadUser } = require('../middleware/auth');
const { Op } = require('sequelize');
const os = require('os');
const multer = require('multer'); // Form data için gerekli
const { User, Camera, Stream, Category, StreamCategory } = require('../models');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');

const SLIDER_DIR = path.join(__dirname, '../../public/assets/slider');
const SLIDER_DATA_FILE = path.join(__dirname, '../data/slider-images.json');

const router = express.Router();
const activeStreams = {};
// Multer middleware for form data handling
const upload = multer();
const SERVER_HOST = process.env.USE_NGINX === 'true'
    ? (process.env.NGINX_HOST || 'http://localhost:8080')
    : (process.env.SERVER_HOST + ":" + process.env.PORT || getServerIp() + ":" + process.env.PORT);

// Session middleware for admin panel
router.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Load user middleware
router.use(loadUser);

// Parse JSON and form data
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const { getStreamService } = require('../services/stream');
const streamService = getStreamService();

// Login page
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/admin');
    }
    res.render('admin/login', {
        title: 'Admin Login - Ark Stream',
        error: null
    });
});

// Login process
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({
            where: {
                [Op.or]: [
                    { username: username },
                    { email: username }
                ],
                is_active: true
            },
            attributes: ['id', 'username', 'email', 'password', 'role', 'last_login']
        });

        if (!user) {
            return res.render('admin/login', {
                title: 'Admin Login - Ark Stream',
                error: 'Geçersiz kullanıcı adı veya şifre'
            });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.render('admin/login', {
                title: 'Admin Login - Ark Stream',
                error: 'Geçersiz kullanıcı adı veya şifre'
            });
        }

        // Update last login
        await user.update({ last_login: new Date() });

        // Set session
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;

        res.redirect('/admin');
    } catch (error) {
        console.error('Login error:', error);
        res.render('admin/login', {
            title: 'Admin Login - Ark Stream',
            error: 'Giriş sırasında bir hata oluştu'
        });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/admin/login');
    });
});

// Dashboard
router.get('/', requireAuth, async (req, res) => {
    try {
        const userCount = await User.count();
        const activeUsers = await User.count({ where: { is_active: true } });
        const adminCount = await User.count({ where: { role: 'admin' } });

        res.render('admin/dashboard', {
            title: 'Dashboard - Ark Stream Admin',
            user: req.user,
            stats: {
                totalUsers: userCount,
                activeUsers: activeUsers,
                adminUsers: adminCount,
                totalCameras: 0,
                activeCameras: 0
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: {
                status: 500,
                message: 'Dashboard yüklenemedi'
            }
        });
    }
});

// Users management page
router.get('/users', requireAuth, async (req, res) => {
    try {
        res.render('admin/users', {
            title: 'Kullanıcı Yönetimi - Ark Stream Admin',
            user: req.user
        });
    } catch (error) {
        console.error('Users page error:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: {
                status: 500,
                message: 'Kullanıcı sayfası yüklenemedi'
            }
        });
    }
});

// ===========================================
// API ENDPOINTS FOR DATATABLES & AJAX
// ===========================================

// DataTable API for users - DÜZELTME: GET yerine POST
router.post('/api/users', requireAuth, async (req, res) => {
    try {
        const { start = 0, length = 10, search = {}, order = [] } = req.body;

        // Search conditions
        let whereCondition = {};
        if (search && search.value && search.value.trim() !== '') {
            const searchValue = `%${search.value.trim()}%`;
            whereCondition = {
                [Op.or]: [
                    { username: { [Op.like]: searchValue } },
                    { email: { [Op.like]: searchValue } },
                    { role: { [Op.like]: searchValue } }
                ]
            };
        }

        // Order conditions
        const orderConditions = [];
        const columns = ['id', 'username', 'email', 'role', 'is_active', 'last_login', 'created_at'];

        if (order && order.length > 0) {
            order.forEach(orderItem => {
                const columnIndex = parseInt(orderItem.column);
                const direction = orderItem.dir === 'desc' ? 'DESC' : 'ASC';
                if (columns[columnIndex]) {
                    orderConditions.push([columns[columnIndex], direction]);
                }
            });
        } else {
            orderConditions.push(['created_at', 'DESC']);
        }

        // Get total count
        const totalRecords = await User.count();

        // Get filtered count
        const filteredRecords = await User.count({ where: whereCondition });

        // Get data
        const users = await User.findAll({
            where: whereCondition,
            order: orderConditions,
            offset: parseInt(start),
            limit: parseInt(length),
            attributes: ['id', 'username', 'email', 'role', 'is_active', 'last_login', 'created_at']
        });

        res.json({
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: totalRecords,
            recordsFiltered: filteredRecords,
            data: users
        });
    } catch (error) {
        console.error('DataTable API error:', error);
        res.status(500).json({
            error: 'Veri yüklenemedi',
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: []
        });
    }
});

// Get single user
router.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id, {
            attributes: ['id', 'username', 'email', 'role', 'is_active', 'created_at', 'last_login']
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Kullanıcı bilgileri alınamadı'
        });
    }
});

// Create user - DÜZELTME: Multer upload middleware eklendi
router.post('/api/users/create', upload.none(), requireAuth, async (req, res) => {
    try {
        console.log('Create user request body:', req.body); // Debug log

        const { username, email, password, role, is_active } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Kullanıcı adı, email ve şifre alanları zorunludur'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Şifre en az 6 karakter olmalıdır'
            });
        }

        // Check if user exists
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [
                    { username: username.trim() },
                    { email: email.trim().toLowerCase() }
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Bu kullanıcı adı veya email zaten kullanılıyor'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            username: username.trim(),
            email: email.trim().toLowerCase(),
            password: hashedPassword,
            role: role || 'viewer',
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        });

        res.json({
            success: true,
            message: 'Kullanıcı başarıyla oluşturuldu',
            data: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                is_active: user.is_active
            }
        });
    } catch (error) {
        console.error('User creation error:', error);

        let errorMessage = 'Kullanıcı oluşturulurken bir hata oluştu';
        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Bu kullanıcı adı veya email zaten kullanılıyor';
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
        }

        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
});

// Update user - DÜZELTME: Multer upload middleware eklendi
router.put('/api/users/:id', upload.none(), requireAuth, async (req, res) => {
    try {
        console.log('Update user request body:', req.body); // Debug log

        const userId = req.params.id;
        const { username, email, password, role, is_active } = req.body;

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }

        // Validation
        if (!username || !email) {
            return res.status(400).json({
                success: false,
                message: 'Kullanıcı adı ve email doldurulmalıdır'
            });
        }

        // Check if username/email exists for other users
        const existingUser = await User.findOne({
            where: {
                [Op.and]: [
                    { id: { [Op.ne]: userId } },
                    {
                        [Op.or]: [
                            { username: username.trim() },
                            { email: email.trim().toLowerCase() }
                        ]
                    }
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Bu kullanıcı adı veya email başka bir kullanıcı tarafından kullanılıyor'
            });
        }

        const updateData = {
            username: username.trim(),
            email: email.trim().toLowerCase(),
            role: role || 'viewer',
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        };

        // Only update password if provided
        if (password && password.trim() !== '') {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Şifre en az 6 karakter olmalıdır'
                });
            }
            updateData.password = await bcrypt.hash(password, 12);
        }

        await user.update(updateData);

        res.json({
            success: true,
            message: 'Kullanıcı başarıyla güncellendi',
            data: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                is_active: user.is_active
            }
        });
    } catch (error) {
        console.error('User update error:', error);

        let errorMessage = 'Kullanıcı güncellenirken bir hata oluştu';
        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Bu kullanıcı adı veya email başka bir kullanıcı tarafından kullanılıyor';
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
        }

        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
});

// Change password
router.post('/api/users/:id/change-password', requireAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({
                success: false,
                message: 'Yeni şifre gereklidir'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Şifre en az 6 karakter olmalıdır'
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        await user.update({ password: hashedPassword });

        res.json({
            success: true,
            message: 'Şifre başarıyla değiştirildi'
        });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({
            success: false,
            message: 'Şifre değiştirilirken bir hata oluştu'
        });
    }
});

// Delete user
router.delete('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.params.id;

        // Prevent deleting current user
        if (userId == req.session.userId) {
            return res.status(400).json({
                success: false,
                message: 'Kendi hesabınızı silemezsiniz'
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }

        await user.destroy();

        res.json({
            success: true,
            message: 'Kullanıcı başarıyla silindi'
        });
    } catch (error) {
        console.error('User deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Kullanıcı silinirken bir hata oluştu'
        });
    }
});

// Get admin statistics
router.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const totalUsers = await User.count();
        const activeUsers = await User.count({ where: { is_active: true } });
        const adminUsers = await User.count({ where: { role: 'admin' } });
        const userUsers = await User.count({ where: { role: 'user' } });
        const viewerUsers = await User.count({ where: { role: 'viewer' } });

        // Recent users (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentUsers = await User.count({
            where: {
                created_at: {
                    [Op.gte]: thirtyDaysAgo
                }
            }
        });

        // Users with recent login (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentlyActiveUsers = await User.count({
            where: {
                last_login: {
                    [Op.gte]: sevenDaysAgo
                }
            }
        });

        res.json({
            success: true,
            data: {
                totalUsers,
                activeUsers,
                inactiveUsers: totalUsers - activeUsers,
                adminUsers,
                userUsers,
                viewerUsers,
                recentUsers,
                recentlyActiveUsers
            }
        });
    } catch (error) {
        console.error('Stats API error:', error);
        res.status(500).json({
            success: false,
            message: 'İstatistikler alınamadı'
        });
    }
});
router.post('/api/cameras', requireAuth, async (req, res) => {
    try {
        const { start = 0, length = 10, search = {}, order = [] } = req.body;

        let whereCondition = {};
        if (search && search.value && search.value.trim() !== '') {
            const searchValue = `%${search.value.trim()}%`;
            whereCondition = {
                [Op.or]: [
                    { name: { [Op.like]: searchValue } },
                    { brand: { [Op.like]: searchValue } },
                    { model: { [Op.like]: searchValue } }
                ]
            };
        }

        const orderConditions = [];
        const columns = ['name', 'brand', 'model', 'created_at'];

        if (order && order.length > 0) {
            order.forEach(orderItem => {
                const columnIndex = parseInt(orderItem.column);
                const direction = orderItem.dir === 'desc' ? 'DESC' : 'ASC';
                if (columns[columnIndex]) {
                    orderConditions.push([columns[columnIndex], direction]);
                }
            });
        } else {
            orderConditions.push(['created_at', 'DESC']);
        }

        const totalRecords = await Camera.count();
        const filteredRecords = await Camera.count({ where: whereCondition });

        const cameras = await Camera.findAll({
            where: whereCondition,
            order: orderConditions,
            offset: parseInt(start),
            limit: parseInt(length),
            include: [{
                model: Stream,
                as: 'streams',
                attributes: ['id', 'stream_name', 'status']
            }]
        });

        res.json({
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: totalRecords,
            recordsFiltered: filteredRecords,
            data: cameras
        });
    } catch (error) {
        console.error('DataTable API error (cameras):', error);
        res.status(500).json({
            error: 'Veri yüklenemedi',
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: []
        });
    }
});

// Kamera ekleme
router.post('/api/cameras/create', upload.none(), requireAuth, async (req, res) => {
    try {
        const { name, brand, model, description, is_active } = req.body;

        if (!name || !brand || !model) {
            return res.status(400).json({
                success: false,
                message: 'Kamera adı, marka ve model alanları zorunludur'
            });
        }

        const existingCamera = await Camera.findOne({
            where: { name: name.trim() }
        });

        if (existingCamera) {
            return res.status(400).json({
                success: false,
                message: 'Bu kamera adı zaten kullanılıyor'
            });
        }

        const camera = await Camera.create({
            name: name.trim(),
            brand: brand.trim(),
            model: model.trim(),
            description: description?.trim() || null,
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        });

        res.json({
            success: true,
            message: 'Kamera başarıyla oluşturuldu',
            data: camera
        });
    } catch (error) {
        console.error('Camera creation error:', error);
        res.status(400).json({
            success: false,
            message: 'Kamera oluşturulurken bir hata oluştu'
        });
    }
});

// Kamera güncelleme
router.put('/api/cameras/:id', upload.none(), requireAuth, async (req, res) => {
    try {
        const cameraId = req.params.id;
        const { name, brand, model, description, is_active } = req.body;

        const camera = await Camera.findByPk(cameraId);
        if (!camera) {
            return res.status(404).json({
                success: false,
                message: 'Kamera bulunamadı'
            });
        }

        if (!name || !brand || !model) {
            return res.status(400).json({
                success: false,
                message: 'Kamera adı, marka ve model alanları zorunludur'
            });
        }

        const existingCamera = await Camera.findOne({
            where: {
                [Op.and]: [
                    { id: { [Op.ne]: cameraId } },
                    { name: name.trim() }
                ]
            }
        });

        if (existingCamera) {
            return res.status(400).json({
                success: false,
                message: 'Bu kamera adı başka bir kamera tarafından kullanılıyor'
            });
        }

        await camera.update({
            name: name.trim(),
            brand: brand.trim(),
            model: model.trim(),
            description: description?.trim() || null,
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        });

        res.json({
            success: true,
            message: 'Kamera başarıyla güncellendi',
            data: camera
        });
    } catch (error) {
        console.error('Camera update error:', error);
        res.status(400).json({
            success: false,
            message: 'Kamera güncellenirken bir hata oluştu'
        });
    }
});

// Kamera silme
router.delete('/api/cameras/:id', requireAuth, async (req, res) => {
    try {
        const cameraId = req.params.id;
        const camera = await Camera.findByPk(cameraId);

        if (!camera) {
            return res.status(404).json({
                success: false,
                message: 'Kamera bulunamadı'
            });
        }

        // Aktif stream'leri kontrol et
        const activeStreamsForCamera = await Stream.findAll({
            where: {
                camera_id: cameraId,
                status: ['streaming', 'starting']
            }
        });

        if (activeStreamsForCamera.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Bu kameraya ait aktif yayınlar var. Önce yayınları durdurun.'
            });
        }

        await camera.destroy();

        res.json({
            success: true,
            message: 'Kamera başarıyla silindi'
        });
    } catch (error) {
        console.error('Camera deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Kamera silinirken bir hata oluştu'
        });
    }
});

// STREAM ENDPOINTS

// Stream listesi (DataTable için)
router.post('/api/streams', requireAuth, async (req, res) => {
    try {
        const { start = 0, length = 10, search = {}, order = [] } = req.body;

        let whereCondition = {};
        if (search && search.value && search.value.trim() !== '') {
            const searchValue = `%${search.value.trim()}%`;
            whereCondition = {
                [Op.or]: [
                    { stream_name: { [Op.like]: searchValue } },
                    { ip_address: { [Op.like]: searchValue } },
                    { '$camera.name$': { [Op.like]: searchValue } },
                    { '$camera.brand$': { [Op.like]: searchValue } },
                    { '$categories.name$': { [Op.like]: searchValue } }
                ]
            };
        }

        const orderConditions = [];
        const columns = ['stream_name', 'ip_address', 'status', 'created_at'];

        if (order && order.length > 0) {
            order.forEach(orderItem => {
                const columnIndex = parseInt(orderItem.column);
                const direction = orderItem.dir === 'desc' ? 'DESC' : 'ASC';
                if (columns[columnIndex]) {
                    orderConditions.push([columns[columnIndex], direction]);
                }
            });
        } else {
            orderConditions.push(['created_at', 'DESC']);
        }

        const totalRecords = await Stream.count();

        // Filtered records için subquery kullan (many-to-many arama için)
        let filteredRecords;
        if (whereCondition[Op.or]) {
            filteredRecords = await Stream.count({
                where: whereCondition,
                include: [{
                    model: Camera,
                    as: 'camera',
                    required: false
                }, {
                    model: Category,
                    as: 'categories',
                    required: false
                }],
                distinct: true // Many-to-many ilişkide duplicate'ları önler
            });
        } else {
            filteredRecords = totalRecords;
        }

        const streams = await Stream.findAll({
            where: whereCondition,
            order: orderConditions,
            offset: parseInt(start),
            limit: parseInt(length),
            include: [{
                model: Camera,
                as: 'camera',
                attributes: ['id', 'name', 'brand', 'model']
            }, {
                model: Category,
                as: 'categories',
                attributes: ['id', 'name', 'color', 'icon'],
                required: false,
                through: { attributes: [] } // Junction table attributes'larını dahil etme
            }],
            distinct: true // Duplicate stream'leri önle
        });

        res.json({
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: totalRecords,
            recordsFiltered: filteredRecords,
            data: streams
        });
    } catch (error) {
        console.error('DataTable API error (streams):', error);
        res.status(500).json({
            error: 'Veri yüklenemedi',
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: []
        });
    }
});

// Stream ekleme
router.post('/api/streams/create', upload.none(), requireAuth, async (req, res) => {
    try {
        const {
            stream_name, camera_id, ip_address, rtsp_port, username, password, channel,
            resolution, fps, bitrate, audio_bitrate, is_active, is_recording
        } = req.body;

        if (!stream_name || !camera_id || !ip_address || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Yayın adı, kamera, IP adresi, kullanıcı adı ve şifre alanları zorunludur'
            });
        }

        // Kameranın var olduğunu kontrol et
        const camera = await Camera.findByPk(camera_id);
        if (!camera) {
            return res.status(400).json({
                success: false,
                message: 'Seçilen kamera bulunamadı'
            });
        }

        // Stream adının benzersiz olduğunu kontrol et
        const existingStream = await Stream.findOne({
            where: { stream_name: stream_name.trim() }
        });

        if (existingStream) {
            return res.status(400).json({
                success: false,
                message: 'Bu yayın adı zaten kullanılıyor'
            });
        }

        const stream = await Stream.create({
            stream_name: stream_name.trim(),
            camera_id,
            ip_address: ip_address.trim(),
            rtsp_port: rtsp_port ? parseInt(rtsp_port) : 554,
            username: username.trim(),
            password: password.trim(),
            channel: channel ? parseInt(channel) : 1,
            resolution: resolution || '640x480',
            fps: fps ? parseInt(fps) : 30,
            bitrate: bitrate || '800k',
            audio_bitrate: audio_bitrate || '160k',
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true',
            is_recording: is_recording === 'on' || is_recording === true || is_recording === '1' || is_recording === 'true',
            hls_url: `${SERVER_HOST}/static/stream/${stream_name.trim()}.m3u8`
        });

        res.json({
            success: true,
            message: 'Yayın başarıyla oluşturuldu',
            data: stream
        });
    } catch (error) {
        console.error('Stream creation error:', error);
        res.status(400).json({
            success: false,
            message: 'Yayın oluşturulurken bir hata oluştu'
        });
    }
});

function getServerIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
// Stream başlatma
router.post('/api/streams/:id/start', requireAuth, async (req, res) => {
    try {
        const streamId = req.params.id;
        const stream = await Stream.findByPk(streamId, {
            include: [{
                model: Camera,
                as: 'camera'
            }]
        });

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Stream zaten aktif mi?
        if (streamService.isStreamActive(stream.stream_name)) {
            return res.status(400).json({
                success: false,
                message: 'Bu yayın zaten aktif'
            });
        }

        // Stream config hazırla
        const streamConfig = {
            streamName: stream.stream_name,
            brand: stream.camera.brand,
            username: stream.username,
            password: stream.password,
            ip: stream.ip_address,
            port: stream.rtsp_port,
            channel: stream.channel,
            resolution: stream.resolution,
            fps: stream.fps,
            bitrate: stream.bitrate,
            audioBitrate: stream.audio_bitrate
        };

        // Database durumunu güncelle - starting
        await stream.update({
            status: 'starting',
            last_started: new Date(),
            error_message: null
        });

        try {
            // Stream servisini başlat
            const result = await streamService.startStream(streamConfig);

            // Callback'leri ayarla - database güncellemeleri için
            streamService.setStreamCallbacks(stream.stream_name, {
                onClose: async (code) => {
                    await stream.update({
                        status: code === 0 ? 'stopped' : 'error',
                        last_stopped: new Date(),
                        error_message: code !== 0 ? `FFmpeg exited with code ${code}` : null,
                        process_id: null
                    });
                },
                onError: async (error) => {
                    await stream.update({
                        status: 'error',
                        error_message: error.message,
                        process_id: null
                    });
                }
            });

            // Database'de final durumu güncelle
            await stream.update({
                status: 'streaming',
                process_id: result.pid,
                hls_url: `${SERVER_HOST}${result.hlsUrl}`
            });

            res.json({
                success: true,
                message: 'Yayın başlatıldı',
                data: {
                    stream_name: stream.stream_name,
                    hls_url: `${result.hlsUrl}`,
                    status: 'streaming',
                    pid: result.pid
                }
            });

        } catch (streamError) {
            // Stream başlatma hatası - database'i güncelle
            await stream.update({
                status: 'error',
                error_message: streamError.message,
                process_id: null
            });

            throw streamError;
        }

    } catch (error) {
        console.error('Stream start error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın başlatılırken bir hata oluştu: ' + error.message
        });
    }
});

// Stream durdurma
router.post('/api/streams/:id/stop', requireAuth, async (req, res) => {
    try {
        const streamId = req.params.id;
        const stream = await Stream.findByPk(streamId);

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Stream aktif değilse
        if (!streamService.isStreamActive(stream.stream_name)) {
            return res.status(400).json({
                success: false,
                message: 'Bu yayın zaten aktif değil'
            });
        }

        try {
            // Stream servisini durdur
            await streamService.stopStream(stream.stream_name);

            // Database'i güncelle
            await stream.update({
                status: 'stopped',
                last_stopped: new Date(),
                process_id: null,
                error_message: null
            });

            res.json({
                success: true,
                message: 'Yayın durduruldu'
            });

        } catch (streamError) {
            // Stream durdurma hatası
            await stream.update({
                status: 'error',
                error_message: streamError.message
            });

            throw streamError;
        }

    } catch (error) {
        console.error('Stream stop error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın durdurulurken bir hata oluştu: ' + error.message
        });
    }
});

router.get('/api/streams/:id/status', requireAuth, async (req, res) => {
    try {
        const streamId = req.params.id;
        const stream = await Stream.findByPk(streamId);

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Stream service'den gerçek durumu al
        const streamStatus = streamService.getStreamStatus(stream.stream_name);

        if (streamStatus) {
            // Database ile senkronize et
            if (stream.status !== streamStatus.status) {
                await stream.update({ status: streamStatus.status });
            }
        }

        res.json({
            success: true,
            data: {
                database_status: stream.status,
                service_status: streamStatus,
                last_started: stream.last_started,
                last_stopped: stream.last_stopped,
                hls_url: stream.hls_url
            }
        });

    } catch (error) {
        console.error('Stream status error:', error);
        res.status(500).json({
            success: false,
            message: 'Stream durumu alınırken bir hata oluştu'
        });
    }
});

// Tüm aktif stream'leri listele
router.get('/api/streams/active', requireAuth, async (req, res) => {
    try {
        const activeStreams = streamService.getActiveStreams();

        res.json({
            success: true,
            data: activeStreams
        });

    } catch (error) {
        console.error('Active streams error:', error);
        res.status(500).json({
            success: false,
            message: 'Aktif stream listesi alınırken bir hata oluştu'
        });
    }
});

// Stream güncelleme
router.put('/api/streams/:id', upload.none(), requireAuth, async (req, res) => {
    try {
        const streamId = req.params.id;
        const {
            stream_name, camera_id, ip_address, rtsp_port, username, password, channel,
            resolution, fps, bitrate, audio_bitrate, is_active, is_recording
        } = req.body;

        const stream = await Stream.findByPk(streamId);
        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Aktif yayınlar güncellenemez
        if (stream.status === 'streaming' || stream.status === 'starting') {
            return res.status(400).json({
                success: false,
                message: 'Aktif yayınlar güncellenemez. Önce yayını durdurun.'
            });
        }

        // Kameranın var olduğunu kontrol et
        const camera = await Camera.findByPk(camera_id);
        if (!camera) {
            return res.status(400).json({
                success: false,
                message: 'Seçilen kamera bulunamadı'
            });
        }

        // Stream adının benzersiz olduğunu kontrol et
        const existingStream = await Stream.findOne({
            where: {
                [Op.and]: [
                    { id: { [Op.ne]: streamId } },
                    { stream_name: stream_name.trim() }
                ]
            }
        });

        if (existingStream) {
            return res.status(400).json({
                success: false,
                message: 'Bu yayın adı başka bir yayın tarafından kullanılıyor'
            });
        }

        const updateData = {
            stream_name: stream_name.trim(),
            camera_id,
            ip_address: ip_address.trim(),
            rtsp_port: rtsp_port ? parseInt(rtsp_port) : 554,
            username: username.trim(),
            channel: channel ? parseInt(channel) : 1,
            resolution: resolution || '640x480',
            fps: fps ? parseInt(fps) : 30,
            bitrate: bitrate || '800k',
            audio_bitrate: audio_bitrate || '160k',
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true',
            is_recording: is_recording === 'on' || is_recording === true || is_recording === '1' || is_recording === 'true',
            hls_url: `${SERVER_HOST}/static/stream/${stream_name.trim()}.m3u8`
        };

        // DÜZELTME: Şifre sadece dolu gelirse güncelle
        if (password && password.trim() !== '') {
            updateData.password = password.trim();
        }

        await stream.update(updateData);

        res.json({
            success: true,
            message: 'Yayın başarıyla güncellendi',
            data: stream
        });
    } catch (error) {
        console.error('Stream update error:', error);
        res.status(400).json({
            success: false,
            message: 'Yayın güncellenirken bir hata oluştu'
        });
    }
});

// Stream silme
router.delete('/api/streams/:id', requireAuth, async (req, res) => {
    try {
        const streamId = req.params.id;
        const stream = await Stream.findByPk(streamId);

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Aktif yayın silinemez
        if (stream.status === 'streaming' || stream.status === 'starting') {
            return res.status(400).json({
                success: false,
                message: 'Aktif yayın silinemez. Önce yayını durdurun.'
            });
        }

        await stream.destroy();

        res.json({
            success: true,
            message: 'Yayın başarıyla silindi'
        });
    } catch (error) {
        console.error('Stream deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın silinirken bir hata oluştu'
        });
    }
});

// Aktif kameralar listesi (Stream oluştururken kullanmak için)
router.get('/api/cameras/list', requireAuth, async (req, res) => {
    try {
        const cameras = await Camera.findAll({
            where: { is_active: true },
            attributes: ['id', 'name', 'brand', 'model'],
            order: [['name', 'ASC']]
        });

        res.json({
            success: true,
            data: cameras
        });
    } catch (error) {
        console.error('Camera list error:', error);
        res.status(500).json({
            success: false,
            message: 'Kamera listesi alınamadı'
        });
    }
});

// Tek stream bilgisi
router.get('/api/streams/:id', requireAuth, async (req, res) => {
    try {
        const stream = await Stream.findByPk(req.params.id, {
            include: [{
                model: Camera,
                as: 'camera'
            }, {
                model: Category,
                as: 'categories',
                attributes: ['id', 'name', 'color', 'icon'],
                through: { attributes: [] }
            }]
        });

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        res.json({
            success: true,
            data: stream
        });
    } catch (error) {
        console.error('Get stream error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın bilgileri alınamadı'
        });
    }
});

// Tek kamera bilgisi
router.get('/api/cameras/:id', requireAuth, async (req, res) => {
    try {
        const camera = await Camera.findByPk(req.params.id, {
            include: [{
                model: Stream,
                as: 'streams',
                attributes: ['id', 'stream_name', 'status']
            }]
        });

        if (!camera) {
            return res.status(404).json({
                success: false,
                message: 'Kamera bulunamadı'
            });
        }

        res.json({
            success: true,
            data: camera
        });
    } catch (error) {
        console.error('Get camera error:', error);
        res.status(500).json({
            success: false,
            message: 'Kamera bilgileri alınamadı'
        });
    }
});

// İstatistikler
router.get('/api/stream-stats', requireAuth, async (req, res) => {
    try {
        const totalCameras = await Camera.count();
        const activeCameras = await Camera.count({ where: { is_active: true } });
        const totalStreams = await Stream.count();
        const activeStreams = await Stream.count({ where: { is_active: true } });
        const streamingStreams = await Stream.count({ where: { status: 'streaming' } });
        const stoppedStreams = await Stream.count({ where: { status: 'stopped' } });
        const errorStreams = await Stream.count({ where: { status: 'error' } });

        // Many-to-many kategori istatistikleri
        const totalStreamCategoryRelations = await StreamCategory.count();
        const categorizedStreams = await Stream.count({
            include: [{
                model: Category,
                as: 'categories',
                required: true
            }],
            distinct: true
        });
        const uncategorizedStreams = totalStreams - categorizedStreams;

        // Marka istatistikleri
        const brandStats = await Camera.findAll({
            attributes: [
                'brand',
                [require('sequelize').fn('COUNT', '*'), 'count']
            ],
            group: ['brand'],
            raw: true
        });

        // En popüler kategoriler (en çok stream'e sahip)
        const topCategories = await Category.findAll({
            include: [{
                model: Stream,
                as: 'streams',
                attributes: [],
                where: { is_active: true },
                required: false
            }],
            attributes: [
                'id', 'name', 'color',
                [require('sequelize').fn('COUNT', require('sequelize').col('streams.id')), 'stream_count']
            ],
            group: ['Category.id'],
            order: [[require('sequelize').fn('COUNT', require('sequelize').col('streams.id')), 'DESC']],
            limit: 5
        });

        res.json({
            success: true,
            data: {
                cameras: {
                    total: totalCameras,
                    active: activeCameras,
                    inactive: totalCameras - activeCameras
                },
                streams: {
                    total: totalStreams,
                    active: activeStreams,
                    streaming: streamingStreams,
                    stopped: stoppedStreams,
                    error: errorStreams,
                    categorized: categorizedStreams,
                    uncategorized: uncategorizedStreams
                },
                categories: {
                    totalRelations: totalStreamCategoryRelations,
                    topCategories: topCategories.map(cat => ({
                        id: cat.id,
                        name: cat.name,
                        color: cat.color,
                        streamCount: parseInt(cat.getDataValue('stream_count')) || 0
                    }))
                },
                brandStats: brandStats.reduce((acc, item) => {
                    acc[item.brand] = parseInt(item.count);
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Stream stats API error:', error);
        res.status(500).json({
            success: false,
            message: 'İstatistikler alınamadı'
        });
    }
});

async function ensureSliderDir() {
    try {
        await fs.access(SLIDER_DIR);
    } catch (error) {
        await fs.mkdir(SLIDER_DIR, { recursive: true });
    }
}

// Slider veri dosyasını oluştur
async function ensureSliderDataFile() {
    try {
        await fs.access(SLIDER_DATA_FILE);
    } catch (error) {
        // Data klasörünü oluştur
        await fs.mkdir(path.dirname(SLIDER_DATA_FILE), { recursive: true });
        await fs.writeFile(SLIDER_DATA_FILE, JSON.stringify([], null, 2));
    }
}

// Slider verilerini oku
async function readSliderData() {
    try {
        await ensureSliderDataFile();
        const data = await fs.readFile(SLIDER_DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading slider data:', error);
        return [];
    }
}

// Slider verilerini kaydet
async function writeSliderData(data) {
    try {
        await ensureSliderDataFile();
        await fs.writeFile(SLIDER_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing slider data:', error);
        throw error;
    }
}

// Multer storage configuration for slider images
const sliderStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        await ensureSliderDir();
        cb(null, SLIDER_DIR);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueName = crypto.randomUUID();
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uniqueName}${ext}`);
    }
});

const sliderUpload = multer({
    storage: sliderStorage,
    fileFilter: (req, file, cb) => {
        // Check file type
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Sadece resim dosyaları (JPEG, PNG, WEBP) desteklenir'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// ============================================
// SLIDER API ENDPOINTS
// ============================================

// Slider resimlerini listele
router.get('/api/slider/images', requireAuth, async (req, res) => {
    try {
        const images = await readSliderData();

        // Sort by order
        images.sort((a, b) => (a.order || 0) - (b.order || 0));

        res.json({
            success: true,
            data: images
        });
    } catch (error) {
        console.error('Get slider images error:', error);
        res.status(500).json({
            success: false,
            message: 'Slider resimleri alınırken hata oluştu'
        });
    }
});

// Slider resim yükleme
router.post('/api/slider/upload', requireAuth, sliderUpload.array('images', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Hiç dosya yüklenmedi'
            });
        }

        const existingImages = await readSliderData();
        const newImages = [];

        for (const file of req.files) {
            try {
                // Get image metadata using sharp
                const metadata = await sharp(file.path).metadata();

                // Create image record
                const imageData = {
                    id: crypto.randomUUID(),
                    filename: file.filename,
                    original_name: file.originalname,
                    file_size: file.size,
                    mime_type: file.mimetype,
                    width: metadata.width,
                    height: metadata.height,
                    order: existingImages.length + newImages.length,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                newImages.push(imageData);
            } catch (imageError) {
                console.error('Error processing image:', imageError);
                // Delete the problematic file
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    console.error('Error deleting problematic file:', unlinkError);
                }
            }
        }

        if (newImages.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Hiç resim işlenemedi. Dosyaların geçerli resim formatında olduğundan emin olun.'
            });
        }

        // Add new images to existing data
        const allImages = [...existingImages, ...newImages];
        await writeSliderData(allImages);

        res.json({
            success: true,
            message: `${newImages.length} resim başarıyla yüklendi`,
            data: {
                uploaded: newImages.length,
                total: allImages.length,
                images: newImages
            }
        });

    } catch (error) {
        console.error('Slider upload error:', error);

        // Clean up uploaded files on error
        if (req.files) {
            for (const file of req.files) {
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    console.error('Error cleaning up file:', unlinkError);
                }
            }
        }

        let errorMessage = 'Resim yükleme sırasında hata oluştu';
        if (error.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.';
        } else if (error.message.includes('desteklenir')) {
            errorMessage = error.message;
        }

        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
});

// Slider resmi silme
router.delete('/api/slider/images/:id', requireAuth, async (req, res) => {
    try {
        const imageId = req.params.id;
        const images = await readSliderData();

        const imageIndex = images.findIndex(img => img.id === imageId);
        if (imageIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Resim bulunamadı'
            });
        }

        const imageToDelete = images[imageIndex];

        // Delete physical file
        try {
            await fs.unlink(path.join(SLIDER_DIR, imageToDelete.filename));
        } catch (fileError) {
            console.warn('File already deleted or not found:', fileError);
        }

        // Remove from data
        images.splice(imageIndex, 1);

        // Reorder remaining images
        images.forEach((img, index) => {
            img.order = index;
            img.updated_at = new Date().toISOString();
        });

        await writeSliderData(images);

        res.json({
            success: true,
            message: 'Resim başarıyla silindi',
            data: {
                deleted: imageToDelete.original_name,
                remaining: images.length
            }
        });

    } catch (error) {
        console.error('Delete slider image error:', error);
        res.status(500).json({
            success: false,
            message: 'Resim silinirken hata oluştu'
        });
    }
});

// Slider resim sıralamasını değiştir
router.post('/api/slider/reorder', requireAuth, async (req, res) => {
    try {
        const { fromIndex, toIndex } = req.body;

        if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
            return res.status(400).json({
                success: false,
                message: 'Geçersiz index değerleri'
            });
        }

        const images = await readSliderData();

        if (fromIndex < 0 || fromIndex >= images.length || toIndex < 0 || toIndex >= images.length) {
            return res.status(400).json({
                success: false,
                message: 'Index değerleri geçerli aralıkta değil'
            });
        }

        // Sort by current order
        images.sort((a, b) => (a.order || 0) - (b.order || 0));

        // Move item
        const [movedItem] = images.splice(fromIndex, 1);
        images.splice(toIndex, 0, movedItem);

        // Update order for all items
        images.forEach((img, index) => {
            img.order = index;
            img.updated_at = new Date().toISOString();
        });

        await writeSliderData(images);

        res.json({
            success: true,
            message: 'Sıralama başarıyla değiştirildi'
        });

    } catch (error) {
        console.error('Reorder slider images error:', error);
        res.status(500).json({
            success: false,
            message: 'Sıralama değiştirilirken hata oluştu'
        });
    }
});

// Slider resim bilgilerini güncelle
router.put('/api/slider/images/:id', requireAuth, async (req, res) => {
    try {
        const imageId = req.params.id;
        const { original_name } = req.body;

        const images = await readSliderData();
        const imageIndex = images.findIndex(img => img.id === imageId);

        if (imageIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Resim bulunamadı'
            });
        }

        // Update image data
        if (original_name) {
            images[imageIndex].original_name = original_name.trim();
        }
        images[imageIndex].updated_at = new Date().toISOString();

        await writeSliderData(images);

        res.json({
            success: true,
            message: 'Resim bilgileri güncellendi',
            data: images[imageIndex]
        });

    } catch (error) {
        console.error('Update slider image error:', error);
        res.status(500).json({
            success: false,
            message: 'Resim güncellenirken hata oluştu'
        });
    }
});

// Slider istatistikleri
router.get('/api/slider/stats', requireAuth, async (req, res) => {
    try {
        const images = await readSliderData();

        let totalSize = 0;
        const formats = {};
        const dimensions = {};

        images.forEach(img => {
            totalSize += img.file_size || 0;

            const ext = path.extname(img.filename).toLowerCase().substring(1);
            formats[ext] = (formats[ext] || 0) + 1;

            const dimension = `${img.width}x${img.height}`;
            dimensions[dimension] = (dimensions[dimension] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                total_images: images.length,
                total_size: totalSize,
                formats,
                dimensions,
                average_size: images.length > 0 ? Math.round(totalSize / images.length) : 0
            }
        });

    } catch (error) {
        console.error('Slider stats error:', error);
        res.status(500).json({
            success: false,
            message: 'İstatistikler alınırken hata oluştu'
        });
    }
});

// Public API - Frontend için slider resimlerini al
router.get('/api/slider-images', async (req, res) => {
    try {
        const images = await readSliderData();

        // Sort by order and return only filenames
        const sortedImages = images
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(img => img.filename);

        res.json({
            success: true,
            images: sortedImages
        });

    } catch (error) {
        console.error('Public slider images error:', error);
        res.status(500).json({
            success: false,
            message: 'Slider resimleri alınırken hata oluştu',
            images: []
        });
    }
});

// Başlangıçta klasörleri ve veri dosyasını oluştur
(async () => {
    try {
        await ensureSliderDir();
        await ensureSliderDataFile();
        console.log('Slider directories and data file initialized');
    } catch (error) {
        console.error('Error initializing slider system:', error);
    }
})();

router.get('/categories', requireAuth, async (req, res) => {
    try {
        res.render('admin/categories', {
            title: 'Kategori Yönetimi - Ark Stream Admin',
            user: req.user
        });
    } catch (error) {
        console.error('Categories page error:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: {
                status: 500,
                message: 'Kategori sayfası yüklenemedi'
            }
        });
    }
});

// DataTable API for categories
router.post('/api/categories', requireAuth, async (req, res) => {
    try {
        const { start = 0, length = 10, search = {}, order = [] } = req.body;

        let whereCondition = {};
        if (search && search.value && search.value.trim() !== '') {
            const searchValue = `%${search.value.trim()}%`;
            whereCondition = {
                [Op.or]: [
                    { name: { [Op.like]: searchValue } },
                    { description: { [Op.like]: searchValue } }
                ]
            };
        }

        const orderConditions = [];
        const columns = ['name', 'sort_order', 'is_active', 'created_at'];

        if (order && order.length > 0) {
            order.forEach(orderItem => {
                const columnIndex = parseInt(orderItem.column);
                const direction = orderItem.dir === 'desc' ? 'DESC' : 'ASC';
                if (columns[columnIndex]) {
                    orderConditions.push([columns[columnIndex], direction]);
                }
            });
        } else {
            orderConditions.push(['sort_order', 'ASC'], ['name', 'ASC']);
        }

        const totalRecords = await Category.count();
        const filteredRecords = await Category.count({ where: whereCondition });

        // FIXED: Use a simpler approach with two separate queries
        const categories = await Category.findAll({
            where: whereCondition,
            order: orderConditions,
            offset: parseInt(start),
            limit: parseInt(length)
        });

        // Get stream counts for these specific categories
        const categoryIds = categories.map(cat => cat.id);

        const streamCounts = await StreamCategory.findAll({
            where: {
                category_id: categoryIds
            },
            attributes: [
                'category_id',
                [require('sequelize').fn('COUNT', require('sequelize').col('category_id')), 'stream_count']
            ],
            group: ['category_id'],
            raw: true
        });

        // Create a map for easy lookup
        const streamCountMap = {};
        streamCounts.forEach(item => {
            streamCountMap[item.category_id] = parseInt(item.stream_count) || 0;
        });

        // Add stream counts to categories
        const categoriesWithCounts = categories.map(category => {
            const categoryData = category.toJSON();
            categoryData.stream_count = streamCountMap[category.id] || 0;
            return categoryData;
        });

        res.json({
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: totalRecords,
            recordsFiltered: filteredRecords,
            data: categoriesWithCounts
        });
    } catch (error) {
        console.error('DataTable API error (categories):', error);
        res.status(500).json({
            error: 'Veri yüklenemedi',
            draw: parseInt(req.body.draw) || 1,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: []
        });
    }
});

// Aktif kategoriler listesi (Stream oluştururken kullanmak için)
router.get('/api/categories/list', requireAuth, async (req, res) => {
    try {
        const categories = await Category.findAll({
            where: { is_active: true },
            attributes: ['id', 'name', 'color', 'icon'],
            order: [['sort_order', 'ASC'], ['name', 'ASC']]
        });

        console.log('Categories found:', categories.length); // Debug log

        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error('Category list error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori listesi alınamadı'
        });
    }
});

// Kategori istatistikleri
router.get('/api/category-stats', requireAuth, async (req, res) => {
    try {
        const totalCategories = await Category.count();
        const activeCategories = await Category.count({ where: { is_active: true } });

        // Her kategori için stream sayısı
        const categoryStreamCounts = await Category.findAll({
            include: [{
                model: Stream,
                as: 'streams',
                attributes: [],
                where: { is_active: true },
                required: false
            }],
            attributes: [
                'id', 'name', 'color',
                [require('sequelize').fn('COUNT', require('sequelize').col('streams.id')), 'stream_count']
            ],
            group: ['Category.id'],
            order: [['sort_order', 'ASC']]
        });

        // Kategorisiz streamler
        const totalStreams = await Stream.count({ where: { is_active: true } });
        const categorizedStreams = await StreamCategory.count({
            include: [{
                model: Stream,
                where: { is_active: true }
            }]
        });
        const uncategorizedStreams = totalStreams - categorizedStreams;

        res.json({
            success: true,
            data: {
                totalCategories,
                activeCategories,
                inactiveCategories: totalCategories - activeCategories,
                totalStreams,
                categorizedStreams,
                uncategorizedStreams,
                categoryStreamCounts: categoryStreamCounts.map(cat => ({
                    id: cat.id,
                    name: cat.name,
                    color: cat.color,
                    streamCount: parseInt(cat.getDataValue('stream_count')) || 0
                }))
            }
        });
    } catch (error) {
        console.error('Category stats API error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori istatistikleri alınamadı'
        });
    }
});


// Tek kategori getir
router.get('/api/categories/:id', requireAuth, async (req, res) => {
    try {
        const category = await Category.findByPk(req.params.id, {
            include: [{
                model: Stream,
                as: 'streams',
                attributes: ['id', 'stream_name', 'status', 'is_active'],
                required: false
            }]
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Kategori bulunamadı'
            });
        }

        res.json({
            success: true,
            data: category
        });
    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori bilgileri alınamadı'
        });
    }
});

// Yeni kategori oluştur
router.post('/api/categories/create', upload.none(), requireAuth, async (req, res) => {
    try {
        console.log('Create category request body:', req.body);

        const { name, description, color, icon, sort_order, is_active } = req.body;

        // Validasyon
        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Kategori adı en az 2 karakter olmalıdır'
            });
        }

        // Aynı isimde kategori var mı kontrol et
        const existingCategory = await Category.findOne({
            where: { name: name.trim() }
        });

        if (existingCategory) {
            return res.status(400).json({
                success: false,
                message: 'Bu isimde bir kategori zaten mevcut'
            });
        }

        const category = await Category.create({
            name: name.trim(),
            description: description?.trim() || null,
            color: color || '#007bff',
            icon: icon || 'camera',
            sort_order: sort_order ? parseInt(sort_order) : 0,
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        });

        res.json({
            success: true,
            message: 'Kategori başarıyla oluşturuldu',
            data: category
        });
    } catch (error) {
        console.error('Category creation error:', error);

        let errorMessage = 'Kategori oluşturulurken bir hata oluştu';
        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Bu kategori adı zaten kullanılıyor';
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
        }

        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
});

// Kategori güncelle
router.put('/api/categories/:id', upload.none(), requireAuth, async (req, res) => {
    try {
        console.log('Update category request body:', req.body);

        const categoryId = req.params.id;
        const { name, description, color, icon, sort_order, is_active } = req.body;

        const category = await Category.findByPk(categoryId);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Kategori bulunamadı'
            });
        }

        // Eğer isim değiştiriliyorsa, aynı isimde başka kategori var mı kontrol et
        if (name && name.trim() !== category.name) {
            const existingCategory = await Category.findOne({
                where: {
                    name: name.trim(),
                    id: { [Op.ne]: categoryId }
                }
            });

            if (existingCategory) {
                return res.status(400).json({
                    success: false,
                    message: 'Bu isimde bir kategori zaten mevcut'
                });
            }
        }

        await category.update({
            name: name?.trim() || category.name,
            description: description !== undefined ? (description?.trim() || null) : category.description,
            color: color || category.color,
            icon: icon || category.icon,
            sort_order: sort_order !== undefined ? parseInt(sort_order) : category.sort_order,
            is_active: is_active === 'on' || is_active === true || is_active === '1' || is_active === 'true'
        });

        res.json({
            success: true,
            message: 'Kategori başarıyla güncellendi',
            data: category
        });
    } catch (error) {
        console.error('Category update error:', error);

        let errorMessage = 'Kategori güncellenirken bir hata oluştu';
        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Bu kategori adı başka bir kategori tarafından kullanılıyor';
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
        }

        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
});

// Kategori sil
router.delete('/api/categories/:id', requireAuth, async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { force = false } = req.query; // ?force=true ile zorunlu silme

        const category = await Category.findByPk(categoryId);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Kategori bulunamadı'
            });
        }

        // Kategoriye bağlı stream var mı kontrol et
        const streamCount = await StreamCategory.count({
            where: { category_id: categoryId }
        });

        if (streamCount > 0 && !force) {
            return res.status(400).json({
                success: false,
                message: `Bu kategoride ${streamCount} yayın bulunmaktadır. Önce yayınları başka kategorilere taşıyın veya silin.`,
                data: {
                    streamCount,
                    forceDeleteUrl: `/admin/api/categories/${categoryId}?force=true`
                }
            });
        }

        // Zorunlu silme durumunda, bağlı stream ilişkilerini sil
        if (force && streamCount > 0) {
            await StreamCategory.destroy({
                where: { category_id: categoryId }
            });
        }

        await category.destroy();

        res.json({
            success: true,
            message: 'Kategori başarıyla silindi',
            data: {
                deletedCategory: category.name,
                removedRelations: force ? streamCount : 0
            }
        });
    } catch (error) {
        console.error('Category deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori silinemedi'
        });
    }
});

// Kategori sıralamasını güncelle
router.post('/api/categories/reorder', upload.none(), requireAuth, async (req, res) => {
    try {
        const { categories } = req.body; // [{ id, sort_order }, ...]

        if (!Array.isArray(categories)) {
            return res.status(400).json({
                success: false,
                message: 'Kategoriler array formatında olmalıdır'
            });
        }

        const updatePromises = categories.map(cat =>
            Category.update(
                { sort_order: parseInt(cat.sort_order) },
                { where: { id: cat.id } }
            )
        );

        await Promise.all(updatePromises);

        res.json({
            success: true,
            message: 'Kategori sıralaması güncellendi'
        });
    } catch (error) {
        console.error('Reorder categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategori sıralaması güncellenemedi'
        });
    }
});

// ============================================
// STREAM-CATEGORY RELATION ENDPOINTS
// ============================================

// Stream'e kategori ekle
router.post('/api/streams/:streamId/categories/:categoryId', requireAuth, async (req, res) => {
    try {
        const { streamId, categoryId } = req.params;

        // Stream ve kategori var mı kontrol et
        const stream = await Stream.findByPk(streamId);
        const category = await Category.findByPk(categoryId);

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Kategori bulunamadı'
            });
        }

        // İlişki zaten var mı kontrol et
        const existingRelation = await StreamCategory.findOne({
            where: { stream_id: streamId, category_id: categoryId }
        });

        if (existingRelation) {
            return res.status(400).json({
                success: false,
                message: 'Bu yayın zaten bu kategoride mevcut'
            });
        }

        // İlişki oluştur
        await StreamCategory.create({
            stream_id: streamId,
            category_id: categoryId
        });

        res.json({
            success: true,
            message: 'Yayın kategoriye başarıyla eklendi'
        });

    } catch (error) {
        console.error('Add stream to category error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın kategoriye eklenirken hata oluştu'
        });
    }
});

// Stream'den kategori çıkar
router.delete('/api/streams/:streamId/categories/:categoryId', requireAuth, async (req, res) => {
    try {
        const { streamId, categoryId } = req.params;

        const deleted = await StreamCategory.destroy({
            where: {
                stream_id: streamId,
                category_id: categoryId
            }
        });

        if (deleted === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bu yayın zaten bu kategoride değil'
            });
        }

        res.json({
            success: true,
            message: 'Yayın kategoriden başarıyla çıkarıldı'
        });

    } catch (error) {
        console.error('Remove stream from category error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın kategoriden çıkarılırken hata oluştu'
        });
    }
});

// Stream'in kategorilerini toplu güncelle
router.put('/api/streams/:streamId/categories', upload.none(), requireAuth, async (req, res) => {
    try {
        const { streamId } = req.params;
        const { category_ids } = req.body; // Array of category IDs

        const stream = await Stream.findByPk(streamId);
        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        // Mevcut ilişkileri sil
        await StreamCategory.destroy({
            where: { stream_id: streamId }
        });

        // Yeni kategoriler varsa ekle
        if (category_ids && Array.isArray(category_ids) && category_ids.length > 0) {
            // Kategorilerin var olduğunu kontrol et
            const existingCategories = await Category.findAll({
                where: { id: category_ids },
                attributes: ['id']
            });

            const existingCategoryIds = existingCategories.map(cat => cat.id);

            // Mevcut kategoriler için ilişki oluştur
            const streamCategories = existingCategoryIds.map(categoryId => ({
                stream_id: streamId,
                category_id: categoryId
            }));

            if (streamCategories.length > 0) {
                await StreamCategory.bulkCreate(streamCategories);
            }
        }

        res.json({
            success: true,
            message: 'Yayın kategorileri başarıyla güncellendi',
            data: {
                updated_categories: category_ids || []
            }
        });

    } catch (error) {
        console.error('Update stream categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın kategorileri güncellenirken hata oluştu'
        });
    }
});

// Stream'in kategorilerini getir
router.get('/api/streams/:streamId/categories', requireAuth, async (req, res) => {
    try {
        const { streamId } = req.params;

        const stream = await Stream.findByPk(streamId, {
            include: [{
                model: Category,
                as: 'categories',
                attributes: ['id', 'name', 'color', 'icon']
            }]
        });

        if (!stream) {
            return res.status(404).json({
                success: false,
                message: 'Yayın bulunamadı'
            });
        }

        res.json({
            success: true,
            data: {
                stream_id: streamId,
                stream_name: stream.stream_name,
                categories: stream.categories || []
            }
        });

    } catch (error) {
        console.error('Get stream categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Yayın kategorileri alınırken hata oluştu'
        });
    }
});



module.exports = router;