import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().min(7).max(20).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().min(7).max(20).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().min(1),
});
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  token: z.string().min(1),
});
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

export const deleteMeSchema = z.object({
  currentPassword: z.string().min(1),
});
export type DeleteMeInput = z.infer<typeof deleteMeSchema>;
