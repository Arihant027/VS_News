import { Router } from 'express';
import bcrypt from 'bcryptjs'; // Import bcryptjs
import auth from '../middleware/auth.js';
import User from '../models/user.model.js';
import Newsletter from '../models/newsletter.model.js';

const router = Router();

// GET Logged-in User's Data
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user).select('-password');
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NEW ENDPOINT TO UPDATE USER PROFILE ---
router.patch('/me/profile', auth, async (req, res) => {
    try {
        const { name, password } = req.body;
        
        // Find the user by the ID from the authentication token
        const user = await User.findById(req.user);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Update name if provided
        if (name) {
            user.name = name;
        }

        // Update password if provided
        if (password) {
            const salt = await bcrypt.genSalt();
            user.password = await bcrypt.hash(password, salt);
        }

        const updatedUser = await user.save();

        // Return the updated user object (excluding the password) so the frontend can update its state
        res.json({
            id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            userType: updatedUser.userType,
        });

    } catch (err) {
        console.error("Profile Update Error:", err);
        res.status(500).json({ message: 'Server error updating profile.', error: err.message });
    }
});
// --- END OF NEW ENDPOINT ---

// PATCH - Update User's Category Preferences
router.patch('/me/categories', auth, async (req, res) => {
    try {
        const { categories } = req.body;
        const updatedUser = await User.findByIdAndUpdate(
            req.user,
            { categories: categories },
            { new: true }
        ).select('-password');
        res.json(updatedUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/my-newsletters', auth, async (req, res) => {
    try {
        // Find all newsletters where the recipients array contains the current user's ID
        const receivedNewsletters = await Newsletter.find({ recipients: req.user })
            .sort({ createdAt: -1 }) // Show the most recent first
            .select('title category createdAt'); // Select only the fields we need

        res.json(receivedNewsletters);
    } catch (err) {
        res.status(500).json({ error: 'Server error while fetching newsletters.' });
    }
});

export default router;