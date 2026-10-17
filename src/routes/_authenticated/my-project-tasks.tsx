import { createFileRoute, redirect } from "@tanstack/react-router";

// Proje görevleri artık "Görevlerim" ekranında ayrı bir sekme. Eski adres
// (bildirimler, yer imleri) oraya yönlendirilir.
export const Route = createFileRoute("/_authenticated/my-project-tasks")({
  beforeLoad: () => {
    throw redirect({ to: "/my-jobs", hash: "proje" });
  },
});
