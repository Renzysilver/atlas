/**
 * ATLAS database seed — creates the admin account (tinnybolt@gmail.com)
 * Run: npx prisma db seed   OR   bun prisma/seed.ts
 *
 * Set ATLAS_ADMIN_PASSWORD env var before running, or it defaults to
 * "atlas-admin-change-me" — change it immediately after first login.
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100_000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

function cuid(): string {
  // Simple cuid-like ID for seeding
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function main() {
  const adminEmail = "tinnybolt@gmail.com";
  const adminPassword = process.env.ATLAS_ADMIN_PASSWORD || "atlas-admin-change-me";

  console.log(`\n⚡ ATLAS Seed — creating admin: ${adminEmail}`);

  // Check if already exists
  const existing = await db.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log("  → Admin already exists, updating role to 'admin'...");
    await db.user.update({
      where: { email: adminEmail },
      data: { role: "admin", isActive: true },
    });
    console.log("  ✓ Done — admin role confirmed");
    return;
  }

  const userId = cuid();

  await db.user.create({
    data: {
      id: userId,
      email: adminEmail,
      name: "Vali (Admin)",
      passwordHash: hashPassword(adminPassword),
      role: "admin",
      isActive: true,
      emailVerified: true,
      subscription: {
        create: {
          id: cuid(),
          tier: "vip",
          status: "active",
          priceKobo: 0, // comped
          billingCycle: "monthly",
        },
      },
    },
  });

  console.log(`  ✓ Admin created`);
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Password: ${adminPassword}`);
  console.log(`  Tier:     VIP (comped)`);
  console.log(`\n  ⚠️  Change the password at /login after first sign-in!\n`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
