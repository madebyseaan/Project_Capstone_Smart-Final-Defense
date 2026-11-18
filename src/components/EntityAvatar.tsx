import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getEntityPhotoUrl } from "@/lib/photoUrls";
import type { MediaEntityType } from "@/lib/api";

interface EntityAvatarProps {
  entityType: MediaEntityType;
  id?: string | number | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  size?: "default" | "sm" | "lg";
  fallback: ReactNode;
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
}

/**
 * Avatar backed by EnrollPro's signed photo API. Falls back to the supplied
 * initials/silhouette when the entity has no photo or the service is offline.
 */
export function EntityAvatar({
  entityType,
  id,
  alt,
  className,
  style,
  size,
  fallback,
  fallbackClassName,
  fallbackStyle,
}: EntityAvatarProps) {
  const entityId = id == null ? "" : String(id).trim();

  const { data: photoUrl } = useQuery({
    queryKey: ["entity-photo", entityType, entityId],
    queryFn: () => getEntityPhotoUrl(entityType, entityId),
    enabled: entityId.length > 0,
    // Keep photo URLs for 8 minutes; retry missing photos sooner so a transient
    // EnrollPro outage does not pin the initials fallback for the whole window.
    staleTime: (query) => (query.state.data ? 8 * 60_000 : 30_000),
    gcTime: 10 * 60_000,
    retry: 0,
  });

  return (
    <Avatar className={className} style={style} size={size}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={alt ?? ""} /> : null}
      <AvatarFallback className={fallbackClassName} style={fallbackStyle}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}
