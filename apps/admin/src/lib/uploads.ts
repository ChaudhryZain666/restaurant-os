import { apiClient } from "./api";

export type UploadPurpose = "logo" | "coverImage" | "menuItemImage";

/** POSTs a file to the restaurant's upload endpoint and returns its public URL. Callers still
 *  save that URL themselves through the same PATCH endpoints they already use for a
 *  manually-typed URL (updateRestaurant / updateMenuItem) — this only handles getting the file
 *  into storage and back as a URL. */
export async function uploadRestaurantImage(restaurantId: string, purpose: UploadPurpose, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("purpose", purpose);
  formData.append("file", file);
  const { url } = await apiClient.request<{ url: string }>(`/restaurants/${restaurantId}/uploads`, {
    method: "POST",
    body: formData,
  });
  return url;
}
