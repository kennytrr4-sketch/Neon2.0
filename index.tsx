import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Create Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// Health check endpoint
app.get("/make-server-3170f0d7/health", (c) => {
  return c.json({ status: "ok" });
});

// ==================== AUTH ROUTES ====================

// Sign up
app.post("/make-server-3170f0d7/auth/signup", async (c) => {
  try {
    const { name, email, password } = await c.req.json();
    
    // Check if user already exists
    const existingUsers = await kv.get(`user:email:${email}`);
    if (existingUsers) {
      return c.json({ error: 'User already exists' }, 400);
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true
    });

    if (authError || !authData.user) {
      console.log('Auth signup error:', authError);
      return c.json({ error: authError?.message || 'Failed to create user' }, 400);
    }

    // Create user profile
    const userId = authData.user.id;
    const userProfile = {
      id: userId,
      name,
      email,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      bio: '',
      location: '',
      website: '',
      coverPhoto: '',
      joined: new Date().toISOString(),
      friends: 0,
    };

    await kv.set(`user:${userId}`, userProfile);
    await kv.set(`user:email:${email}`, userId);

    return c.json({ success: true, user: userProfile });
  } catch (error) {
    console.log('Signup error:', error);
    return c.json({ error: 'Internal server error during signup' }, 500);
  }
});

// Sign in
app.post("/make-server-3170f0d7/auth/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      console.log('Auth signin error:', error);
      return c.json({ error: error?.message || 'Invalid credentials' }, 401);
    }

    // Get user profile
    const userId = data.user.id;
    const userProfile = await kv.get(`user:${userId}`);

    if (!userProfile) {
      return c.json({ error: 'User profile not found' }, 404);
    }

    // Log the user login with email for welcome message purposes
    console.log('='.repeat(60));
    console.log('🔔 USER LOGIN NOTIFICATION');
    console.log('='.repeat(60));
    console.log(`User Email: ${email}`);
    console.log(`User Name: ${userProfile.name}`);
    console.log(`User ID: ${userId}`);
    console.log(`Login Time: ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    console.log('You can now send a welcome email to:', email);
    console.log('='.repeat(60));

    return c.json({
      success: true,
      user: userProfile,
      access_token: data.session.access_token
    });
  } catch (error) {
    console.log('Signin error:', error);
    return c.json({ error: 'Internal server error during signin' }, 500);
  }
});

// Get session
app.get("/make-server-3170f0d7/auth/session", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: 'No token provided' }, 401);
    }

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const userProfile = await kv.get(`user:${user.id}`);
    
    return c.json({ success: true, user: userProfile });
  } catch (error) {
    console.log('Session error:', error);
    return c.json({ error: 'Internal server error getting session' }, 500);
  }
});

// ==================== USER ROUTES ====================

// Get all users
app.get("/make-server-3170f0d7/users", async (c) => {
  try {
    const users = await kv.getByPrefix('user:user-');
    // Filter out email mappings and return only user profiles
    const userProfiles = users.filter((u: any) => u && u.id && !u.id.includes('email'));
    return c.json({ users: userProfiles });
  } catch (error) {
    console.log('Get users error:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// Get user by ID
app.get("/make-server-3170f0d7/users/:id", async (c) => {
  try {
    const userId = c.req.param('id');
    const user = await kv.get(`user:${userId}`);
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user });
  } catch (error) {
    console.log('Get user error:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

// Update user profile
app.put("/make-server-3170f0d7/users/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const userId = c.req.param('id');
    if (authUser.id !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const updates = await c.req.json();
    const currentUser = await kv.get(`user:${userId}`);
    
    if (!currentUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    const updatedUser = { ...currentUser, ...updates };
    await kv.set(`user:${userId}`, updatedUser);

    return c.json({ success: true, user: updatedUser });
  } catch (error) {
    console.log('Update user error:', error);
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

// ==================== POST ROUTES ====================

// Create post
app.post("/make-server-3170f0d7/posts", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const postData = await c.req.json();
    const postId = `post-${Date.now()}`;
    
    const post = {
      id: postId,
      ...postData,
      timestamp: new Date().toISOString(),
    };

    await kv.set(`post:${postId}`, post);

    return c.json({ success: true, post });
  } catch (error) {
    console.log('Create post error:', error);
    return c.json({ error: 'Failed to create post' }, 500);
  }
});

// Get all posts
app.get("/make-server-3170f0d7/posts", async (c) => {
  try {
    const posts = await kv.getByPrefix('post:');
    // Sort by timestamp (newest first)
    const sortedPosts = posts.sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return c.json({ posts: sortedPosts });
  } catch (error) {
    console.log('Get posts error:', error);
    return c.json({ error: 'Failed to fetch posts' }, 500);
  }
});

// Update post
app.put("/make-server-3170f0d7/posts/:id", async (c) => {
  try {
    const postId = c.req.param('id');
    const updates = await c.req.json();
    
    const currentPost = await kv.get(`post:${postId}`);
    if (!currentPost) {
      return c.json({ error: 'Post not found' }, 404);
    }

    const updatedPost = { ...currentPost, ...updates };
    await kv.set(`post:${postId}`, updatedPost);

    return c.json({ success: true, post: updatedPost });
  } catch (error) {
    console.log('Update post error:', error);
    return c.json({ error: 'Failed to update post' }, 500);
  }
});

// ==================== NOTIFICATION ROUTES ====================

// Create notification
app.post("/make-server-3170f0d7/notifications", async (c) => {
  try {
    const notificationData = await c.req.json();
    const notificationId = `notification-${Date.now()}`;
    
    const notification = {
      id: notificationId,
      ...notificationData,
      timestamp: new Date().toISOString(),
    };

    await kv.set(`notification:${notificationData.userId}:${notificationId}`, notification);

    return c.json({ success: true, notification });
  } catch (error) {
    console.log('Create notification error:', error);
    return c.json({ error: 'Failed to create notification' }, 500);
  }
});

// Get user notifications
app.get("/make-server-3170f0d7/notifications/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const notifications = await kv.getByPrefix(`notification:${userId}:`);
    
    // Sort by timestamp (newest first)
    const sortedNotifications = notifications.sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return c.json({ notifications: sortedNotifications });
  } catch (error) {
    console.log('Get notifications error:', error);
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }
});

// Mark notification as read
app.put("/make-server-3170f0d7/notifications/:userId/:id", async (c) => {
  try {
    const userId = c.req.param('userId');
    const notificationId = c.req.param('id');
    const key = `notification:${userId}:${notificationId}`;
    
    const notification = await kv.get(key);
    if (!notification) {
      return c.json({ error: 'Notification not found' }, 404);
    }

    const updatedNotification = { ...notification, read: true };
    await kv.set(key, updatedNotification);

    return c.json({ success: true, notification: updatedNotification });
  } catch (error) {
    console.log('Update notification error:', error);
    return c.json({ error: 'Failed to update notification' }, 500);
  }
});

// Mark all notifications as read
app.put("/make-server-3170f0d7/notifications/:userId/read-all", async (c) => {
  try {
    const userId = c.req.param('userId');
    const notifications = await kv.getByPrefix(`notification:${userId}:`);
    
    for (const notification of notifications) {
      const updatedNotification = { ...notification, read: true };
      await kv.set(`notification:${userId}:${notification.id}`, updatedNotification);
    }

    return c.json({ success: true });
  } catch (error) {
    console.log('Mark all notifications read error:', error);
    return c.json({ error: 'Failed to mark all notifications as read' }, 500);
  }
});

// ==================== MESSAGE ROUTES ====================

// Send message
app.post("/make-server-3170f0d7/messages", async (c) => {
  try {
    const messageData = await c.req.json();
    const conversationId = [messageData.senderId, messageData.receiverId].sort().join('-');
    const messageId = `message-${Date.now()}`;
    
    const message = {
      id: messageId,
      ...messageData,
      timestamp: new Date().toISOString(),
    };

    await kv.set(`message:${conversationId}:${messageId}`, message);

    return c.json({ success: true, message });
  } catch (error) {
    console.log('Send message error:', error);
    return c.json({ error: 'Failed to send message' }, 500);
  }
});

// Get conversation messages
app.get("/make-server-3170f0d7/messages/:conversationId", async (c) => {
  try {
    const conversationId = c.req.param('conversationId');
    const messages = await kv.getByPrefix(`message:${conversationId}:`);
    
    // Sort by timestamp
    const sortedMessages = messages.sort((a: any, b: any) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return c.json({ messages: sortedMessages });
  } catch (error) {
    console.log('Get messages error:', error);
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});

// ==================== STORY ROUTES ====================

// Create story
app.post("/make-server-3170f0d7/stories", async (c) => {
  try {
    const storyData = await c.req.json();
    const storyId = `story-${Date.now()}`;
    
    const story = {
      id: storyId,
      ...storyData,
      timestamp: new Date().toISOString(),
    };

    await kv.set(`story:${storyId}`, story);

    return c.json({ success: true, story });
  } catch (error) {
    console.log('Create story error:', error);
    return c.json({ error: 'Failed to create story' }, 500);
  }
});

// Get all stories
app.get("/make-server-3170f0d7/stories", async (c) => {
  try {
    const stories = await kv.getByPrefix('story:');
    
    // Filter out stories older than 24 hours
    const now = new Date().getTime();
    const validStories = stories.filter((story: any) => {
      const storyTime = new Date(story.timestamp).getTime();
      return (now - storyTime) < 24 * 60 * 60 * 1000;
    });

    return c.json({ stories: validStories });
  } catch (error) {
    console.log('Get stories error:', error);
    return c.json({ error: 'Failed to fetch stories' }, 500);
  }
});

// ==================== FRIEND ROUTES ====================

// Add friend
app.post("/make-server-3170f0d7/friends", async (c) => {
  try {
    const { userId, friendId } = await c.req.json();
    
    // Store friendship bidirectionally
    await kv.set(`friend:${userId}:${friendId}`, { userId, friendId, timestamp: new Date().toISOString() });
    await kv.set(`friend:${friendId}:${userId}`, { userId: friendId, friendId: userId, timestamp: new Date().toISOString() });

    return c.json({ success: true });
  } catch (error) {
    console.log('Add friend error:', error);
    return c.json({ error: 'Failed to add friend' }, 500);
  }
});

// Remove friend
app.delete("/make-server-3170f0d7/friends/:userId/:friendId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const friendId = c.req.param('friendId');
    
    await kv.del(`friend:${userId}:${friendId}`);
    await kv.del(`friend:${friendId}:${userId}`);

    return c.json({ success: true });
  } catch (error) {
    console.log('Remove friend error:', error);
    return c.json({ error: 'Failed to remove friend' }, 500);
  }
});

// Get user friends
app.get("/make-server-3170f0d7/friends/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const friendships = await kv.getByPrefix(`friend:${userId}:`);
    
    const friendIds = friendships.map((f: any) => f.friendId);
    const friends = [];
    
    for (const friendId of friendIds) {
      const friend = await kv.get(`user:${friendId}`);
      if (friend) {
        friends.push(friend);
      }
    }

    return c.json({ friends });
  } catch (error) {
    console.log('Get friends error:', error);
    return c.json({ error: 'Failed to fetch friends' }, 500);
  }
});

// ==================== CALL ROUTES ====================

// Initiate call
app.post("/make-server-3170f0d7/calls", async (c) => {
  try {
    const callData = await c.req.json();
    const callId = callData.callId || `call-${Date.now()}`;
    
    const call = {
      id: callId,
      ...callData,
      status: 'ringing',
      timestamp: new Date().toISOString(),
    };

    await kv.set(`call:${callId}`, call);

    return c.json({ success: true, call });
  } catch (error) {
    console.log('Initiate call error:', error);
    return c.json({ error: 'Failed to initiate call' }, 500);
  }
});

// Get active calls for user
app.get("/make-server-3170f0d7/calls/:userId", async (c) => {
  try {
    const userId = c.req.param('userId');
    const allCalls = await kv.getByPrefix('call:');
    
    // Filter calls where user is the receiver and status is ringing
    const userCalls = allCalls.filter((call: any) => 
      call.receiverId === userId && call.status === 'ringing'
    );

    return c.json({ calls: userCalls });
  } catch (error) {
    console.log('Get calls error:', error);
    return c.json({ error: 'Failed to fetch calls' }, 500);
  }
});

// Update call status
app.put("/make-server-3170f0d7/calls/:id", async (c) => {
  try {
    const callId = c.req.param('id');
    const { status } = await c.req.json();
    
    const call = await kv.get(`call:${callId}`);
    if (!call) {
      return c.json({ error: 'Call not found' }, 404);
    }

    const updatedCall = { ...call, status };
    await kv.set(`call:${callId}`, updatedCall);

    return c.json({ success: true, call: updatedCall });
  } catch (error) {
    console.log('Update call error:', error);
    return c.json({ error: 'Failed to update call' }, 500);
  }
});

Deno.serve(app.fetch);
