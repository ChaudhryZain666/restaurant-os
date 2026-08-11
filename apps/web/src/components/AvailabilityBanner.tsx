import { useRestaurant } from "../context/RestaurantContext";

/** Reusable, restaurant-agnostic — driven entirely by the computed availability from the API. */
export function AvailabilityBanner() {
  const { availability } = useRestaurant();
  if (!availability || availability.status === "open") return null;

  const message =
    availability.status === "closed"
      ? "This restaurant isn't accepting orders right now."
      : availability.reason
        ? `This restaurant has paused ordering: ${availability.reason}`
        : "This restaurant has temporarily paused ordering.";

  return (
    <div
      role="status"
      style={{ background: "#fef3c7", color: "#92400e", padding: "0.75rem 1rem", textAlign: "center" }}
    >
      {message}
    </div>
  );
}
