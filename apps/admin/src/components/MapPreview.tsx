import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icon references image URLs relative to its own package location,
// which breaks under Vite's bundling (the default paths 404). Re-pointing at Leaflet's own
// bundled assets via `new URL(..., import.meta.url)` is the standard Vite-compatible fix —
// still the same real icon images, just resolved correctly by Vite's asset pipeline.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href,
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href,
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href,
});

interface MapPreviewProps {
  latitude: number;
  longitude: number;
  /** Optional delivery-radius circle, in kilometers — DeliveryPage.tsx's radius config. */
  radiusKm?: number;
  className?: string;
}

/**
 * Phase 28 — a real embedded map, replacing the external "Preview on a map ↗" Google Maps link.
 * Leaflet + OpenStreetMap tiles (confirmed with the user): free, no API key, no billing account —
 * this codebase had no map-rendering library before this. Deliberately view-only: the existing
 * AddressAutocomplete/geocoding flow (Phase 10) stays the only way to CHANGE a location's
 * coordinates — this is a visualization layer over coordinates that are already captured, not a
 * new geocoding path.
 */
export function MapPreview({ latitude, longitude, radiusKm, className }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true, zoomControl: true }).setView([latitude, longitude], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    L.marker([latitude, longitude]).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Only re-initialize the map itself on mount — position/radius updates are handled by the
    // effect below via setView/setLatLng, not a full teardown+rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([latitude, longitude]);
  }, [latitude, longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    if (radiusKm && radiusKm > 0) {
      circleRef.current = L.circle([latitude, longitude], {
        radius: radiusKm * 1000,
        color: "#2563eb",
        fillOpacity: 0.08,
      }).addTo(map);
      map.fitBounds(circleRef.current.getBounds());
    }
  }, [latitude, longitude, radiusKm]);

  return <div ref={containerRef} className={className ?? "h-64 w-full rounded-lg"} role="img" aria-label="Restaurant location map" />;
}
