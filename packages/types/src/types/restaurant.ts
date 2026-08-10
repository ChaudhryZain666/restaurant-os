export type RestaurantStatus = "pending" | "active" | "suspended";

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: RestaurantStatus;
  createdAt: string;
}
