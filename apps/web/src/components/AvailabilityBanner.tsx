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
    <div role="status" className="animate-slide-up border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center sm:px-6">
      <p className="flex items-center justify-center gap-2 text-sm font-medium text-amber-900">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
        {message}
      </p>
    </div>
  );
}
