const { User } = require('../models');

// Check if user is authenticated
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    // If it's an API request, return JSON
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }

    // Otherwise redirect to login
    res.redirect('/admin/login');
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.userId && req.session.role === 'admin') {
        return next();
    }

    // If it's an API request, return JSON
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    // Otherwise redirect with error
    res.status(403).render('error', {
        title: 'Access Denied',
        error: {
            status: 403,
            message: 'You need admin privileges to access this page.'
        }
    });
};

// Load current user data
const loadUser = async (req, res, next) => {
    if (req.session && req.session.userId) {
        try {
            const user = await User.findByPk(req.session.userId);
            if (user && user.is_active) {
                req.user = user;
                res.locals.currentUser = user;
            } else {
                // User doesn't exist or is inactive
                req.session.destroy();
                delete req.user;
                delete res.locals.currentUser;
            }
        } catch (error) {
            console.error('Error loading user:', error);
        }
    }
    next();
};

// Check user permissions
const checkPermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return requireAuth(req, res, next);
        }

        const userRole = req.user.role;
        const permissions = {
            'admin': ['view', 'create', 'edit', 'delete', 'manage_users', 'manage_cameras'],
            'user': ['view', 'create', 'edit'],
            'viewer': ['view']
        };

        if (permissions[userRole] && permissions[userRole].includes(permission)) {
            return next();
        }

        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                message: `Permission '${permission}' required`
            });
        }

        res.status(403).render('error', {
            title: 'Permission Denied',
            error: {
                status: 403,
                message: `You don't have permission to ${permission}.`
            }
        });
    };
};

module.exports = {
    requireAuth,
    requireAdmin,
    loadUser,
    checkPermission
};