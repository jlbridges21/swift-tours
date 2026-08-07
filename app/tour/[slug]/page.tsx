import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import { getPublicTourBySlug } from "@/lib/queries/public-tours";
import { siteOrigin } from "@/lib/site-url";
import { publicUrl } from "@/lib/storage";

export const revalidate = 60;

/** Opt into on-demand ISR for unknown slugs (required with revalidate). */
export async function generateStaticParams() {
  return [];
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const payload = await getPublicTourBySlug(slug);

  if (!payload) {
    return {
      title: "Tour not found · Swift Tours",
    };
  }

  const { tour, scenes } = payload;
  const description =
    tour.description?.trim() ||
    `Explore “${tour.title}” — a 360° virtual tour on Swift Tours.`;
  const url = `${siteOrigin()}/tour/${slug}`;

  const cover = tour.cover_scene_id
    ? scenes.find((s) => s.id === tour.cover_scene_id)
    : undefined;
  const imagePath = cover?.thumbnail_path ?? null;
  const images = imagePath
    ? [
        {
          url: publicUrl(imagePath),
          width: 640,
          height: 320,
          alt: tour.title,
        },
      ]
    : undefined;

  return {
    title: `${tour.title} · Swift Tours`,
    description,
    openGraph: {
      title: tour.title,
      description,
      type: "website",
      url,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: tour.title,
      description,
      images: images?.map((img) => img.url),
    },
  };
}

export default async function PublicTourPage({ params }: PageProps) {
  const { slug } = await params;
  const payload = await getPublicTourBySlug(slug);

  if (!payload) {
    notFound();
  }

  const { tour, scenes, hotspots } = payload;

  return (
    <TourViewerShell
      tour={tour}
      scenes={scenes}
      hotspots={hotspots}
      trackViews
      showShare
    />
  );
}
