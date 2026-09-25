import type { HydratedDocument, Types } from "mongoose";
import { generateSecureToken, hashToken } from "./secureToken.service.js";
import { OAuthConnectState, type OAuthConnectStateDoc } from "../models/OAuthConnectState.js";
import type { EncryptedBlob } from "../utils/credentialEncryption.js";

// A single-sitting synchronous flow (owner clicks Connect, signs in, comes right back) — 15 minutes
// is generous slack, not a security-vs-usability tradeoff.
const STATE_TTL_MS = 15 * 60 * 1000;

export interface OAuthConnectStateBinding {
  provider: "uber_eats";
  restaurantId: Types.ObjectId | string;
  businessId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  redirectUri: string;
}

/** Mints a fresh, single-use OAuth state value — see OAuthConnectState.ts's own header comment for
 *  the full CSRF/replay-safety reasoning. Only the raw value is ever handed back; the DB keeps only
 *  its hash. */
export async function issueOAuthConnectState(binding: OAuthConnectStateBinding): Promise<{ raw: string }> {
  const { raw, hash } = generateSecureToken();
  await OAuthConnectState.create({
    tokenHash: hash,
    provider: binding.provider,
    restaurantId: binding.restaurantId,
    businessId: binding.businessId,
    userId: binding.userId,
    redirectUri: binding.redirectUri,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return { raw };
}

/** Atomically claims (consumes) a state value — returns null for ANY mismatch: unknown, expired, or
 *  already consumed (replayed). Callers MUST additionally cross-check the returned doc's `userId`
 *  against the authenticated caller before trusting it — the state value alone proves the request
 *  came from someone who saw a genuine authorize redirect, not that it's the SAME person now sitting
 *  in the authenticated session completing the callback. */
export async function consumeOAuthConnectState(raw: string, provider: string): Promise<HydratedDocument<OAuthConnectStateDoc> | null> {
  return OAuthConnectState.findOneAndUpdate(
    { tokenHash: hashToken(raw), provider, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );
}

/** Stashes store-discovery's candidates against an already-consumed state, for the multi-store-picker
 *  follow-up call (`finalizePendingStoreSelection`) — the common single-store case skips this and
 *  finalizes immediately instead. */
export async function savePendingStoreSelection(
  stateId: string,
  candidates: { externalStoreId: string; displayName: string }[],
  encryptedCredentials?: EncryptedBlob,
  credentialFingerprint?: string
): Promise<void> {
  await OAuthConnectState.updateOne(
    { _id: stateId },
    {
      $set: {
        pendingCandidateStores: candidates,
        ...(encryptedCredentials ? { pendingEncryptedCredentials: encryptedCredentials } : {}),
        ...(credentialFingerprint ? { pendingCredentialFingerprint: credentialFingerprint } : {}),
      },
    }
  );
}

export interface FinalizedStoreSelection {
  restaurantId: Types.ObjectId;
  businessId: Types.ObjectId;
  externalStoreId: string;
  encryptedCredentials?: EncryptedBlob;
  credentialFingerprint?: string;
}

/** Finalizes the owner's store pick — re-checks `expectedUserId` against the state document itself
 *  (not a fresh token), so the select-store endpoint can't be used to hijack a different user's
 *  in-flight connection. Returns null if the state, user, or chosen store doesn't match. Returns the
 *  restaurant/business context alongside the pick so the caller never needs a second lookup — tenant
 *  context stays entirely server-derived from the state document, never the request body. */
export async function finalizePendingStoreSelection(
  stateId: string,
  chosenExternalStoreId: string,
  expectedUserId: string
): Promise<FinalizedStoreSelection | null> {
  const state = await OAuthConnectState.findById(stateId);
  if (!state || state.userId.toString() !== expectedUserId) return null;
  const candidate = state.pendingCandidateStores?.find((c) => c.externalStoreId === chosenExternalStoreId);
  if (!candidate) return null;
  return {
    restaurantId: state.restaurantId,
    businessId: state.businessId,
    // `as string` — InferSchemaType's known quirk with plain (non-`required`) subdocument string
    // fields; real and string-typed at runtime, guaranteed set by savePendingStoreSelection.
    externalStoreId: candidate.externalStoreId as string,
    encryptedCredentials: state.pendingEncryptedCredentials as EncryptedBlob | undefined,
    credentialFingerprint: state.pendingCredentialFingerprint as string | undefined,
  };
}
