const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../models');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { validateUser, validateLogin, validatePasswordChange } = require('../middleware/validation');

const router = express.Router();

// Kullanıcı kayıt - POST /api/auth/register
router.post('/register', validateUser, async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, role = 'viewer' } = req.body;

        // Username ve email benzersizlik kontrolü
        const existingUser = await db.User.findOne({
            where: {
                [db.Sequelize.Op.or]: [
                    { username: username.toLowerCase() },
                    { email: email.toLowerCase() }
                ]
            }
        });

        if (existingUser) {
            const field = existingUser.username === username.toLowerCase() ? 'Username' : 'Email';
            return res.status(400).json({ error: `${field} zaten kullanılıyor` });
        }

        // Admin sadece admin oluşturabilir
        if (role === 'admin' && (!req.user || req.user.role !== 'admin')) {
            return res.status(403).json({ error: 'Admin hesabı oluşturma yetkiniz yok' });
        }

        // İlk kullanıcı otomatik admin olur
        const userCount = await db.User.count();
        const finalRole = userCount === 0 ? 'admin' : role;

        // Kullanıcı oluştur
        const user = await db.User.createUser({
            username,
            email,
            password,
            firstName,
            lastName,
            role: finalRole,
            status: 'active'
        });

        // JWT token oluştur
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`User registered: ${user.username} (${user.role})`);

        res.status(201).json({
            message: 'Kullanıcı başarıyla oluşturuldu',
            user,
            token
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Kullanıcı oluşturulamadı' });
    }
});

// Kullanıcı giriş - POST /api/auth/login
router.post('/login', validateLogin, async (req, res) => {
    try {
        const { username, password, rememberMe = false } = req.body;
        const clientIp = req.ip || req.connection.remoteAddress;

        // Kullanıcıyı authenticate et
        const user = await db.User.authenticate(username, password);

        // Last login bilgilerini güncelle
        user.lastLoginIp = clientIp;
        await user.save();

        // JWT token oluştur
        const tokenExpiry = rememberMe ? '30d' : '7d';
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: tokenExpiry }
        );

        // Hassas bilgileri gizle
        const userData = user.toJSON();
        delete userData.password;
        delete userData.passwordResetToken;
        delete userData.emailVerificationToken;

        console.log(`User logged in: ${user.username} from ${clientIp}`);

        res.json({
            message: 'Giriş başarılı',
            user: userData,
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ error: error.message });
    }
});

// Kullanıcı çıkış - POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        // Token blacklist'e eklenebilir (Redis kullanılabilir)
        console.log(`User logged out: ${req.user.username}`);

        res.json({
            message: 'Çıkış başarılı'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Çıkış yapılamadı' });
    }
});

// Kullanıcı profili - GET /api/auth/profile
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
        });

        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        res.json(user);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Profil alınamadı' });
    }
});

// Profil güncelleme - PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { firstName, lastName, email, preferences, timezone, language } = req.body;

        const user = await db.User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Email değişikliği kontrolü
        if (email && email !== user.email) {
            const existingUser = await db.User.findOne({
                where: {
                    email: email.toLowerCase(),
                    id: { [db.Sequelize.Op.ne]: user.id }
                }
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Bu email zaten kullanılıyor' });
            }
        }

        // Güncelleme verilerini hazırla
        const updateData = {};
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (email !== undefined) updateData.email = email.toLowerCase();
        if (preferences !== undefined) updateData.preferences = { ...user.preferences, ...preferences };
        if (timezone !== undefined) updateData.timezone = timezone;
        if (language !== undefined) updateData.language = language;

        await user.update(updateData);

        // Hassas bilgileri gizle
        const userData = user.toJSON();
        delete userData.password;
        delete userData.passwordResetToken;
        delete userData.emailVerificationToken;

        console.log(`Profile updated: ${user.username}`);

        res.json({
            message: 'Profil başarıyla güncellendi',
            user: userData
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Profil güncellenemedi' });
    }
});

// Şifre değiştirme - POST /api/auth/change-password
router.post('/change-password', authMiddleware, validatePasswordChange, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await db.User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Mevcut şifreyi kontrol et
        const isValidPassword = await user.validatePassword(currentPassword);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Mevcut şifre yanlış' });
        }

        // Yeni şifreyi kaydet
        user.password = newPassword;
        await user.save();

        console.log(`Password changed: ${user.username}`);

        res.json({
            message: 'Şifre başarıyla değiştirildi'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Şifre değiştirilemedi' });
    }
});

// Token doğrulama - GET /api/auth/verify
router.get('/verify', authMiddleware, async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] }
        });

        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        res.json({
            valid: true,
            user
        });
    } catch (error) {
        console.error('Verify token error:', error);
        res.status(401).json({ error: 'Token geçersiz' });
    }
});

// Kullanıcı listesi (Admin) - GET /api/auth/users
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            role,
            status,
            search,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const where = {};

        // Filtreleme
        if (role) {
            where.role = role;
        }

        if (status) {
            where.status = status;
        }

        if (search) {
            where[db.Sequelize.Op.or] = [
                { username: { [db.Sequelize.Op.like]: `%${search}%` } },
                { email: { [db.Sequelize.Op.like]: `%${search}%` } },
                { firstName: { [db.Sequelize.Op.like]: `%${search}%` } },
                { lastName: { [db.Sequelize.Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows: users } = await db.User.findAndCountAll({
            where,
            attributes: { exclude: ['password', 'passwordResetToken', 'emailVerificationToken'] },
            order: [[sortBy, sortOrder.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Kullanıcılar alınamadı' });
    }
});

// Kullanıcı oluşturma (Admin) - POST /api/auth/users
router.post('/users', authMiddleware, requireRole('admin'), validateUser, async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, role = 'viewer' } = req.body;

        // Username ve email benzersizlik kontrolü
        const existingUser = await db.User.findOne({
            where: {
                [db.Sequelize.Op.or]: [
                    { username: username.toLowerCase() },
                    { email: email.toLowerCase() }
                ]
            }
        });

        if (existingUser) {
            const field = existingUser.username === username.toLowerCase() ? 'Username' : 'Email';
            return res.status(400).json({ error: `${field} zaten kullanılıyor` });
        }

        // Kullanıcı oluştur
        const user = await db.User.createUser({
            username,
            email,
            password,
            firstName,
            lastName,
            role,
            status: 'active'
        });

        console.log(`User created by admin: ${user.username} (${user.role}) by ${req.user.username}`);

        res.status(201).json({
            message: 'Kullanıcı başarıyla oluşturuldu',
            user
        });
    } catch (error) {
        console.error('Admin create user error:', error);
        res.status(500).json({ error: 'Kullanıcı oluşturulamadı' });
    }
});

// Kullanıcı güncelleme (Admin) - PUT /api/auth/users/:id
router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, firstName, lastName, role, status } = req.body;

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Kendi kendini admin'den çıkarmasını engelle
        if (user.id === req.user.id && role && role !== 'admin') {
            return res.status(400).json({ error: 'Kendi rolünüzü admin\'den değiştiremezsiniz' });
        }

        // Username ve email benzersizlik kontrolü
        if ((username && username !== user.username) || (email && email !== user.email)) {
            const newUsername = username ? username.toLowerCase() : user.username;
            const newEmail = email ? email.toLowerCase() : user.email;

            const existingUser = await db.User.findOne({
                where: {
                    [db.Sequelize.Op.or]: [
                        { username: newUsername },
                        { email: newEmail }
                    ],
                    id: { [db.Sequelize.Op.ne]: id }
                }
            });

            if (existingUser) {
                return res.status(400).json({ error: 'Username veya email zaten kullanılıyor' });
            }
        }

        // Güncelleme verilerini hazırla
        const updateData = {};
        if (username !== undefined) updateData.username = username.toLowerCase();
        if (email !== undefined) updateData.email = email.toLowerCase();
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (role !== undefined) updateData.role = role;
        if (status !== undefined) updateData.status = status;

        await user.update(updateData);

        // Hassas bilgileri gizle
        const userData = user.toJSON();
        delete userData.password;
        delete userData.passwordResetToken;
        delete userData.emailVerificationToken;

        console.log(`User updated by admin: ${user.username} by ${req.user.username}`);

        res.json({
            message: 'Kullanıcı başarıyla güncellendi',
            user: userData
        });
    } catch (error) {
        console.error('Admin update user error:', error);
        res.status(500).json({ error: 'Kullanıcı güncellenemedi' });
    }
});

// Kullanıcı silme (Admin) - DELETE /api/auth/users/:id
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Kendi kendini silmesini engelle
        if (user.id === req.user.id) {
            return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
        }

        // Son admin'i silmesini engelle
        if (user.role === 'admin') {
            const adminCount = await db.User.count({ where: { role: 'admin' } });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Son admin hesabını silemezsiniz' });
            }
        }

        await user.destroy();

        console.log(`User deleted by admin: ${user.username} by ${req.user.username}`);

        res.json({
            message: 'Kullanıcı başarıyla silindi'
        });
    } catch (error) {
        console.error('Admin delete user error:', error);
        res.status(500).json({ error: 'Kullanıcı silinemedi' });
    }
});

// Kullanıcı istatistikleri (Admin) - GET /api/auth/stats
router.get('/stats', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const totalUsers = await db.User.count();
        const activeUsers = await db.User.count({ where: { status: 'active' } });
        const suspendedUsers = await db.User.count({ where: { status: 'suspended' } });

        const roleStats = await db.User.findAll({
            attributes: [
                'role',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['role'],
            raw: true
        });

        const recentLogins = await db.User.findAll({
            where: {
                lastLoginAt: {
                    [db.Sequelize.Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Son 24 saat
                }
            },
            attributes: ['id', 'username', 'lastLoginAt', 'lastLoginIp'],
            order: [['lastLoginAt', 'DESC']],
            limit: 10
        });

        res.json({
            total: totalUsers,
            active: activeUsers,
            inactive: totalUsers - activeUsers,
            suspended: suspendedUsers,
            roleBreakdown: roleStats.reduce((acc, item) => {
                acc[item.role] = parseInt(item.count);
                return acc;
            }, {}),
            recentLogins
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ error: 'Kullanıcı istatistikleri alınamadı' });
    }
});

// Şifre sıfırlama isteği - POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email adresi gerekli' });
        }

        const user = await db.User.findOne({
            where: { email: email.toLowerCase() }
        });

        if (!user) {
            // Güvenlik için her zaman başarılı mesaj döndür
            return res.json({
                message: 'Eğer bu email adresi sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi'
            });
        }

        // Şifre sıfırlama token'ı oluştur
        const resetToken = require('crypto').randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 saat

        await user.update({
            passwordResetToken: resetToken,
            passwordResetExpires: resetExpires
        });

        // TODO: Email gönderme servisi entegrasyonu
        console.log(`Password reset requested for: ${user.email}, token: ${resetToken}`);

        res.json({
            message: 'Eğer bu email adresi sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi'
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Şifre sıfırlama isteği gönderilemedi' });
    }
});

// Şifre sıfırlama - POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token ve yeni şifre gerekli' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
        }

        const user = await db.User.findOne({
            where: {
                passwordResetToken: token,
                passwordResetExpires: {
                    [db.Sequelize.Op.gt]: new Date()
                }
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş token' });
        }

        // Şifreyi güncelle ve token'ı temizle
        await user.update({
            password: newPassword,
            passwordResetToken: null,
            passwordResetExpires: null
        });

        console.log(`Password reset completed for: ${user.email}`);

        res.json({
            message: 'Şifre başarıyla sıfırlandı'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Şifre sıfırlanamadı' });
    }
});

// Toplu kullanıcı işlemleri (Admin) - POST /api/auth/users/bulk
router.post('/users/bulk', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { action, userIds, data } = req.body;

        if (!action || !userIds || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'Geçersiz toplu işlem parametreleri' });
        }

        const users = await db.User.findAll({
            where: { id: userIds }
        });

        if (users.length !== userIds.length) {
            return res.status(400).json({ error: 'Bazı kullanıcılar bulunamadı' });
        }

        // Kendi hesabını etkileyecek işlemleri engelle
        const affectsSelf = users.some(user => user.id === req.user.id);
        if (affectsSelf && (action === 'delete' || (action === 'update_role' && data.role !== 'admin'))) {
            return res.status(400).json({ error: 'Kendi hesabınızı etkileyecek işlemler yapılamaz' });
        }

        let results = [];

        switch (action) {
            case 'delete':
                for (const user of users) {
                    try {
                        // Admin sayısını kontrol et
                        if (user.role === 'admin') {
                            const adminCount = await db.User.count({ where: { role: 'admin' } });
                            if (adminCount <= 1) {
                                results.push({
                                    id: user.id,
                                    success: false,
                                    error: 'Son admin hesabı silinemez'
                                });
                                continue;
                            }
                        }

                        await user.destroy();
                        results.push({ id: user.id, success: true });
                    } catch (error) {
                        results.push({ id: user.id, success: false, error: error.message });
                    }
                }
                break;

            case 'update_status':
                if (!data.status) {
                    return res.status(400).json({ error: 'Status değeri gerekli' });
                }

                for (const user of users) {
                    try {
                        await user.update({ status: data.status });
                        results.push({ id: user.id, success: true });
                    } catch (error) {
                        results.push({ id: user.id, success: false, error: error.message });
                    }
                }
                break;

            case 'update_role':
                if (!data.role) {
                    return res.status(400).json({ error: 'Role değeri gerekli' });
                }

                for (const user of users) {
                    try {
                        await user.update({ role: data.role });
                        results.push({ id: user.id, success: true });
                    } catch (error) {
                        results.push({ id: user.id, success: false, error: error.message });
                    }
                }
                break;

            case 'reset_login_attempts':
                for (const user of users) {
                    try {
                        await user.update({
                            loginAttempts: 0,
                            lockedUntil: null
                        });
                        results.push({ id: user.id, success: true });
                    } catch (error) {
                        results.push({ id: user.id, success: false, error: error.message });
                    }
                }
                break;

            default:
                return res.status(400).json({ error: 'Geçersiz işlem' });
        }

        console.log(`Bulk user operation ${action} performed by ${req.user.username} on ${userIds.length} users`);

        res.json({
            message: `Toplu ${action} işlemi tamamlandı`,
            results
        });
    } catch (error) {
        console.error('Bulk user operation error:', error);
        res.status(500).json({ error: 'Toplu işlem yapılamadı' });
    }
});

// Kullanıcı aktivite geçmişi (Admin) - GET /api/auth/users/:id/activity
router.get('/users/:id/activity', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        // Stream log'larını al
        const streamLogs = await db.StreamLog.findAll({
            where: { userId: id },
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name', 'streamKey'],
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
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        // Viewer session'larını al
        const viewerSessions = await db.ViewerSession.findAll({
            where: { userId: id },
            include: [
                {
                    model: db.Stream,
                    as: 'stream',
                    attributes: ['id', 'name', 'streamKey']
                }
            ],
            order: [['startedAt', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            },
            streamLogs,
            viewerSessions
        });
    } catch (error) {
        console.error('Get user activity error:', error);
        res.status(500).json({ error: 'Kullanıcı aktivitesi alınamadı' });
    }
});

// Oturum geçmişi - GET /api/auth/sessions
router.get('/sessions', authMiddleware, async (req, res) => {
    try {
        // Bu özellik için ayrı bir session tracking sistemi gerekebilir
        // Şimdilik basit bir response dönelim

        const user = await db.User.findByPk(req.user.id, {
            attributes: ['lastLoginAt', 'lastLoginIp']
        });

        const sessions = [
            {
                id: 'current',
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                loginTime: user.lastLoginAt,
                status: 'active',
                isCurrent: true
            }
        ];

        res.json({
            sessions,
            totalSessions: sessions.length
        });
    } catch (error) {
        console.error('Get sessions error:', error);
        res.status(500).json({ error: 'Oturum geçmişi alınamadı' });
    }
});

module.exports = router;