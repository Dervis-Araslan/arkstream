const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        username: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true,
                len: [3, 50],
                isAlphanumeric: true
            }
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                isEmail: true,
                notEmpty: true
            }
        },
        password: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [6, 100]
            }
        },
        firstName: {
            type: DataTypes.STRING(50),
            allowNull: true,
            validate: {
                len: [0, 50]
            }
        },
        lastName: {
            type: DataTypes.STRING(50),
            allowNull: true,
            validate: {
                len: [0, 50]
            }
        },
        role: {
            type: DataTypes.ENUM('admin', 'operator', 'viewer'),
            allowNull: false,
            defaultValue: 'viewer',
            validate: {
                isIn: [['admin', 'operator', 'viewer']]
            }
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive', 'suspended'),
            allowNull: false,
            defaultValue: 'active',
            validate: {
                isIn: [['active', 'inactive', 'suspended']]
            }
        },
        lastLoginAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        lastLoginIp: {
            type: DataTypes.STRING(45),
            allowNull: true,
            validate: {
                isIP: true
            }
        },
        loginAttempts: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        lockedUntil: {
            type: DataTypes.DATE,
            allowNull: true
        },
        emailVerified: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        emailVerificationToken: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        passwordResetToken: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        passwordResetExpires: {
            type: DataTypes.DATE,
            allowNull: true
        },
        preferences: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: {},
            comment: 'User preferences and settings'
        },
        permissions: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: [],
            comment: 'Additional permissions array'
        },
        avatar: {
            type: DataTypes.STRING(200),
            allowNull: true,
            validate: {
                isUrl: true
            }
        },
        timezone: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: 'Europe/Istanbul'
        },
        language: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'tr',
            validate: {
                isIn: [['tr', 'en', 'de', 'fr']]
            }
        }
    }, {
        tableName: 'users',
        timestamps: true,
        paranoid: true, // Soft delete için
        indexes: [
            {
                unique: true,
                fields: ['username'],
                name: 'unique_username'
            },
            {
                unique: true,
                fields: ['email'],
                name: 'unique_email'
            },
            {
                fields: ['role'],
                name: 'idx_user_role'
            },
            {
                fields: ['status'],
                name: 'idx_user_status'
            },
            {
                fields: ['emailVerified'],
                name: 'idx_user_verified'
            },
            {
                fields: ['lastLoginAt'],
                name: 'idx_user_last_login'
            }
        ],
        hooks: {
            beforeValidate: (user, options) => {
                // Email'i küçük harfe çevir
                if (user.email) {
                    user.email = user.email.toLowerCase().trim();
                }

                // Username'i küçük harfe çevir
                if (user.username) {
                    user.username = user.username.toLowerCase().trim();
                }
            },
            beforeCreate: async (user, options) => {
                // Şifreyi hash'le
                if (user.password) {
                    const salt = await bcrypt.genSalt(12);
                    user.password = await bcrypt.hash(user.password, salt);
                }

                // Default preferences
                user.preferences = {
                    theme: 'dark',
                    autoRefresh: true,
                    refreshInterval: 5000,
                    gridColumns: 3,
                    showCameraInfo: true,
                    enableNotifications: true
                };
            },
            beforeUpdate: async (user, options) => {
                // Şifre değiştiyse hash'le
                if (user.changed('password')) {
                    const salt = await bcrypt.genSalt(12);
                    user.password = await bcrypt.hash(user.password, salt);
                }
            }
        }
    });

    // Instance methods
    User.prototype.validatePassword = async function (password) {
        return await bcrypt.compare(password, this.password);
    };

    User.prototype.isLocked = function () {
        return !!(this.lockedUntil && this.lockedUntil > Date.now());
    };

    User.prototype.incrementLoginAttempts = async function () {
        // Eğer önceki kilit süresi geçmişse reset et
        if (this.lockedUntil && this.lockedUntil < Date.now()) {
            await this.update({
                loginAttempts: 1,
                lockedUntil: null
            });
            return;
        }

        const updates = { loginAttempts: this.loginAttempts + 1 };

        // 5 başarısız denemeden sonra hesabı kilitle
        if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
            updates.lockedUntil = Date.now() + 30 * 60 * 1000; // 30 dakika kilit
        }

        await this.update(updates);
    };

    User.prototype.resetLoginAttempts = async function () {
        await this.update({
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: this.lastLoginIp
        });
    };

    User.prototype.getFullName = function () {
        if (this.firstName && this.lastName) {
            return `${this.firstName} ${this.lastName}`;
        }
        return this.username;
    };

    User.prototype.hasPermission = function (permission) {
        // Admin her şeyi yapabilir
        if (this.role === 'admin') {
            return true;
        }

        // Role bazlı yetkiler
        const rolePermissions = {
            operator: [
                'camera.view',
                'camera.create',
                'camera.update',
                'stream.view',
                'stream.create',
                'stream.update',
                'stream.start',
                'stream.stop',
                'dashboard.view'
            ],
            viewer: [
                'stream.view',
                'dashboard.view'
            ]
        };

        const defaultPermissions = rolePermissions[this.role] || [];
        const userPermissions = this.permissions || [];

        return defaultPermissions.includes(permission) || userPermissions.includes(permission);
    };

    User.prototype.canAccessStream = function (stream) {
        // Public stream'lere herkes erişebilir
        if (stream.isPublic) {
            return true;
        }

        // Admin ve operator private stream'lere erişebilir
        if (this.role === 'admin' || this.role === 'operator') {
            return true;
        }

        return false;
    };

    // Class methods
    User.authenticate = async function (usernameOrEmail, password) {
        const user = await this.findOne({
            where: {
                [sequelize.Sequelize.Op.or]: [
                    { username: usernameOrEmail.toLowerCase() },
                    { email: usernameOrEmail.toLowerCase() }
                ],
                status: 'active'
            }
        });

        if (!user) {
            throw new Error('Kullanıcı bulunamadı');
        }

        if (user.isLocked()) {
            throw new Error('Hesap kilitli. Lütfen daha sonra tekrar deneyin.');
        }

        const isValidPassword = await user.validatePassword(password);

        if (!isValidPassword) {
            await user.incrementLoginAttempts();
            throw new Error('Geçersiz şifre');
        }

        await user.resetLoginAttempts();
        return user;
    };

    User.createUser = async function (userData) {
        const user = await this.create(userData);

        // Şifreyi response'dan çıkar
        const userResponse = user.toJSON();
        delete userResponse.password;
        delete userResponse.passwordResetToken;
        delete userResponse.emailVerificationToken;

        return userResponse;
    };

    User.getActiveUsers = function () {
        return this.findAll({
            where: {
                status: 'active'
            },
            attributes: {
                exclude: ['password', 'passwordResetToken', 'emailVerificationToken']
            }
        });
    };

    User.getUsersByRole = function (role) {
        return this.findAll({
            where: {
                role: role,
                status: 'active'
            },
            attributes: {
                exclude: ['password', 'passwordResetToken', 'emailVerificationToken']
            }
        });
    };

    return User;
};