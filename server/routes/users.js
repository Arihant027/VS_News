import { Router } from 'express';
import bcrypt from 'bcryptjs';
import auth from '../middleware/auth.js';
import User from '../models/user.model.js';
import Newsletter from '../models/newsletter.model.js';
import sgMail from '@sendgrid/mail'; // Import SendGrid mailer

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

// PATCH - Update User Profile
router.patch('/me/profile', auth, async (req, res) => {
    try {
        const { name, password } = req.body;
        const user = await User.findById(req.user);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (name) {
            user.name = name;
        }
        if (password) {
            const salt = await bcrypt.genSalt();
            user.password = await bcrypt.hash(password, salt);
        }
        const updatedUser = await user.save();
        res.json({
            id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            userType: updatedUser.userType,
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error updating profile.', error: err.message });
    }
});

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

// GET user's received newsletters
router.get('/my-newsletters', auth, async (req, res) => {
    try {
        const receivedNewsletters = await Newsletter.find({ recipients: req.user })
            .sort({ createdAt: -1 })
            .select('title category createdAt');
        res.json(receivedNewsletters);
    } catch (err) {
        res.status(500).json({ error: 'Server error while fetching newsletters.' });
    }
});

// --- NEW ENDPOINT TO EMAIL A NEWSLETTER TO THE LOGGED-IN USER ---
router.post('/send-newsletter-to-self', auth, async (req, res) => {
    // Check if SendGrid is configured
    if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
        return res.status(500).json({ message: 'Email service is not configured on the server.' });
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    try {
        const { newsletterId } = req.body;
        if (!newsletterId) {
            return res.status(400).json({ message: 'Newsletter ID is required.' });
        }

        // 1. Get the logged-in user's details
        const user = await User.findById(req.user).select('name email');
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // 2. Get the newsletter details
        const newsletter = await Newsletter.findById(newsletterId);
        if (!newsletter || !newsletter.pdfContent || !newsletter.pdfContent.data) {
            return res.status(404).json({ message: 'Newsletter or its PDF content not found.' });
        }

        // 3. Construct and send the email
        const msg = {
            to: user.email,
            from: { name: 'NewsLetterAI', email: process.env.FROM_EMAIL },
            subject: `Your Requested Newsletter: ${newsletter.title}`,
            html: `<p>Hi ${user.name || ''},</p><p>As requested, the newsletter "<strong>${newsletter.title}</strong>" is attached to this email.</p>`,
            attachments: [{
                content: newsletter.pdfContent.data.toString('base64'),
                filename: `${newsletter.title.replace(/\s/g, '_')}.pdf`,
                type: 'application/pdf',
                disposition: 'attachment',
            }],
        };
        
        await sgMail.send(msg);

        res.json({ message: `Newsletter successfully sent to ${user.email}.` });

    } catch (err) {
        console.error('Error sending newsletter to self:', err);
        if (err.response) { // If error is from SendGrid API
            console.error(err.response.body);
        }
        res.status(500).json({ message: 'Failed to send email due to a server error.' });
    }
});


export default router;