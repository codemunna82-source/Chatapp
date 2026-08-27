import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from './logger';

let connecting: Promise<typeof mongoose> | null = null;

export async function connectMongo(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (!connecting) {
    mongoose.set('strictQuery', true);
    connecting = mongoose.connect(uri, {
      // Fail fast rather than hanging indefinitely on a bad URI.
      serverSelectionTimeoutMS: 10_000,
    });
    connecting
      .then(() => logger.info({ uri: redactUri(uri) }, 'MongoDB connected'))
      .catch((err) => logger.error({ err }, 'MongoDB connection failed'));
  }
  return connecting;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  connecting = null;
}

function redactUri(uri: string): string {
  // Never log credentials embedded in a mongodb+srv://user:pass@host URI.
  return uri.replace(/\/\/[^@]+@/, '//[REDACTED]@');
}
