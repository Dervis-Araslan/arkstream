module.exports = (sequelize, DataTypes) => {
    const Camera = sequelize.define('Camera', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [2, 100]
            }
        },
        brand: {
            type: DataTypes.ENUM('samsung', 'dahua', 'hikvision', 'axis', 'bosch', 'other'),
            allowNull: false,
            validate: {
                isIn: [['samsung', 'dahua', 'hikvision', 'axis', 'bosch', 'other']]
            }
        },
        model: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [1, 100]
            }
        },
        ip: {
            type: DataTypes.STRING(45),
            allowNull: false,
            validate: {
                isIP: true
            }
        },
        port: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 554,
            validate: {
                min: 1,
                max: 65535
            }
        },
        username: {
            type: DataTypes.STRING(50),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [1, 50]
            }
        },
        password: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: true,
                len: [1, 100]
            }
        },
        location: {
            type: DataTypes.STRING(200),
            allowNull: true,
            validate: {
                len: [0, 200]
            }
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        resolution: {
            type: DataTypes.STRING(20),
            allowNull: true,
            defaultValue: '1920x1080',
            validate: {
                is: /^\d+x\d+$/
            }
        },
        fps: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 30,
            validate: {
                min: 1,
                max: 120
            }
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive', 'maintenance', 'offline'),
            allowNull: false,
            defaultValue: 'active',
            validate: {
                isIn: [['active', 'inactive', 'maintenance', 'offline']]
            }
        },
        lastPing: {
            type: DataTypes.DATE,
            allowNull: true
        },
        isOnline: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        connectionAttempts: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        lastError: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Ek kamera bilgileri için JSON field'
        }
    }, {
        tableName: 'cameras',
        timestamps: true,
        paranoid: true, // Soft delete için
        indexes: [
            {
                unique: true,
                fields: ['ip', 'port'],
                name: 'unique_ip_port'
            },
            {
                fields: ['brand'],
                name: 'idx_camera_brand'
            },
            {
                fields: ['status'],
                name: 'idx_camera_status'
            },
            {
                fields: ['isOnline'],
                name: 'idx_camera_online'
            },
            {
                fields: ['location'],
                name: 'idx_camera_location'
            }
        ],
        hooks: {
            beforeValidate: (camera, options) => {
                // IP ve port kombinasyonunu kontrol et
                if (camera.ip && camera.port) {
                    camera.ip = camera.ip.trim();
                }
            },
            beforeCreate: (camera, options) => {
                camera.connectionAttempts = 0;
                camera.isOnline = false;
            }
        }
    });

    // Instance methods
    Camera.prototype.generateRtspUrl = function (channel = 1) {
        let rtspUrl;

        switch (this.brand.toLowerCase()) {
            case 'dahua':
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/cam/realmonitor?channel=${channel}&subtype=0`;
                break;
            case 'samsung':
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/profile1/media.smp`;
                break;
            case 'hikvision':
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/Streaming/Channels/${channel}01`;
                break;
            case 'axis':
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/axis-media/media.amp?camera=${channel}`;
                break;
            case 'bosch':
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/rtsp_tunnel?h26x=4&line=${channel}`;
                break;
            default:
                rtspUrl = `rtsp://${this.username}:${this.password}@${this.ip}:${this.port}/stream${channel}`;
        }

        return rtspUrl;
    };

    Camera.prototype.updateConnectionStatus = async function (isOnline, error = null) {
        this.isOnline = isOnline;
        this.lastPing = new Date();

        if (isOnline) {
            this.connectionAttempts = 0;
            this.lastError = null;
        } else {
            this.connectionAttempts += 1;
            this.lastError = error;
        }

        await this.save();
    };

    // Class methods
    Camera.getOnlineCameras = function () {
        return this.findAll({
            where: {
                isOnline: true,
                status: 'active'
            }
        });
    };

    Camera.getCamerasByBrand = function (brand) {
        return this.findAll({
            where: {
                brand: brand
            }
        });
    };

    return Camera;
};