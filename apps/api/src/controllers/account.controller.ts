import type { Request, Response } from "express";
import { Types } from "mongoose";
import type { AddressInput, UpdateAddressInput } from "@restaurant/validation";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

/**
 * Every handler below operates exclusively on req.user!.id (the authenticated token's own
 * subject) — there is no userId route param anywhere in this file. That is the entire ownership
 * guarantee: a customer can never address another customer's saved addresses because there is no
 * code path that accepts one.
 */

export async function listAddresses(req: Request, res: Response) {
  const user = await User.findById(req.user!.id, "addresses");
  if (!user) throw ApiError.notFound("User not found");
  sendSuccess(res, { addresses: user.toJSON().addresses });
}

export async function addAddress(req: Request, res: Response) {
  const input = req.body as AddressInput;
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound("User not found");

  // Exactly one address is ever marked default: the first one saved, or whichever the client
  // most recently asked to be default.
  const makeDefault = input.isDefault || user.addresses.length === 0;
  if (makeDefault) user.addresses.forEach((a) => (a.isDefault = false));

  user.addresses.push({ ...input, _id: new Types.ObjectId(), isDefault: makeDefault });
  await user.save();
  sendSuccess(res, { addresses: user.toJSON().addresses }, 201);
}

export async function updateAddress(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound("User not found");

  const address = user.addresses.find((a) => a._id.toString() === req.params.addressId);
  if (!address) throw ApiError.notFound("Address not found");

  const input = req.body as UpdateAddressInput;
  if (input.isDefault) user.addresses.forEach((a) => (a.isDefault = false));
  Object.assign(address, input);

  await user.save();
  sendSuccess(res, { addresses: user.toJSON().addresses });
}

export async function deleteAddress(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound("User not found");

  const address = user.addresses.find((a) => a._id.toString() === req.params.addressId);
  if (!address) throw ApiError.notFound("Address not found");

  const wasDefault = address.isDefault;
  user.addresses = user.addresses.filter((a) => a._id.toString() !== req.params.addressId);
  if (wasDefault && user.addresses.length > 0) user.addresses[0].isDefault = true;

  await user.save();
  sendSuccess(res, { addresses: user.toJSON().addresses });
}
