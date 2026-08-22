import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 22 — a controllable stand-in for real DNS, read only by MockDnsVerifier (selected when
 * DNS_VERIFIER=mock, the default outside production). Tests/dev seed a row here to simulate
 * "this hostname's DNS TXT records currently contain X" without needing real, ownable DNS
 * infrastructure for every test hostname — the same documented exception this project already
 * relies on for e2e tests reading real invite tokens directly from Mongo instead of a real inbox,
 * not a new convention. Kept as its own collection (not folded into DomainMapping) specifically so
 * verification-mismatch/wrong-domain/no-record scenarios can be simulated independently of what a
 * DomainMapping actually expects — exercising the real matching logic, not bypassing it.
 */
const mockDnsRecordSchema = new Schema(
  {
    hostname: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    txtValues: { type: [String], default: [] },
  },
  { timestamps: true, toJSON: idTransform }
);

export type MockDnsRecordDoc = InferSchemaType<typeof mockDnsRecordSchema>;
export const MockDnsRecord = model<MockDnsRecordDoc>("MockDnsRecord", mockDnsRecordSchema);
