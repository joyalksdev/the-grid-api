// backend/seed.js
// Database seeding script for initial gaming stations and sample logs

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Import models
const Screen = require('./models/Screen');
const ActivityLog = require('./models/ActivityLog');

// Load environment variables
dotenv.config();

// Sample screens data - 6 gaming stations
const initialScreens = [
  {
    screenId: 1,
    name: 'Screen 1',
    type: 'SimDrive',
    status: 'available',
    activeSession: null
  },
  {
    screenId: 2,
    name: 'Screen 2',
    type: 'Console',
    status: 'available',
    activeSession: null
  },
  {
    screenId: 3,
    name: 'Screen 3',
    type: 'Console',
    status: 'available',
    activeSession: null
  },
  {
    screenId: 4,
    name: 'Screen 4',
    type: 'Console',
    status: 'available',
    activeSession: null
  },
  {
    screenId: 5,
    name: 'Screen 5',
    type: 'Console',
    status: 'available',
    activeSession: null
  },
  {
    screenId: 6,
    name: 'Screen 6',
    type: 'Console',
    status: 'available',
    activeSession: null
  }
];

// Sample logs data - mixed of Cash and UPI payments
const sampleLogs = [
  {
    logId: 'LOG-1001',
    player: 'Rahul Sharma',
    screen: 'Screen 2 (Single)',
    duration: '60 Mins',
    cost: 160,
    payment: 'UPI',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
  },
  {
    logId: 'LOG-1002',
    player: 'Priya Patel',
    screen: 'Screen 1 (SimDrive)',
    duration: '60 Mins',
    cost: 290,
    payment: 'Cash',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000) // 4 hours ago
  },
  {
    logId: 'LOG-1003',
    player: 'Arjun Verma',
    screen: 'Screen 3 (Big)',
    duration: '30 Mins',
    cost: 220,
    payment: 'UPI',
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours ago
  },
  {
    logId: 'LOG-1004',
    player: 'Meera Singh',
    screen: 'Screen 4 (Dual)',
    duration: '30 Mins',
    cost: 140,
    payment: 'Cash',
    timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000) // 8 hours ago
  },
  {
    logId: 'LOG-1005',
    player: 'Kiran Desai',
    screen: 'Screen 1 (SimDrive)',
    duration: '15 Mins',
    cost: 90,
    payment: 'UPI',
    timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000) // 10 hours ago
  }
];

// Seeding function
const seedDatabase = async () => {
  // Production Safety Guard
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ CRITICAL PREVENTED: Cannot run database seeding in production!');
    process.exit(1);
  }
    try {
    // Connect to database
    await connectDB();

    console.log('Starting database seeding...\n');

    // Clear existing data
    console.log('Clearing existing data...');
    await Screen.deleteMany({});
    await ActivityLog.deleteMany({});
    console.log('✓ Existing data cleared\n');

    // Insert screens
    console.log('Seeding gaming stations...');
    const screens = await Screen.insertMany(initialScreens);
    console.log(`✓ ${screens.length} screens seeded successfully`);

    screens.forEach(screen => {
      console.log(`  - Screen ${screen.screenId}: ${screen.name} (${screen.type})`);
    });
    console.log('');

    // Insert logs
    console.log('Seeding activity logs...');
    const logs = await ActivityLog.insertMany(sampleLogs);
    console.log(`✓ ${logs.length} logs seeded successfully`);

    logs.forEach(log => {
      console.log(`  - ${log.logId}: ${log.player} - ₹${log.cost} (${log.payment})`);
    });
    console.log('');

    // Calculate and display metrics
    const totalRevenue = logs.reduce((sum, log) => sum + log.cost, 0);
    console.log('📊 Metrics Summary:');
    console.log(`   Total Revenue: ₹${totalRevenue}`);
    console.log(`   Total Sessions: ${logs.length}`);
    console.log('');

    console.log('✅ Database seeding completed successfully!');

    // Close connection
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding error:', error);
    mongoose.connection.close();
    process.exit(1);
  }
};

// Run seeding
seedDatabase();