const { sequelize } = require('../config/database');
const User = require('./user');
const { Camera } = require('./camera');
const { Stream } = require('./camera');
const { Category } = require('./camera');

// Define associations here when we add more models
// Example:
// User.hasMany(Camera);
// Camera.belongsTo(User);

// Export all models and sequelize instance
module.exports = {
    sequelize,
    Camera,
    User,
    Stream,
    Category
};