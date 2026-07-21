import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { LoadingState } from "@/components/page-states";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/", replace: true });
  }, [loading, navigate, user]);

  if (loading) return <LoadingState label="Oturum kontrol ediliyor..." />;
  if (!user) return null;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
