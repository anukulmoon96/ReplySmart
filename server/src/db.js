import fs from 'node:fs/promises';
import mongoose from 'mongoose';

/**
 * Connect to MongoDB. Uses MONGODB_URI when set; otherwise starts an embedded
 * mongod (via mongodb-memory-server) that persists to server/.data/db so the
 * app works without installing MongoDB.
 */
export async function connectDatabase({ mongoUri, embeddedDbPath }) {
  if (mongoUri) {
    await mongoose.connect(mongoUri);
    return { kind: 'mongodb', stop: () => mongoose.disconnect() };
  }

  console.log('MONGODB_URI not set - starting embedded MongoDB (the first run downloads mongod, which can take a few minutes)...');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  await fs.mkdir(embeddedDbPath, { recursive: true });
  const mongod = await MongoMemoryServer.create({
    instance: { dbPath: embeddedDbPath, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(mongod.getUri('replysmart'));
  return {
    kind: 'embedded',
    stop: async () => {
      await mongoose.disconnect();
      await mongod.stop({ doCleanup: false });
    },
  };
}
