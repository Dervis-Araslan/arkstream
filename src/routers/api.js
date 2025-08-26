const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { requireAuth, checkPermission } = require('../middleware/auth');

const router = express.Router();

// API middleware - her response JSON olsun
router.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Ark Stream API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        status: 'online'
    });
});

// Mevcut kullanıcı bilgilerini getir
router.get('/user', requireAuth, async (req, res) => {
    try {
        const user = await User.findByPk(req.session.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('API get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to fetch user information'
        });
    }
});

// Kullanıcıları listele (sayfalama ile)
router.get('/users', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        // Arama koşulu
        const whereClause = {};
        if (search) {
            whereClause[Op.or] = [
                { username: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows: users } = await User.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['created_at', 'DESC']],
            attributes: { exclude: ['password'] }
        });

        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    page,
                    limit,
                    total: count,
                    pages: Math.ceil(count / limit),
                    hasNext: page * limit < count,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('API users list error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to fetch users'
        });
    }
});

// Tek kullanıcı getir
router.get('/users/:id', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('API single user error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to fetch user'
        });
    }
});

// Yeni kullanıcı oluştur
router.post('/users', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const { username, email, password, role, is_active } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username, email and password are required'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Password hash
        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            username: username.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || 'viewer',
            is_active: is_active !== undefined ? is_active : true
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: user
        });

    } catch (error) {
        console.error('API user creation error:', error);

        let errorMessage = 'Unable to create user';
        let statusCode = 500;

        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Username or email already exists';
            statusCode = 400;
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            message: errorMessage
        });
    }
});

// Kullanıcı güncelle
router.put('/users/:id', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const { username, email, password, role, is_active } = req.body;
        const updateData = {};

        // Update fields if provided
        if (username !== undefined) updateData.username = username.trim();
        if (email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid email address'
                });
            }
            updateData.email = email.toLowerCase().trim();
        }
        if (role !== undefined) updateData.role = role;
        if (is_active !== undefined) updateData.is_active = is_active;

        // Password update
        if (password && password.trim() !== '') {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters'
                });
            }
            updateData.password = await bcrypt.hash(password, 12);
        }

        await user.update(updateData);

        res.json({
            success: true,
            message: 'User updated successfully',
            data: user
        });

    } catch (error) {
        console.error('API user update error:', error);

        let errorMessage = 'Unable to update user';
        let statusCode = 500;

        if (error.name === 'SequelizeUniqueConstraintError') {
            errorMessage = 'Username or email already exists';
            statusCode = 400;
        } else if (error.name === 'SequelizeValidationError') {
            errorMessage = error.errors.map(err => err.message).join(', ');
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            message: errorMessage
        });
    }
});

// Kullanıcı sil
router.delete('/users/:id', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const userId = req.params.id;

        // Kendi hesabını silmeyi engelle
        if (userId == req.session.userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account'
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Son admin kontrolü
        if (user.role === 'admin') {
            const adminCount = await User.count({ where: { role: 'admin' } });
            if (adminCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete the last admin user'
                });
            }
        }

        await user.destroy();

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('API user deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to delete user'
        });
    }
});

// Kullanıcı durumunu değiştir (aktif/pasif)
router.patch('/users/:id/status', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Kendi hesabını deaktif etmeyi engelle
        if (req.params.id == req.session.userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot deactivate your own account'
            });
        }

        const { is_active } = req.body;

        await user.update({ is_active });

        res.json({
            success: true,
            message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
            data: user
        });

    } catch (error) {
        console.error('API user status update error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to update user status'
        });
    }
});

// Sistem istatistikleri
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const totalUsers = await User.count();
        const activeUsers = await User.count({ where: { is_active: true } });
        const inactiveUsers = await User.count({ where: { is_active: false } });
        const adminUsers = await User.count({ where: { role: 'admin' } });
        const normalUsers = await User.count({ where: { role: 'user' } });
        const viewerUsers = await User.count({ where: { role: 'viewer' } });

        // Son 24 saat içinde giriş yapan kullanıcılar
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const recentLogins = await User.count({
            where: {
                last_login: {
                    [Op.gte]: yesterday
                }
            }
        });

        res.json({
            success: true,
            data: {
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    inactive: inactiveUsers,
                    recent_logins: recentLogins,
                    by_role: {
                        admin: adminUsers,
                        user: normalUsers,
                        viewer: viewerUsers
                    }
                },
                cameras: {
                    total: 0, // Camera modeli eklenince güncellenecek
                    active: 0,
                    inactive: 0,
                    recording: 0
                },
                system: {
                    uptime: Math.floor(process.uptime()),
                    memory: {
                        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
                    },
                    version: '1.0.0',
                    node_version: process.version,
                    platform: process.platform
                },
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('API stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to fetch system statistics'
        });
    }
});

// Kullanıcı arama
router.get('/users/search/:query', requireAuth, checkPermission('manage_users'), async (req, res) => {
    try {
        const { query } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const users = await User.findAll({
            where: {
                [Op.or]: [
                    { username: { [Op.like]: `%${query}%` } },
                    { email: { [Op.like]: `%${query}%` } }
                ]
            },
            limit,
            order: [['username', 'ASC']],
            attributes: { exclude: ['password'] }
        });

        res.json({
            success: true,
            data: {
                users,
                count: users.length,
                query
            }
        });

    } catch (error) {
        console.error('API user search error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to search users'
        });
    }
});

module.exports = router;