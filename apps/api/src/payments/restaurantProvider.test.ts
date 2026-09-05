import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { StripeProvider } from "./StripeProvider.js";
import { SafepayProvider } from "./SafepayProvider.js";
import {
  buildProviderFromAccount,
  canProcessOnlinePayments,
  hasActiveRestaurantPaymentAccount,
  resolveRestaurantPaymentProvider,
} from "./restaurantProvider.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import mongoose from "mongoose";

const accountIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await RestaurantPaymentAccount.deleteMany({ _id: { $in: accountIds } });
  await closeTestConnections();
});

describe("buildProviderFromAccount", () => {
  it("Phase 37 — builds a platform_connect StripeProvider from the PLATFORM's own key, never a decrypted restaurant secret", () => {
    const account = {
      provider: "stripe",
      connectionMode: "platform_connect",
      connectedAccountId: "acct_unit_test_123",
    } as never;
    const provider = buildProviderFromAccount(account);
    expect(provider).toBeInstanceOf(StripeProvider);
    expect(provider.name).toBe("stripe");
  });

  it("Phase 37 — throws a clear error for a platform_connect account with no connectedAccountId", () => {
    const account = { provider: "stripe", connectionMode: "platform_connect" } as never;
    expect(() => buildProviderFromAccount(account)).toThrow(/connectedAccountId/);
  });

  it("builds a real StripeProvider from a decrypted stripe account", () => {
    const account = {
      provider: "stripe",
      encryptedCredentials: encryptCredentials({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc" }),
    } as never;
    const provider = buildProviderFromAccount(account);
    expect(provider).toBeInstanceOf(StripeProvider);
    expect(provider.name).toBe("stripe");
  });

  it("builds a real SafepayProvider from a decrypted safepay account", () => {
    const account = {
      provider: "safepay",
      encryptedCredentials: encryptCredentials({
        apiKey: "api-key",
        secretKey: "secret-key",
        webhookSecret: "webhook-secret",
        env: "sandbox",
      }),
    } as never;
    const provider = buildProviderFromAccount(account);
    expect(provider).toBeInstanceOf(SafepayProvider);
    expect(provider.name).toBe("safepay");
  });
});

describe("resolveRestaurantPaymentProvider", () => {
  it("returns null when the restaurant has no active BYOC account", async () => {
    const result = await resolveRestaurantPaymentProvider(new mongoose.Types.ObjectId().toString());
    expect(result).toBeNull();
  });

  it("resolves the active account's provider and accountId when one exists", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const account = await RestaurantPaymentAccount.create({
      restaurantId,
      businessId: new mongoose.Types.ObjectId(),
      provider: "stripe",
      status: "active",
      encryptedCredentials: encryptCredentials({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc" }),
      credentialFingerprint: "sk_test_····abc",
      connectedByUserId: new mongoose.Types.ObjectId(),
    });
    accountIds.push(account.id as string);

    const result = await resolveRestaurantPaymentProvider(restaurantId.toString());
    expect(result).not.toBeNull();
    expect(result!.provider.name).toBe("stripe");
    expect(result!.accountId).toBe(account.id);
  });

  it("ignores a disconnected account for the same restaurant", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const account = await RestaurantPaymentAccount.create({
      restaurantId,
      businessId: new mongoose.Types.ObjectId(),
      provider: "stripe",
      status: "disconnected",
      encryptedCredentials: encryptCredentials({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc" }),
      credentialFingerprint: "sk_test_····abc",
      connectedByUserId: new mongoose.Types.ObjectId(),
    });
    accountIds.push(account.id as string);

    const result = await resolveRestaurantPaymentProvider(restaurantId.toString());
    expect(result).toBeNull();
  });
});

describe("hasActiveRestaurantPaymentAccount (Phase 42)", () => {
  it("returns false when the restaurant has no active account", async () => {
    expect(await hasActiveRestaurantPaymentAccount(new mongoose.Types.ObjectId().toString())).toBe(false);
  });

  it("returns true when an active account exists, without needing STRIPE_SECRET_KEY or decrypting anything", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const account = await RestaurantPaymentAccount.create({
      restaurantId,
      businessId: new mongoose.Types.ObjectId(),
      provider: "stripe",
      connectionMode: "platform_connect",
      status: "active",
      connectedAccountId: "acct_unit_test_active",
      connectedByUserId: new mongoose.Types.ObjectId(),
    });
    accountIds.push(account.id as string);

    expect(await hasActiveRestaurantPaymentAccount(restaurantId.toString())).toBe(true);
  });

  it("returns false for a disconnected account, same as the payment-resolution path", async () => {
    const restaurantId = new mongoose.Types.ObjectId();
    const account = await RestaurantPaymentAccount.create({
      restaurantId,
      businessId: new mongoose.Types.ObjectId(),
      provider: "stripe",
      connectionMode: "platform_connect",
      status: "disconnected",
      connectedAccountId: "acct_unit_test_disconnected",
      connectedByUserId: new mongoose.Types.ObjectId(),
    });
    accountIds.push(account.id as string);

    expect(await hasActiveRestaurantPaymentAccount(restaurantId.toString())).toBe(false);
  });
});

describe("canProcessOnlinePayments (Phase 42 — the BYOC-required safety rule)", () => {
  it("blocks a restaurant with no own account once the pooled default is a real provider", () => {
    expect(canProcessOnlinePayments(false, "stripe")).toBe(false);
    expect(canProcessOnlinePayments(false, "safepay")).toBe(false);
  });

  it("allows a restaurant with no own account while the pooled default is still the mock provider (dev/test/demo)", () => {
    expect(canProcessOnlinePayments(false, "mock")).toBe(true);
  });

  it("always allows a restaurant that has its own connected account, regardless of the pooled default", () => {
    expect(canProcessOnlinePayments(true, "stripe")).toBe(true);
    expect(canProcessOnlinePayments(true, "safepay")).toBe(true);
    expect(canProcessOnlinePayments(true, "mock")).toBe(true);
  });
});
