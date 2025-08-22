module.exports = (sequelize, DataTypes) => {
    const StreamLog = sequelize.define('StreamLog', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        streamId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'streams',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            onDelete: 'SET NULL'
        },
        action: {
            type: DataTypes.ENUM(
                'start', 'stop', 'error', 'viewer_join', 'viewer_leave',
                'quality_change', 'reconnect', 'ffmpeg_restart', 'config_update'
            ),
            allowNull: false,
            validate: {
                isIn: [[
                    'start', 'stop', 'error', 'viewer_join', 'viewer_leave',
                    'quality_change', 'reconnect', 'ffmpeg_restart', 'config_update'
                ]]
            }
        },
        level: {
            type: DataTypes.ENUM('info', 'warning', 'error', 'debug'),
            allowNull: false,
            defaultValue: 'info',
            validate: {
                isIn: [['info', 'warning', 'error', 'debug']]
            }
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
            validate: {
                notEmpty: true
            }
        },
        details: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Additional log details in JSON format'
        },
        userAgent: {
            type: DataTypes.STRING(500),
            allowNull: true
        },
        ipAddress: {
            type: DataTypes.STRING(45),
            allowNull: true,
            validate: {
                isIP: true
            }
        },
        sessionId: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        duration: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Duration in seconds for actions like viewer sessions'
        },
        errorCode: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        stackTrace: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        systemInfo: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'System information at the time of log'
        }
    }, {
        tableName: 'stream_logs',
        timestamps: true,
        updatedAt: false, // Log kayıtları güncellenmez
        indexes: [
            {
                fields: ['streamId'],
                name: 'idx_streamlog_stream'
            },
            {
                fields: ['userId'],
                name: 'idx_streamlog_user'
            },
            {
                fields: ['action'],
                name: 'idx_streamlog_action'
            },
            {
                fields: ['level'],
                name: 'idx_streamlog_level'
            },
            {
                fields: ['createdAt'],
                name: 'idx_streamlog_created'
            },
            {
                fields: ['ipAddress'],
                name: 'idx_streamlog_ip'
            },
            {
                fields: ['sessionId'],
                name: 'idx_streamlog_session'
            }
        ],
        hooks: {
            beforeCreate: (log, options) => {
                // Sistem bilgilerini otomatik ekle
                if (!log.systemInfo) {
                    log.systemInfo = {
                        timestamp: new Date().toISOString(),
                        nodeVersion: process.version,
                        platform: process.platform,
                        memory: process.memoryUsage()
                    };
                }
            }
        }
    });

    // Instance methods
    StreamLog.prototype.isError = function () {
        return this.level === 'error';
    };

    StreamLog.prototype.isUserAction = function () {
        return ['viewer_join', 'viewer_leave'].includes(this.action);
    };

    StreamLog.prototype.isSystemAction = function () {
        return ['start', 'stop', 'error', 'reconnect', 'ffmpeg_restart'].includes(this.action);
    };

    // Class methods
    StreamLog.logStreamAction = async function (streamId, action, message, options = {}) {
        const logData = {
            streamId,
            action,
            message,
            level: options.level || 'info',
            userId: options.userId || null,
            details: options.details || null,
            userAgent: options.userAgent || null,
            ipAddress: options.ipAddress || null,
            sessionId: options.sessionId || null,
            duration: options.duration || null,
            errorCode: options.errorCode || null,
            stackTrace: options.stackTrace || null,
            systemInfo: options.systemInfo || null
        };

        try {
            const log = await this.create(logData);

            // Console'a da yazdır
            const levelMap = {
                'info': 'log',
                'warning': 'warn',
                'error': 'error',
                'debug': 'debug'
            };

            console[levelMap[logData.level] || 'log'](
                `[Stream ${streamId}] ${action.toUpperCase()}: ${message}`
            );

            return log;
        } catch (error) {
            console.error('StreamLog create error:', error);
            return null;
        }
    };

    StreamLog.logViewerAction = async function (streamId, action, userId = null, options = {}) {
        const message = action === 'viewer_join'
            ? 'Viewer joined stream'
            : 'Viewer left stream';

        return await this.logStreamAction(streamId, action, message, {
            ...options,
            userId,
            level: 'info'
        });
    };

    StreamLog.logError = async function (streamId, message, error, options = {}) {
        return await this.logStreamAction(streamId, 'error', message, {
            ...options,
            level: 'error',
            errorCode: error.code || 'UNKNOWN_ERROR',
            stackTrace: error.stack || null,
            details: {
                errorName: error.name,
                errorMessage: error.message,
                ...options.details
            }
        });
    };

    StreamLog.getStreamLogs = function (streamId, limit = 100, offset = 0) {
        return this.findAll({
            where: {
                streamId
            },
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            include: [
                {
                    model: sequelize.models.User,
                    as: 'user',
                    attributes: ['id', 'username', 'firstName', 'lastName'],
                    required: false
                }
            ]
        });
    };

    StreamLog.getErrorLogs = function (streamId = null, limit = 50) {
        const where = {
            level: 'error'
        };

        if (streamId) {
            where.streamId = streamId;
        }

        return this.findAll({
            where,
            order: [['createdAt', 'DESC']],
            limit,
            include: [
                {
                    model: sequelize.models.Stream,
                    as: 'stream',
                    attributes: ['id', 'name', 'streamKey'],
                    include: [
                        {
                            model: sequelize.models.Camera,
                            as: 'camera',
                            attributes: ['id', 'name', 'brand', 'model']
                        }
                    ]
                }
            ]
        });
    };

    StreamLog.getViewerStats = async function (streamId, startDate, endDate) {
        const { Op } = sequelize.Sequelize;

        const logs = await this.findAll({
            where: {
                streamId,
                action: {
                    [Op.in]: ['viewer_join', 'viewer_leave']
                },
                createdAt: {
                    [Op.between]: [startDate, endDate]
                }
            },
            order: [['createdAt', 'ASC']]
        });

        // Viewer istatistiklerini hesapla
        let currentViewers = 0;
        let maxViewers = 0;
        let totalSessions = 0;
        const sessions = new Map();

        logs.forEach(log => {
            if (log.action === 'viewer_join') {
                currentViewers++;
                totalSessions++;
                maxViewers = Math.max(maxViewers, currentViewers);

                if (log.sessionId) {
                    sessions.set(log.sessionId, { joinTime: log.createdAt });
                }
            } else if (log.action === 'viewer_leave') {
                currentViewers = Math.max(0, currentViewers - 1);

                if (log.sessionId && sessions.has(log.sessionId)) {
                    const session = sessions.get(log.sessionId);
                    session.leaveTime = log.createdAt;
                    session.duration = Math.floor((log.createdAt - session.joinTime) / 1000);
                }
            }
        });

        const completedSessions = Array.from(sessions.values())
            .filter(session => session.leaveTime);

        const avgSessionDuration = completedSessions.length > 0
            ? completedSessions.reduce((sum, session) => sum + session.duration, 0) / completedSessions.length
            : 0;

        return {
            totalSessions,
            maxConcurrentViewers: maxViewers,
            averageSessionDuration: Math.round(avgSessionDuration),
            completedSessions: completedSessions.length
        };
    };

    StreamLog.cleanupOldLogs = async function (daysToKeep = 30) {
        const { Op } = sequelize.Sequelize;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const deletedCount = await this.destroy({
            where: {
                createdAt: {
                    [Op.lt]: cutoffDate
                }
            }
        });

        console.log(`Cleaned up ${deletedCount} old log entries`);
        return deletedCount;
    };

    return StreamLog;
};