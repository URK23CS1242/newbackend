// --- Imports ---
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// --- Initialize Express ---
const app = express();

// Request Logger
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadDir)) {
  require('fs').mkdirSync(uploadDir);
}

// --- Middleware ---
const corsOptions = {
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://iamgroot-214e3.web.app',
      'https://iamgroot-214e3.firebaseapp.com'
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// =============================
// 📦 SCHEMAS & MODELS
// =============================

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  profileImage: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  incomingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  outgoingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const User = mongoose.model('User', userSchema);

// Friend Request Schema
const friendRequestSchema = new mongoose.Schema(
  {
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

const FriendRequest = mongoose.model('FriendRequest', friendRequestSchema);

// Blink (Post) Schema
const blinkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  content: { type: String, maxlength: 200 },
  likes: { type: Number, default: 0 },
  comments: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  mediaUrl: String,
  mediaType: { type: String, enum: ['image', 'video', 'none', null] },
});

const Blink = mongoose.model('Blink', blinkSchema);

// =============================
// 🖼 MULTER CONFIG
// =============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only images and videos are allowed'));
  },
});

// =============================
// 👥 AUTH ROUTES
// =============================

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const newUser = new User({ name, email, password });
    await newUser.save();
    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({ message: 'Login successful', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// =============================
// ✨ BLINK ROUTES
// =============================

// Get All Blinks
app.get('/api/blinks', async (req, res) => {
  try {
    const blinks = await Blink.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'name email');

    const result = blinks.map((b) => {
      const obj = b.toObject();
      // Construct full URL for media if it exists
      if (obj.mediaUrl) {
        obj.mediaDataUrl = `${process.env.BACKEND_URL || 'https://newbackend-9u98.onrender.com'}/uploads/${obj.mediaUrl}`;
      }
      return obj;
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching blinks' });
  }
});

// Create Blink
app.post('/api/blinks', upload.single('media'), async (req, res) => {
  try {
    const { userId, content } = req.body;

    if (content && content.split(' ').length > 15)
      return res.status(400).json({ message: 'Blink cannot exceed 15 words' });

    const newBlink = new Blink({
      userId,
      content,
      mediaType: req.file ? (req.file.mimetype.startsWith('image/') ? 'image' : 'video') : 'none',
      mediaUrl: req.file ? req.file.filename : null,
    });

    await newBlink.save();
    res.status(201).json(newBlink);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error creating blink' });
  }
});

// =============================
// 🤝 FRIEND REQUEST ROUTES
// =============================

// Check Friend Request Status
app.get('/api/friend-requests/check/:fromUserId/:toUserId', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.params;

    // Validate users exist
    const [sender, receiver] = await Promise.all([
      User.findById(fromUserId),
      User.findById(toUserId)
    ]);

    if (!sender || !receiver) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already friends
    if (sender.friends.includes(toUserId)) {
      return res.json({ status: 'friends' });
    }

    // Check for pending requests
    if (sender.outgoingRequests.includes(toUserId) || receiver.incomingRequests.includes(fromUserId)) {
      return res.json({ status: 'pending' });
    }

    // No relationship exists
    return res.json({ status: 'none' });

    res.json({ status, requestId });
  } catch (err) {
    console.error('Error checking friend request:', err);
    res.status(500).json({ message: 'Error checking friend request status' });
  }
});

// Send Friend Request
app.post('/api/friend-request', async (req, res) => {
  try {
    const { fromUser, toUser } = req.body;

    if (!fromUser || !toUser) {
      return res.status(400).json({ message: 'Both fromUser and toUser are required' });
    }
    if (fromUser === toUser) {
      return res.status(400).json({ message: 'Cannot send request to yourself' });
    }

    // Already friends?
    const sender = await User.findById(fromUser);
    if (sender.friends.includes(toUser)) {
      return res.status(400).json({ message: 'Already friends' });
    }

    // Check if pending
    const existingRequest = await FriendRequest.findOne({
      fromUser,
      toUser,
      status: 'pending',
    });

    if (existingRequest) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }

    const newRequest = new FriendRequest({ fromUser, toUser });
    await newRequest.save();

    res.status(201).json({ message: 'Friend request sent successfully', requestId: newRequest._id });
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ message: 'Error sending friend request' });
  }
});

// Cancel (delete) a pending friend request
app.delete('/api/friend-request/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await FriendRequest.findById(requestId);

    if (!request) return res.status(404).json({ message: 'Friend request not found' });
    if (request.status !== 'pending')
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });

    await FriendRequest.findByIdAndDelete(requestId);
    res.json({ message: 'Friend request cancelled' });
  } catch (err) {
    console.error('Error cancelling friend request:', err);
    res.status(500).json({ message: 'Error cancelling friend request' });
  }
});

// Get All Pending Friend Requests for a User
app.get('/api/friend-requests/:userId', async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      toUser: req.params.userId,
      status: 'pending',
    }).populate('fromUser', 'name email');

    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching friend requests' });
  }
});

// Accept / Reject Friend Request
app.put('/api/friend-request/:requestId', async (req, res) => {
  try {
    const { status } = req.body;
    const request = await FriendRequest.findById(req.params.requestId);

    if (!request) return res.status(404).json({ message: 'Friend request not found' });

    request.status = status;
    await request.save();

    if (status === 'accepted') {
      await User.findByIdAndUpdate(request.fromUser, { $addToSet: { friends: request.toUser } });
      await User.findByIdAndUpdate(request.toUser, { $addToSet: { friends: request.fromUser } });
    }

    res.json({ message: `Friend request ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating friend request' });
  }
});

// Send Friend Request
app.post('/api/friend-request', async (req, res) => {
  try {
    const { fromUser, toUser } = req.body;

    // Validate users exist
    const [sender, receiver] = await Promise.all([
      User.findById(fromUser),
      User.findById(toUser)
    ]);

    if (!sender || !receiver) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already friends
    if (sender.friends.includes(toUser)) {
      return res.status(400).json({ message: 'Already friends' });
    }

    // Check for existing requests
    if (sender.outgoingRequests.includes(toUser) || receiver.incomingRequests.includes(fromUser)) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }

    // Add to requests arrays
    sender.outgoingRequests.push(toUser);
    receiver.incomingRequests.push(fromUser);

    await Promise.all([sender.save(), receiver.save()]);

    res.status(201).json({ message: 'Friend request sent successfully' });
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ message: 'Error sending friend request' });
  }
});

// Get Pending Friend Requests
app.get('/api/friend-requests/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('incomingRequests', 'name email profileImage');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.incomingRequests);
  } catch (err) {
    console.error('Error fetching friend requests:', err);
    res.status(500).json({ message: 'Error fetching friend requests' });
  }
});

// Accept/Reject Friend Request
app.put('/api/friend-request/:requestId', async (req, res) => {
  try {
    const { fromUser, toUser, status } = req.body;

    if (!fromUser || !toUser) {
      return res.status(400).json({ message: 'Missing user IDs' });
    }

    // Get both users with populated fields
    const [sender, receiver] = await Promise.all([
      User.findById(fromUser)
        .select('name email profileImage friends incomingRequests outgoingRequests'),
      User.findById(toUser)
        .select('name email profileImage friends incomingRequests outgoingRequests')
    ]);

    if (!sender || !receiver) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Log for debugging
    console.log('Sender:', sender._id, 'Receiver:', receiver._id);
    console.log('Sender outgoing:', sender.outgoingRequests);
    console.log('Receiver incoming:', receiver.incomingRequests);

    // Check if request exists
    const requestExists = receiver.incomingRequests.some(id => id.toString() === sender._id.toString()) &&
                         sender.outgoingRequests.some(id => id.toString() === receiver._id.toString());
    
    if (!requestExists) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    // Remove request from both users' arrays
    receiver.incomingRequests = receiver.incomingRequests.filter(
      id => id.toString() !== sender._id.toString()
    );
    sender.outgoingRequests = sender.outgoingRequests.filter(
      id => id.toString() !== receiver._id.toString()
    );

    if (status === 'accepted') {
      // Add to friends arrays if not already friends
      const senderHasFriend = sender.friends.some(
        id => id.toString() === receiver._id.toString()
      );
      const receiverHasFriend = receiver.friends.some(
        id => id.toString() === sender._id.toString()
      );

      if (!senderHasFriend) {
        sender.friends.push(receiver._id);
      }
      if (!receiverHasFriend) {
        receiver.friends.push(sender._id);
      }
    }

    // Save both users
    await Promise.all([sender.save(), receiver.save()]);

    // Return updated user data with populated friends
    const updatedReceiver = await User.findById(receiver._id)
      .populate('friends', 'name email profileImage')
      .select('-password');

    res.json({ 
      message: status === 'accepted' ? 'Friend request accepted' : 'Friend request rejected',
      status,
      user: updatedReceiver
    });
  } catch (err) {
    console.error('Error handling friend request:', err);
    res.status(500).json({ message: 'Error handling friend request' });
  }
});

// Get User's Friends
app.get('/api/friends/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friends', 'name email profileImage');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.friends);
  } catch (err) {
    console.error('Error fetching friends:', err);
    res.status(500).json({ message: 'Error fetching friends' });
  }
});

// Get User Data
app.get('/api/users/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('friends', 'name email profileImage')
      .populate('incomingRequests', 'name email profileImage')
      .populate('outgoingRequests', 'name email profileImage')
      .select('-password');  // Exclude password from response

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user data:', err);
    res.status(500).json({ message: 'Error fetching user data' });
  }
});

// Remove Friend
app.delete('/api/friends/:userId/:friendId', async (req, res) => {
  try {
    const { userId, friendId } = req.params;

    const [user, friend] = await Promise.all([
      User.findById(userId),
      User.findById(friendId)
    ]);

    if (!user || !friend) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove from both users' friends arrays
    user.friends = user.friends.filter(id => id.toString() !== friendId);
    friend.friends = friend.friends.filter(id => id.toString() !== userId);

    await Promise.all([user.save(), friend.save()]);

    res.json({ message: 'Friend removed successfully' });
  } catch (err) {
    console.error('Error removing friend:', err);
    res.status(500).json({ message: 'Error removing friend' });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// =============================
// 🚀 START SERVER
// =============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API URL: ${process.env.BACKEND_URL || 'http://localhost:' + PORT}`);
});
