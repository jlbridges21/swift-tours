import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmbedTourClient } from "@/components/viewer/embed-tour-client";
import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import { getPublicTourBySlug } from "@/lib/queries/public-tours";

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

  return {
    title: {
      absolute: payload ? payload.tour.title : "Tour",
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function EmbedTourPage({ params }: PageProps) {
  const { slug } = await params;
  const payload = await getPublicTourBySlug(slug);

  if (!payload) {
    notFound();
  }

  const { tour, scenes, groups, hotspots } = payload;

  return (
    <Suspense
      fallback={
        <TourViewerShell
          tour={tour}
          scenes={scenes}
          groups={groups}
          hotspots={hotspots}
          trackViews
          embedMode
        />
      }
    >
      <EmbedTourClient
        tour={tour}
        scenes={scenes}
        groups={groups}
        hotspots={hotspots}
      />
    </Suspense>
  );
}
