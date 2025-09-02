// Camera Model - Basit kamera bilgileri
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Camera = sequelize.define('Camera', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            len: [2, 100],
            notEmpty: true
        }
    },
    brand: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            len: [2, 50],
            notEmpty: true
        }
    },
    model: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            len: [2, 50],
            notEmpty: true
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'cameras',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

// Category Model - Kategori bilgileri
const Category = sequelize.define('Category', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            len: [2, 100],
            notEmpty: true
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    color: {
        type: DataTypes.STRING(7), // #FFFFFF formatı için
        allowNull: true,
        defaultValue: '#007bff',
        validate: {
            is: /^#[0-9A-F]{6}$/i
        }
    },
    icon: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: 'camera'
    },
    sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['sort_order']
        },
        {
            fields: ['is_active']
        }
    ]
});

// Stream Model - Yayın bilgileri (kategori kaldırıldı)
const Stream = sequelize.define('Stream', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stream_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            len: [2, 100],
            notEmpty: true,
            // Sadece alfanumerik ve - _ karakterlerine izin ver
            is: /^[a-zA-Z0-9_-]+$/
        }
    },
    camera_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Camera,
            key: 'id'
        }
    },
    ip_address: {
        type: DataTypes.STRING(15),
        allowNull: false,
        validate: {
            isIP: true,
            notEmpty: true
        }
    },
    rtsp_port: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 554,
        validate: {
            min: 1,
            max: 65535
        }
    },
    username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    password: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    channel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
            min: 1,
            max: 16
        }
    },
    // Yayın ayarları
    resolution: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: '640x480'
    },
    fps: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 30,
        validate: {
            min: 1,
            max: 60
        }
    },
    bitrate: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: '800k'
    },
    audio_bitrate: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: '160k'
    },
    // Durum bilgileri
    status: {
        type: DataTypes.ENUM('stopped', 'starting', 'streaming', 'error'),
        defaultValue: 'stopped'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    is_recording: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    last_started: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_stopped: {
        type: DataTypes.DATE,
        allowNull: true
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // FFmpeg process ID (gerekirse)
    process_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // HLS URL
    hls_url: {
        type: DataTypes.STRING(255),
        allowNull: true
    }
}, {
    tableName: 'streams',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['camera_id']
        },
        {
            fields: ['stream_name']
        },
        {
            fields: ['status']
        }
    ]
});

// Stream-Category Many-to-Many ilişkisi için ara tablo
const StreamCategory = sequelize.define('StreamCategory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    stream_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Stream,
            key: 'id'
        }
    },
    category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Category,
            key: 'id'
        }
    }
}, {
    tableName: 'stream_categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['stream_id']
        },
        {
            fields: ['category_id']
        },
        {
            // Unique constraint - bir stream bir kategoriye sadece bir kez eklenebilir
            unique: true,
            fields: ['stream_id', 'category_id']
        }
    ]
});

// İlişkiler
Camera.hasMany(Stream, {
    foreignKey: 'camera_id',
    as: 'streams'
});

Stream.belongsTo(Camera, {
    foreignKey: 'camera_id',
    as: 'camera'
});

// Many-to-Many ilişkiler
Stream.belongsToMany(Category, {
    through: StreamCategory,
    foreignKey: 'stream_id',
    otherKey: 'category_id',
    as: 'categories'
});

Category.belongsToMany(Stream, {
    through: StreamCategory,
    foreignKey: 'category_id',
    otherKey: 'stream_id',
    as: 'streams'
});

// Instance methods
Camera.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    return values;
};

Category.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    return values;
};

Stream.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    // Güvenlik için şifreyi gizle
    delete values.password;
    return values;
};

// Stream için RTSP URL oluşturma metodu
Stream.prototype.generateRTSPUrl = function () {
    const brand = this.camera ? this.camera.brand.toLowerCase() : '';

    if (brand === 'dahua') {
        return `rtsp://${this.username}:${this.password}@${this.ip_address}:${this.rtsp_port}/cam/realmonitor?channel=${this.channel}&subtype=0`;
    } else if (brand === 'samsung') {
        return `rtsp://${this.username}:${this.password}@${this.ip_address}:${this.rtsp_port}/profile1/media.smp`;
    } else if (brand === 'hikvision') {
        return `rtsp://${this.username}:${this.password}@${this.ip_address}:${this.rtsp_port}/Streaming/Channels/${this.channel}01/`;
    } else {
        // Generic RTSP URL
        return `rtsp://${this.username}:${this.password}@${this.ip_address}:${this.rtsp_port}/`;
    }
};

// Static methods
Camera.getWithStreamCounts = async function () {
    return await this.findAll({
        include: [{
            model: Stream,
            as: 'streams',
            attributes: []
        }],
        attributes: [
            'id', 'name', 'brand', 'model', 'is_active',
            [sequelize.fn('COUNT', sequelize.col('streams.id')), 'stream_count']
        ],
        group: ['Camera.id']
    });
};

Stream.getActiveStreams = async function () {
    return await this.findAll({
        where: {
            status: ['streaming', 'starting']
        },
        include: [{
            model: Camera,
            as: 'camera'
        }, {
            model: Category,
            as: 'categories'
        }]
    });
};

Category.getWithStreamCounts = async function () {
    return await this.findAll({
        where: { is_active: true },
        include: [{
            model: Stream,
            as: 'streams',
            attributes: [],
            where: { is_active: true },
            required: false
        }],
        attributes: [
            'id', 'name', 'description', 'color', 'icon', 'sort_order',
            [sequelize.fn('COUNT', sequelize.col('streams.id')), 'stream_count']
        ],
        group: ['Category.id'],
        order: [['sort_order', 'ASC']]
    });
};

// Stream'e kategori ekleme metodu
Stream.prototype.addToCategory = async function (categoryId) {
    try {
        await StreamCategory.create({
            stream_id: this.id,
            category_id: categoryId
        });
        return true;
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            // Zaten bu kategoride
            return false;
        }
        throw error;
    }
};

// Stream'den kategori çıkarma metodu
Stream.prototype.removeFromCategory = async function (categoryId) {
    const deleted = await StreamCategory.destroy({
        where: {
            stream_id: this.id,
            category_id: categoryId
        }
    });
    return deleted > 0;
};

// Stream'in kategorilerini güncelleme metodu
Stream.prototype.updateCategories = async function (categoryIds) {
    // Mevcut kategorileri sil
    await StreamCategory.destroy({
        where: { stream_id: this.id }
    });

    // Yeni kategorileri ekle
    if (categoryIds && categoryIds.length > 0) {
        const streamCategories = categoryIds.map(categoryId => ({
            stream_id: this.id,
            category_id: categoryId
        }));

        await StreamCategory.bulkCreate(streamCategories);
    }
};

module.exports = { Camera, Stream, Category, StreamCategory };