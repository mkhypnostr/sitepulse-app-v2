import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";

export type AppRole = "admin" | "technical_office" | "contractor" | "customer";

interface AuthState {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  refreshRole: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function loadRole(userId: string | undefined) {
    if (!userId) {
      setRole(null);
      return;
    }
    // Role lookup is server-side so an RLS/query error can never silently
    // downgrade a technical-office user to the customer interface.
    const { data, error } = await supabase.rpc("get_my_app_role");
    if (error) {
      console.error("Kullanıcı rolü alınamadı", error);
      setRole(null);
      return;
    }
    setRole((data ?? "customer") as AppRole);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      loadRole(s?.user?.id);
      router.invalidate();
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadRole(data.session?.user?.id).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const value: AuthState = {
    user: session?.user ?? null,
    session,
    role,
    loading,
    refreshRole: async () => {
      await loadRole(session?.user?.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
