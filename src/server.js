require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

// Database
const db = require('./models');

// Routes
const cameraRoutes = require('./routes/cameras');
const streamRoutes = require('./routes/streams');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');

// Middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');

// Services
const StreamManager = require('./services/StreamManager');
const WebSocketService = require('./services/WebSocketService');
const MonitoringService = require('./services/MonitoringService');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware setup
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api', rateLimiter);

// Static files
app.use('/hls', express.static(path.join(__dirname, 'public/hls')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Global services
let streamManager;
let wsService;
let monitoringService;

// API Routes
app.use('/api/auth', userRoutes);
app.use('/api/cameras', authMiddleware, cameraRoutes);
app.use('/api/streams', authMiddleware, streamRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);

// Legacy RTSP endpoints (compatibility)
app.get('/start-stream', async (req, res) => {
    try {
        const { username, password, ip, rtspPort, brand, streamName, channel } = req.query;

        if (!username || !password || !ip || !rtspPort || !brand || !streamName) {
            return res.status(400).json({ error: "Missing parameters." });
        }

        // Kamera var mı kontrol et
        let camera = await db.Camera.findOne({
            where: { ip, port: rtspPort }
        });

        // Yoksa oluştur
        if (!camera) {
            camera = await db.Camera.create({
                name: `${brand.toUpperCase()} Camera`,
                brand: brand.toLowerCase(),
                model: 'Unknown',
                ip,
                port: parseInt(rtspPort),
                username,
                password,
                location: 'Auto-created',
                status: 'active'
            });
        }

        // Stream oluştur
        const stream = await db.Stream.create({
            cameraId: camera.id,
            name: streamName,
            channel: parseInt(channel) || 1,
            quality: 'medium',
            rtspUrl: camera.generateRtspUrl(parseInt(channel) || 1),
            isPublic: true
        });

        // Stream'i başlat
        const result = await streamManager.startStream(stream.id);

        if (result.success) {
            res.json({
                url: stream.generateHlsUrl(`http://localhost:${PORT}`),
                streamId: stream.id,
                streamKey: stream.streamKey
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Legacy start-stream error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/stop-stream', async (req, res) => {
    try {
        const { streamName } = req.query;

        if (!streamName) {
            return res.status(400).json({ error: "Stream name required." });
        }

        const stream = await db.Stream.findOne({
            where: { name: streamName }
        });

        if (!stream) {
            return res.status(404).json({ error: "Stream not found." });
        }

        const result = await streamManager.stopStream(stream.id);

        if (result.success) {
            res.json({ message: "Stream stopped." });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Legacy stop-stream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Database bağlantısını kontrol et
        await db.sequelize.authenticate();

        // Sistem durumunu kontrol et
        const systemHealth = await db.SystemStats.getSystemHealth();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: 'connected',
            system: systemHealth,
            uptime: process.uptime(),
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    console.log(`Received ${signal}, starting graceful shutdown...`);

    try {
        // Aktif stream'leri durdur
        if (streamManager) {
            await streamManager.stopAllStreams();
        }

        // WebSocket bağlantılarını kapat
        if (wsService) {
            wsService.close();
        }

        // Monitoring'i durdur
        if (monitoringService) {
            monitoringService.stop();
        }

        // Database bağlantısını kapat
        await db.sequelize.close();

        console.log('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
}

// Server başlatma
async function startServer() {
    try {
        // Database bağlantısını test et
        await db.sequelize.authenticate();
        console.log('Database connection established successfully.');

        // Tabloları oluştur/güncelle
        if (process.env.NODE_ENV === 'development') {
            await db.sequelize.sync({ alter: true });
            console.log('Database tables synchronized.');
        }

        // Servisleri başlat
        streamManager = new StreamManager(db);
        wsService = new WebSocketService();
        monitoringService = new MonitoringService(db);

        // Express serveri başlat
        const server = app.listen(PORT, () => {
            console.log(`🚀 Ark Stream Server running on port ${PORT}`);
            console.log(`📺 HLS streams: http://localhost:${PORT}/hls/`);
            console.log(`💻 Dashboard: http://localhost:${PORT}`);
            console.log(`🔧 Health check: http://localhost:${PORT}/health`);
        });

        // WebSocket'i server'a bağla
        wsService.attach(server);

        // Stream Manager'ı WebSocket'e bağla
        streamManager.setWebSocketService(wsService);

        // Monitoring'i başlat
        monitoringService.start();

        // Cron job'ları ayarla
        setupCronJobs();

        console.log('🎯 All services started successfully!');

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Cron job'lar
function setupCronJobs() {
    // Her 5 dakikada bir sistem istatistiklerini kaydet
    cron.schedule('*/5 * * * *', async () => {
        try {
            await db.SystemStats.recordStats();
        } catch (error) {
            console.error('Error recording system stats:', error);
        }
    });

    // Her gün gece yarısı eski kayıtları temizle
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('Starting daily cleanup...');

            // Eski log'ları temizle
            await db.StreamLog.cleanupOldLogs(30);

            // Eski sistem istatistiklerini temizle
            await db.SystemStats.cleanupOldStats(7);

            // Eski viewer session'ları temizle
            await db.ViewerSession.cleanupOldSessions(30);

            console.log('Daily cleanup completed');
        } catch (error) {
            console.error('Error during daily cleanup:', error);
        }
    });

    // Her 30 dakikada bir inactive session'ları temizle
    cron.schedule('*/30 * * * *', async () => {
        try {
            await db.ViewerSession.endInactiveSessions(30);
        } catch (error) {
            console.error('Error ending inactive sessions:', error);
        }
    });

    // Her 10 dakikada bir kamera durumlarını kontrol et
    cron.schedule('*/10 * * * *', async () => {
        try {
            if (monitoringService) {
                await monitoringService.checkCameraStatus();
            }
        } catch (error) {
            console.error('Error checking camera status:', error);
        }
    });

    console.log('⏰ Cron jobs scheduled successfully');
}

// Server'ı başlat
startServer();