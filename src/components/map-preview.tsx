import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPinned } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  extractMapCoordinates,
  googleMapsCoordinateEmbedUrl,
  googleMapsEmbedUrl,
  isShortGoogleMapsUrl,
  safeMapUrl,
  type MapCoordinates,
} from "@/lib/map-location";
import { cn } from "@/lib/utils";

type ResolveMapResponse = {
  latitude: number | null;
  longitude: number | null;
};

export function MapPreview({
  mapUrl,
  fallbackQuery,
  className,
  compact = false,
}: {
  mapUrl: string | null | undefined;
  fallbackQuery?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const safeUrl = safeMapUrl(mapUrl);
  const directCoordinates = extractMapCoordinates(safeUrl);
  const isShortLink = isShortGoogleMapsUrl(safeUrl);
  const resolvedLocation = useQuery({
    queryKey: ["resolved-map-location", safeUrl],
    enabled: Boolean(safeUrl && !directCoordinates && !isShortLink),
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } =
        await supabase.functions.invoke<ResolveMapResponse>(
          "resolve-map-location",
          { body: { url: safeUrl } },
        );
      if (error) throw error;
      if (
        data?.latitude == null ||
        data?.longitude == null ||
        !Number.isFinite(data.latitude) ||
        !Number.isFinite(data.longitude)
      ) {
        return null;
      }
      return {
        latitude: data.latitude,
        longitude: data.longitude,
      } satisfies MapCoordinates;
    },
  });

  if (!safeUrl) return null;

  if (isShortLink) {
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm font-bold text-highlight transition-colors hover:bg-primary/5",
          className,
        )}
      >
        <span className="flex items-center gap-2">
          <MapPinned className="h-4 w-4" /> Haritada Aç
        </span>
        <ExternalLink className="h-4 w-4" />
      </a>
    );
  }

  const mapCoordinates = directCoordinates ?? resolvedLocation.data;
  const embedUrl = mapCoordinates
    ? googleMapsCoordinateEmbedUrl(mapCoordinates)
    : googleMapsEmbedUrl(fallbackQuery);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-muted/20",
        className,
      )}
    >
      <div className={cn("relative bg-primary/5", compact ? "h-32" : "h-48")}>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title="Konum haritası"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="pointer-events-none h-full w-full border-0"
            tabIndex={-1}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_68%)]">
            <MapPinned className="h-10 w-10 text-highlight/70" />
          </div>
        )}
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Konumu haritada aç"
          className="absolute inset-0 z-10"
        />
        {resolvedLocation.isFetching ? (
          <div className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-bold shadow">
            Konum hazırlanıyor…
          </div>
        ) : null}
      </div>
      <a
        href={safeUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-highlight hover:bg-primary/5"
      >
        <span className="flex items-center gap-2">
          <MapPinned className="h-4 w-4" /> Konumu haritada aç
        </span>
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}
