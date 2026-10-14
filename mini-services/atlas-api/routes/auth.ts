// ATLAS API — routes/auth.ts
// Authentication: register, login, profile, subscription management

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import crypto from "crypto";

export const authRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return verifyHash === hash;
}

function makeToken(userId: string): string {
  // Simple signed token: base64(payload).base64(sig)
  // In production, swap this for JWT with a proper library
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString("base64url");
  const secret = process.env.ATLAS_TOKEN_SECRET || "atlas-dev-secret-change-in-prod";
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const [payload, sig] = token.split(".");
    const secret = process.env.ATLAS_TOKEN_SECRET || "atlas-dev-secret-change-in-prod";
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

// Auth middleware — attaches req.userId when token is valid
export function requireAuth(req: any, res: any, next: any): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }
  const decoded = verifyToken(header.slice(7));
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.userId = decoded.userId;
  next();
}

export function requireAdmin(req: any, res: any, next: any): void {
  requireAuth(req, res, async () => {
    const user = await db.user.findUnique({ where: { id: req.userId } });
    if (!user || user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

// ─── TIER CONFIG ─────────────────────────────────────────────────────────────

export const TIER_PRICES: Record<string, { monthly: number; weekly: number; label: string }> = {
  free:    { monthly: 0,       weekly: 0,      label: "Free"    },
  starter: { monthly: 300_000, weekly: 80_000, label: "Starter" }, // ₦3,000/mo | ₦800/wk
  pro:     { monthly: 750_000, weekly: 200_000, label: "Pro"    }, // ₦7,500/mo | ₦2,000/wk
  vip:     { monthly: 1_500_000, weekly: 400_000, label: "VIP"  }, // ₦15,000/mo | ₦4,000/wk
};

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// POST /auth/register
authRouter.post("/register", async (req, res) => {
  try {
    const { email, name, phone, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const user = await db.user.create({
      data: {
        email: email.toLowerCase(),
        name: name || null,
        phone: phone || null,
        passwordHash: hashPassword(password),
        role: "subscriber",
        subscription: {
          create: {
            tier: "free",
            status: "active",
            priceKobo: 0,
            billingCycle: "monthly",
          },
        },
      },
      include: { subscription: true },
    });

    logger.info("new user registered", { userId: user.id, email: user.email });

    const token = makeToken(user.id);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tier: user.subscription?.tier || "free",
      },
    });
  } catch (err) {
    logger.error("register error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /auth/login
authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { subscription: true },
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Account suspended. Contact support." });
      return;
    }

    const token = makeToken(user.id);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tier: user.subscription?.tier || "free",
        subscriptionStatus: user.subscription?.status || "none",
        subscriptionExpiresAt: user.subscription?.expiresAt || null,
      },
    });
  } catch (err) {
    logger.error("login error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /auth/me — profile + subscription info
authRouter.get("/me", requireAuth, async (req: any, res) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.userId },
      include: { subscription: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      subscription: user.subscription
        ? {
            tier: user.subscription.tier,
            status: user.subscription.status,
            billingCycle: user.subscription.billingCycle,
            priceKobo: user.subscription.priceKobo,
            priceNaira: user.subscription.priceKobo / 100,
            expiresAt: user.subscription.expiresAt,
            startedAt: user.subscription.startedAt,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// POST /auth/upgrade — upgrade subscription tier (wired to Paystack later)
authRouter.post("/upgrade", requireAuth, async (req: any, res) => {
  try {
    const { tier, billingCycle = "monthly" } = req.body;
    if (!["free", "starter", "pro", "vip"].includes(tier)) {
      res.status(400).json({ error: "Invalid tier. Must be: free, starter, pro, or vip" });
      return;
    }

    const priceKobo = TIER_PRICES[tier][billingCycle as "monthly" | "weekly"] ?? 0;

    const expiresAt = tier === "free" ? null : new Date(
      Date.now() + (billingCycle === "weekly" ? 7 : 30) * 24 * 60 * 60 * 1000
    );

    const subscription = await db.subscription.upsert({
      where: { userId: req.userId },
      create: {
        userId: req.userId,
        tier,
        status: "active",
        priceKobo,
        billingCycle,
        expiresAt,
      },
      update: {
        tier,
        status: "active",
        priceKobo,
        billingCycle,
        expiresAt,
      },
    });

    logger.info("subscription upgraded", {
      userId: req.userId,
      tier,
      billingCycle,
      priceNaira: priceKobo / 100,
    });

    res.json({
      success: true,
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        priceNaira: priceKobo / 100,
        expiresAt: subscription.expiresAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Upgrade failed" });
  }
});

// ─── ADMIN: user management ───────────────────────────────────────────────────

// GET /auth/admin/users — list all users with subscription info
authRouter.get("/admin/users", requireAdmin, async (req: any, res) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const limit = parseInt(String(req.query.limit || "50"), 10);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      db.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { subscription: true },
      }),
      db.user.count(),
    ]);

    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        tier: u.subscription?.tier || "free",
        subscriptionStatus: u.subscription?.status || "none",
        priceNaira: (u.subscription?.priceKobo ?? 0) / 100,
        expiresAt: u.subscription?.expiresAt || null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /auth/admin/stats — subscriber counts by tier, MRR
authRouter.get("/admin/stats", requireAdmin, async (_req, res) => {
  try {
    const [tierCounts, subscriptions] = await Promise.all([
      db.subscription.groupBy({
        by: ["tier", "status"],
        _count: { _all: true },
      }),
      db.subscription.findMany({
        where: { status: "active" },
        select: { priceKobo: true, billingCycle: true },
      }),
    ]);

    // MRR: convert weekly to monthly equivalent
    const mrrKobo = subscriptions.reduce((sum, s) => {
      const monthly = s.billingCycle === "weekly" ? s.priceKobo * 4.33 : s.priceKobo;
      return sum + monthly;
    }, 0);

    const byTier = tierCounts.reduce((acc: any, row) => {
      if (!acc[row.tier]) acc[row.tier] = {};
      acc[row.tier][row.status] = row._count._all;
      return acc;
    }, {});

    const totalUsers = await db.user.count();
    const activeSubscribers = subscriptions.length;

    res.json({
      totalUsers,
      activeSubscribers,
      mrrNaira: Math.round(mrrKobo / 100),
      arrNaira: Math.round((mrrKobo * 12) / 100),
      byTier,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// PATCH /auth/admin/users/:id — update user (toggle active, change role)
authRouter.patch("/admin/users/:id", requireAdmin, async (req: any, res) => {
  try {
    const { isActive, role } = req.body;
    const updated = await db.user.update({
      where: { id: req.params.id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(role && { role }),
      },
    });
    res.json({ success: true, userId: updated.id, isActive: updated.isActive, role: updated.role });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user" });
  }
});
