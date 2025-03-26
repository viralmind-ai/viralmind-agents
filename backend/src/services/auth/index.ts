import { NextFunction, Request, Response } from 'express';
import { WalletConnectionModel } from '../../models/Models.ts';

// Middleware to resolve connect token to wallet address
export async function requireWalletAddress(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-connect-token'];
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Connect token is required' });
    return;
  }

  const connection = await WalletConnectionModel.findOne({ token });
  if (!connection) {
    res.status(401).json({ error: 'Invalid connect token' });
    return;
  }

  // Add the wallet address to the request object
  // @ts-ignore - Add walletAddress to the request object
  req.walletAddress = connection.address;
  next();
}

// Function to get address from connect token (for use in routes)
export async function getAddressFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  const connection = await WalletConnectionModel.findOne({ token });
  return connection?.address || null;
}
