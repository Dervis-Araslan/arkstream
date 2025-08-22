const { Sequelize } = require('sequelize');
const config = require('../config/database')[process.env.NODE_ENV || 'development'];

// Sequelize instance oluştur
const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: config.logging,
    timezone: config.timezone,
    pool: config.pool,
    define: config.define
});

const db = {};

// Sequelize ve sequelize instance'ını db objesine ekle
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Model dosyalarını import et
db.Camera = require('./camera')(sequelize, Sequelize);
db.Stream = require('./stream')(sequelize, Sequelize);
db.User = require('./user')(sequelize, Sequelize);
db.StreamLog = require('./streamlog')(sequelize, Sequelize);
db.SystemStats = require('./systemstats')(sequelize, Sequelize);
db.ViewerSession = require('./viewersession')(sequelize, Sequelize);

// Model ilişkilerini tanımla
// Camera <-> Stream ilişkisi (1:N)
db.Camera.hasMany(db.Stream, {
    foreignKey: 'cameraId',
    as: 'streams',
    onDelete: 'CASCADE'
});
db.Stream.belongsTo(db.Camera, {
    foreignKey: 'cameraId',
    as: 'camera'
});

// Stream <-> StreamLog ilişkisi (1:N)
db.Stream.hasMany(db.StreamLog, {
    foreignKey: 'streamId',
    as: 'logs',
    onDelete: 'CASCADE'
});
db.StreamLog.belongsTo(db.Stream, {
    foreignKey: 'streamId',
    as: 'stream'
});

// User <-> StreamLog ilişkisi (1:N) - İsteğe bağlı
db.User.hasMany(db.StreamLog, {
    foreignKey: 'userId',
    as: 'viewLogs',
    onDelete: 'SET NULL'
});
db.StreamLog.belongsTo(db.User, {
    foreignKey: 'userId',
    as: 'user'
});

// Stream <-> ViewerSession ilişkisi (1:N)
db.Stream.hasMany(db.ViewerSession, {
    foreignKey: 'streamId',
    as: 'viewerSessions',
    onDelete: 'CASCADE'
});
db.ViewerSession.belongsTo(db.Stream, {
    foreignKey: 'streamId',
    as: 'stream'
});

// User <-> ViewerSession ilişkisi (1:N) - İsteğe bağlı
db.User.hasMany(db.ViewerSession, {
    foreignKey: 'userId',
    as: 'viewerSessions',
    onDelete: 'SET NULL'
});
db.ViewerSession.belongsTo(db.User, {
    foreignKey: 'userId',
    as: 'user'
});

module.exports = db;