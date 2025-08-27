const express = require('express');
const path = require('path');
require('dotenv').config();

// Database connection - Path düzeltmesi
const { sequelize, User, Stream, Camera } = require('./models');
const bcrypt = require('bcryptjs');
const { getStreamService } = require('./services/stream');

// Routes
const adminRoutes = require('./routers/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/static', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/admin', adminRoutes);

// Basic routes
const publicRoutes = require('./routers/public');
app.use('/', publicRoutes);
const SERVER_HOST = process.env.SERVER_HOST + ":" + process.env.PORT || getServerIp() + ":" + + process.env.PORT;

// API routes
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Ark Stream API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const totalUsers = await User.count();
        const activeUsers = await User.count({ where: { is_active: true } });

        res.json({
            success: true,
            data: {
                users: {
                    total: totalUsers,
                    active: activeUsers
                },
                database: 'connected',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'Database not connected',
            error: error.message
        });
    }
});

// Stream Recovery Function
async function recoverStreams() {
    try {
        console.log('🔄 Checking stream states on startup...');

        const streamService = getStreamService();

        // Clean up orphaned HLS files first
        await cleanupOrphanedFiles();

        // Find streams marked as active in database
        const activeStreams = await Stream.findAll({
            where: {
                status: ['streaming', 'starting'],
                is_active: true
            },
            include: [{
                model: Camera,
                as: 'camera',
                where: { is_active: true }
            }]
        });

        console.log(`📊 Found ${activeStreams.length} streams marked as active in database`);

        for (const stream of activeStreams) {
            const isActuallyActive = streamService.isStreamActive(stream.stream_name);

            if (!isActuallyActive) {
                console.log(`⚠️ Stream ${stream.stream_name} marked as streaming but not actually running`);

                // Update database status to stopped first
                await stream.update({
                    status: 'stopped',
                    last_stopped: new Date(),
                    process_id: null,
                    error_message: 'Application restart - stream was not running'
                });

                console.log(`✅ Stream ${stream.stream_name} status updated to 'stopped'`);

                // Auto-restart streams
                try {
                    console.log(`🔄 Auto-restarting stream ${stream.stream_name}`);

                    const streamConfig = {
                        streamName: stream.stream_name,
                        brand: stream.camera.brand,
                        username: stream.username,
                        password: stream.password,
                        ip: stream.ip_address,
                        port: stream.rtsp_port,
                        channel: stream.channel,
                        resolution: stream.resolution,
                        fps: stream.fps,
                        bitrate: stream.bitrate,
                        audioBitrate: stream.audio_bitrate
                    };

                    const result = await streamService.startStream(streamConfig);

                    // Set up callbacks for database updates
                    streamService.setStreamCallbacks(stream.stream_name, {
                        onClose: async (code) => {
                            await stream.update({
                                status: code === 0 ? 'stopped' : 'error',
                                last_stopped: new Date(),
                                error_message: code !== 0 ? `FFmpeg exited with code ${code}` : null,
                                process_id: null
                            });
                        },
                        onError: async (error) => {
                            await stream.update({
                                status: 'error',
                                error_message: error.message,
                                process_id: null
                            });
                        }
                    });

                    await stream.update({
                        status: 'streaming',
                        last_started: new Date(),
                        process_id: result.pid,
                        error_message: null,
                        hls_url: `${SERVER_HOST}/static/${stream.stream_name}.m3u8`
                    });

                    console.log(`✅ Stream ${stream.stream_name} auto-restarted successfully (PID: ${result.pid})`);
                } catch (restartError) {
                    console.error(`❌ Failed to auto-restart stream ${stream.stream_name}:`, restartError.message);

                    await stream.update({
                        status: 'error',
                        error_message: `Auto-restart failed: ${restartError.message}`
                    });
                }
            } else {
                console.log(`✅ Stream ${stream.stream_name} is actually running - keeping status`);
            }
        }

        console.log('✅ Stream recovery completed');

    } catch (error) {
        console.error('❌ Stream recovery failed:', error);
    }
}

// Clean up orphaned HLS files
async function cleanupOrphanedFiles() {
    try {
        const fs = require('fs');
        const glob = require('glob');
        const publicPath = path.join(__dirname, '../public');

        // Find all .m3u8 and .ts files
        const m3u8Files = glob.sync(path.join(publicPath, '*.m3u8'));
        const tsFiles = glob.sync(path.join(publicPath, '*.ts'));

        const allFiles = [...m3u8Files, ...tsFiles];

        if (allFiles.length > 0) {
            console.log(`🧹 Cleaning up ${allFiles.length} orphaned HLS files...`);

            allFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`🗑️ Deleted: ${path.basename(file)}`);
                }
            });
        }

    } catch (error) {
        console.error('❌ Error during HLS cleanup:', error);
    }
}

// Graceful shutdown handler
async function gracefulShutdown() {
    console.log('\n🔄 Shutting down server...');

    try {
        const streamService = getStreamService();
        await streamService.stopAllStreams();
        console.log('✅ All streams stopped');
    } catch (error) {
        console.error('❌ Error stopping streams:', error);
    }

    try {
        await sequelize.close();
        console.log('✅ Database connection closed');
    } catch (error) {
        console.error('❌ Error closing database:', error);
    }

    process.exit(0);
}

// Create first admin user
async function createDefaultAdmin() {
    try {
        const adminExists = await User.findOne({ where: { role: 'admin' } });

        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 12);

            await User.create({
                username: 'admin',
                email: 'admin@arkstream.com',
                password: hashedPassword,
                role: 'admin'
            });

            console.log('✅ Default admin user created:');
            console.log('   Username: admin');
            console.log('   Password: admin123');
            console.log('   Email: admin@arkstream.com');
        }
    } catch (error) {
        console.error('❌ Error creating admin user:', error.message);
    }
}

// 404 handler
app.use('*', (req, res) => {
    res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you are looking for does not exist.</p>
    <a href="/">← Back to Home</a>
  `);
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(error.status || 500).send(`
    <h1>Error</h1>
    <p>${error.message || 'Internal Server Error'}</p>
  `);
});

// Database connection and server start
async function startServer() {
    try {
        console.log('🔄 Connecting to database...');
        await sequelize.authenticate();
        console.log('✅ Database connection successful');

        // Sync database (create tables)
        await sequelize.sync({ force: false });
        console.log('✅ Database tables synchronized');

        // Create default admin
        await createDefaultAdmin();

        app.listen(PORT, () => {
            console.log(`\n🚀 Ark Stream Server running on http://${SERVER_HOST}`);
            console.log(`📊 Admin Panel: http://${SERVER_HOST}/admin`);
            console.log(`🎥 Main Dashboard: http://${SERVER_HOST}`);
            console.log(`📡 API Health: http://${SERVER_HOST}/api/health`);
            console.log(`📈 API Stats: http://${SERVER_HOST}/api/stats\n`);

            // Run stream recovery after 3 seconds (ensure database is ready)
            setTimeout(recoverStreams, 3000);
        });

    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('\n💡 Make sure MySQL is running and database exists:');
        console.log('   CREATE DATABASE ark_stream;');
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startServer();