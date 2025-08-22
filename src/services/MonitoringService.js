const os = require('os');
const { spawn } = require('child_process');

class MonitoringService {
    constructor(db) {
        this.db = db;
        this.isRunning = false;
        this.intervals = [];
        this.healthChecks = new Map();
        this.alertThresholds = {
            cpu: 80,
            memory: 85,
            disk: 90,
            errorRate: 10,
            streamFailures: 5
        };
        this.lastAlerts = new Map();
    }

    start() {
        if (this.isRunning) {
            console.log('Monitoring service is already running');
            return;
        }

        this.isRunning = true;
        console.log('Starting monitoring service...');

        // Sistem istatistiklerini kaydetme (her 5 dakika)
        this.intervals.push(setInterval(() => {
            this.recordSystemStats();
        }, 5 * 60 * 1000));

        // Kamera durumu kontrolü (her 10 dakika)
        this.intervals.push(setInterval(() => {
            this.checkCameraStatus();
        }, 10 * 60 * 1000));

        // Stream sağlık kontrolü (her 2 dakika)
        this.intervals.push(setInterval(() => {
            this.checkStreamHealth();
        }, 2 * 60 * 1000));

        // Sistem uyarıları kontrolü (her dakika)
        this.intervals.push(setInterval(() => {
            this.checkSystemAlerts();
        }, 60 * 1000));

        // Performance monitoring (her 30 saniye)
        this.intervals.push(setInterval(() => {
            this.monitorPerformance();
        }, 30 * 1000));

        console.log('Monitoring service started successfully');
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        console.log('Monitoring service stopped');
    }

    async recordSystemStats() {
        try {
            await this.db.SystemStats.recordStats();
        } catch (error) {
            console.error('Error recording system stats:', error);
        }
    }

    async checkCameraStatus() {
        try {
            const cameras = await this.db.Camera.findAll({
                where: { status: 'active' }
            });

            for (const camera of cameras) {
                const isOnline = await this.pingCamera(camera);
                await camera.updateConnectionStatus(isOnline, isOnline ? null : 'Ping failed');

                // Health check sonucunu sakla
                this.healthChecks.set(`camera:${camera.id}`, {
                    type: 'camera',
                    id: camera.id,
                    name: camera.name,
                    status: isOnline ? 'healthy' : 'unhealthy',
                    lastCheck: new Date(),
                    message: isOnline ? 'Online' : 'Offline'
                });
            }

            console.log(`Camera status check completed for ${cameras.length} cameras`);
        } catch (error) {
            console.error('Error checking camera status:', error);
        }
    }

    async checkStreamHealth() {
        try {
            const activeStreams = await this.db.Stream.findAll({
                where: { status: 'active' },
                include: [{ model: this.db.Camera, as: 'camera' }]
            });

            for (const stream of activeStreams) {
                const health = await this.checkStreamHealthStatus(stream);

                this.healthChecks.set(`stream:${stream.id}`, {
                    type: 'stream',
                    id: stream.id,
                    name: stream.name,
                    status: health.healthy ? 'healthy' : 'unhealthy',
                    lastCheck: new Date(),
                    message: health.message,
                    details: health.details
                });

                // Sağlıksız stream'leri logla
                if (!health.healthy) {
                    await this.db.StreamLog.logStreamAction(
                        stream.id,
                        'error',
                        `Health check failed: ${health.message}`,
                        { details: health.details }
                    );
                }
            }

            console.log(`Stream health check completed for ${activeStreams.length} streams`);
        } catch (error) {
            console.error('Error checking stream health:', error);
        }
    }

    async checkSystemAlerts() {
        try {
            const stats = await this.db.SystemStats.getLatestStats();
            if (!stats) return;

            const alerts = [];

            // CPU uyarısı
            if (stats.cpuUsage > this.alertThresholds.cpu) {
                alerts.push({
                    type: 'cpu_high',
                    severity: 'warning',
                    message: `High CPU usage: ${stats.cpuUsage.toFixed(1)}%`,
                    value: stats.cpuUsage,
                    threshold: this.alertThresholds.cpu
                });
            }

            // Memory uyarısı
            if (stats.memoryUsage > this.alertThresholds.memory) {
                alerts.push({
                    type: 'memory_high',
                    severity: 'warning',
                    message: `High memory usage: ${stats.memoryUsage.toFixed(1)}%`,
                    value: stats.memoryUsage,
                    threshold: this.alertThresholds.memory
                });
            }

            // Error rate kontrolü
            const errorRate = await this.calculateErrorRate();
            if (errorRate > this.alertThresholds.errorRate) {
                alerts.push({
                    type: 'error_rate_high',
                    severity: 'critical',
                    message: `High error rate: ${errorRate.toFixed(1)} errors/hour`,
                    value: errorRate,
                    threshold: this.alertThresholds.errorRate
                });
            }

            // Stream failure kontrolü
            const failedStreams = await this.getFailedStreamsCount();
            if (failedStreams > this.alertThresholds.streamFailures) {
                alerts.push({
                    type: 'stream_failures',
                    severity: 'critical',
                    message: `Multiple stream failures: ${failedStreams} streams`,
                    value: failedStreams,
                    threshold: this.alertThresholds.streamFailures
                });
            }

            // Disk kullanımı kontrolü
            const diskUsage = await this.getDiskUsage();
            if (diskUsage > this.alertThresholds.disk) {
                alerts.push({
                    type: 'disk_high',
                    severity: 'warning',
                    message: `High disk usage: ${diskUsage.toFixed(1)}%`,
                    value: diskUsage,
                    threshold: this.alertThresholds.disk
                });
            }

            // Uyarıları işle
            for (const alert of alerts) {
                await this.processAlert(alert);
            }

        } catch (error) {
            console.error('Error checking system alerts:', error);
        }
    }

    async monitorPerformance() {
        try {
            // Process memory kullanımı
            const memUsage = process.memoryUsage();

            // Aktif stream sayısı
            const activeStreams = await this.db.Stream.count({ where: { status: 'active' } });

            // Viewer sayısı
            const totalViewers = await this.db.Stream.sum('viewerCount') || 0;

            // Performance metrikleri
            const performance = {
                timestamp: new Date(),
                memory: {
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memUsage.external / 1024 / 1024)
                },
                streams: {
                    active: activeStreams,
                    viewers: totalViewers
                },
                uptime: Math.floor(process.uptime())
            };

            // Performance logları (gerekirse)
            if (performance.memory.heapUsed > 500) { // 500MB üzerinde
                console.warn('High memory usage detected:', performance.memory);
            }

        } catch (error) {
            console.error('Error monitoring performance:', error);
        }
    }

    async pingCamera(camera) {
        return new Promise((resolve) => {
            const timeout = 5000;
            const ping = spawn('ping', ['-c', '1', '-W', '5', camera.ip]);

            const timer = setTimeout(() => {
                ping.kill();
                resolve(false);
            }, timeout);

            ping.on('close', (code) => {
                clearTimeout(timer);
                resolve(code === 0);
            });

            ping.on('error', () => {
                clearTimeout(timer);
                resolve(false);
            });
        });
    }

    async checkStreamHealthStatus(stream) {
        try {
            // HLS dosyasının varlığını kontrol et
            const fs = require('fs');
            const path = require('path');
            const hlsFile = path.join(__dirname, '..', 'public', 'hls', `${stream.streamKey}.m3u8`);

            if (!fs.existsSync(hlsFile)) {
                return {
                    healthy: false,
                    message: 'HLS file not found',
                    details: { hlsFile }
                };
            }

            // Dosya yaşını kontrol et (5 dakikadan eski olmamalı)
            const stats = fs.statSync(hlsFile);
            const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);

            if (ageMinutes > 5) {
                return {
                    healthy: false,
                    message: 'HLS file too old',
                    details: { ageMinutes: Math.round(ageMinutes) }
                };
            }

            // Kamera online kontrolü
            if (!stream.camera.isOnline) {
                return {
                    healthy: false,
                    message: 'Camera offline',
                    details: { cameraId: stream.camera.id }
                };
            }

            // Error count kontrolü
            if (stream.errorCount > 5) {
                return {
                    healthy: false,
                    message: 'Too many errors',
                    details: { errorCount: stream.errorCount }
                };
            }

            return {
                healthy: true,
                message: 'Stream healthy',
                details: { ageMinutes: Math.round(ageMinutes) }
            };

        } catch (error) {
            return {
                healthy: false,
                message: 'Health check failed',
                details: { error: error.message }
            };
        }
    }

    async calculateErrorRate() {
        try {
            const oneHourAgo = new Date();
            oneHourAgo.setHours(oneHourAgo.getHours() - 1);

            const errorCount = await this.db.StreamLog.count({
                where: {
                    level: 'error',
                    createdAt: { [this.db.Sequelize.Op.gte]: oneHourAgo }
                }
            });

            return errorCount;
        } catch (error) {
            console.error('Error calculating error rate:', error);
            return 0;
        }
    }

    async getFailedStreamsCount() {
        try {
            return await this.db.Stream.count({
                where: { status: 'error' }
            });
        } catch (error) {
            console.error('Error getting failed streams count:', error);
            return 0;
        }
    }

    async getDiskUsage() {
        try {
            const fs = require('fs');
            const stats = fs.statSync('.');

            // Basit disk kullanımı hesaplaması
            // Gerçek projede daha detaylı disk kontrolü yapılabilir
            return 50; // Placeholder
        } catch (error) {
            console.error('Error getting disk usage:', error);
            return 0;
        }
    }

    async processAlert(alert) {
        const alertKey = `${alert.type}:${alert.severity}`;
        const now = Date.now();
        const lastAlert = this.lastAlerts.get(alertKey);

        // Aynı uyarıyı 15 dakikada bir gönder
        if (lastAlert && (now - lastAlert) < 15 * 60 * 1000) {
            return;
        }

        this.lastAlerts.set(alertKey, now);

        console.warn(`ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);

        // WebSocket ile admin'lere bildir (eğer WebSocket servisi mevcut ise)
        // Bu kısım WebSocket servisinin referansı alındığında aktif edilebilir

        // Email, Slack vb. bildirim servisleri buraya eklenebilir

        // Database'e alert kaydı
        try {
            await this.db.StreamLog.create({
                streamId: null,
                userId: null,
                action: 'system_alert',
                level: alert.severity === 'critical' ? 'error' : 'warning',
                message: alert.message,
                details: alert
            });
        } catch (error) {
            console.error('Error saving alert to database:', error);
        }
    }

    // Health check sonuçlarını getir
    getHealthStatus() {
        const healthData = {
            overall: 'healthy',
            checks: Array.from(this.healthChecks.values()),
            lastUpdate: new Date()
        };

        // Genel durumu hesapla
        const unhealthyChecks = healthData.checks.filter(check => check.status === 'unhealthy');
        if (unhealthyChecks.length > 0) {
            healthData.overall = 'unhealthy';
            healthData.issues = unhealthyChecks.length;
        }

        return healthData;
    }

    // Threshold'ları güncelle
    updateThresholds(newThresholds) {
        this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
        console.log('Alert thresholds updated:', this.alertThresholds);
    }

    // Manual health check tetikleme
    async runHealthCheck() {
        console.log('Running manual health check...');

        await Promise.all([
            this.checkCameraStatus(),
            this.checkStreamHealth(),
            this.checkSystemAlerts()
        ]);

        return this.getHealthStatus();
    }

    // İstatistikler
    getMonitoringStats() {
        return {
            isRunning: this.isRunning,
            activeIntervals: this.intervals.length,
            healthChecks: this.healthChecks.size,
            thresholds: this.alertThresholds,
            lastAlerts: Object.fromEntries(this.lastAlerts)
        };
    }
}

module.exports = MonitoringService;