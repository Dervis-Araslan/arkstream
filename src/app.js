const express = require('express');
const path = require('path');
require('dotenv').config();

// Database connection
const { sequelize, User } = require('./models');
const bcrypt = require('bcryptjs');

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
app.get('/', (req, res) => {
    res.send(`
    <h1>🚀 Ark Stream - IP Camera System</h1>
    <p>Server is running successfully!</p>
    <ul>
      <li><a href="/admin">Admin Panel</a></li>
      <li><a href="/api/health">API Health Check</a></li>
      <li><a href="/api/stats">System Stats</a></li>
    </ul>
  `);
});

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
            console.log(`\n🚀 Ark Stream Server running on http://localhost:${PORT}`);
            console.log(`📊 Admin Panel: http://localhost:${PORT}/admin`);
            console.log(`🎥 Main Dashboard: http://localhost:${PORT}`);
            console.log(`📡 API Health: http://localhost:${PORT}/api/health`);
            console.log(`📈 API Stats: http://localhost:${PORT}/api/stats\n`);
        });

    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('\n💡 Make sure MySQL is running and database exists:');
        console.log('   CREATE DATABASE ark_stream;');
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down server...');
    await sequelize.close();
    console.log('✅ Database connection closed');
    process.exit(0);
});

startServer();