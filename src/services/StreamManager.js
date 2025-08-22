const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StreamManager {
    constructor(db) {
        this.db = db;
        this.activeStreams = new Map(); // streamId -> process info
        this.wsService = null;
        this.hlsPath = path.join(__dirname, '..', 'public', 'hls');

        // HLS dizinini oluştur
        this.ensureHLSDirectory();

        // Cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldHLSFiles();
        }, 300000); // 5 dakikada bir temizle
    }

    setWebSocketService(wsService) {
        this.wsService = wsService;
    }

    ensureHLSDirectory() {
        if (!fs.existsSync(this.hlsPath)) {
            fs.mkdirSync(this.hlsPath, { recursive: true });
        }
    }

    async startStream(streamId, userId = null) {
        try {
            // Stream'i veritabanından al
            const stream = await this.db.Stream.findByPk(streamId, {
                include: [{ model: this.db.Camera, as: 'camera' }]
            });

            if (!stream) {
                throw new Error('Stream bulunamadı');
            }

            if (!stream.camera) {
                throw new Error('Stream\'e ait kamera bulunamadı');
            }

            // Stream zaten aktif mi?
            if (this.activeStreams.has(streamId)) {
                throw new Error('Stream zaten aktif');
            }

            // Kamera online mı?
            if (!stream.camera.isOnline) {
                // Kamera durumunu test et
                const testResult = await this.testCameraConnection(stream.camera);
                if (!testResult.success) {
                    throw new Error(`Kamera offline: ${testResult.error}`);
                }
            }

            // Stream durumunu başlatılıyor olarak güncelle
            await stream.update({ status: 'starting' });

            // FFmpeg process'ini başlat
            const ffmpegProcess = await this.spawnFFmpegProcess(stream);

            // Process bilgilerini kaydet
            this.activeStreams.set(streamId, {
                process: ffmpegProcess,
                stream: stream,
                startTime: Date.now(),
                retryCount: 0,
                lastError: null
            });

            // Process event'lerini dinle
            this.setupProcessHandlers(streamId, ffmpegProcess, userId);

            // Log kaydı
            await this.db.StreamLog.logStreamAction(
                streamId,
                'start',
                'Stream started successfully',
                { userId }
            );

            console.log(`Stream started: ${stream.name} (ID: ${streamId})`);

            return { success: true, streamId, message: 'Stream başlatıldı' };
        } catch (error) {
            console.error(`Failed to start stream ${streamId}:`, error);

            // Hata durumunda stream'i error state'e al
            try {
                const stream = await this.db.Stream.findByPk(streamId);
                if (stream) {
                    await stream.setError(error.message);
                }

                await this.db.StreamLog.logError(
                    streamId,
                    'Failed to start stream',
                    error,
                    { userId }
                );
            } catch (logError) {
                console.error('Error logging stream start failure:', logError);
            }

            return { success: false, error: error.message };
        }
    }

    async stopStream(streamId, userId = null) {
        try {
            const streamInfo = this.activeStreams.get(streamId);
            if (!streamInfo) {
                // Veritabanından stream'i al ve inactive yap
                const stream = await this.db.Stream.findByPk(streamId);
                if (stream && stream.status !== 'inactive') {
                    await stream.setInactive();
                }
                return { success: true, message: 'Stream zaten durmuş durumda' };
            }

            const stream = streamInfo.stream;

            // Stream durumunu durdurulıyor olarak güncelle
            await stream.update({ status: 'stopping' });

            // FFmpeg process'ini durdur
            if (streamInfo.process && !streamInfo.process.killed) {
                streamInfo.process.kill('SIGTERM');

                // 5 saniye sonra zorla öldür
                setTimeout(() => {
                    if (!streamInfo.process.killed) {
                        streamInfo.process.kill('SIGKILL');
                    }
                }, 5000);
            }

            // Aktif stream listesinden çıkar
            this.activeStreams.delete(streamId);

            // Stream'i inactive yap
            await stream.setInactive();

            // HLS dosyalarını temizle
            this.cleanupStreamHLSFiles(stream.streamKey);

            // Log kaydı
            await this.db.StreamLog.logStreamAction(
                streamId,
                'stop',
                'Stream stopped successfully',
                { userId }
            );

            // WebSocket ile bildir
            if (this.wsService) {
                this.wsService.broadcast('stream:stopped', {
                    streamId,
                    streamKey: stream.streamKey
                });
            }

            console.log(`Stream stopped: ${stream.name} (ID: ${streamId})`);

            return { success: true, streamId, message: 'Stream durduruldu' };
        } catch (error) {
            console.error(`Failed to stop stream ${streamId}:`, error);

            await this.db.StreamLog.logError(
                streamId,
                'Failed to stop stream',
                error,
                { userId }
            );

            return { success: false, error: error.message };
        }
    }

    async restartStream(streamId, userId = null) {
        try {
            // Önce durdur
            const stopResult = await this.stopStream(streamId, userId);
            if (!stopResult.success) {
                throw new Error(`Stop failed: ${stopResult.error}`);
            }

            // Kısa bir bekleme
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Sonra başlat
            const startResult = await this.startStream(streamId, userId);
            if (!startResult.success) {
                throw new Error(`Start failed: ${startResult.error}`);
            }

            await this.db.StreamLog.logStreamAction(
                streamId,
                'reconnect',
                'Stream restarted successfully',
                { userId }
            );

            return { success: true, streamId, message: 'Stream yeniden başlatıldı' };
        } catch (error) {
            console.error(`Failed to restart stream ${streamId}:`, error);

            await this.db.StreamLog.logError(
                streamId,
                'Failed to restart stream',
                error,
                { userId }
            );

            return { success: false, error: error.message };
        }
    }

    async spawnFFmpegProcess(stream) {
        const { camera } = stream;
        const qualitySettings = stream.getQualitySettings();

        // HLS çıktı dosyası
        const hlsOutput = path.join(this.hlsPath, `${stream.streamKey}.m3u8`);

        // FFmpeg argümanları
        const ffmpegArgs = [
            // Input options
            '-rtsp_transport', 'tcp',
            '-fflags', '+genpts',
            '-use_wallclock_as_timestamps', '1',
            '-i', stream.rtspUrl,

            // Video encoding
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-s', qualitySettings.resolution,
            '-r', qualitySettings.fps.toString(),
            '-b:v', qualitySettings.bitrate,
            '-maxrate', qualitySettings.bitrate,
            '-bufsize', `${parseInt(qualitySettings.bitrate) * 2}k`,

            // Audio encoding
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2',

            // HLS options
            '-f', 'hls',
            '-hls_time', process.env.HLS_SEGMENT_DURATION || '2',
            '-hls_list_size', process.env.HLS_PLAYLIST_SIZE || '3',
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_filename', path.join(this.hlsPath, `${stream.streamKey}_%03d.ts`),

            // Output
            hlsOutput
        ];

        // FFmpeg'i başlat
        const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // FFmpeg args'ı stream'e kaydet
        await stream.update({
            ffmpegArgs: ffmpegArgs,
            ffmpegProcessId: ffmpegProcess.pid
        });

        return ffmpegProcess;
    }

    setupProcessHandlers(streamId, ffmpegProcess, userId) {
        const streamInfo = this.activeStreams.get(streamId);
        if (!streamInfo) return;

        const { stream } = streamInfo;
        let outputBuffer = '';
        let errorBuffer = '';

        // STDOUT handler
        ffmpegProcess.stdout.on('data', (data) => {
            outputBuffer += data.toString();
            // Process output for statistics
            this.parseFFmpegOutput(streamId, outputBuffer);
        });

        // STDERR handler (FFmpeg ana output'u stderr'e yazar)
        ffmpegProcess.stderr.on('data', (data) => {
            errorBuffer += data.toString();
            this.parseFFmpegOutput(streamId, errorBuffer);

            // Son 1000 karakter tut
            if (errorBuffer.length > 1000) {
                errorBuffer = errorBuffer.slice(-1000);
            }
        });

        // Process başarıyla başladı
        ffmpegProcess.on('spawn', async () => {
            try {
                await stream.setActive();
                streamInfo.startTime = Date.now();

                if (this.wsService) {
                    this.wsService.broadcast('stream:started', {
                        streamId,
                        streamKey: stream.streamKey,
                        hlsUrl: stream.generateHlsUrl()
                    });
                }
            } catch (error) {
                console.error(`Error setting stream ${streamId} as active:`, error);
            }
        });

        // Process bitti
        ffmpegProcess.on('exit', async (code, signal) => {
            console.log(`FFmpeg process for stream ${streamId} exited with code ${code}, signal ${signal}`);

            try {
                this.activeStreams.delete(streamId);

                if (code === 0 || signal === 'SIGTERM') {
                    // Normal sonlanma
                    await stream.setInactive();
                } else {
                    // Hata ile sonlanma
                    const errorMsg = `FFmpeg exited with code ${code}${signal ? `, signal ${signal}` : ''}`;
                    await stream.setError(errorMsg);

                    // Auto restart dene
                    await this.handleStreamError(streamId, errorMsg, userId);
                }

                if (this.wsService) {
                    this.wsService.broadcast('stream:ended', {
                        streamId,
                        streamKey: stream.streamKey,
                        code,
                        signal
                    });
                }
            } catch (error) {
                console.error(`Error handling stream ${streamId} exit:`, error);
            }
        });

        // Process error
        ffmpegProcess.on('error', async (error) => {
            console.error(`FFmpeg process error for stream ${streamId}:`, error);

            try {
                await stream.setError(error.message);
                await this.db.StreamLog.logError(streamId, 'FFmpeg process error', error, { userId });

                this.activeStreams.delete(streamId);

                // Auto restart dene
                await this.handleStreamError(streamId, error.message, userId);
            } catch (logError) {
                console.error(`Error logging stream ${streamId} error:`, logError);
            }
        });
    }

    parseFFmpegOutput(streamId, output) {
        const streamInfo = this.activeStreams.get(streamId);
        if (!streamInfo) return;

        // FPS parse et
        const fpsMatch = output.match(/fps=\s*(\d+\.?\d*)/);
        if (fpsMatch) {
            const fps = parseFloat(fpsMatch[1]);
            this.updateStreamStats(streamId, { currentFps: fps });
        }

        // Bitrate parse et
        const bitrateMatch = output.match(/bitrate=\s*(\d+\.?\d*)\s*kbits\/s/);
        if (bitrateMatch) {
            const bitrate = parseFloat(bitrateMatch[1]);
            this.updateStreamStats(streamId, { bandwidth: bitrate / 1000 }); // Mbps'e çevir
        }

        // Error mesajları kontrol et
        if (output.includes('Connection failed') ||
            output.includes('Connection refused') ||
            output.includes('Connection timed out')) {
            console.warn(`Connection issue detected for stream ${streamId}`);
        }
    }

    async updateStreamStats(streamId, stats) {
        try {
            const stream = await this.db.Stream.findByPk(streamId);
            if (stream) {
                await stream.update(stats);
            }
        } catch (error) {
            console.error(`Error updating stream ${streamId} stats:`, error);
        }
    }

    async handleStreamError(streamId, errorMessage, userId) {
        const streamInfo = this.activeStreams.get(streamId);
        const maxRetries = 3;
        const retryDelay = 5000; // 5 saniye

        try {
            const stream = await this.db.Stream.findByPk(streamId);
            if (!stream) return;

            // Retry count'u arttır
            if (streamInfo) {
                streamInfo.retryCount = (streamInfo.retryCount || 0) + 1;
                streamInfo.lastError = errorMessage;
            } else {
                // Stream info yoksa veritabanından error count'u al
                stream.errorCount = (stream.errorCount || 0) + 1;
                await stream.save();
            }

            const retryCount = streamInfo ? streamInfo.retryCount : stream.errorCount;

            if (retryCount <= maxRetries) {
                console.log(`Attempting to restart stream ${streamId} (attempt ${retryCount}/${maxRetries})`);

                await this.db.StreamLog.logStreamAction(
                    streamId,
                    'ffmpeg_restart',
                    `Auto restart attempt ${retryCount}/${maxRetries}`,
                    { userId, details: { error: errorMessage } }
                );

                // Delay sonrası restart
                setTimeout(async () => {
                    try {
                        await this.startStream(streamId, userId);
                    } catch (restartError) {
                        console.error(`Auto restart failed for stream ${streamId}:`, restartError);
                    }
                }, retryDelay * retryCount);
            } else {
                console.log(`Max retry attempts reached for stream ${streamId}`);

                await this.db.StreamLog.logStreamAction(
                    streamId,
                    'error',
                    `Max retry attempts (${maxRetries}) reached`,
                    { userId, details: { lastError: errorMessage } }
                );
            }
        } catch (error) {
            console.error(`Error handling stream ${streamId} error:`, error);
        }
    }

    async testCameraConnection(camera) {
        return new Promise((resolve) => {
            const timeout = 10000;
            const rtspUrl = camera.generateRtspUrl(1);

            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                '-rtsp_transport', 'tcp',
                '-timeout', '5000000',
                rtspUrl
            ]);

            let output = '';
            let errorOutput = '';

            ffprobe.stdout.on('data', (data) => {
                output += data.toString();
            });

            ffprobe.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            const timer = setTimeout(() => {
                ffprobe.kill('SIGKILL');
                resolve({
                    success: false,
                    error: 'Connection timeout'
                });
            }, timeout);

            ffprobe.on('close', (code) => {
                clearTimeout(timer);

                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({
                        success: false,
                        error: errorOutput || 'Connection failed'
                    });
                }
            });

            ffprobe.on('error', (error) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    error: error.message
                });
            });
        });
    }

    cleanupStreamHLSFiles(streamKey) {
        try {
            const m3u8File = path.join(this.hlsPath, `${streamKey}.m3u8`);
            const tsPattern = path.join(this.hlsPath, `${streamKey}_*.ts`);

            // .m3u8 dosyasını sil
            if (fs.existsSync(m3u8File)) {
                fs.unlinkSync(m3u8File);
            }

            // .ts dosyalarını sil
            const files = fs.readdirSync(this.hlsPath);
            files.forEach(file => {
                if (file.startsWith(`${streamKey}_`) && file.endsWith('.ts')) {
                    const filePath = path.join(this.hlsPath, file);
                    fs.unlinkSync(filePath);
                }
            });
        } catch (error) {
            console.error(`Error cleaning up HLS files for ${streamKey}:`, error);
        }
    }

    cleanupOldHLSFiles() {
        try {
            const files = fs.readdirSync(this.hlsPath);
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 saat

            files.forEach(file => {
                const filePath = path.join(this.hlsPath, file);
                const stats = fs.statSync(filePath);

                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                }
            });
        } catch (error) {
            console.error('Error during HLS cleanup:', error);
        }
    }

    async stopAllStreams() {
        console.log('Stopping all active streams...');

        const stopPromises = Array.from(this.activeStreams.keys()).map(streamId =>
            this.stopStream(streamId)
        );

        await Promise.all(stopPromises);

        // Cleanup interval'i temizle
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        console.log('All streams stopped');
    }

    getActiveStreamsInfo() {
        const info = [];

        for (const [streamId, streamInfo] of this.activeStreams.entries()) {
            info.push({
                streamId,
                streamName: streamInfo.stream.name,
                streamKey: streamInfo.stream.streamKey,
                pid: streamInfo.process.pid,
                startTime: streamInfo.startTime,
                uptime: Date.now() - streamInfo.startTime,
                retryCount: streamInfo.retryCount || 0,
                lastError: streamInfo.lastError
            });
        }

        return info;
    }

    getStreamStatus(streamId) {
        const streamInfo = this.activeStreams.get(streamId);
        if (!streamInfo) {
            return { active: false, status: 'inactive' };
        }

        return {
            active: true,
            status: 'active',
            pid: streamInfo.process.pid,
            startTime: streamInfo.startTime,
            uptime: Date.now() - streamInfo.startTime,
            retryCount: streamInfo.retryCount || 0
        };
    }
}

module.exports = StreamManager;