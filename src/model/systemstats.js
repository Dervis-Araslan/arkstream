const os = require('os');

module.exports = (sequelize, DataTypes) => {
    const SystemStats = sequelize.define('SystemStats', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        cpuUsage: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0,
                max: 100
            },
            comment: 'CPU usage percentage'
        },
        memoryUsage: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0,
                max: 100
            },
            comment: 'Memory usage percentage'
        },
        memoryTotal: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total memory in bytes'
        },
        memoryUsed: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Used memory in bytes'
        },
        memoryFree: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Free memory in bytes'
        },
        diskUsage: {
            type: DataTypes.FLOAT,
            allowNull: true,
            validate: {
                min: 0,
                max: 100
            },
            comment: 'Disk usage percentage'
        },
        diskTotal: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Total disk space in bytes'
        },
        diskUsed: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Used disk space in bytes'
        },
        networkRx: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Network bytes received'
        },
        networkTx: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Network bytes transmitted'
        },
        activeStreams: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        totalViewers: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        activeCameras: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        ffmpegProcesses: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: 0
            }
        },
        totalBandwidth: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Total bandwidth usage in Mbps'
        },
        systemLoad: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'System load averages'
        },
        processInfo: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Node.js process information'
        },
        errors: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Recent errors and their counts'
        },
        uptime: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'System uptime in seconds'
        },
        temperature: {
            type: DataTypes.FLOAT,
            allowNull: true,
            comment: 'CPU temperature in Celsius'
        }
    }, {
        tableName: 'system_stats',
        timestamps: true,
        updatedAt: false, // Stats kayıtları güncellenmez, sadece eklenir
        indexes: [
            {
                fields: ['createdAt'],
                name: 'idx_systemstats_created'
            },
            {
                fields: ['cpuUsage'],
                name: 'idx_systemstats_cpu'
            },
            {
                fields: ['memoryUsage'],
                name: 'idx_systemstats_memory'
            },
            {
                fields: ['activeStreams'],
                name: 'idx_systemstats_streams'
            },
            {
                fields: ['totalViewers'],
                name: 'idx_systemstats_viewers'
            }
        ]
    });

    // Class methods
    SystemStats.getCurrentStats = async function () {
        try {
            // CPU bilgisi
            const cpus = os.cpus();
            let cpuUsage = 0;

            // Basit CPU usage hesaplaması
            cpus.forEach(cpu => {
                const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
                const idle = cpu.times.idle;
                cpuUsage += ((total - idle) / total) * 100;
            });
            cpuUsage = cpuUsage / cpus.length;

            // Memory bilgisi
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memoryUsage = (usedMem / totalMem) * 100;

            // Process bilgisi
            const processMemory = process.memoryUsage();

            // System load
            const loadAvg = os.loadavg();

            // Stream ve kamera sayıları
            const activeStreams = await sequelize.models.Stream.count({
                where: { status: 'active' }
            });

            const totalViewers = await sequelize.models.Stream.sum('viewerCount') || 0;

            const activeCameras = await sequelize.models.Camera.count({
                where: {
                    status: 'active',
                    isOnline: true
                }
            });

            // FFmpeg process sayısı (basit tahmin)
            const ffmpegProcesses = activeStreams;

            // Bandwidth hesaplaması
            const streams = await sequelize.models.Stream.findAll({
                where: { status: 'active' },
                attributes: ['bandwidth']
            });

            const totalBandwidth = streams.reduce((sum, stream) => {
                return sum + (parseFloat(stream.bandwidth) || 0);
            }, 0);

            const statsData = {
                cpuUsage: Math.round(cpuUsage * 100) / 100,
                memoryUsage: Math.round(memoryUsage * 100) / 100,
                memoryTotal: totalMem,
                memoryUsed: usedMem,
                memoryFree: freeMem,
                networkRx: 0, // Bu değerler ayrı bir modül ile toplanabilir
                networkTx: 0,
                activeStreams,
                totalViewers,
                activeCameras,
                ffmpegProcesses,
                totalBandwidth: Math.round(totalBandwidth * 100) / 100,
                systemLoad: {
                    load1: loadAvg[0],
                    load5: loadAvg[1],
                    load15: loadAvg[2]
                },
                processInfo: {
                    pid: process.pid,
                    nodeVersion: process.version,
                    platform: process.platform,
                    arch: process.arch,
                    memory: {
                        rss: processMemory.rss,
                        heapTotal: processMemory.heapTotal,
                        heapUsed: processMemory.heapUsed,
                        external: processMemory.external
                    }
                },
                uptime: Math.floor(process.uptime())
            };

            return statsData;
        } catch (error) {
            console.error('Error collecting system stats:', error);
            throw error;
        }
    };

    SystemStats.recordStats = async function () {
        try {
            const stats = await this.getCurrentStats();
            const record = await this.create(stats);
            return record;
        } catch (error) {
            console.error('Error recording system stats:', error);
            return null;
        }
    };

    SystemStats.getLatestStats = function () {
        return this.findOne({
            order: [['createdAt', 'DESC']]
        });
    };

    SystemStats.getStatsHistory = function (hours = 24, interval = 60) {
        const { Op } = sequelize.Sequelize;
        const startTime = new Date();
        startTime.setHours(startTime.getHours() - hours);

        return this.findAll({
            where: {
                createdAt: {
                    [Op.gte]: startTime
                }
            },
            order: [['createdAt', 'ASC']],
            raw: true
        });
    };

    SystemStats.getAverageStats = async function (hours = 24) {
        const { Op } = sequelize.Sequelize;
        const startTime = new Date();
        startTime.setHours(startTime.getHours() - hours);

        const stats = await this.findAll({
            where: {
                createdAt: {
                    [Op.gte]: startTime
                }
            },
            attributes: [
                [sequelize.fn('AVG', sequelize.col('cpuUsage')), 'avgCpuUsage'],
                [sequelize.fn('AVG', sequelize.col('memoryUsage')), 'avgMemoryUsage'],
                [sequelize.fn('MAX', sequelize.col('activeStreams')), 'maxActiveStreams'],
                [sequelize.fn('MAX', sequelize.col('totalViewers')), 'maxTotalViewers'],
                [sequelize.fn('AVG', sequelize.col('totalBandwidth')), 'avgBandwidth']
            ],
            raw: true
        });

        return stats[0] || {};
    };

    SystemStats.cleanupOldStats = async function (daysToKeep = 7) {
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

        console.log(`Cleaned up ${deletedCount} old system stats records`);
        return deletedCount;
    };

    SystemStats.getSystemHealth = async function () {
        const latest = await this.getLatestStats();
        if (!latest) {
            return { status: 'unknown', message: 'No stats available' };
        }

        const issues = [];

        // CPU kontrol
        if (latest.cpuUsage > 80) {
            issues.push(`High CPU usage: ${latest.cpuUsage.toFixed(1)}%`);
        }

        // Memory kontrol
        if (latest.memoryUsage > 85) {
            issues.push(`High memory usage: ${latest.memoryUsage.toFixed(1)}%`);
        }

        // Disk kontrol
        if (latest.diskUsage && latest.diskUsage > 90) {
            issues.push(`High disk usage: ${latest.diskUsage.toFixed(1)}%`);
        }

        // Stream kontrol
        if (latest.activeStreams === 0) {
            issues.push('No active streams');
        }

        let status = 'healthy';
        if (issues.length > 0) {
            status = issues.length > 2 ? 'critical' : 'warning';
        }

        return {
            status,
            message: issues.length > 0 ? issues.join(', ') : 'System is running normally',
            issues,
            stats: {
                cpuUsage: latest.cpuUsage,
                memoryUsage: latest.memoryUsage,
                diskUsage: latest.diskUsage,
                activeStreams: latest.activeStreams,
                totalViewers: latest.totalViewers,
                uptime: latest.uptime
            }
        };
    };

    return SystemStats;
};