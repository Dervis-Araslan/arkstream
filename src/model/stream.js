const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize, DataTypes) => {
    const Stream = sequelize.define('Stream', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        cameraId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'cameras',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true,
                len: [2, 100]
            }
        },
        streamKey: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true,
                len: [10, 50]
            }
        },
        rtspUrl: {
            type: DataTypes.STRING(500),
            allowNull: false,
            validate: {
                notEmpty: true,
                isUrl: {
                    protocols: ['rtsp']
                }
            }
        },
        hlsUrl: {
            type: DataTypes.STRING(500),
            allowNull: true,
            validate: {
                isUrl: {
                    protocols: ['http', 'https']
                }
            }
        },
        channel: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
            validate: {
                min: 1,
                max: 32
            }
        },
        quality: {
            type: DataTypes.ENUM('low', 'medium', 'high', 'ultra'),
            allowNull: false,
            defaultValue: 'medium',
            validate: {
                isIn: [['low', 'medium', 'high', 'ultra']]
            }
        },
        resolution: {
            type: DataTypes.STRING(20),
            allowNull: true,
            validate: {
                is: /^\d+x\d+$/
            }
        },
        bitrate: {
            type: DataTypes.STRING(20),
            allowNull: true,
            validate: {
                is: /^\d+[kK]?$/
            }
        },
        targetFps: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 30,
            validate: {
                min: 1,
                max: 120
            }
        },
        currentFps: {
            type: DataTypes.FLOAT,
            allowNull: true,
            defaultValue: 0,
            validate: {
                min: 0,
                max: 120
            }
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive', 'starting', 'stopping', 'error', 'reconnecting'),
            allowNull: false,
            defaultValue: 'inactive',
            validate: {
                isIn: [['active', 'inactive', 'starting', 'stopping', 'error', 'reconnecting']]
            }
        },
        isPublic: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        viewerCount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        totalViews: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        stoppedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        lastViewedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        errorMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        errorCount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        ffmpegProcessId: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        ffmpegArgs: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'FFmpeg arguments array'
        },
        streamSettings: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Additional stream settings'
        },
        bandwidth: {
            type: DataTypes.FLOAT,
            allowNull: true,
            defaultValue: 0,
            comment: 'Current bandwidth usage in Mbps'
        },
        uptime: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total uptime in seconds'
        }
    }, {
        tableName: 'streams',
        timestamps: true,
        paranoid: true, // Soft delete için
        indexes: [
            {
                fields: ['cameraId'],
                name: 'idx_stream_camera'
            },
            {
                fields: ['status'],
                name: 'idx_stream_status'
            },
            {
                fields: ['streamKey'],
                name: 'idx_stream_key'
            },
            {
                fields: ['isPublic'],
                name: 'idx_stream_public'
            },
            {
                fields: ['quality'],
                name: 'idx_stream_quality'
            },
            {
                fields: ['viewerCount'],
                name: 'idx_stream_viewers'
            }
        ],
        hooks: {
            beforeValidate: (stream, options) => {
                // Stream key otomatik oluştur
                if (!stream.streamKey) {
                    stream.streamKey = uuidv4().replace(/-/g, '').substring(0, 16);
                }

                // Name'i temizle
                if (stream.name) {
                    stream.name = stream.name.trim();
                }
            },
            beforeCreate: (stream, options) => {
                stream.viewerCount = 0;
                stream.totalViews = 0;
                stream.errorCount = 0;
                stream.uptime = 0;
            },
            afterUpdate: (stream, options) => {
                // Status değişikliklerini logla
                if (stream.changed('status')) {
                    console.log(`Stream ${stream.name} status changed to: ${stream.status}`);
                }
            }
        }
    });

    // Instance methods
    Stream.prototype.generateHlsUrl = function (baseUrl = 'http://localhost:8080') {
        return `${baseUrl}/hls/${this.streamKey}.m3u8`;
    };

    Stream.prototype.getQualitySettings = function () {
        const qualityMap = {
            low: { resolution: '640x480', bitrate: '500k', fps: 15 },
            medium: { resolution: '1280x720', bitrate: '1500k', fps: 25 },
            high: { resolution: '1920x1080', bitrate: '3000k', fps: 30 },
            ultra: { resolution: '3840x2160', bitrate: '6000k', fps: 30 }
        };

        return qualityMap[this.quality] || qualityMap.medium;
    };

    Stream.prototype.updateViewerCount = async function (increment = true) {
        if (increment) {
            this.viewerCount += 1;
            this.totalViews += 1;
            this.lastViewedAt = new Date();
        } else {
            this.viewerCount = Math.max(0, this.viewerCount - 1);
        }

        await this.save();
    };

    Stream.prototype.setError = async function (errorMessage) {
        this.status = 'error';
        this.errorMessage = errorMessage;
        this.errorCount += 1;
        this.stoppedAt = new Date();

        await this.save();
    };

    Stream.prototype.setActive = async function () {
        this.status = 'active';
        this.errorMessage = null;
        this.startedAt = new Date();
        this.stoppedAt = null;

        await this.save();
    };

    Stream.prototype.setInactive = async function () {
        this.status = 'inactive';
        this.stoppedAt = new Date();
        this.viewerCount = 0;
        this.ffmpegProcessId = null;

        await this.save();
    };

    Stream.prototype.calculateUptime = function () {
        if (this.startedAt && this.status === 'active') {
            const now = new Date();
            const diffInSeconds = Math.floor((now - this.startedAt) / 1000);
            return this.uptime + diffInSeconds;
        }
        return this.uptime;
    };

    // Class methods
    Stream.getActiveStreams = function () {
        return this.findAll({
            where: {
                status: 'active'
            },
            include: [{
                model: sequelize.models.Camera,
                as: 'camera'
            }]
        });
    };

    Stream.getPublicStreams = function () {
        return this.findAll({
            where: {
                isPublic: true,
                status: 'active'
            },
            include: [{
                model: sequelize.models.Camera,
                as: 'camera'
            }]
        });
    };

    Stream.getStreamByKey = function (streamKey) {
        return this.findOne({
            where: {
                streamKey: streamKey
            },
            include: [{
                model: sequelize.models.Camera,
                as: 'camera'
            }]
        });
    };

    Stream.getTotalViewers = async function () {
        const result = await this.sum('viewerCount', {
            where: {
                status: 'active'
            }
        });
        return result || 0;
    };

    return Stream;
};