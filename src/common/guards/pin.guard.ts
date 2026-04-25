/**
 * PIN Guard
 *
 * Verifies the user's 4-digit transaction PIN for sensitive operations.
 * Requires x-txn-pin header.
 * Includes brute-force protection: max 5 attempts per 15-minute window.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';

// Import UsersService instead of User model directly
import { UsersService } from '../../users/users.service';

// Export constant for decorator
export const REQUIRE_PIN_KEY = 'requirePin';

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface PinAttemptRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

@Injectable()
export class PinGuard implements CanActivate {
  private readonly logger = new Logger(PinGuard.name);
  private readonly pinAttempts = new Map<string, PinAttemptRecord>();

  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {
    // Clean up expired entries every 10 minutes
    setInterval(() => this.cleanupExpiredEntries(), 10 * 60 * 1000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if PIN is required for this route
    const requirePin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If @RequirePin() decorator is not present, skip PIN check
    if (!requirePin) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if user is locked out from PIN attempts
    const userId = user.sub;
    this.checkPinLockout(userId);

    // Get PIN from header
    const pin = request.headers['x-txn-pin'];

    if (!pin) {
      throw new BadRequestException(
        'Transaction PIN required. Please provide x-txn-pin header.',
      );
    }

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      throw new BadRequestException('Invalid PIN format. Must be 4 digits.');
    }

    // Get user from database using UsersService
    const dbUser = await this.usersService.findById(user.sub);

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    if (!dbUser.transactionPinHash) {
      throw new ForbiddenException(
        'Transaction PIN not set. Please set your PIN first.',
      );
    }

    // Verify PIN
    const isPinValid = await bcrypt.compare(pin, dbUser.transactionPinHash);

    if (!isPinValid) {
      this.recordFailedAttempt(userId);
      const record = this.pinAttempts.get(userId);
      const remaining = MAX_PIN_ATTEMPTS - (record?.attempts || 0);
      this.logger.warn(`Failed PIN attempt for user ${userId}. ${remaining} attempts remaining.`);

      if (remaining <= 0) {
        throw new ForbiddenException(
          'Too many failed PIN attempts. Account locked for 15 minutes.',
        );
      }

      throw new ForbiddenException(
        `Invalid transaction PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      );
    }

    // Reset attempts on success
    this.pinAttempts.delete(userId);

    return true;
  }

  private checkPinLockout(userId: string): void {
    const record = this.pinAttempts.get(userId);
    if (!record) return;

    if (record.lockedUntil && Date.now() < record.lockedUntil) {
      const remainingMs = record.lockedUntil - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      throw new ForbiddenException(
        `Account locked due to too many failed PIN attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
      );
    }

    // If lockout period expired, reset
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
      this.pinAttempts.delete(userId);
    }
  }

  private recordFailedAttempt(userId: string): void {
    const now = Date.now();
    const record = this.pinAttempts.get(userId);

    if (!record || now - record.firstAttemptAt > PIN_LOCKOUT_MS) {
      // Start new window
      this.pinAttempts.set(userId, {
        attempts: 1,
        firstAttemptAt: now,
        lockedUntil: null,
      });
      return;
    }

    record.attempts += 1;

    if (record.attempts >= MAX_PIN_ATTEMPTS) {
      record.lockedUntil = now + PIN_LOCKOUT_MS;
      this.logger.warn(`User ${userId} locked out due to ${MAX_PIN_ATTEMPTS} failed PIN attempts.`);
    }
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [userId, record] of this.pinAttempts.entries()) {
      if (
        (record.lockedUntil && now >= record.lockedUntil) ||
        (!record.lockedUntil && now - record.firstAttemptAt > PIN_LOCKOUT_MS)
      ) {
        this.pinAttempts.delete(userId);
      }
    }
  }
}