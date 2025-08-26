// services/stream.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StreamService {
    constructor() {
        this.activeStreams = {};
        this.publicPath = path.join(__dirname, '../../public');

        // Public klasörünü oluştur
        if (!fs.existsSync(this.publicPath)) {
            fs.mkdirSync(this.publicPath, { recursive: true });
        }
    }

    /**
     * RTSP URL oluşturur
     */
    generateRTSPUrl(brand, username, password, ip, port, channel) {
        brand = brand.toLowerCase();

        if (brand === 'dahua') {
            return `rtsp://${username}:${password}@${ip}:${port}/cam/realmonitor?channel=${channel}&subtype=0`;
        } else if (brand === 'samsung') {
            return `rtsp://${username}:${password}@${ip}:${port}/profile1/media.smp`;
        } else if (brand === 'hikvision') {
            return `rtsp://${username}:${password}@${ip}:${port}/Streaming/Channels/${channel}01/`;
        } else if (brand === 'axis') {
            return `rtsp://${username}:${password}@${ip}:${port}/axis-media/media.amp`;
        } else {
            // Generic RTSP URL
            return `rtsp://${username}:${password}@${ip}:${port}/`;
        }
    }

    /**
     * Stream başlatır
     */
    async startStream(streamConfig) {
        const {
            streamName,
            brand,
            username,
            password,
            ip,
            port,
            channel = 1,
            resolution = '640x480',
            fps = 30,
            bitrate = '800k',
            audioBitrate = '160k'
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

            // FFmpeg argümanları
            const ffmpegArgs = [
                '-rtsp_transport', 'tcp',
                '-fflags', '+genpts',
                '-use_wallclock_as_timestamps', '1',
                '-i', rtspUrl,
                '-pix_fmt', 'yuv420p',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-b:v', bitrate,
                '-r', fps.toString(),
                '-s', resolution,
                '-c:a', 'aac',
                '-b:a', audioBitrate,
                '-ar', '44100',
                '-f', 'hls',
                '-hls_time', '1',
                '-hls_list_size', '5',
                '-hls_flags', 'delete_segments+append_list+omit_endlist',
                hlsPath
            ];

            console.log(`[${brand}] Starting FFmpeg for ${streamName}: ${rtspUrl}`);

            // FFmpeg sürecini başlat
            const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

            // Process event handlers
            ffmpegProcess.stderr.on('data', (data) => {
                const output = data.toString();
                console.error(`[FFmpeg ${streamName}] ${output}`);

                // Stream başlatma başarılı mı kontrol et
                if (output.includes('Opening') || output.includes('Stream mapping')) {
                    if (this.activeStreams[streamName]) {
                        this.activeStreams[streamName].status = 'streaming';
                    } else {
                        console.log(`[StreamService] Warning: Stream ${streamName} not found in activeStreams`);
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
                hlsUrl: `/public/${streamName}.m3u8`,
                rtspUrl: rtspUrl
            };

            return {
                success: true,
                streamName,
                hlsUrl: `/public/${streamName}.m3u8`,
                pid: ffmpegProcess.pid,
                status: 'starting'
            };

        } catch (error) {
            console.error(`Stream start error for ${streamName}:`, error);
            throw error;
        }
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
                streamInfo.process.kill('SIGKILL');
            }

            // HLS dosyalarını temizle
            const hlsPath = path.join(this.publicPath, `${streamName}.m3u8`);
            const segmentPattern = path.join(this.publicPath, `${streamName}*.ts`);

            // M3U8 dosyasını sil
            if (fs.existsSync(hlsPath)) {
                fs.unlinkSync(hlsPath);
            }

            // TS segment dosyalarını sil
            const glob = require('glob');
            const segmentFiles = glob.sync(segmentPattern);
            segmentFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });

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