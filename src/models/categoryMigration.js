'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Categories tablosunu oluştur
        await queryInterface.createTable('categories', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4
            },
            name: {
                type: Sequelize.STRING(100),
                allowNull: false,
                unique: true
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            color: {
                type: Sequelize.STRING(7),
                allowNull: true,
                defaultValue: '#007bff'
            },
            icon: {
                type: Sequelize.STRING(50),
                allowNull: true,
                defaultValue: 'camera'
            },
            sort_order: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            is_active: {
                type: Sequelize.BOOLEAN,
                defaultValue: true
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        // Stream-Category many-to-many ara tablosunu oluştur
        await queryInterface.createTable('stream_categories', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4
            },
            stream_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'streams',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            category_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'categories',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        // Index'leri oluştur
        await queryInterface.addIndex('categories', ['sort_order']);
        await queryInterface.addIndex('categories', ['is_active']);
        await queryInterface.addIndex('stream_categories', ['stream_id']);
        await queryInterface.addIndex('stream_categories', ['category_id']);

        // Unique constraint - bir stream bir kategoriye sadece bir kez eklenebilir
        await queryInterface.addIndex('stream_categories', ['stream_id', 'category_id'], {
            unique: true,
            name: 'unique_stream_category'
        });
    },

    async down(queryInterface, Sequelize) {
        // Stream-Category ara tablosunu sil
        await queryInterface.dropTable('stream_categories');

        // Categories tablosunu sil
        await queryInterface.dropTable('categories');
    }
};