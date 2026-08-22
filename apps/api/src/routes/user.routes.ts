import { Router } from "express";
import { addressSchema, updateAddressSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { addAddress, deleteAddress, listAddresses, updateAddress } from "../controllers/account.controller.js";

/** The authenticated user's own saved addresses — identity-scoped, not tenant-scoped. */
export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get("/me/addresses", asyncHandler(listAddresses));
userRouter.post("/me/addresses", validateBody(addressSchema), asyncHandler(addAddress));
userRouter.patch("/me/addresses/:addressId", validateBody(updateAddressSchema), asyncHandler(updateAddress));
userRouter.delete("/me/addresses/:addressId", asyncHandler(deleteAddress));
