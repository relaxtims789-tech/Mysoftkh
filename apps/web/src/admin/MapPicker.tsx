import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * OpenStreetMap with the branch point and its allowed radius. Click the map to move the point.
 * Read-only when onChange is not given.
 */
export function MapPicker({ lat, lng, radius, onChange, small, extra }: {
  lat: number; lng: number; radius: number; onChange?: (lat: number, lng: number) => void; small?: boolean;
  extra?: { lat: number; lng: number; label: string; color?: string }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ circle: L.Circle; dot: L.CircleMarker; extra: L.LayerGroup } | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([lat, lng], 17);
    // OSM's tile policy requires a Referer; the page-wide policy could be stricter, so set it on the tiles too.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(m);
    const circle = L.circle([lat, lng], { radius, color: '#1d4ed8', weight: 2, fillOpacity: 0.12 }).addTo(m);
    const dot = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(m);
    const extraLayer = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
    map.current = m;
    layers.current = { circle, dot, extra: extraLayer };
    setTimeout(() => m.invalidateSize(), 50);
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const l = layers.current;
    if (!l || !map.current || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    l.circle.setLatLng([lat, lng]).setRadius(radius);
    l.dot.setLatLng([lat, lng]);
    if (!map.current.getBounds().contains([lat, lng])) map.current.panTo([lat, lng]);
  }, [lat, lng, radius]);

  useEffect(() => {
    const l = layers.current;
    if (!l) return;
    l.extra.clearLayers();
    for (const p of extra ?? []) {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: p.color ?? '#d03b3b', fillOpacity: 1 }).bindTooltip(p.label).addTo(l.extra);
    }
  }, [extra]);

  return <div ref={box} className={`map-box${small ? ' small' : ''}`} />;
}
