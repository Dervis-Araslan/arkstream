const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

class WebSocketService {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // Map<ws, clientInfo>
        this.rooms = new Map(); // Map<roomName, Set<ws>>
        this.heartbeatInterval = null;
        this.cleanupInterval = null;
        this.isRunning = false;
    }

    // WebSocket server'ı HTTP server'a bağla
    attach(server) {
        this.wss = new WebSocket.Server({
            server,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });

        this.wss.on('connection', this.handleConnection.bind(this));
        this.startHeartbeat();
        this.startCleanup();
        this.isRunning = true;

        console.log('✅ WebSocket server attached and running');
    }

    // Client authentication
    async verifyClient(info) {
        try {
            const query = url.parse(info.req.url, true).query;
            const token = query.token;

            if (!token) {
                console.log('❌ WebSocket connection rejected: No token provided');
                return false;
            }

            // JWT token'ı verify et
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // User bilgisini req'e ekle
            info.req.user = {
                id: decoded.id,
                username: decoded.username,
                role: decoded.role
            };

            return true;
        } catch (error) {
            console.log('❌ WebSocket auth failed:', error.message);
            return false;
        }
    }

    // Yeni WebSocket bağlantısını handle et
    handleConnection(ws, req) {
        const user = req.user;
        const clientId = this.generateClientId();
        const clientIp = req.connection.remoteAddress || req.headers['x-forwarded-for'];

        // Client bilgilerini sakla
        const clientInfo = {
            id: clientId,
            user: user,
            ip: clientIp,
            userAgent: req.headers['user-agent'],
            connectedAt: new Date(),
            lastPing: new Date(),
            lastActivity: new Date(),
            subscriptions: new Set(),
            isAlive: true
        };

        this.clients.set(ws, clientInfo);

        console.log(`🔌 WebSocket client connected: ${user.username} (${clientId}) from ${clientIp}`);

        // Welcome message gönder
        this.sendToClient(ws, 'connection:established', {
            clientId,
            serverTime: new Date(),
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });

        // Event handlers
        ws.on('message', (data) => this.handleMessage(ws, data));
        ws.on('close', (code, reason) => this.handleDisconnection(ws, code, reason));
        ws.on('error', (error) => this.handleError(ws, error));
        ws.on('pong', () => this.handlePong(ws));

        // Auto-subscribe based on role
        this.autoSubscribe(ws, user);
    }

    // Mesaj işleme
    handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            const clientInfo = this.clients.get(ws);

            if (!clientInfo) {
                console.warn('⚠️ Message from unknown client');
                return;
            }

            // Activity timestamp güncelle
            clientInfo.lastActivity = new Date();

            console.log(`📨 Message from ${clientInfo.user.username}: ${message.type}`);

            switch (message.type) {
                case 'ping':
                    this.handlePing(ws);
                    break;

                case 'subscribe':
                    this.handleSubscribe(ws, message.data);
                    break;

                case 'unsubscribe':
                    this.handleUnsubscribe(ws, message.data);
                    break;

                case 'stream:join':
                    this.handleStreamJoin(ws, message.data);
                    break;

                case 'stream:leave':
                    this.handleStreamLeave(ws, message.data);
                    break;

                case 'viewer:update':
                    this.handleViewerUpdate(ws, message.data);
                    break;

                case 'chat:message':
                    this.handleChatMessage(ws, message.data);
                    break;

                default:
                    console.log(`❓ Unknown message type: ${message.type}`);
                    this.sendToClient(ws, 'error', {
                        message: 'Unknown message type',
                        type: message.type
                    });
            }
        } catch (error) {
            console.error('💥 WebSocket message handling error:', error);
            this.sendToClient(ws, 'error', {
                message: 'Invalid message format',
                error: error.message
            });
        }
    }

    // Ping handler
    handlePing(ws) {
        this.sendToClient(ws, 'pong', {
            timestamp: new Date(),
            serverUptime: process.uptime()
        });
    }

    // Pong handler
    handlePong(ws) {
        const clientInfo = this.clients.get(ws);
        if (clientInfo) {
            clientInfo.lastPing = new Date();
            clientInfo.isAlive = true;
        }
    }

    // Subscribe handler
    handleSubscribe(ws, data) {
        const { channels } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !Array.isArray(channels)) {
            this.sendToClient(ws, 'error', { message: 'Invalid subscribe data' });
            return;
        }

        const subscribedChannels = [];
        const rejectedChannels = [];

        channels.forEach(channel => {
            if (this.hasChannelPermission(clientInfo.user, channel)) {
                clientInfo.subscriptions.add(channel);
                this.addToRoom(ws, channel);
                subscribedChannels.push(channel);
            } else {
                rejectedChannels.push(channel);
            }
        });

        this.sendToClient(ws, 'subscribed', {
            subscribed: subscribedChannels,
            rejected: rejectedChannels,
            totalSubscriptions: clientInfo.subscriptions.size
        });

        console.log(`📡 ${clientInfo.user.username} subscribed to: ${subscribedChannels.join(', ')}`);
    }

    // Unsubscribe handler
    handleUnsubscribe(ws, data) {
        const { channels } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !Array.isArray(channels)) {
            this.sendToClient(ws, 'error', { message: 'Invalid unsubscribe data' });
            return;
        }

        channels.forEach(channel => {
            clientInfo.subscriptions.delete(channel);
            this.removeFromRoom(ws, channel);
        });

        this.sendToClient(ws, 'unsubscribed', {
            channels,
            totalSubscriptions: clientInfo.subscriptions.size
        });

        console.log(`📡 ${clientInfo.user.username} unsubscribed from: ${channels.join(', ')}`);
    }

    // Stream join handler
    handleStreamJoin(ws, data) {
        const { streamId, quality = 'auto' } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !streamId) {
            this.sendToClient(ws, 'error', { message: 'Invalid stream join data' });
            return;
        }

        const roomName = `stream:${streamId}`;
        this.addToRoom(ws, roomName);
        clientInfo.subscriptions.add(roomName);

        // Room'daki viewer sayısını al
        const viewerCount = this.getRoomSize(roomName);

        // Diğer viewer'lara bildir
        this.broadcastToRoom(roomName, 'viewer:joined', {
            streamId,
            viewerCount,
            user: {
                id: clientInfo.user.id,
                username: clientInfo.user.username
            }
        }, ws);

        // Joiner'a onay gönder
        this.sendToClient(ws, 'stream:joined', {
            streamId,
            viewerCount,
            quality,
            joinedAt: new Date()
        });

        console.log(`🎬 ${clientInfo.user.username} joined stream ${streamId} (${viewerCount} viewers)`);
    }

    // Stream leave handler
    handleStreamLeave(ws, data) {
        const { streamId } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !streamId) {
            this.sendToClient(ws, 'error', { message: 'Invalid stream leave data' });
            return;
        }

        const roomName = `stream:${streamId}`;
        this.removeFromRoom(ws, roomName);
        clientInfo.subscriptions.delete(roomName);

        const viewerCount = this.getRoomSize(roomName);

        // Diğer viewer'lara bildir
        this.broadcastToRoom(roomName, 'viewer:left', {
            streamId,
            viewerCount,
            user: {
                id: clientInfo.user.id,
                username: clientInfo.user.username
            }
        });

        // Leaver'a onay gönder
        this.sendToClient(ws, 'stream:left', {
            streamId,
            leftAt: new Date()
        });

        console.log(`🎬 ${clientInfo.user.username} left stream ${streamId} (${viewerCount} viewers)`);
    }

    // Viewer update handler (quality change, buffering, etc.)
    handleViewerUpdate(ws, data) {
        const { streamId, type, value } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !streamId || !type) return;

        const roomName = `stream:${streamId}`;

        // Admin'lere viewer activity bildir
        this.broadcastToSubscribers('admin:viewer-activity', 'viewer:activity', {
            streamId,
            user: clientInfo.user.username,
            activity: type,
            value,
            timestamp: new Date()
        });

        console.log(`👀 Viewer activity: ${clientInfo.user.username} - ${type} on stream ${streamId}`);
    }

    // Chat message handler
    handleChatMessage(ws, data) {
        const { streamId, message } = data;
        const clientInfo = this.clients.get(ws);

        if (!clientInfo || !streamId || !message) {
            this.sendToClient(ws, 'error', { message: 'Invalid chat data' });
            return;
        }

        const roomName = `stream:${streamId}`;

        // Chat mesajını stream'deki herkese gönder
        this.broadcastToRoom(roomName, 'chat:message', {
            streamId,
            user: {
                id: clientInfo.user.id,
                username: clientInfo.user.username,
                role: clientInfo.user.role
            },
            message: message.trim(),
            timestamp: new Date()
        });

        console.log(`💬 Chat message in stream ${streamId} from ${clientInfo.user.username}: ${message}`);
    }

    // Disconnection handler
    handleDisconnection(ws, code, reason) {
        const clientInfo = this.clients.get(ws);

        if (clientInfo) {
            console.log(`🔌 WebSocket client disconnected: ${clientInfo.user.username} (${clientInfo.id}) - Code: ${code}`);

            // Tüm room'lardan çıkar ve bildir
            clientInfo.subscriptions.forEach(subscription => {
                this.removeFromRoom(ws, subscription);

                // Stream room'larında viewer left mesajı gönder
                if (subscription.startsWith('stream:')) {
                    const streamId = subscription.replace('stream:', '');
                    const viewerCount = this.getRoomSize(subscription);

                    this.broadcastToRoom(subscription, 'viewer:left', {
                        streamId,
                        viewerCount,
                        user: {
                            id: clientInfo.user.id,
                            username: clientInfo.user.username
                        }
                    });
                }
            });

            this.clients.delete(ws);
        }
    }

    // Error handler
    handleError(ws, error) {
        const clientInfo = this.clients.get(ws);
        console.error('💥 WebSocket error:', error.message, clientInfo ? clientInfo.user.username : 'unknown');
    }

    // Role'e göre otomatik subscription
    autoSubscribe(ws, user) {
        const autoChannels = [];

        switch (user.role) {
            case 'admin':
                autoChannels.push('admin:alerts', 'admin:viewer-activity', 'system:all', 'streams:all');
                break;
            case 'operator':
                autoChannels.push('streams:all', 'system:status');
                break;
            case 'viewer':
                autoChannels.push('system:status');
                break;
        }

        if (autoChannels.length > 0) {
            this.handleSubscribe(ws, { channels: autoChannels });
        }
    }

    // Tek client'a mesaj gönder
    sendToClient(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type,
                    data,
                    timestamp: new Date()
                }));
            } catch (error) {
                console.error('Error sending message to client:', error);
            }
        }
    }

    // Tüm client'lara broadcast
    broadcast(type, data, excludeWs = null) {
        const message = JSON.stringify({
            type,
            data,
            timestamp: new Date()
        });

        let sentCount = 0;
        this.clients.forEach((clientInfo, ws) => {
            if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    sentCount++;
                } catch (error) {
                    console.error('Error broadcasting to client:', error);
                }
            }
        });

        console.log(`📡 Broadcast sent to ${sentCount} clients: ${type}`);
    }

    // Room'a broadcast
    broadcastToRoom(roomName, type, data, excludeWs = null) {
        const room = this.rooms.get(roomName);
        if (!room || room.size === 0) return;

        const message = JSON.stringify({
            type,
            data,
            timestamp: new Date()
        });

        let sentCount = 0;
        room.forEach(ws => {
            if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    sentCount++;
                } catch (error) {
                    console.error('Error broadcasting to room:', error);
                }
            }
        });

        console.log(`📡 Room broadcast sent to ${sentCount} clients in ${roomName}: ${type}`);
    }

    // Subscriber'lara broadcast
    broadcastToSubscribers(channel, type, data) {
        let sentCount = 0;
        this.clients.forEach((clientInfo, ws) => {
            if (clientInfo.subscriptions.has(channel) && ws.readyState === WebSocket.OPEN) {
                try {
                    this.sendToClient(ws, type, data);
                    sentCount++;
                } catch (error) {
                    console.error('Error broadcasting to subscriber:', error);
                }
            }
        });

        console.log(`📡 Channel broadcast sent to ${sentCount} subscribers of ${channel}: ${type}`);
    }

    // Room management
    addToRoom(ws, roomName) {
        if (!this.rooms.has(roomName)) {
            this.rooms.set(roomName, new Set());
        }
        this.rooms.get(roomName).add(ws);
    }

    removeFromRoom(ws, roomName) {
        const room = this.rooms.get(roomName);
        if (room) {
            room.delete(ws);
            if (room.size === 0) {
                this.rooms.delete(roomName);
            }
        }
    }

    getRoomSize(roomName) {
        const room = this.rooms.get(roomName);
        return room ? room.size : 0;
    }

    // Permission check
    hasChannelPermission(user, channel) {
        switch (channel) {
            case 'admin:alerts':
            case 'admin:viewer-activity':
            case 'system:all':
                return user.role === 'admin';

            case 'streams:all':
                return ['admin', 'operator'].includes(user.role);

            case 'system:status':
                return ['admin', 'operator', 'viewer'].includes(user.role);

            default:
                if (channel.startsWith('stream:')) {
                    return true; // Public stream'ler için herkes
                }
                return false;
        }
    }

    // Heartbeat system
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.clients.forEach((clientInfo, ws) => {
                if (!clientInfo.isAlive) {
                    console.log(`💀 Terminating dead connection: ${clientInfo.user.username}`);
                    ws.terminate();
                    return;
                }

                clientInfo.isAlive = false;
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            });
        }, 30000); // 30 saniyede bir
    }

    // Cleanup system
    startCleanup() {
        this.cleanupInterval = setInterval(() => {
            // Inactive connection'ları temizle
            const now = Date.now();
            const inactiveTimeout = 5 * 60 * 1000; // 5 dakika

            this.clients.forEach((clientInfo, ws) => {
                if (now - clientInfo.lastActivity.getTime() > inactiveTimeout) {
                    console.log(`🧹 Cleaning up inactive connection: ${clientInfo.user.username}`);
                    ws.close(1000, 'Inactive connection');
                }
            });

            // Empty room'ları temizle
            this.rooms.forEach((clients, roomName) => {
                if (clients.size === 0) {
                    this.rooms.delete(roomName);
                }
            });
        }, 60000); // 1 dakikada bir
    }

    // Stream event notifiers
    notifyStreamStarted(streamId, streamData) {
        this.broadcastToSubscribers('streams:all', 'stream:started', {
            streamId,
            ...streamData,
            timestamp: new Date()
        });

        console.log(`🎬 Stream started notification sent: ${streamId}`);
    }

    notifyStreamStopped(streamId, reason = 'normal') {
        this.broadcastToSubscribers('streams:all', 'stream:stopped', {
            streamId,
            reason,
            timestamp: new Date()
        });

        this.broadcastToRoom(`stream:${streamId}`, 'stream:ended', {
            streamId,
            reason,
            timestamp: new Date()
        });

        console.log(`🎬 Stream stopped notification sent: ${streamId} (${reason})`);
    }

    notifyStreamError(streamId, error) {
        this.broadcastToSubscribers('streams:all', 'stream:error', {
            streamId,
            error: error.message || error,
            timestamp: new Date()
        });

        this.broadcastToRoom(`stream:${streamId}`, 'stream:error', {
            streamId,
            error: error.message || error,
            timestamp: new Date()
        });

        console.log(`🎬 Stream error notification sent: ${streamId} - ${error}`);
    }

    notifyViewerCountUpdate(streamId, viewerCount) {
        this.broadcastToRoom(`stream:${streamId}`, 'viewer:count', {
            streamId,
            viewerCount,
            timestamp: new Date()
        });
    }

    // System notifications
    notifySystemAlert(alert) {
        this.broadcastToSubscribers('admin:alerts', 'system:alert', {
            ...alert,
            timestamp: new Date()
        });

        console.log(`🚨 System alert sent: ${alert.type} - ${alert.message}`);
    }

    notifyDashboardUpdate(stats) {
        this.broadcastToSubscribers('system:status', 'dashboard:update', {
            ...stats,
            timestamp: new Date()
        });
    }

    // Admin notifications
    notifyAdmins(type, data) {
        let sentCount = 0;
        this.clients.forEach((clientInfo, ws) => {
            if (clientInfo.user.role === 'admin' && ws.readyState === WebSocket.OPEN) {
                this.sendToClient(ws, type, data);
                sentCount++;
            }
        });

        console.log(`👑 Admin notification sent to ${sentCount} admins: ${type}`);
    }

    // User-specific notification
    notifyUser(userId, type, data) {
        let sent = false;
        this.clients.forEach((clientInfo, ws) => {
            if (clientInfo.user.id === userId && ws.readyState === WebSocket.OPEN) {
                this.sendToClient(ws, type, data);
                sent = true;
            }
        });

        if (sent) {
            console.log(`👤 User notification sent to user ${userId}: ${type}`);
        }
    }

    // Admin controls
    kickUser(userId, reason = 'Admin action') {
        let kicked = false;
        this.clients.forEach((clientInfo, ws) => {
            if (clientInfo.user.id === userId) {
                this.sendToClient(ws, 'connection:terminated', { reason });
                ws.close(1000, reason);
                kicked = true;
            }
        });

        if (kicked) {
            console.log(`👢 User kicked: ${userId} - ${reason}`);
        }

        return kicked;
    }

    kickAllUsers(reason = 'Server maintenance') {
        const clientCount = this.clients.size;
        this.broadcast('connection:terminated', { reason });

        this.clients.forEach((clientInfo, ws) => {
            ws.close(1000, reason);
        });

        console.log(`👢 All users kicked (${clientCount}) - ${reason}`);
    }

    // Statistics
    getConnectionStats() {
        const stats = {
            totalConnections: this.clients.size,
            totalRooms: this.rooms.size,
            isRunning: this.isRunning,
            userBreakdown: {
                admin: 0,
                operator: 0,
                viewer: 0
            },
            roomBreakdown: {},
            topRooms: []
        };

        // User role breakdown
        this.clients.forEach(clientInfo => {
            stats.userBreakdown[clientInfo.user.role]++;
        });

        // Room breakdown
        this.rooms.forEach((clients, roomName) => {
            stats.roomBreakdown[roomName] = clients.size;
        });

        // Top 10 rooms by size
        stats.topRooms = Object.entries(stats.roomBreakdown)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([room, count]) => ({ room, count }));

        return stats;
    }

    getClientList() {
        const clients = [];
        this.clients.forEach(clientInfo => {
            clients.push({
                id: clientInfo.id,
                user: {
                    id: clientInfo.user.id,
                    username: clientInfo.user.username,
                    role: clientInfo.user.role
                },
                ip: clientInfo.ip,
                connectedAt: clientInfo.connectedAt,
                lastActivity: clientInfo.lastActivity,
                subscriptions: Array.from(clientInfo.subscriptions),
                isAlive: clientInfo.isAlive
            });
        });
        return clients;
    }

    // Utilities
    generateClientId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    isHealthy() {
        return this.isRunning && this.wss && this.wss.readyState === WebSocket.OPEN;
    }

    // Cleanup
    close() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        if (this.wss) {
            this.wss.close();
        }

        this.isRunning = false;
        console.log('🔌 WebSocket server closed');
    }
}

module.exports = WebSocketService;