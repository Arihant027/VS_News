import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/user.model.js';
import Category from '../models/category.model.js';
import Newsletter from '../models/newsletter.model.js';
import auth from '../middleware/auth.js';

const router = Router();

// GET all admins and superadmins
router.get('/', auth, async (req, res) => {
  try {
    const admins = await User.find({ userType: { $in: ['admin', 'superadmin'] } });
    res.json(admins);
  } catch (err) { res.status(500).json({ message: 'Server error.', error: err.message }); }
});

// GET stats for the logged-in admin's managed categories
router.get('/my-categories-stats', auth, async (req, res) => {
    try {
        const admin = await User.findById(req.user);
        if (!admin || !admin.categories || admin.categories.length === 0) return res.json([]);
        const stats = await Promise.all(
            admin.categories.map(async (name) => {
                const subscriberCount = await User.countDocuments({ userType: 'user', categories: name });
                const newsletterCount = await Newsletter.countDocuments({ category: name });
                return { name, subscriberCount, newsletterCount };
            })
        );
        res.json(stats);
    } catch (err) { res.status(500).json({ message: 'Server error fetching category stats.', error: err.message }); }
});

// GET all users subscribed to the logged-in admin's categories
router.get('/my-subscribers', auth, async (req, res) => {
    try {
        const admin = await User.findById(req.user);
        if (!admin || !admin.categories || admin.categories.length === 0) return res.json([]); 
        const subscribers = await User.find({ userType: 'user', categories: { $in: admin.categories } }).select('name email categories');
        res.json(subscribers);
    } catch (err) { res.status(500).json({ message: 'Server error fetching subscribers.', error: err.message }); }
});


// GET all users (for sharing dialog)
router.get('/all-users', auth, async (req, res) => {
    try {
        const allUsers = await User.find({ userType: 'user' })
            .select('name email categories')
            .sort({ name: 1 });
        res.json(allUsers);
    } catch (err) {
        res.status(500).json({ message: 'Server error fetching all users.', error: err.message });
    }
});

// POST - Add a new user (by an admin for their categories)
router.post('/add-user', auth, async (req, res) => {
    try {
        const { name, email, categories } = req.body;
        if (!name || !email) {
            return res.status(400).json({ message: 'Name and email are required.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'A user with this email already exists.' });
        }
        
        const defaultPassword = crypto.randomBytes(8).toString('hex');
        const salt = await bcrypt.genSalt();
        const passwordHash = await bcrypt.hash(defaultPassword, salt);

        const newUser = new User({
            name,
            email,
            password: passwordHash,
            userType: 'user',
            categories: categories || [], // CORRECTED: Use categories from request body
            status: 'Active',
        });

        await newUser.save();

        res.status(201).json({
            message: 'User created successfully!',
            user: { _id: newUser._id, name: newUser.name, email: newUser.email },
            password: defaultPassword,
        });

    } catch (err) {
        res.status(500).json({ message: 'Server error while adding user.', error: err.message });
    }
});

router.patch('/remove-user-from-category', auth, async (req, res) => {
    try {
        const { userId, categoryName } = req.body;
        if (!userId || !categoryName) {
            return res.status(400).json({ message: 'User ID and Category Name are required.' });
        }
        
        const admin = await User.findById(req.user);

        // Authorization check
        if (!admin.categories.includes(categoryName)) {
            return res.status(403).json({ message: 'You are not authorized to manage this category.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $pull: { categories: categoryName } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.json({ message: `User was successfully removed from the ${categoryName} category.` });
        
    } catch (err) {
        res.status(500).json({ message: 'Server error while removing user from category.', error: err.message });
    }
});

// FIX: This route now correctly handles adding users to a specific category
router.patch('/add-users-to-category', auth, async (req, res) => {
    try {
        const { userIds, category } = req.body;
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: 'An array of user IDs is required.' });
        }
        if (!category) {
            return res.status(400).json({ message: 'A category must be specified to add users to.' });
        }
        
        const admin = await User.findById(req.user);
        if (!admin.categories.includes(category)) {
            return res.status(403).json({ message: 'You are not authorized to add users to this category.' });
        }
        
        const adminCategory = category; 

        const result = await User.updateMany(
            { _id: { $in: userIds } },
            { $addToSet: { categories: adminCategory } }
        );

        if (result.modifiedCount === 0 && result.matchedCount > 0) {
             return res.json({ message: `Selected users were already in the ${adminCategory} category. No changes made.` });
        }
        
        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'None of the selected users could be found.' });
        }

        res.json({ message: `${result.modifiedCount} user(s) successfully added to the ${adminCategory} category.` });
        
    } catch (err) {
        res.status(500).json({ message: 'Server error while adding users to category.', error: err.message });
    }
});


// POST - Add a new admin (by superadmin)
router.post('/', auth, async (req, res) => {
  try {
    const { name, email, password, categories = [] } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Please provide all required fields." });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'An account with this email already exists.' });
    const salt = await bcrypt.genSalt();
    const passwordHash = await bcrypt.hash(password, salt);
    const newAdmin = new User({ name, email, password: passwordHash, userType: 'admin', categories, status: 'Active' });
    const savedAdmin = await newAdmin.save();
    if (categories.length > 0) {
        await Category.updateMany({ name: { $in: categories } }, { $addToSet: { admins: savedAdmin._id } });
    }
    res.status(201).json(savedAdmin);
  } catch (err) { res.status(500).json({ message: 'Server error while adding admin.', error: err.message }); }
});

// PATCH - Update an admin (by superadmin)
router.patch('/:id', auth, async (req, res) => {
    try {
        const adminId = req.params.id;
        const { name, email, status, categories: newCategories = [], password } = req.body;

        const adminToUpdate = await User.findById(adminId);
        if (!adminToUpdate) return res.status(404).json({ message: "Admin not found" });

        const oldCategories = adminToUpdate.categories;
        
        adminToUpdate.name = name;
        adminToUpdate.email = email;
        adminToUpdate.status = status;
        adminToUpdate.categories = newCategories;

        if (password && password.length > 0) {
            const salt = await bcrypt.genSalt();
            adminToUpdate.password = await bcrypt.hash(password, salt);
        }

        await adminToUpdate.save();

        const added = newCategories.filter(c => !oldCategories.includes(c));
        if (added.length > 0) await Category.updateMany({ name: { $in: added } }, { $addToSet: { admins: adminId } });
        
        const removed = oldCategories.filter(c => !newCategories.includes(c));
        if (removed.length > 0) await Category.updateMany({ name: { $in: removed } }, { $pull: { admins: adminId } });
        
        res.json(adminToUpdate);
    } catch (err) { res.status(500).json({ message: 'Server error while updating admin.', error: err.message }); }
});

// DELETE an admin
router.delete('/:id', auth, async (req, res) => {
  try {
    const adminToDelete = await User.findById(req.params.id);
    if (!adminToDelete) return res.status(404).json({ message: 'Admin not found.' });
    if (adminToDelete.userType === 'superadmin') return res.status(403).json({ message: 'Super Admins cannot be deleted.' });
    await Category.updateMany({ admins: adminToDelete._id }, { $pull: { admins: adminToDelete._id } });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Admin deleted successfully.' });
  } catch (err) { res.status(500).json({ message: 'Server error.', error: err.message }); }
});

// --- Superadmin specific routes from here ---

router.get('/all-regular-users', auth, async (req, res) => {
  try {
    const requester = await User.findById(req.user);
    if (!requester || requester.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Superadmin permission required.' });
    }
    const users = await User.find({ userType: 'user' })
      .select('name email status categories createdAt')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching users.', error: err.message });
  }
});

router.delete('/user/:id', auth, async (req, res) => {
  try {
    const requester = await User.findById(req.user);
    if (!requester || requester.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Superadmin permission required.' });
    }
    const userToDelete = await User.findById(req.params.id);
    if (!userToDelete) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (userToDelete.userType !== 'user') {
        return res.status(400).json({ message: 'This route is only for deleting regular users.' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while deleting user.' });
  }
});

router.post('/super-add-user', auth, async (req, res) => {
    try {
        const requester = await User.findById(req.user);
        if (!requester || requester.userType !== 'superadmin') {
            return res.status(403).json({ message: 'Access denied. Superadmin permission required.' });
        }
        const { name, email, categories } = req.body;
        if (!name || !email) {
            return res.status(400).json({ message: 'Name and email are required.' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'A user with this email already exists.' });
        }
        const defaultPassword = crypto.randomBytes(8).toString('hex');
        const salt = await bcrypt.genSalt();
        const passwordHash = await bcrypt.hash(defaultPassword, salt);
        const newUser = new User({
            name,
            email,
            password: passwordHash,
            userType: 'user',
            categories: categories || [],
            status: 'Active',
        });
        const savedUser = await newUser.save();
        res.status(201).json({
            message: 'User created successfully!',
            user: { _id: savedUser._id, name: savedUser.name, email: savedUser.email },
            password: defaultPassword,
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error while adding user.', error: err.message });
    }
});

router.patch('/user/:id/subscriptions', auth, async (req, res) => {
    try {
        const requester = await User.findById(req.user);
        if (!requester || requester.userType !== 'superadmin') {
            return res.status(403).json({ message: 'Access denied. Superadmin permission required.' });
        }
        const { categories } = req.body;
        if (!Array.isArray(categories)) {
            return res.status(400).json({ message: 'A valid categories array is required.' });
        }
        const userToUpdate = await User.findById(req.params.id);
        if (!userToUpdate) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (userToUpdate.userType !== 'user') {
            return res.status(400).json({ message: 'Subscriptions can only be edited for regular users.' });
        }
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { categories: categories },
            { new: true }
        ).select('-password');
        res.json(updatedUser);
    } catch (err) {
        res.status(500).json({ message: 'Server error while updating user subscriptions.', error: err.message });
    }
});

export default router;