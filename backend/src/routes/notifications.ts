import express, { Response } from 'express';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { processOutboxRetries, expireObsoleteOffers } from '../services/notificationService';
import { Role } from '@prisma/client';

const router = express.Router();

/**
 * GET /api/v1/notifications
 * Lists notifications for the authenticated user with optional unreadOnly filter.
 */
router.get('/', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const skip = (page - 1) * limit;
    const typeFilter = req.query.type as string | undefined;

    const whereClause: any = {
      recipientId: userId,
      ...(unreadOnly ? { isRead: false } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to fetch notifications',
    });
  }
});

/**
 * GET /api/v1/notifications/unread-count
 * Returns the unread notification count for badge updates.
 */
router.get('/unread-count', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadCount = await prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });

    return res.status(200).json({
      status: 'success',
      data: { unreadCount },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to retrieve unread notification count',
    });
  }
});

/**
 * PUT /api/v1/notifications/mark-all-read
 * Marks all unread notifications for the user as read.
 */
router.put('/mark-all-read', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });

    return res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read',
      data: { count: result.count },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to mark notifications as read',
    });
  }
});

/**
 * PUT /api/v1/notifications/:id/read
 * Marks a single notification as read, ensuring caller is authorized owner.
 */
router.put('/:id/read', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return res.status(404).json({
        status: 'fail',
        message: 'Notification not found',
      });
    }

    if (notification.recipientId !== userId && req.user!.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        status: 'fail',
        message: 'Forbidden: You cannot modify notifications belonging to another user',
      });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.status(200).json({
      status: 'success',
      data: { notification: updated },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to mark notification as read',
    });
  }
});

/**
 * DELETE /api/v1/notifications/:id
 * Removes a notification, ensuring caller is authorized owner.
 */
router.delete('/:id', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return res.status(404).json({
        status: 'fail',
        message: 'Notification not found',
      });
    }

    if (notification.recipientId !== userId && req.user!.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        status: 'fail',
        message: 'Forbidden: You cannot delete notifications belonging to another user',
      });
    }

    await prisma.notification.delete({
      where: { id },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Notification removed',
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to delete notification',
    });
  }
});

/**
 * POST /api/v1/notifications/trigger-workers
 * Outbox retry & expired offer cleanup worker trigger (Super Admin only).
 */
router.post('/trigger-workers', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        status: 'fail',
        message: 'Forbidden: Super Admin privileges required to trigger notification workers',
      });
    }

    const [retryResults, expiredCount] = await Promise.all([
      processOutboxRetries(),
      expireObsoleteOffers(),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        retried: retryResults,
        expiredOffersCount: expiredCount,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'Failed to process notification workers',
    });
  }
});

export default router;
