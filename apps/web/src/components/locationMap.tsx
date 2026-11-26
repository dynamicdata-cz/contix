/**
 * Mapa lokalit (v1.114, ADR-206) – Leaflet, dlaždice přes server CONTIXu (/api/premises/map/tiles),
 * takže prohlížeč nekomunikuje s cizími servery. Značky jsou kreslené (bez obrázků).
 */
import { api } from "@/lib/api";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  selected?: boolean;
}

export function LocationMap({
  points,
  attribution,
  onSelect,
  onPick,
  height = 280,
  testId,
}: {
  points: MapPoint[];
  attribution: string;
  onSelect?: (id: string) => void;
  /** klik do mapy nastaví polohu (úprava lokality) */
  onPick?: (lat: number, lng: number) => void;
  height?: number;
  testId?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([49.8, 15.5], 7);
    m.attributionControl.setPrefix(false);
    L.tileLayer(api.premises.tileUrl(), { maxZoom: 19, attribution }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => pick.current?.(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [attribution]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const p of points) {
      const mk = L.circleMarker([p.lat, p.lng], { radius: p.selected ? 9 : 7, color: p.selected ? "#b91c1c" : "#1d4ed8", weight: 2, fillOpacity: 0.6 }).bindTooltip(p.label);
      if (onSelect) mk.on("click", () => onSelect(p.id));
      mk.addTo(g);
    }
    if (points.length === 1) m.setView([points[0]!.lat, points[0]!.lng], Math.max(m.getZoom(), 15));
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.2), { maxZoom: 15 });
  }, [points, onSelect]);

  return <div ref={el} style={{ height }} className="z-0 w-full rounded-md border border-slate-200" data-testid={testId} />;
}
