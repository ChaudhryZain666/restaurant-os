import { Schema, model, Types } from "mongoose";
import { USER_ROLES, type UserRole } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

export interface UserDoc {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Set only for restaurant-scoped roles (owner/manager/staff/kitchen_staff). */
  restaurantId?: Types.ObjectId;
  phone?: string;
  refreshTokenVersion: number;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: "customer", index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", index: true },
    phone: { type: String },
    refreshTokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      ...idTransform,
      transform(doc, ret) {
        idTransform.transform(doc, ret as Record<string, unknown>);
        delete (ret as Record<string, unknown>).passwordHash;
        return ret;
      },
    },
  }
);

export const User = model<UserDoc>("User", userSchema);
