import { Router } from 'express';
import auth from '../middleware/auth.js';
import Notification from '../models/notification.model.js';

const router = Router();

// GET all recent notifications for the logged-in user (both read and unread)
router.get('/', auth, async (req, res) => {
    try {
        // MODIFICATION: Removed the `isRead: false` filter to fetch all recent notifications.
        const notifications = await Notification.find({ user: req.user })
            .sort({ createdAt: -1 })
            .limit(10); // We still limit to the 10 most recent for performance.
        res.json(notifications);
    } catch (err) {
        res.status(500).json({ message: 'Server error fetching notifications.' });
    }
});

// POST - Mark all notifications as read for the logged-in user
router.post('/mark-as-read', auth, async (req, res) => {
    try {
        await Notification.updateMany({ user: req.user, isRead: false }, { $set: { isRead: true } });
        res.json({ message: 'Notifications marked as read.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error updating notifications.' });
    }
});

export default router;