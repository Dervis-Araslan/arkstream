const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize, DataTypes) => {
    const ViewerSession = sequelize.define('ViewerSession', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        sessionId: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true
            }
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
        ipAddress: {
            type: DataTypes.STRING(45),
            allowNull: true,
            validate: {
                isIP: true
            }
        },
        userAgent: {
            type: DataTypes.STRING(500),
            allowNull: true
        },
        country: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        city: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        device: {
            type: DataTypes.ENUM('desktop', 'mobile', 'tablet', 'tv', 'unknown'),
            allowNull: false,
            defaultValue: 'unknown'
        },
        browser: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        os: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        quality: {
            type: DataTypes.ENUM('low', 'medium', 'high', 'ultra', 'auto'),
            allowNull: false,
            defaultValue: 'auto'
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        endedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        duration: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Session duration in seconds'
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        bytesTransferred: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total bytes transferred to this viewer'
        },
        averageBitrate: {
            type: DataTypes.FLOAT,
            allowNull: true,
            comment: 'Average bitrate during session in kbps'
        },
        bufferEvents: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of buffering events'
        },
        qualityChanges: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of quality changes during session'
        },
        errors: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Errors encountered during session'
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Additional session metadata'
        },
        referrer: {
            type: DataTypes.STRING(500),
            allowNull: true
        },
        exitReason: {
            type: DataTypes.ENUM('user_left', 'stream_ended', 'network_error', 'client_error', 'server_error', 'timeout'),
            allowNull: true
        }
    }, {
        tableName: 'viewer_sessions',
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['sessionId'],
                name: 'unique_session_id'
            },
            {
                fields: ['streamId'],
                name: 'idx_viewersession_stream'
            },
            {
                fields: ['userId'],
                name: 'idx_viewersession_user'
            },
            {
                fields: ['isActive'],
                name: 'idx_viewersession_active'
            },
            {
                fields: ['startedAt'],
                name: 'idx_viewersession_started'
            },
            {
                fields: ['ipAddress'],
                name: 'idx_viewersession_ip'
            },
            {
                fields: ['device'],
                name: 'idx_viewersession_device'
            },
            {
                fields: ['country'],
                name: 'idx_viewersession_country'
            }
        ],
        hooks: {
            beforeCreate: (session, options) => {
                // Session ID otomatik oluştur
                if (!session.sessionId) {
                    session.sessionId = uuidv4();
                }

                // User Agent'dan cihaz bilgisini çıkar
                if (session.userAgent && !session.device) {
                    session.device = detectDevice(session.userAgent);
                }

                // Browser ve OS bilgisini çıkar
                if (session.userAgent) {
                    const browserInfo = detectBrowser(session.userAgent);
                    session.browser = browserInfo.browser;
                    session.os = browserInfo.os;
                }
            },
            beforeUpdate: (session, options) => {
                // Session sonlandırılıyorsa duration hesapla
                if (session.changed('isActive') && !session.isActive && !session.duration) {
                    if (session.startedAt) {
                        const endTime = session.endedAt || new Date();
                        session.duration = Math.floor((endTime - session.startedAt) / 1000);
                    }
                }
            }
        }
    });

    // Helper functions
    function detectDevice(userAgent) {
        const ua = userAgent.toLowerCase();
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            return 'mobile';
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
            return 'tablet';
        } else if (ua.includes('tv') || ua.includes('smarttv')) {
            return 'tv';
        } else if (ua.includes('desktop') || ua.includes('windows') || ua.includes('macintosh')) {
            return 'desktop';
        }
        return 'unknown';
    }

    function detectBrowser(userAgent) {
        const ua = userAgent.toLowerCase();
        let browser = 'unknown';
        let os = 'unknown';

        // Browser detection
        if (ua.includes('chrome') && !ua.includes('edg')) {
            browser = 'chrome';
        } else if (ua.includes('firefox')) {
            browser = 'firefox';
        } else if (ua.includes('safari') && !ua.includes('chrome')) {
            browser = 'safari';
        } else if (ua.includes('edg')) {
            browser = 'edge';
        } else if (ua.includes('opera')) {
            browser = 'opera';
        }

        // OS detection
        if (ua.includes('windows')) {
            os = 'windows';
        } else if (ua.includes('macintosh') || ua.includes('mac os')) {
            os = 'macos';
        } else if (ua.includes('linux')) {
            os = 'linux';
        } else if (ua.includes('android')) {
            os = 'android';
        } else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) {
            os = 'ios';
        }

        return { browser, os };
    }

    // Instance methods
    ViewerSession.prototype.endSession = async function (reason = 'user_left') {
        this.isActive = false;
        this.endedAt = new Date();
        this.exitReason = reason;

        if (this.startedAt) {
            this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
        }

        await this.save();
        return this;
    };

    ViewerSession.prototype.updateBandwidth = async function (bytesTransferred, bitrate) {
        this.bytesTransferred += bytesTransferred;

        if (bitrate) {
            this.averageBitrate = this.averageBitrate
                ? (this.averageBitrate + bitrate) / 2
                : bitrate;
        }

        await this.save();
    };

    ViewerSession.prototype.recordError = async function (error) {
        const errors = this.errors || [];
        errors.push({
            timestamp: new Date(),
            message: error.message,
            code: error.code,
            stack: error.stack
        });

        this.errors = errors;
        await this.save();
    };

    ViewerSession.prototype.recordBufferEvent = async function () {
        this.bufferEvents += 1;
        await this.save();
    };

    ViewerSession.prototype.recordQualityChange = async function (newQuality) {
        this.quality = newQuality;
        this.qualityChanges += 1;
        await this.save();
    };

    // Class methods
    ViewerSession.createSession = async function (streamId, sessionData = {}) {
        const sessionId = sessionData.sessionId || uuidv4();

        const session = await this.create({
            sessionId,
            streamId,
            userId: sessionData.userId || null,
            ipAddress: sessionData.ipAddress || null,
            userAgent: sessionData.userAgent || null,
            country: sessionData.country || null,
            city: sessionData.city || null,
            quality: sessionData.quality || 'auto',
            referrer: sessionData.referrer || null,
            metadata: sessionData.metadata || null
        });

        return session;
    };

    ViewerSession.getActiveSession = function (sessionId) {
        return this.findOne({
            where: {
                sessionId,
                isActive: true
            },
            include: [
                {
                    model: sequelize.models.Stream,
                    as: 'stream',
                    attributes: ['id', 'name', 'status']
                }
            ]
        });
    };

    ViewerSession.getActiveSessions = function (streamId = null) {
        const where = { isActive: true };
        if (streamId) {
            where.streamId = streamId;
        }

        return this.findAll({
            where,
            include: [
                {
                    model: sequelize.models.Stream,
                    as: 'stream',
                    attributes: ['id', 'name', 'streamKey']
                },
                {
                    model: sequelize.models.User,
                    as: 'user',
                    attributes: ['id', 'username'],
                    required: false
                }
            ]
        });
    };

    ViewerSession.getSessionStats = async function (streamId, startDate, endDate) {
        const { Op } = sequelize.Sequelize;

        const sessions = await this.findAll({
            where: {
                streamId,
                startedAt: {
                    [Op.between]: [startDate, endDate]
                }
            },
            raw: true
        });

        if (sessions.length === 0) {
            return {
                totalSessions: 0,
                averageDuration: 0,
                totalDuration: 0,
                uniqueViewers: 0,
                deviceBreakdown: {},
                countryBreakdown: {},
                qualityBreakdown: {}
            };
        }

        const totalSessions = sessions.length;
        const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
        const averageDuration = totalDuration / totalSessions;

        const uniqueIPs = new Set(sessions.map(s => s.ipAddress).filter(Boolean));
        const uniqueViewers = uniqueIPs.size;

        // Device breakdown
        const deviceBreakdown = sessions.reduce((acc, s) => {
            acc[s.device] = (acc[s.device] || 0) + 1;
            return acc;
        }, {});

        // Country breakdown
        const countryBreakdown = sessions.reduce((acc, s) => {
            if (s.country) {
                acc[s.country] = (acc[s.country] || 0) + 1;
            }
            return acc;
        }, {});

        // Quality breakdown
        const qualityBreakdown = sessions.reduce((acc, s) => {
            acc[s.quality] = (acc[s.quality] || 0) + 1;
            return acc;
        }, {});

        return {
            totalSessions,
            averageDuration: Math.round(averageDuration),
            totalDuration,
            uniqueViewers,
            deviceBreakdown,
            countryBreakdown,
            qualityBreakdown,
            averageBufferEvents: sessions.reduce((sum, s) => sum + s.bufferEvents, 0) / totalSessions,
            averageQualityChanges: sessions.reduce((sum, s) => sum + s.qualityChanges, 0) / totalSessions
        };
    };

    ViewerSession.cleanupOldSessions = async function (daysToKeep = 30) {
        const { Op } = sequelize.Sequelize;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        // Önce aktif olmayan eski session'ları sil
        const deletedCount = await this.destroy({
            where: {
                isActive: false,
                endedAt: {
                    [Op.lt]: cutoffDate
                }
            }
        });

        console.log(`Cleaned up ${deletedCount} old viewer sessions`);
        return deletedCount;
    };

    ViewerSession.endInactiveSessions = async function (timeoutMinutes = 30) {
        const { Op } = sequelize.Sequelize;
        const timeoutDate = new Date();
        timeoutDate.setMinutes(timeoutDate.getMinutes() - timeoutMinutes);

        const timeoutSessions = await this.findAll({
            where: {
                isActive: true,
                updatedAt: {
                    [Op.lt]: timeoutDate
                }
            }
        });

        for (const session of timeoutSessions) {
            await session.endSession('timeout');
        }

        console.log(`Ended ${timeoutSessions.length} inactive sessions due to timeout`);
        return timeoutSessions.length;
    };

    return ViewerSession;
};