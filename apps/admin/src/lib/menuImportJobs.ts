import type { MenuImportJobDetail, MenuImportJobSummary, MenuImportSourceType, MenuImportUserAction } from "@restaurant/types";
import { apiClient } from "./api";

/** Thin wrappers around Stage 1's 6 async menu-import-job endpoints — mirrors uploads.ts's own
 *  "just the request, caller owns the UI state" convention. */

export async function createMenuImportJob(
  restaurantId: string,
  sourceType: MenuImportSourceType,
  input: { files: File[] } | { url: string }
): Promise<MenuImportJobSummary> {
  if ("url" in input) {
    const { job } = await apiClient.request<{ job: MenuImportJobSummary }>(`/restaurants/${restaurantId}/menu/import-jobs`, {
      method: "POST",
      body: { url: input.url },
    });
    return job;
  }
  const formData = new FormData();
  formData.append("sourceType", sourceType);
  for (const file of input.files) formData.append("files", file);
  const { job } = await apiClient.request<{ job: MenuImportJobSummary }>(`/restaurants/${restaurantId}/menu/import-jobs`, {
    method: "POST",
    body: formData,
  });
  return job;
}

export async function listMenuImportJobs(restaurantId: string): Promise<MenuImportJobSummary[]> {
  const { jobs } = await apiClient.request<{ jobs: MenuImportJobSummary[] }>(`/restaurants/${restaurantId}/menu/import-jobs`);
  return jobs;
}

export async function getMenuImportJob(restaurantId: string, jobId: string): Promise<MenuImportJobDetail> {
  const { job } = await apiClient.request<{ job: MenuImportJobDetail }>(`/restaurants/${restaurantId}/menu/import-jobs/${jobId}`);
  return job;
}

export interface UpdateMenuImportDraftRowPatch {
  categoryName?: string;
  itemName?: string;
  description?: string;
  price?: number;
  isAvailable?: boolean;
  sortOrder?: number;
  imageUrl?: string;
  userAction?: MenuImportUserAction;
}

export async function updateMenuImportDraftRow(
  restaurantId: string,
  jobId: string,
  rowNumber: number,
  patch: UpdateMenuImportDraftRowPatch
): Promise<MenuImportJobDetail> {
  const { job } = await apiClient.request<{ job: MenuImportJobDetail }>(
    `/restaurants/${restaurantId}/menu/import-jobs/${jobId}/rows/${rowNumber}`,
    { method: "PATCH", body: patch }
  );
  return job;
}

export async function publishMenuImportJob(
  restaurantId: string,
  jobId: string,
  defaultDuplicateStrategy: "skip" | "update" | "merge" = "skip"
): Promise<MenuImportJobDetail> {
  const { job } = await apiClient.request<{ job: MenuImportJobDetail }>(`/restaurants/${restaurantId}/menu/import-jobs/${jobId}/publish`, {
    method: "POST",
    body: { defaultDuplicateStrategy },
  });
  return job;
}

export async function cancelMenuImportJob(restaurantId: string, jobId: string): Promise<MenuImportJobDetail> {
  const { job } = await apiClient.request<{ job: MenuImportJobDetail }>(`/restaurants/${restaurantId}/menu/import-jobs/${jobId}/cancel`, {
    method: "POST",
  });
  return job;
}
