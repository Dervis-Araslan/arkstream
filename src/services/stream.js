// services/stream.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StreamService {
    constructor() {
        this.activeStreams = {};
        this.publicPath = path.join(__dirname, '../../public/stream');

        // Public klasörünü oluştur
        if (!fs.existsSync(this.publicPath)) {
            fs.mkdirSync(this.publicPath, { recursive: true });
        }

        // Segment cleanup job başlat
        this.startCleanupJob();
    }

    /**
     * RTSP URL oluşturur
     */
    generateRTSPUrl(brand, username, password, ip, port, channel) {
        brand = brand.toLowerCase();

        // URL encoding sorunlarını önlemek için şifreyi decode edin
        const decodedPassword = decodeURIComponent(password);

        if (brand === 'dahua') {
            // Port 8080 genellikle web interface, RTSP için 554 deneyin
            const rtspPort = port === 8080 ? 554 : port;
            return `rtsp://${username}:${decodedPassword}@${ip}:${rtspPort}/cam/realmonitor?channel=${channel}&subtype=0`;
        } else if (brand === 'samsung') {
            return `rtsp://${username}:${decodedPassword}@${ip}:${port}/profile1/media.smp`;
        } else if (brand === 'hikvision') {
            return `rtsp://${username}:${decodedPassword}@${ip}:${port}/Streaming/Channels/${channel}01/`;
        } else if (brand === 'axis') {
            return `rtsp://${username}:${decodedPassword}@${ip}:${port}/axis-media/media.amp`;
        } else {
            return `rtsp://${username}:${decodedPassword}@${ip}:${port}/`;
        }
    }

    /**
     * Stream başlatır - 2 dakika delay ile optimize edilmiş
     */
    async startStream(streamConfig) {
        const {
            streamName,
            brand,
            username,
            password,
            ip,
            port,
            channel = 1
        } = streamConfig;

        // Stream zaten aktif mi kontrol et
        if (this.activeStreams[streamName]) {
            throw new Error('Bu yayın zaten aktif');
        }

        try {
            // RTSP URL oluştur
            const rtspUrl = this.generateRTSPUrl(brand, username, password, ip, port, channel);

            // HLS çıktısı yolu
            const hlsPath = path.join(this.publicPath, `${streamName}.m3u8`);

            // 2 dakika delay için optimize edilmiş FFmpeg argümanları
            const ffmpegArgs = [
                '-loglevel', 'error',

                '-rtsp_transport', 'tcp',
                '-i', rtspUrl,

                // Video encoding - production ready
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-tune', 'zerolatency',
                '-b:v', '800k',
                '-maxrate', '1500k',
                '-bufsize', '3000k',
                '-r', '25',
                '-s', '1280x720',
                '-pix_fmt', 'yuv420p',

                // Audio encoding
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '44100',

                // HLS - 2 dakika delay için
                '-f', 'hls',
                '-hls_time', '2',            // 2 sn segment
                '-hls_list_size', '6',       // sadece 12 sn 
                '-hls_flags', 'delete_segments+append_list+omit_endlist',
                '-hls_segment_filename', path.join(this.publicPath, `${streamName}_%03d.ts`),
                hlsPath
            ];

            console.log(`[${brand}] Starting FFmpeg for ${streamName}: ${rtspUrl}`);

            // FFmpeg sürecini başlat
            const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

            // Network optimization ekle
            this.setupNetworkOptimization(ffmpegProcess, streamName);

            // Process event handlers
            ffmpegProcess.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`[FFmpeg ${streamName}] ${output}`);

                // Stream başlatma başarılı mı kontrol et
                if (output.includes('Opening') || output.includes('Stream mapping')) {
                    if (this.activeStreams[streamName]) {
                        this.activeStreams[streamName].status = 'streaming';
                    }
                }
            });

            ffmpegProcess.on('close', (code) => {
                console.log(`[FFmpeg ${streamName}] exited with code ${code}`);

                if (this.activeStreams[streamName]) {
                    this.activeStreams[streamName].status = code === 0 ? 'stopped' : 'error';
                    this.activeStreams[streamName].exitCode = code;

                    // Callback varsa çağır
                    if (this.activeStreams[streamName].onClose) {
                        this.activeStreams[streamName].onClose(code);
                    }
                }

                // Stream durduğunda segment'leri temizle
                this.cleanupSegments(streamName);
            });

            ffmpegProcess.on('error', (error) => {
                console.error(`[FFmpeg ${streamName}] Process error:`, error);

                if (this.activeStreams[streamName]) {
                    this.activeStreams[streamName].status = 'error';
                    this.activeStreams[streamName].error = error.message;

                    // Callback varsa çağır
                    if (this.activeStreams[streamName].onError) {
                        this.activeStreams[streamName].onError(error);
                    }
                }
            });

            // Stream bilgilerini sakla
            this.activeStreams[streamName] = {
                process: ffmpegProcess,
                pid: ffmpegProcess.pid,
                status: 'starting',
                startedAt: new Date(),
                config: streamConfig,
                hlsUrl: `/static/stream/${streamName}.m3u8`,
                rtspUrl: rtspUrl
            };

            return {
                success: true,
                streamName,
                hlsUrl: `/static/stream/${streamName}.m3u8`,
                pid: ffmpegProcess.pid,
                status: 'starting'
            };

        } catch (error) {
            console.error(`Stream start error for ${streamName}:`, error);
            throw error;
        }
    }

    /**
     * Segment cleanup işlemi
     */
    cleanupSegments(streamName) {
        const segmentPattern = path.join(this.publicPath, `${streamName}_*.ts`);
        const glob = require('glob');

        try {
            const segmentFiles = glob.sync(segmentPattern);

            // En eski segment'leri sil (sadece son 25'ini koru)
            if (segmentFiles.length > 25) {
                const filesToDelete = segmentFiles
                    .sort((a, b) => {
                        const aNum = parseInt(a.match(/_(\d+)\.ts$/)?.[1] || '0');
                        const bNum = parseInt(b.match(/_(\d+)\.ts$/)?.[1] || '0');
                        return aNum - bNum;
                    })
                    .slice(0, -25); // Son 25'i koru

                filesToDelete.forEach(file => {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        console.log(`Cleaned up: ${path.basename(file)}`);
                    }
                });
            }
        } catch (error) {
            console.error(`Cleanup error for ${streamName}:`, error);
        }
    }

    /**
     * Periyodik segment temizliği başlat
     */
    startCleanupJob() {
        // Her 30 saniyede bir segment temizliği yap
        setInterval(() => {
            Object.keys(this.activeStreams).forEach(streamName => {
                if (this.activeStreams[streamName].status === 'streaming') {
                    this.cleanupSegments(streamName);
                }
            });
        }, 30000);
    }

    /**
     * Stream durdurur
     */
    async stopStream(streamName) {
        if (!streamName || !this.activeStreams[streamName]) {
            throw new Error('Yayın bulunamadı veya aktif değil');
        }

        try {
            const streamInfo = this.activeStreams[streamName];

            // FFmpeg sürecini durdur
            if (streamInfo.process && !streamInfo.process.killed) {
                streamInfo.process.kill('SIGTERM'); // SIGKILL yerine SIGTERM kullan

                // 5 saniye sonra hala çalışıyorsa force kill
                setTimeout(() => {
                    if (streamInfo.process && !streamInfo.process.killed) {
                        streamInfo.process.kill('SIGKILL');
                    }
                }, 5000);
            }

            // HLS dosyalarını temizle
            const hlsPath = path.join(this.publicPath, `${streamName}.m3u8`);

            // M3U8 dosyasını sil
            if (fs.existsSync(hlsPath)) {
                fs.unlinkSync(hlsPath);
            }

            // Segment'leri temizle
            this.cleanupSegments(streamName);

            // Aktif stream listesinden kaldır
            delete this.activeStreams[streamName];

            console.log(`[StreamService] Stream ${streamName} stopped and cleaned up`);

            return {
                success: true,
                message: 'Yayın durduruldu ve dosyalar temizlendi'
            };

        } catch (error) {
            console.error(`Stream stop error for ${streamName}:`, error);
            throw error;
        }
    }

    /**
     * Network optimization
     */
    setupNetworkOptimization(ffmpegProcess, streamName) {
        // TCP buffer boyutlarını ayarla
        ffmpegProcess.stdout?.setEncoding('utf8');
        ffmpegProcess.stderr?.setEncoding('utf8');

        // Process önceliğini ayarla (Linux/macOS için)
        try {
            if (process.setpriority) {
                process.setpriority(ffmpegProcess.pid, -5);
            }
        } catch (e) {
            console.warn(`Priority setting failed for ${streamName}`);
        }
    }

    /**
     * Stream durumunu kontrol eder
     */
    getStreamStatus(streamName) {
        if (!streamName || !this.activeStreams[streamName]) {
            return null;
        }

        const streamInfo = this.activeStreams[streamName];
        return {
            streamName,
            status: streamInfo.status,
            pid: streamInfo.pid,
            startedAt: streamInfo.startedAt,
            hlsUrl: streamInfo.hlsUrl,
            uptime: new Date() - streamInfo.startedAt
        };
    }

    /**
     * Tüm aktif stream'leri listeler
     */
    getActiveStreams() {
        const streams = {};

        for (const [streamName, streamInfo] of Object.entries(this.activeStreams)) {
            streams[streamName] = {
                streamName,
                status: streamInfo.status,
                pid: streamInfo.pid,
                startedAt: streamInfo.startedAt,
                hlsUrl: streamInfo.hlsUrl,
                uptime: new Date() - streamInfo.startedAt
            };
        }

        return streams;
    }

    /**
     * Stream'in aktif olup olmadığını kontrol eder
     */
    isStreamActive(streamName) {
        return !!this.activeStreams[streamName];
    }

    /**
     * Tüm stream'leri durdurur (graceful shutdown için)
     */
    async stopAllStreams() {
        const streamNames = Object.keys(this.activeStreams);
        const stopPromises = streamNames.map(streamName => {
            return this.stopStream(streamName).catch(error => {
                console.error(`Error stopping stream ${streamName}:`, error);
            });
        });

        await Promise.all(stopPromises);
        console.log('[StreamService] All streams stopped');
    }

    /**
     * Stream için callback ayarlar (database güncellemeleri için)
     */
    setStreamCallbacks(streamName, callbacks) {
        if (this.activeStreams[streamName]) {
            this.activeStreams[streamName].onClose = callbacks.onClose;
            this.activeStreams[streamName].onError = callbacks.onError;
        }
    }
}

// Singleton pattern
let streamServiceInstance = null;

module.exports = {
    getStreamService: () => {
        if (!streamServiceInstance) {
            streamServiceInstance = new StreamService();
        }
        return streamServiceInstance;
    },
    StreamService
};