import { Schema, model, Types } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

export interface ModifierOptionSubdoc {
  _id: Types.ObjectId;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
  sortOrder: number;
}

// Explicit interface rather than InferSchemaType: a subdocument array whose entries keep their
// own _id (needed so order creation can reference exactly which option was picked) produces a
// Mongoose DocumentArray/Subdocument type that InferSchemaType cannot flatten cleanly — the same
// class of problem documented in apps/api/src/models/User.ts, just triggered by a nested
// subdocument array here instead of an imported enum.
export interface ModifierGroupDoc {
  restaurantId: Types.ObjectId;
  /** Phase 20 — see Category.ts's businessId for the full rationale. */
  businessId?: Types.ObjectId;
  menuItemId: Types.ObjectId;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: ModifierOptionSubdoc[];
  /** Phase 19 — see Category.ts's clonedFromCategoryId for the full rationale. */
  clonedFromModifierGroupId?: Types.ObjectId;
}

const modifierOptionSchema = new Schema<ModifierOptionSubdoc>({
  name: { type: String, required: true, trim: true },
  priceAdjustment: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
});

const modifierGroupSchema = new Schema<ModifierGroupDoc>(
  {
    // No standalone index on restaurantId: the compound index below already covers
    // restaurantId-only queries via its leading-field prefix.
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", index: true },
    menuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true, index: true },
    name: { type: String, required: true, trim: true },
    minSelect: { type: Number, default: 0, min: 0 },
    maxSelect: { type: Number, default: 1, min: 1 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    options: { type: [modifierOptionSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    clonedFromModifierGroupId: { type: Schema.Types.ObjectId, ref: "ModifierGroup", select: false },
  },
  {
    timestamps: true,
    toJSON: {
      ...idTransform,
      transform(doc, ret) {
        idTransform.transform(doc, ret as Record<string, unknown>);
        const record = ret as unknown as { options?: Array<Record<string, unknown>> };
        record.options?.forEach((opt) => {
          if (opt._id) {
            opt.id = (opt._id as { toString(): string }).toString();
            delete opt._id;
          }
        });
        return ret;
      },
    },
  }
);

modifierGroupSchema.index({ restaurantId: 1, menuItemId: 1 });
modifierGroupSchema.index({ businessId: 1, menuItemId: 1 });

export const ModifierGroup = model<ModifierGroupDoc>("ModifierGroup", modifierGroupSchema);
